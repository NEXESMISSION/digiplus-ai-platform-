// Channels API (dashboard) + Meta webhooks.
const express = require('express');
const db = require('../db');
const store = require('../meta/store');
const channels = require('../services/channels');
const meta = require('../meta/graph');
const { parseWebhook } = require('../meta/webhook');
const { requireUser, requireAccount } = require('../auth');
const { limitsFor, planForChannel, CHANNEL_NAMES } = require('../plans');
const { seal, unseal, decrypt } = require('../lib/crypto');
const { HttpError, route, clean, safeEqual, background, appUrl } = require('../lib/http');

const router = express.Router();
const CHANNELS = ['messenger', 'instagram', 'whatsapp'];

router.use(
  ['/api/meta/config', '/api/bots/:botId/channels', '/api/bots/:botId/conversations/:id/takeover', '/api/bots/:botId/conversations/:id/reply'],
  requireUser,
  requireAccount
);

const webhookBase = (req) => (process.env.WEBHOOK_BASE_URL || appUrl(req)).replace(/\/+$/, '');

async function ownBot(req) {
  const bot = await db.getBot(req.params.botId);
  if (!bot || bot.account_id !== req.account.id) throw new HttpError(404, 'Bot not found');
  return bot;
}

function requireChannel(account, channel) {
  if (!CHANNELS.includes(channel)) throw new HttpError(400, 'Unknown channel');
  if (!limitsFor(account).channels.includes(channel)) {
    const plan = planForChannel(channel);
    throw new HttpError(402, `${CHANNEL_NAMES[channel]} is available from the ${plan.name} plan.`, { code: 'channel_locked', plan: plan.id });
  }
}

function forOwner(c, req) {
  return {
    id: c.id,
    channel: c.channel,
    external_id: c.external_id,
    name: c.name,
    mode: c.mode,
    auto_reply: c.auto_reply,
    status: c.status,
    last_error: c.last_error,
    last_event_at: c.last_event_at,
    created_at: c.created_at,
    details: {
      picture: c.meta?.picture || null,
      username: c.meta?.username || null,
      page_name: c.meta?.page_name || null,
      display_phone_number: c.meta?.display_phone_number || null,
      verified_name: c.meta?.verified_name || null,
      api: c.meta?.api || 'facebook',
    },
    webhook: c.mode === 'own_app' ? { url: `${webhookBase(req)}/api/webhooks/meta/c/${c.hook_id}`, verifyToken: c.verify_token } : null,
  };
}

// ---------------------------------------------------------------- dashboard
router.get('/api/meta/config', (req, res) => {
  res.json({
    appId: meta.appId(),
    graphVersion: meta.version(),
    loginConfigId: process.env.META_LOGIN_CONFIG_ID || '',
    whatsappConfigId: process.env.META_WHATSAPP_CONFIG_ID || '',
    oauthReady: Boolean(meta.isAppConfigured() && process.env.META_LOGIN_CONFIG_ID),
    embeddedReady: Boolean(meta.isAppConfigured() && process.env.META_WHATSAPP_CONFIG_ID),
  });
});

router.get('/api/bots/:botId/channels', route(async (req, res) => {
  const bot = await ownBot(req);
  const connections = await store.listConnections(bot.id);
  res.json({
    connections: connections.map((c) => forOwner(c, req)),
    allowed: limitsFor(req.account).channels,
    requiredPlan: Object.fromEntries(CHANNELS.map((ch) => [ch, planForChannel(ch).name])),
  });
}));

// Step 1 of "Continue with Facebook": list Pages + linked Instagram accounts.
router.post('/api/bots/:botId/channels/facebook/pages', route(async (req, res) => {
  const bot = await ownBot(req);
  if (!meta.isAppConfigured()) throw new HttpError(400, 'Facebook connection is not configured on this server yet.');
  const code = clean(req.body?.code, 4000);
  if (!code) throw new HttpError(400, 'Missing Facebook login code');

  let pages;
  try {
    pages = await channels.pagesFromLoginCode(code);
  } catch (e) {
    throw new HttpError(400, e.message);
  }
  const describe = async (channel, id) => {
    const existing = await store.findActiveConnection(channel, id);
    if (!existing) return null;
    if (existing.bot_id === bot.id) return 'this bot';
    if (existing.account_id === req.account.id) return (await db.getBot(existing.bot_id))?.name || 'another bot';
    return 'another account';
  };
  const view = [];
  for (const p of pages) {
    view.push({
      id: p.id,
      name: p.name,
      picture: p.picture,
      connectedTo: await describe('messenger', p.id),
      instagram: p.instagram ? { ...p.instagram, connectedTo: await describe('instagram', p.instagram.id) } : null,
    });
  }
  res.json({
    selection: seal({ accountId: req.account.id, botId: bot.id, pages }, 15 * 60_000),
    pages: view,
    allowed: limitsFor(req.account).channels,
  });
}));

// Step 2: connect the chosen Pages / Instagram accounts to this bot.
router.post('/api/bots/:botId/channels/facebook/connect', route(async (req, res) => {
  const bot = await ownBot(req);
  const selection = unseal(req.body?.selection);
  if (!selection || selection.accountId !== req.account.id || selection.botId !== bot.id) {
    throw new HttpError(400, 'This Facebook selection expired. Please connect again.');
  }
  const pageIds = new Set((Array.isArray(req.body?.pageIds) ? req.body.pageIds : []).map(String));
  const igIds = new Set((Array.isArray(req.body?.instagramIds) ? req.body.instagramIds : []).map(String));
  if (!pageIds.size && !igIds.size) throw new HttpError(400, 'Choose at least one Page or Instagram account.');
  if (pageIds.size) requireChannel(req.account, 'messenger');
  if (igIds.size) requireChannel(req.account, 'instagram');

  const connected = [];
  const errors = [];
  for (const page of selection.pages) {
    if (pageIds.has(page.id)) {
      try {
        connected.push(forOwner(await channels.connectPage({ account: req.account, bot, page }), req));
      } catch (e) {
        errors.push(`${page.name}: ${e.message}`);
      }
    }
    if (page.instagram && igIds.has(page.instagram.id)) {
      try {
        connected.push(forOwner(await channels.connectInstagramViaPage({ account: req.account, bot, page }), req));
      } catch (e) {
        errors.push(`@${page.instagram.username || page.instagram.id}: ${e.message}`);
      }
    }
  }
  res.json({ connected, errors });
}));

router.post('/api/bots/:botId/channels/whatsapp/embedded', route(async (req, res) => {
  const bot = await ownBot(req);
  requireChannel(req.account, 'whatsapp');
  const code = clean(req.body?.code, 4000);
  const phoneNumberId = clean(req.body?.phoneNumberId, 40);
  const wabaId = clean(req.body?.wabaId, 40);
  if (!code || !/^\d+$/.test(phoneNumberId) || !/^\d+$/.test(wabaId)) throw new HttpError(400, 'WhatsApp signup did not finish. Please try again.');
  try {
    const connection = await channels.connectWhatsAppEmbedded({ account: req.account, bot, code, phoneNumberId, wabaId });
    res.status(201).json({ connection: forOwner(connection, req) });
  } catch (e) {
    throw e instanceof HttpError ? e : new HttpError(400, e.message);
  }
}));

router.post('/api/bots/:botId/channels/manual', route(async (req, res) => {
  const bot = await ownBot(req);
  const channel = clean(req.body?.channel, 20);
  requireChannel(req.account, channel);
  const connection = await channels.connectManual({
    account: req.account,
    bot,
    channel,
    externalId: clean(req.body?.externalId, 40),
    accessToken: clean(req.body?.accessToken, 2000),
    appSecretValue: clean(req.body?.appSecret, 200) || null,
    api: req.body?.api === 'instagram' ? 'instagram' : 'facebook',
    wabaId: /^\d+$/.test(clean(req.body?.wabaId, 40)) ? clean(req.body.wabaId, 40) : null,
  });
  res.status(201).json({ connection: forOwner(connection, req) });
}));

async function ownConnection(req, bot) {
  const connection = await store.getConnection(req.params.connectionId);
  if (!connection || connection.bot_id !== bot.id || connection.status === 'disconnected') throw new HttpError(404, 'Connection not found');
  return connection;
}

router.patch('/api/bots/:botId/channels/:connectionId', route(async (req, res) => {
  const bot = await ownBot(req);
  const connection = await ownConnection(req, bot);
  if (typeof req.body?.auto_reply !== 'boolean') throw new HttpError(400, 'Nothing to update');
  res.json({ connection: forOwner(await store.updateConnection(connection.id, { auto_reply: req.body.auto_reply }), req) });
}));

router.delete('/api/bots/:botId/channels/:connectionId', route(async (req, res) => {
  const bot = await ownBot(req);
  const connection = await ownConnection(req, bot);
  await channels.disconnect(connection);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- human takeover
async function ownConversation(req, bot) {
  const conversation = await db.getConversation(req.params.id);
  if (!conversation || conversation.bot_id !== bot.id) throw new HttpError(404, 'Conversation not found');
  return conversation;
}

router.post('/api/bots/:botId/conversations/:id/takeover', route(async (req, res) => {
  const bot = await ownBot(req);
  const conversation = await ownConversation(req, bot);
  if (typeof req.body?.paused !== 'boolean') throw new HttpError(400, 'Missing "paused"');
  const updated = await store.updateChannelConversation(conversation.id, { bot_paused: req.body.paused });
  res.json({ bot_paused: updated.bot_paused });
}));

router.post('/api/bots/:botId/conversations/:id/reply', route(async (req, res) => {
  const bot = await ownBot(req);
  const conversation = await ownConversation(req, bot);
  const text = clean(req.body?.text, 4000);
  if (!text) throw new HttpError(400, 'Write a message first');
  await channels.humanReply(conversation, text);
  res.status(201).json({ ok: true });
}));

// ---------------------------------------------------------------- webhooks
function verifyChallenge(req, res, expectedToken) {
  if (req.query['hub.mode'] === 'subscribe' && expectedToken && safeEqual(String(req.query['hub.verify_token'] || ''), expectedToken)) {
    return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  }
  res.sendStatus(403);
}

router.get('/api/webhooks/meta', (req, res) => verifyChallenge(req, res, process.env.META_VERIFY_TOKEN));

router.get('/api/webhooks/meta/c/:hookId', route(async (req, res) => {
  const connection = await store.findConnectionByHook(req.params.hookId);
  verifyChallenge(req, res, connection?.verify_token);
}));

function parseRaw(req) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  try {
    return { raw, body: JSON.parse(raw.toString('utf8') || '{}') };
  } catch {
    return { raw, body: null };
  }
}

// Platform app: every connected Page / Instagram / WhatsApp number of every customer.
async function platformWebhook(req, res) {
  const { raw, body } = parseRaw(req);
  if (!meta.validSignature(raw, req.get('x-hub-signature-256'), meta.appSecret())) return res.sendStatus(401);
  if (!body) return res.sendStatus(400);
  const events = parseWebhook(body);
  if (events.length) background(channels.processEvents(events), 'meta');
  res.sendStatus(200); // answer Meta fast, or it retries
}

// A business's own Meta app, verified with that app's secret.
async function ownAppWebhook(req, res) {
  try {
    const connection = await store.findConnectionByHook(req.params.hookId);
    if (!connection || !connection.app_secret_enc) return res.sendStatus(404);
    const { raw, body } = parseRaw(req);
    if (!meta.validSignature(raw, req.get('x-hub-signature-256'), decrypt(connection.app_secret_enc))) return res.sendStatus(401);
    if (!body) return res.sendStatus(400);
    const events = parseWebhook(body);
    if (events.length) background(channels.processEvents(events, { connection }), 'meta');
    res.sendStatus(200);
  } catch (e) {
    console.error(`[meta webhook] ${e.message}`);
    res.sendStatus(500);
  }
}

module.exports = router;
module.exports.platformWebhook = platformWebhook;
module.exports.ownAppWebhook = ownAppWebhook;
