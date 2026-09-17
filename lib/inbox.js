// What the owner sees: every conversation, newest first, and one conversation in full.
const { db, must } = require('./store');

const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

// One line for the list: what the client asked for when the assistant saved it, else their last message.
function previewFor(row) {
  const data = row.request_data || {};
  if (row.request_kind === 'order' && Array.isArray(data.items)) {
    const items = data.items.map((i) => `${i.name} · ${i.option}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`).join(', ');
    return `${items} · ${data.total}dt`;
  }
  if (row.request_kind === 'booking' && data.service) {
    const day = data.date ? `${DAYS[new Date(`${data.date}T00:00:00Z`).getUTCDay()]} ${Number(data.date.slice(8))}/${data.date.slice(5, 7)}` : '';
    return [data.service, [day, data.time].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  }
  if (row.request_kind === 'details') {
    const line = [data.need, data.business, data.area].filter(Boolean).join(' · ');
    if (line) return line;
  }
  return row.last_client_text || row.last_text || '';
}

// Name and phone come from what the assistant saved (details or booking), when there is one.
function summary(row) {
  const data = row.request_data || {};
  const lastClientAt = row.last_client_at ? Date.parse(row.last_client_at) : 0;
  return {
    id: row.id,
    bot: row.bot,
    name: data.name || null,
    phone: data.phone || null,
    preview: previewFor(row),
    lastAt: row.last_at || row.updated_at,
    unread: lastClientAt > 0 && (!row.admin_seen_at || lastClientAt > Date.parse(row.admin_seen_at)),
    request: row.request_kind ? { kind: row.request_kind, status: row.request_status } : null,
  };
}

async function list() {
  const rows = must(
    await db().from('admin_inbox').select('*').order('last_at', { ascending: false, nullsFirst: false }).limit(300)
  );
  return rows.map(summary);
}

async function get(id) {
  const [rows, messages, requests] = await Promise.all([
    db().from('admin_inbox').select('*').eq('id', id).limit(1),
    db().from('messages').select('role, text, card, created_at').eq('conversation_id', id).order('id').limit(1000),
    db().from('requests').select('kind, status, data, starts_at, created_at').eq('conversation_id', id).order('created_at'),
  ]);
  const row = must(rows)[0];
  if (!row) return null;
  return { conversation: summary(row), items: must(messages), requests: must(requests) };
}

async function markSeen(id) {
  must(await db().from('conversations').update({ admin_seen_at: new Date().toISOString() }).eq('id', id));
}

async function remove(id) {
  must(await db().from('conversations').delete().eq('id', id));
}

module.exports = { list, get, markSeen, remove };
