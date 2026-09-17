// What people do on the site: one row per page opened (see public/track.js).
// No names, no addresses, no text: a page, a random visitor id, seconds and a few event names.
const store = require('./store');

const EVENTS = new Set(['demo', 'plan', 'try', 'tarifs', 'message', 'choice', 'catalog', 'product', 'order', 'request', 'restart']);
const clean = (text, max) => String(text || '').trim().slice(0, max);

const PER_HOUR = 300; // views from one connection

async function view({ id, visitor, session, page, bot, source, device, ipHash }) {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await store
    .db()
    .from('page_views')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', since);
  if ((count || 0) >= PER_HOUR) return false;

  await store.db().from('page_views').upsert(
    {
      id,
      visitor: clean(visitor, 64),
      session: clean(session, 64),
      page: clean(page, 120),
      bot: bot ? clean(bot, 40) : null,
      source: clean(source, 60) || 'direct',
      device: device === 'phone' ? 'phone' : 'desktop',
      ip_hash: ipHash,
    },
    { onConflict: 'id', ignoreDuplicates: true }
  );
  return true;
}

// The page is closed or hidden: how long it was open, and what was tapped.
async function leave({ id, seconds, events }) {
  const list = (Array.isArray(events) ? events : []).filter((e) => EVENTS.has(e)).slice(0, 12);
  const time = Math.max(0, Math.min(3600, Math.round(Number(seconds) || 0)));
  const current = store.must(await store.db().from('page_views').select('seconds').eq('id', id).maybeSingle());
  if (!current) return false;
  await store
    .db()
    .from('page_views')
    .update({ seconds: Math.max(time, current.seconds || 0), events: list })
    .eq('id', id);
  return true;
}

// Everything the analytics page shows, counted here so the page stays simple.
async function summary(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = store.must(
    await store.db().from('page_views').select('*').gte('created_at', since).order('created_at', { ascending: true }).limit(20000)
  );

  const visitors = new Set();
  const sessions = new Map(); // session → { pages: [], events: Set }
  const pages = new Map();
  const sources = new Map();
  const devices = new Map();
  const byDay = new Map();

  for (const row of rows) {
    visitors.add(row.visitor);
    const day = row.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + 1);
    sources.set(row.source || 'direct', (sources.get(row.source || 'direct') || 0) + 1);
    devices.set(row.device || 'desktop', (devices.get(row.device || 'desktop') || 0) + 1);

    const page = pages.get(row.page) || { page: row.page, views: 0, seconds: 0, timed: 0, exits: 0 };
    page.views += 1;
    if (row.seconds > 0) {
      page.seconds += row.seconds;
      page.timed += 1;
    }
    pages.set(row.page, page);

    const session = sessions.get(row.session) || { pages: [], events: new Set() };
    session.pages.push(row);
    for (const event of row.events || []) session.events.add(event);
    sessions.set(row.session, session);
  }

  // Where they stop: the last page of each visit.
  for (const session of sessions.values()) {
    const last = session.pages[session.pages.length - 1];
    const page = pages.get(last.page);
    if (page) page.exits += 1;
  }

  const funnel = { visits: sessions.size, chat: 0, message: 0, request: 0 };
  for (const session of sessions.values()) {
    const opened = session.pages.some((p) => p.page.startsWith('/chat'));
    if (opened) funnel.chat += 1;
    if (session.events.has('message')) funnel.message += 1;
    if (session.events.has('request')) funnel.request += 1;
  }

  const list = (map) => [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

  return {
    days,
    views: rows.length,
    visitors: visitors.size,
    sessions: sessions.size,
    funnel,
    perDay: [...byDay.entries()].map(([day, count]) => ({ day, count })),
    pages: [...pages.values()]
      .map((p) => ({ page: p.page, views: p.views, seconds: p.timed ? Math.round(p.seconds / p.timed) : 0, exits: p.exits }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 20),
    sources: list(sources).slice(0, 8),
    devices: list(devices),
  };
}

module.exports = { view, leave, summary };
