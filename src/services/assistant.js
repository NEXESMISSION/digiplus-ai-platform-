// AI replies and summaries, with plan limits and exact cost tracking.
const db = require('../db');
const ai = require('../ai');
const prompts = require('../prompts');
const { sanitizeSettings } = require('../settings');
const { limitsFor, currentPeriod } = require('../plans');
const { HttpError } = require('../lib/http');

const MAX_HISTORY = 20; // messages sent with each reply (cost grows with history)
const MAX_HISTORY_CHARS = 6_000; // and with their length: 20 long messages would cost ~14x a normal reply
const MIN_KEEP_CHARS = 200; // don't send a uselessly short fragment of an older message
const REPLY_MAX_TOKENS = 1200; // includes reasoning tokens
const SUMMARY_MAX_TOKENS = 2500;
const SUMMARY_IDLE_MINUTES = 10;

async function recordAi(accountId, result, isSummary) {
  if (!result) return;
  await db.recordUsage(accountId, currentPeriod(), result.usage, result.costUsd, isSummary).catch((e) => console.error(`[usage] ${e.message}`));
}

// Counts one AI reply against the account's monthly allowance, then calls the model.
// Returns { ok: true, result } or { ok: false, reason: 'limit' }. A failed call gives the reply back.
async function replyWithAllowance({ account, system, messages }) {
  const period = currentPeriod();
  const { replies } = limitsFor(account);
  if (!(await db.consumeReply(account.id, period, replies))) return { ok: false, reason: 'limit' };
  try {
    const result = await ai.generate({ system, messages, maxOutputTokens: REPLY_MAX_TOKENS });
    await recordAi(account.id, result, false);
    return { ok: true, result };
  } catch (e) {
    await db.releaseReply(account.id, period).catch(() => {});
    if (e.result) await recordAi(account.id, e.result, false);
    throw e;
  }
}

// Keeps the newest messages inside a character budget, so neither one very long
// message nor twenty of them can multiply the cost of every following reply.
// The newest message is always kept (truncated if it alone is over budget).
function trimHistory(messages, budget = MAX_HISTORY_CHARS) {
  const kept = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const content = String(message.content || '');
    if (!content) continue;
    const left = budget - used;
    if (content.length <= left) {
      kept.unshift(message);
      used += content.length;
      continue;
    }
    if (left >= MIN_KEEP_CHARS || !kept.length) kept.unshift({ ...message, content: content.slice(0, Math.max(left, MIN_KEEP_CHARS)) });
    break;
  }
  return kept;
}

async function replyToConversation({ account, bot, conversation }) {
  const settings = sanitizeSettings(bot.settings);
  const history = trimHistory(await db.getRecentMessages(conversation.id, MAX_HISTORY));
  return replyWithAllowance({ account, system: prompts.buildSystemPrompt(settings, conversation), messages: history });
}

async function summarizeConversation(conversationId) {
  if (!(await db.claimSummary(conversationId))) {
    throw new HttpError(409, 'A summary is already being generated — try again in a minute.');
  }
  try {
    const conversation = await db.getConversation(conversationId);
    if (!conversation) throw new HttpError(404, 'Conversation not found');
    const bot = await db.getBot(conversation.bot_id);
    const messages = await db.getMessages(conversationId);
    if (!messages.some((m) => m.role === 'user')) throw new HttpError(400, 'Nothing to summarize yet');

    const settings = sanitizeSettings(bot.settings);
    const { system, user } = prompts.buildSummaryMessages(settings, conversation, messages);
    let result;
    try {
      result = await ai.generate({ system, messages: [{ role: 'user', content: user }], json: true, maxOutputTokens: SUMMARY_MAX_TOKENS });
    } catch (e) {
      if (e.result) await recordAi(bot.account_id, e.result, true);
      throw e;
    }
    await recordAi(bot.account_id, result, true);

    const summary = prompts.normalizeSummary(prompts.parseJsonLoose(result.text));
    await db.saveSummary(conversationId, summary, conversation.updated_at, conversation.message_count);

    const fill = {};
    if (!conversation.client_name && summary.client.name) fill.client_name = summary.client.name.slice(0, 200);
    if (!conversation.client_contact && summary.client.contact) fill.client_contact = summary.client.contact.slice(0, 200);
    if (Object.keys(fill).length) await db.updateConversation(conversationId, fill);
    return summary;
  } catch (e) {
    await db.failSummary(conversationId, e.message).catch(() => {});
    throw e;
  }
}

// Summarizes conversations whose client went quiet. Skips bots with auto-summary off
// and accounts that already used their monthly allowance (summaries cost AI too).
async function autoSummarizeIdle(limit = 3) {
  if (!ai.isConfigured()) return [];
  const idleSince = new Date(Date.now() - SUMMARY_IDLE_MINUTES * 60_000).toISOString();
  const done = [];
  for (const row of await db.conversationsNeedingSummary(idleSince, limit)) {
    try {
      const bot = await db.getBot(row.bot_id);
      if (!bot || !sanitizeSettings(bot.settings).autoSummary) continue;
      const account = await db.getAccount(bot.account_id);
      const usage = await db.getUsage(account.id, currentPeriod());
      if (usage.replies >= limitsFor(account).replies + usage.bonus_replies) continue;
      await summarizeConversation(row.id);
      done.push(row.id);
    } catch (e) {
      console.error(`[summary] ${row.id}: ${e.message}`);
    }
  }
  return done;
}

module.exports = { MAX_HISTORY, MAX_HISTORY_CHARS, trimHistory, replyWithAllowance, replyToConversation, summarizeConversation, autoSummarizeIdle };
