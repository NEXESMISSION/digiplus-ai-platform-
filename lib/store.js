// Conversations, messages and saved requests, in Supabase. Server-side only (service role key).
const { createClient } = require('@supabase/supabase-js');

let client;
function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      // A stuck database call must fail, not leave the chat page waiting forever.
      global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: init.signal || AbortSignal.timeout(15_000) }) },
    });
  }
  return client;
}

function must({ data, error }) {
  if (error) throw new Error(`Database: ${error.message}`);
  return data;
}

function counted({ count, error }) {
  if (error) throw new Error(`Database: ${error.message}`);
  return count || 0;
}

const isDuplicate = (error) => error?.code === '23505';
const touch = async (conversationId) =>
  must(await db().from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId));

// A message as the chat page and the AI see it.
const item = (row) => ({ role: row.role, text: row.text, card: row.card || null, created_at: row.created_at });

async function findConversation(bot, visitorId) {
  return must(await db().from('conversations').select('*').eq('bot', bot).eq('visitor_id', visitorId).maybeSingle());
}

async function openConversation({ bot, visitorId, ipHash }) {
  const found = await findConversation(bot, visitorId);
  if (found) return found;
  const { data, error } = await db().from('conversations').insert({ bot, visitor_id: visitorId, ip_hash: ipHash }).select().single();
  if (isDuplicate(error)) return findConversation(bot, visitorId); // two first sends arrived together
  return must({ data, error });
}

async function deleteConversation(bot, visitorId) {
  must(await db().from('conversations').delete().eq('bot', bot).eq('visitor_id', visitorId));
}

// Returns false when this batch was already stored (the page retried a send).
async function addClientMessages(conversationId, texts, batch) {
  const seen = must(await db().from('messages').select('id').eq('conversation_id', conversationId).eq('batch', batch).limit(1));
  if (seen.length) return false;
  must(await db().from('messages').insert(texts.map((text) => ({ conversation_id: conversationId, role: 'client', text, batch }))));
  return true; // updated_at moves when the answer is stored
}

// The bot's answer to a batch, if it was already written.
async function repliesAfterBatch(conversationId, batch) {
  const last = must(
    await db().from('messages').select('id').eq('conversation_id', conversationId).eq('batch', batch).order('id', { ascending: false }).limit(1)
  );
  if (!last.length) return [];
  const rows = must(
    await db().from('messages').select('role, text, card, created_at').eq('conversation_id', conversationId).gt('id', last[0].id).order('id')
  );
  const replies = [];
  for (const row of rows) {
    if (row.role !== 'bot') break;
    replies.push(item(row));
  }
  return replies;
}

async function addBotItems(conversationId, items) {
  if (!items.length) return;
  must(
    await db()
      .from('messages')
      .insert(items.map((i) => ({ conversation_id: conversationId, role: 'bot', text: i.text || '', card: i.card || null })))
  );
  await touch(conversationId);
}

async function lastItems(conversationId, limit) {
  const rows = must(
    await db()
      .from('messages')
      .select('role, text, card, created_at')
      .eq('conversation_id', conversationId)
      .order('id', { ascending: false })
      .limit(limit)
  );
  return rows.reverse().map(item);
}

async function clientMessageCount(conversationId) {
  return counted(
    await db().from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).eq('role', 'client')
  );
}

// Messages sent from one connection (all conversations) since a moment.
async function clientMessagesFromIpSince(ipHash, since) {
  return counted(
    await db()
      .from('messages')
      .select('id, conversations!inner(ip_hash)', { count: 'exact', head: true })
      .eq('role', 'client')
      .eq('conversations.ip_hash', ipHash)
      .gte('created_at', since.toISOString())
  );
}

async function saveRequest({ bot, conversationId, kind, data, startsAt = null, status }) {
  return must(
    await db().from('requests').insert({ bot, conversation_id: conversationId, kind, data, starts_at: startsAt, status }).select().single()
  );
}

async function updateRequest(id, patch) {
  return must(await db().from('requests').update(patch).eq('id', id).select().single());
}

async function latestRequest(conversationId, kind) {
  return must(
    await db()
      .from('requests')
      .select('*')
      .eq('conversation_id', conversationId)
      .eq('kind', kind)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  );
}

// Booked times that are still coming, so nobody else can take them.
async function takenTimes(bot, from) {
  const rows = must(
    await db()
      .from('requests')
      .select('starts_at')
      .eq('bot', bot)
      .eq('kind', 'booking')
      .in('status', ['pending', 'confirmed'])
      .gte('starts_at', from.toISOString())
  );
  return rows.map((r) => r.starts_at);
}

module.exports = {
  db,
  must,
  findConversation,
  openConversation,
  deleteConversation,
  addClientMessages,
  repliesAfterBatch,
  addBotItems,
  lastItems,
  clientMessageCount,
  clientMessagesFromIpSince,
  saveRequest,
  updateRequest,
  latestRequest,
  takenTimes,
};
