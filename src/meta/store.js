// Database access for messaging channels (connections, channel conversations, channel messages).
const db = require('../db');
const { randomToken } = require('../lib/crypto');

const sb = () => db.sb();
const now = () => new Date().toISOString();
const isDuplicate = (error) => error?.code === '23505';
function must({ data, error }) {
  if (error) throw new Error(`Database error: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------- connections
async function createConnection(row) {
  const { data, error } = await sb().from('channel_connections').insert(row).select().single();
  if (isDuplicate(error)) return null;
  return must({ data, error });
}

async function listConnections(botId) {
  return must(
    await sb().from('channel_connections').select('*').eq('bot_id', botId).neq('status', 'disconnected').order('created_at')
  );
}

async function getConnection(id) {
  if (!db.isUuid(id)) return null;
  return must(await sb().from('channel_connections').select('*').eq('id', id).maybeSingle());
}

async function findActiveConnection(channel, externalId) {
  return must(
    await sb()
      .from('channel_connections')
      .select('*')
      .eq('channel', channel)
      .eq('external_id', String(externalId))
      .neq('status', 'disconnected')
      .limit(1)
      .maybeSingle()
  );
}

async function findConnectionByHook(hookId) {
  if (!/^[A-Za-z0-9_-]{10,64}$/.test(String(hookId))) return null;
  return must(
    await sb().from('channel_connections').select('*').eq('hook_id', hookId).neq('status', 'disconnected').maybeSingle()
  );
}

async function updateConnection(id, patch) {
  return must(await sb().from('channel_connections').update({ ...patch, updated_at: now() }).eq('id', id).select().single());
}

async function countConnectionsByChannel() {
  const rows = must(await sb().from('channel_connections').select('channel').neq('status', 'disconnected').range(0, 9999));
  return rows.reduce((acc, r) => ({ ...acc, [r.channel]: (acc[r.channel] || 0) + 1 }), { messenger: 0, instagram: 0, whatsapp: 0 });
}

// ---------------------------------------------------------------- conversations
async function findChannelConversation(botId, channel, externalUserId) {
  return must(
    await sb()
      .from('conversations')
      .select('*')
      .eq('bot_id', botId)
      .eq('channel', channel)
      .eq('external_user_id', String(externalUserId))
      .maybeSingle()
  );
}

// One conversation per client per channel per bot.
async function findOrCreateChannelConversation({ botId, channel, connectionId, externalUserId, name, contact }) {
  const existing = await findChannelConversation(botId, channel, externalUserId);
  if (existing) return { conversation: existing, created: false };
  const { data, error } = await sb()
    .from('conversations')
    .insert({
      bot_id: botId,
      channel,
      connection_id: connectionId,
      external_user_id: String(externalUserId),
      token: randomToken(24),
      client_name: name || null,
      client_contact: contact || null,
      source: channel,
    })
    .select()
    .single();
  if (isDuplicate(error)) return { conversation: await findChannelConversation(botId, channel, externalUserId), created: false };
  return { conversation: must({ data, error }), created: true };
}

async function updateChannelConversation(id, fields) {
  const allowed = ['bot_paused', 'last_client_message_at', 'connection_id', 'status', 'client_name', 'client_contact'];
  const patch = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
  return must(await sb().from('conversations').update(patch).eq('id', id).select().single());
}

// ---------------------------------------------------------------- messages
// Returns the new id, or null when this channel message id was already stored (Meta retry).
async function addChannelMessage(conversationId, { role, sender, content, externalId = null, ai = null, sendError = null }) {
  const row = { conversation_id: conversationId, role, sender, content, external_id: externalId, send_error: sendError };
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
  const { data, error } = await sb().from('messages').insert(row).select('id').single();
  if (externalId && isDuplicate(error)) return null;
  return must({ data, error }).id;
}

async function hasNewerClientMessage(conversationId, messageId) {
  const rows = must(
    await sb().from('messages').select('id').eq('conversation_id', conversationId).eq('role', 'user').gt('id', messageId).limit(1)
  );
  return rows.length > 0;
}

async function lastBotMessage(conversationId) {
  return must(
    await sb()
      .from('messages')
      .select('id, content, sender, created_at')
      .eq('conversation_id', conversationId)
      .eq('role', 'assistant')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
  );
}

async function messageExists(externalId) {
  const rows = must(await sb().from('messages').select('id').eq('external_id', externalId).limit(1));
  return rows.length > 0;
}

async function getMessagesAfter(conversationId, afterId = 0) {
  return must(
    await sb()
      .from('messages')
      .select('id, role, sender, content, send_error, created_at')
      .eq('conversation_id', conversationId)
      .gt('id', afterId)
      .order('id', { ascending: true })
      .range(0, 4999)
  );
}

module.exports = {
  createConnection,
  listConnections,
  getConnection,
  findActiveConnection,
  findConnectionByHook,
  updateConnection,
  countConnectionsByChannel,
  findChannelConversation,
  findOrCreateChannelConversation,
  updateChannelConversation,
  addChannelMessage,
  hasNewerClientMessage,
  lastBotMessage,
  messageExists,
  getMessagesAfter,
};
