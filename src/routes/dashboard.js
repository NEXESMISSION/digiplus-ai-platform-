// Customer dashboard API: account, bots, bot settings, test chat and conversations.
const express = require('express');
const db = require('../db');
const store = require('../meta/store');
const assistant = require('../services/assistant');
const setup = require('../services/setup');
const dodo = require('../billing/dodo');
const { requireUser, requireAccount, isSuperAdmin } = require('../auth');
const { DEFAULTS, sanitizeSettings, dataSize, readiness } = require('../settings');
const { buildSystemPrompt } = require('../prompts');
const { limitsFor, currentPeriod } = require('../plans');
const { HttpError, route, clean, background, rateLimit } = require('../lib/http');

const router = express.Router();
router.use(['/api/me', '/api/account', '/api/bots'], requireUser, requireAccount);

const SUMMARY_LOCK_MS = 3 * 60_000;
const fmt = (n) => Number(n).toLocaleString('en-US');

const pickBot = (b) => ({
  id: b.id,
  name: b.name,
  public_id: b.public_id,
  is_active: b.is_active,
  created_at: b.created_at,
  updated_at: b.updated_at,
});

function usageView(usage, limits) {
  return {
    period: currentPeriod(),
    replies: usage.replies,
    bonusReplies: usage.bonus_replies,
    limit: limits.replies + usage.bonus_replies,
    limitHitAt: usage.limit_hit_at,
  };
}

router.get('/api/me', route(async (req, res) => {
  const account = req.account;
  const limits = limitsFor(account);
  const [usage, bots] = await Promise.all([db.getUsage(account.id, currentPeriod()), db.listBots(account.id)]);
  const serving = new Set(bots.filter((b) => b.is_active).slice(0, limits.bots).map((b) => b.id));
  res.json({
    user: { id: req.user.id, email: req.user.email },
    account: {
      id: account.id,
      name: account.name,
      role: account.role,
      plan: account.plan,
      plan_expires_at: account.plan_expires_at,
      billing_provider: account.billing_provider,
      extra_bots: account.extra_bots,
      dodo_status: account.dodo_status,
    },
    limits,
    usage: usageView(usage, limits),
    bots: bots.map((b) => ({ ...pickBot(b), serving: serving.has(b.id) })),
    isSuperAdmin: isSuperAdmin(req.user),
    cardPayments: dodo.isEnabled(),
  });
}));

router.patch('/api/account', route(async (req, res) => {
  const name = clean(req.body?.name, 120);
  if (!name) throw new HttpError(400, 'Enter a name');
  await db.updateAccount(req.account.id, { name });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- bots
router.post('/api/bots', route(async (req, res) => {
  const name = clean(req.body?.name, 120) || 'My bot';
  const limits = limitsFor(req.account);
  const bots = await db.listBots(req.account.id);
  if (bots.length >= limits.bots) {
    throw new HttpError(
      402,
      `Your ${limits.planName} plan includes ${limits.bots} bot${limits.bots > 1 ? 's' : ''}. Upgrade or add an extra bot to create another one.`,
      { code: 'bot_limit' }
    );
  }
  const settings = sanitizeSettings({ ...DEFAULTS, businessName: name });
  const bot = await db.createBot(req.account.id, name, settings);
  res.status(201).json({ bot: pickBot(bot) });
}));

async function ownBot(req) {
  const bot = await db.getBot(req.params.botId);
  if (!bot || bot.account_id !== req.account.id) throw new HttpError(404, 'Bot not found');
  return bot;
}

router.get('/api/bots/:botId', route(async (req, res) => {
  const bot = await ownBot(req);
  const settings = sanitizeSettings(bot.settings);
  res.json({
    bot: pickBot(bot),
    settings,
    dataSize: dataSize(settings),
    dataLimit: limitsFor(req.account).dataChars,
    readiness: readiness(settings),
  });
}));

router.patch('/api/bots/:botId', route(async (req, res) => {
  const bot = await ownBot(req);
  const patch = {};
  if (typeof req.body?.name === 'string') {
    patch.name = clean(req.body.name, 120);
    if (!patch.name) throw new HttpError(400, 'Enter a name');
  }
  if (typeof req.body?.is_active === 'boolean') patch.is_active = req.body.is_active;
  res.json({ bot: pickBot(await db.updateBot(bot.id, patch)) });
}));

router.delete('/api/bots/:botId', route(async (req, res) => {
  const bot = await ownBot(req);
  await db.deleteBot(bot.id);
  res.json({ ok: true });
}));

function checkDataLimit(settings, account) {
  const size = dataSize(settings);
  const limits = limitsFor(account);
  if (size > limits.dataChars) {
    throw new HttpError(
      402,
      `This bot has ${fmt(size)} characters of business data, but your ${limits.planName} plan allows ${fmt(limits.dataChars)}. Shorten the texts or upgrade.`,
      { code: 'data_limit', dataSize: size, dataLimit: limits.dataChars }
    );
  }
  return { size, limit: limits.dataChars };
}

router.put('/api/bots/:botId/settings', route(async (req, res) => {
  const bot = await ownBot(req);
  const settings = sanitizeSettings(req.body);
  const { size, limit } = checkDataLimit(settings, req.account);
  const updated = await db.updateBot(bot.id, { settings });
  const saved = sanitizeSettings(updated.settings);
  res.json({ settings: saved, dataSize: size, dataLimit: limit, readiness: readiness(saved) });
}));

// AI Setup — writes a whole draft brain from a few sentences, a pasted price
// list or a website link. Nothing is saved: the owner reviews it and saves.
router.post(
  '/api/bots/:botId/autofill',
  rateLimit('autofill', 12, 10 * 60_000, (req) => req.user.id),
  route(async (req, res) => {
    const bot = await ownBot(req);
    const current = sanitizeSettings(bot.settings);
    const limits = limitsFor(req.account);

    let outcome;
    try {
      outcome = await setup.draftSettings({
        account: req.account,
        current,
        businessName: clean(req.body?.businessName, 200) || current.businessName,
        text: typeof req.body?.text === 'string' ? req.body.text : '',
        url: clean(req.body?.url, 500),
        dataLimit: limits.dataChars,
      });
    } catch (e) {
      throw e instanceof HttpError ? e : new HttpError(502, e.message);
    }
    if (!outcome.ok) {
      throw new HttpError(402, 'You used all AI replies of this month. Buy a reply pack or upgrade to keep going.', { code: 'reply_limit' });
    }

    res.json({
      settings: outcome.settings,
      missing: outcome.missing,
      readFrom: outcome.readFrom,
      dataSize: outcome.dataSize,
      dataLimit: limits.dataChars,
    });
  })
);

// "Tell the AI what changed" — the owner writes one sentence instead of hunting
// for the right field. Nothing is saved until they accept it.
router.post(
  '/api/bots/:botId/revise',
  rateLimit('revise', 30, 10 * 60_000, (req) => req.user.id),
  route(async (req, res) => {
    const bot = await ownBot(req);
    const limits = limitsFor(req.account);

    let outcome;
    try {
      outcome = await setup.reviseSettings({
        account: req.account,
        current: sanitizeSettings(bot.settings),
        instruction: req.body?.instruction,
      });
    } catch (e) {
      throw e instanceof HttpError ? e : new HttpError(502, e.message);
    }
    if (!outcome.ok) {
      throw new HttpError(402, 'You used all AI replies of this month. Buy a reply pack or upgrade to keep going.', { code: 'reply_limit' });
    }

    res.json({ settings: outcome.settings, changed: outcome.changed, dataSize: outcome.dataSize, dataLimit: limits.dataChars });
  })
);

router.post('/api/bots/:botId/prompt-preview', route(async (req, res) => {
  const bot = await ownBot(req);
  res.json({ prompt: buildSystemPrompt(sanitizeSettings(req.body?.settings || bot.settings)) });
}));

// Try the bot with unsaved settings. Uses the monthly allowance like a real reply; nothing is stored.
router.post('/api/bots/:botId/test', route(async (req, res) => {
  const bot = await ownBot(req);
  const settings = sanitizeSettings(req.body?.settings || bot.settings);
  checkDataLimit(settings, req.account);
  const messages = assistant.trimHistory(
    (Array.isArray(req.body?.messages) ? req.body.messages : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content }))
      .slice(-assistant.MAX_HISTORY)
  );
  if (messages.at(-1)?.role !== 'user') throw new HttpError(400, 'Send a client message first');

  let outcome;
  try {
    outcome = await assistant.replyWithAllowance({ account: req.account, system: buildSystemPrompt(settings), messages });
  } catch (e) {
    throw new HttpError(502, e.message);
  }
  if (!outcome.ok) {
    throw new HttpError(402, 'You used all AI replies of this month. Buy a reply pack or upgrade to keep going.', { code: 'reply_limit' });
  }
  res.json({ reply: outcome.result.text, ms: outcome.result.ms });
}));

// ---------------------------------------------------------------- conversations
function forOwner(conversation) {
  const { token, ip, ...rest } = conversation;
  const started = conversation.summary_started_at ? Date.parse(conversation.summary_started_at) : 0;
  return { ...rest, summarizing: Date.now() - started < SUMMARY_LOCK_MS };
}

async function ownConversation(req, bot) {
  const conversation = await db.getConversation(req.params.id);
  if (!conversation || conversation.bot_id !== bot.id) throw new HttpError(404, 'Conversation not found');
  return conversation;
}

router.get('/api/bots/:botId/stats', route(async (req, res) => {
  const bot = await ownBot(req);
  res.json(await db.botStats(bot.id));
}));

router.get('/api/bots/:botId/conversations', route(async (req, res) => {
  const bot = await ownBot(req);
  const conversations = await db.listConversations(bot.id, {
    q: clean(req.query.q, 200),
    status: clean(req.query.status, 20),
    stage: clean(req.query.stage, 30),
    channel: clean(req.query.channel, 20),
  });
  background(assistant.autoSummarizeIdle(2), 'summary');
  res.json({ conversations });
}));

router.get('/api/bots/:botId/conversations/:id', route(async (req, res) => {
  const bot = await ownBot(req);
  const conversation = await ownConversation(req, bot);
  const messages = await store.getMessagesAfter(conversation.id, 0);
  res.json({ conversation: forOwner(conversation), messages });
}));

router.patch('/api/bots/:botId/conversations/:id', route(async (req, res) => {
  const bot = await ownBot(req);
  await ownConversation(req, bot);
  const fields = {};
  if (['open', 'closed'].includes(req.body?.status)) fields.status = req.body.status;
  if (typeof req.body?.admin_notes === 'string') fields.admin_notes = req.body.admin_notes.slice(0, 20_000);
  if (typeof req.body?.client_name === 'string') fields.client_name = clean(req.body.client_name, 200);
  if (typeof req.body?.client_contact === 'string') fields.client_contact = clean(req.body.client_contact, 200);
  res.json({ conversation: forOwner(await db.updateConversation(req.params.id, fields)) });
}));

router.delete('/api/bots/:botId/conversations/:id', route(async (req, res) => {
  const bot = await ownBot(req);
  await ownConversation(req, bot);
  await db.deleteConversation(req.params.id);
  res.json({ ok: true });
}));

router.post('/api/bots/:botId/conversations/:id/summarize', route(async (req, res) => {
  const bot = await ownBot(req);
  await ownConversation(req, bot);
  try {
    await assistant.summarizeConversation(req.params.id);
  } catch (e) {
    throw e instanceof HttpError ? e : new HttpError(502, e.message);
  }
  res.json({ conversation: forOwner(await db.getConversation(req.params.id)) });
}));

function transcriptText(c, messages, botName) {
  const time = (iso) => String(iso).slice(0, 16).replace('T', ' ');
  const lines = [
    `Conversation with ${c.client_name || 'anonymous client'}${c.client_contact ? ` (${c.client_contact})` : ''}`,
    `Started: ${time(c.created_at)}   Last message: ${time(c.updated_at)}   Status: ${c.status}${c.source ? `   Source: ${c.source}` : ''}`,
  ];
  const s = c.summary;
  if (s) {
    lines.push('', '=== SUMMARY ===', s.headline || '', '', s.summary || '');
    if (s.stage) lines.push('', `Stage: ${s.stage}   Deal likelihood: ${s.deal_likelihood ?? '?'}%`);
    if (s.needs?.length) lines.push('', 'Needs:', ...s.needs.map((x) => `- ${x}`));
    if (s.idea) lines.push('', `Idea: ${s.idea}`);
    if (s.next_steps?.length) lines.push('', 'Next steps:', ...s.next_steps.map((x) => `- ${x}`));
  }
  if (c.admin_notes) lines.push('', '=== NOTES ===', c.admin_notes);
  lines.push('', '=== TRANSCRIPT ===');
  for (const m of messages) lines.push('', `[${time(m.created_at)}] ${m.role === 'user' ? 'Client' : botName}:`, m.content);
  return lines.join('\n');
}

router.get('/api/bots/:botId/conversations/:id/transcript', route(async (req, res) => {
  const bot = await ownBot(req);
  const conversation = await ownConversation(req, bot);
  const messages = await db.getMessages(conversation.id);
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(transcriptText(conversation, messages, sanitizeSettings(bot.settings).botName));
}));

router.get('/api/bots/:botId/export', route(async (req, res) => {
  const bot = await ownBot(req);
  const conversations = (await db.exportConversations(bot.id)).map(({ token, ip, summary_started_at, ...rest }) => rest);
  res.json({ bot: pickBot(bot), exported_at: new Date().toISOString(), conversations });
}));

module.exports = router;
