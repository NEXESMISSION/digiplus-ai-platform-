// Supabase (Postgres) data access. Server-side only — uses the service_role key.
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { trialEndsAt } = require('./plans');

// A short internet drop makes fetch throw before the request reaches Supabase.
// Retry only those connection-stage errors, so a write can never be applied twice.
const RETRYABLE = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
async function fetchWithRetry(input, init) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      const code = e.cause?.code || e.cause?.cause?.code;
      if (attempt >= 3 || !RETRYABLE.has(code) || init?.signal?.aborted) throw e;
      console.warn(`[db] network error ${code}, retrying (${attempt}/2)`);
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

let client;
function sb() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithRetry },
    });
  }
  return client;
}

function must({ data, error }) {
  if (error) throw new Error(`Database error: ${error.message}`);
  return data;
}

const isDuplicate = (error) => error?.code === '23505'; // unique_violation
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => UUID.test(String(v));
const escapeLike = (q) => q.replace(/[\\%_]/g, (c) => `\\${c}`);
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- accounts
async function getAccount(id) {
  if (!isUuid(id)) return null;
  return must(await sb().from('accounts').select('*').eq('id', id).maybeSingle());
}

async function getAccountForUser(userId) {
  const row = must(
    await sb().from('account_members').select('role, accounts(*)').eq('user_id', userId).order('created_at').limit(1).maybeSingle()
  );
  return row?.accounts ? { ...row.accounts, role: row.role } : null;
}

// First sign-in: take over the account prepared for this email, or start a free trial.
async function ensureAccountForUser(user) {
  const existing = await getAccountForUser(user.id);
  if (existing) return existing;

  const email = String(user.email || '').toLowerCase();
  let account = null;

  if (email) {
    const claimable = must(
      await sb().from('accounts').select('id').eq('claim_email', email).is('owner_id', null).limit(1).maybeSingle()
    );
    if (claimable) {
      account = must(
        await sb()
          .from('accounts')
          .update({ owner_id: user.id, owner_email: email, claim_email: null, updated_at: now() })
          .eq('id', claimable.id)
          .select()
          .single()
      );
    }
  }

  if (!account) {
    const name = String(user.user_metadata?.business_name || email.split('@')[0] || 'My business').slice(0, 120);
    const { data, error } = await sb()
      .from('accounts')
      .insert({ name, owner_id: user.id, owner_email: email, plan: 'trial', plan_expires_at: trialEndsAt() })
      .select()
      .single();
    if (isDuplicate(error)) {
      // Two first requests raced: the other one created it.
      account = must(await sb().from('accounts').select('*').eq('owner_id', user.id).single());
    } else {
      account = must({ data, error });
    }
  }

  const { error } = await sb().from('account_members').insert({ account_id: account.id, user_id: user.id, role: 'owner' });
  if (error && !isDuplicate(error)) throw new Error(`Database error: ${error.message}`);
  return { ...account, role: 'owner' };
}

async function updateAccount(id, patch) {
  return must(await sb().from('accounts').update({ ...patch, updated_at: now() }).eq('id', id).select().single());
}

async function findAccountByDodoSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  return must(await sb().from('accounts').select('*').eq('dodo_subscription_id', subscriptionId).limit(1).maybeSingle());
}

// ---------------------------------------------------------------- bots
const PUBLIC_ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const newPublicId = () => Array.from(crypto.randomBytes(10), (b) => PUBLIC_ID_ALPHABET[b % PUBLIC_ID_ALPHABET.length]).join('');

async function listBots(accountId) {
  return must(
    await sb().from('bots').select('id, public_id, name, is_active, created_at, updated_at').eq('account_id', accountId).order('created_at')
  );
}

async function createBot(accountId, name, settings) {
  return must(
    await sb().from('bots').insert({ account_id: accountId, public_id: newPublicId(), name, settings }).select().single()
  );
}

async function getBot(id) {
  if (!isUuid(id)) return null;
  return must(await sb().from('bots').select('*').eq('id', id).maybeSingle());
}

async function getBotByPublicId(publicId) {
  if (!/^[a-z0-9]{6,32}$/.test(String(publicId))) return null;
  return must(await sb().from('bots').select('*').eq('public_id', publicId).maybeSingle());
}

async function updateBot(id, fields) {
  const allowed = ['name', 'settings', 'is_active'];
  const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  return must(await sb().from('bots').update({ ...patch, updated_at: now() }).eq('id', id).select().single());
}

async function deleteBot(id) {
  if (!isUuid(id)) return;
  must(await sb().from('bots').delete().eq('id', id));
}

// ---------------------------------------------------------------- conversations
async function createConversation({ botId, token, name, contact, source, ip }) {
  return must(
    await sb()
      .from('conversations')
      .insert({ bot_id: botId, token, client_name: name || null, client_contact: contact || null, source: source || null, ip: ip || null })
      .select()
      .single()
  );
}

async function getConversation(id) {
  if (!isUuid(id)) return null;
  return must(await sb().from('conversations').select('*').eq('id', id).maybeSingle());
}

async function listConversations(botId, { q, status, stage, channel, limit = 300 } = {}) {
  return must(
    await sb().rpc('list_conversations', {
      p_bot: botId,
      p_q: q ? escapeLike(q) : null,
      p_status: status || null,
      p_stage: stage || null,
      p_channel: channel || null,
      p_limit: limit,
    })
  );
}

async function updateConversation(id, fields) {
  const allowed = ['status', 'admin_notes', 'client_name', 'client_contact'];
  const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(patch).length) return getConversation(id);
  return must(await sb().from('conversations').update(patch).eq('id', id).select().single());
}

async function deleteConversation(id) {
  if (!isUuid(id)) return;
  must(await sb().from('conversations').delete().eq('id', id));
}

async function botStats(botId) {
  return must(await sb().rpc('bot_stats', { p_bot: botId }));
}

async function exportConversations(botId) {
  const conversations = must(
    await sb().from('conversations').select('*').eq('bot_id', botId).gt('message_count', 0).order('created_at').range(0, 9999)
  );
  const byId = new Map(conversations.map((c) => [c.id, { ...c, messages: [] }]));
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 100) {
    const rows = must(
      await sb()
        .from('messages')
        .select('conversation_id, role, content, created_at')
        .in('conversation_id', ids.slice(i, i + 100))
        .order('id')
        .range(0, 49999)
    );
    for (const m of rows) byId.get(m.conversation_id).messages.push({ role: m.role, content: m.content, created_at: m.created_at });
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------- messages
async function addMessage(conversationId, role, content, ai = null) {
  const row = { conversation_id: conversationId, role, content };
  if (ai) {
    Object.assign(row, {
      provider: 'openai',
      model: ai.model,
      input_tokens: ai.usage.input,
      cached_tokens: ai.usage.cached,
      output_tokens: ai.usage.output,
      cost_usd: Number(ai.costUsd.toFixed(6)),
    });
  }
  return must(await sb().from('messages').insert(row).select('id').single()).id;
}

async function getMessages(conversationId) {
  return must(
    await sb()
      .from('messages')
      .select('id, role, content, model, input_tokens, cached_tokens, output_tokens, cost_usd, created_at')
      .eq('conversation_id', conversationId)
      .order('id', { ascending: true })
      .range(0, 4999)
  );
}

async function getRecentMessages(conversationId, count) {
  const rows = must(
    await sb()
      .from('messages')
      .select('role, content, created_at')
      .eq('conversation_id', conversationId)
      .order('id', { ascending: false })
      .limit(count)
  );
  return rows.reverse();
}

// ---------------------------------------------------------------- summaries
async function claimSummary(id) {
  return must(await sb().rpc('claim_summary', { p_id: id })) === true;
}

// `coveredUntil` = conversation.updated_at when summarizing started, so a message
// that arrives meanwhile still marks the summary as outdated.
async function saveSummary(id, summary, coveredUntil, messageCount) {
  must(
    await sb()
      .from('conversations')
      .update({
        summary,
        summary_at: coveredUntil,
        summary_message_count: messageCount,
        stage: summary.stage || null,
        deal_likelihood: summary.deal_likelihood ?? null,
        summary_started_at: null,
        summary_failed_at: null,
        summary_error: null,
      })
      .eq('id', id)
  );
}

async function failSummary(id, message) {
  must(
    await sb()
      .from('conversations')
      .update({ summary_started_at: null, summary_failed_at: now(), summary_error: String(message).slice(0, 500) })
      .eq('id', id)
  );
}

async function conversationsNeedingSummary(idleSinceIso, limit = 3) {
  return must(await sb().rpc('conversations_needing_summary', { p_idle_since: idleSinceIso, p_limit: limit }));
}

// ---------------------------------------------------------------- usage
async function consumeReply(accountId, period, limit) {
  return must(await sb().rpc('consume_reply', { p_account: accountId, p_period: period, p_limit: limit })) === true;
}

async function releaseReply(accountId, period) {
  must(await sb().rpc('release_reply', { p_account: accountId, p_period: period }));
}

async function recordUsage(accountId, period, usage, costUsd, isSummary = false) {
  must(
    await sb().rpc('record_ai_usage', {
      p_account: accountId,
      p_period: period,
      p_input: usage.input,
      p_cached: usage.cached,
      p_output: usage.output,
      p_cost: Number(costUsd.toFixed(6)),
      p_is_summary: isSummary,
    })
  );
}

async function addBonusReplies(accountId, period, replies) {
  must(await sb().rpc('add_bonus_replies', { p_account: accountId, p_period: period, p_replies: replies }));
}

async function getUsage(accountId, period) {
  const row = must(await sb().from('usage_monthly').select('*').eq('account_id', accountId).eq('period', period).maybeSingle());
  return row || { replies: 0, bonus_replies: 0, summaries: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, cost_usd: 0, limit_hit_at: null };
}

// ---------------------------------------------------------------- manual payments
async function createPaymentRequest(row) {
  return must(await sb().from('payment_requests').insert(row).select().single());
}

async function listPaymentRequests({ accountId, status, limit = 50 } = {}) {
  let query = sb().from('payment_requests').select('*, accounts(name, owner_email)').order('created_at', { ascending: false }).limit(limit);
  if (accountId) query = query.eq('account_id', accountId);
  if (status) query = query.eq('status', status);
  return must(await query);
}

async function getPaymentRequest(id) {
  if (!isUuid(id)) return null;
  return must(await sb().from('payment_requests').select('*').eq('id', id).maybeSingle());
}

// Moves a request out of 'pending' exactly once; returns null if someone already reviewed it.
async function reviewPaymentRequest(id, status, note) {
  if (!isUuid(id)) return null;
  return must(
    await sb()
      .from('payment_requests')
      .update({ status, admin_note: note || null, reviewed_at: now() })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .maybeSingle()
  );
}

async function reopenPaymentRequest(id) {
  must(await sb().from('payment_requests').update({ status: 'pending', reviewed_at: null }).eq('id', id));
}

// ---------------------------------------------------------------- platform settings (payment instructions…)
async function getPlatformSettings() {
  const row = must(await sb().from('platform_settings').select('data').eq('id', 1).maybeSingle());
  return row?.data || {};
}

async function savePlatformSettings(data) {
  must(await sb().from('platform_settings').upsert({ id: 1, data, updated_at: now() }));
  return data;
}

// ---------------------------------------------------------------- webhooks
// Returns false when this webhook id was already received (provider retry).
async function recordWebhookEvent({ id, provider, type, payload }) {
  const { error } = await sb().from('webhook_events').insert({ id, provider, type, payload });
  if (isDuplicate(error)) return false;
  must({ data: null, error });
  return true;
}

async function markWebhookProcessed(id) {
  must(await sb().from('webhook_events').update({ processed_at: now(), error: null }).eq('id', id));
}

async function forgetWebhookEvent(id) {
  must(await sb().from('webhook_events').delete().eq('id', id));
}

// ---------------------------------------------------------------- super admin
async function superAccounts(period) {
  return must(await sb().rpc('super_accounts', { p_period: period }));
}

module.exports = {
  sb,
  isUuid,
  getAccount,
  getAccountForUser,
  ensureAccountForUser,
  updateAccount,
  findAccountByDodoSubscription,
  listBots,
  createBot,
  getBot,
  getBotByPublicId,
  updateBot,
  deleteBot,
  createConversation,
  getConversation,
  listConversations,
  updateConversation,
  deleteConversation,
  botStats,
  exportConversations,
  addMessage,
  getMessages,
  getRecentMessages,
  claimSummary,
  saveSummary,
  failSummary,
  conversationsNeedingSummary,
  consumeReply,
  releaseReply,
  recordUsage,
  addBonusReplies,
  getUsage,
  createPaymentRequest,
  listPaymentRequests,
  getPaymentRequest,
  reviewPaymentRequest,
  reopenPaymentRequest,
  getPlatformSettings,
  savePlatformSettings,
  recordWebhookEvent,
  markWebhookProcessed,
  forgetWebhookEvent,
  superAccounts,
};
