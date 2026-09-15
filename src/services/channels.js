// WhatsApp, Messenger and Instagram: connecting accounts, receiving messages, replying.
const crypto = require('crypto');
const db = require('../db');
const store = require('../meta/store');
const assistant = require('./assistant');
const { servingContext } = require('./serving');
const { graph, appId, appSecret } = require('../meta/graph');
const { encrypt, decrypt, randomToken } = require('../lib/crypto');
const { CHANNEL_NAMES } = require('../plans');
const { HttpError } = require('../lib/http');

const BURST_WAIT_MS = Number(process.env.CHANNEL_BURST_WAIT_MS ?? 2500);
const REPLY_WINDOW_MS = 24 * 3600_000; // Meta: free-form replies only within 24h of the client's last message
const MAX_LENGTH = { whatsapp: 4000, messenger: 2000, instagram: 1000 };
const ASSET_LABEL = { messenger: 'Facebook Page', instagram: 'Instagram account', whatsapp: 'WhatsApp number' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tokenOf = (connection) => decrypt(connection.access_token_enc);
const hostOf = (connection) => (connection.meta?.api === 'instagram' ? 'instagram' : 'facebook');
const isTokenError = (e) => e?.details?.code === 190 || /access token|session has expired|OAuthException/i.test(e?.message || '');

function splitText(text, max) {
  const parts = [];
  let rest = String(text).trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
    if (cut < max / 2) cut = max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

// ---------------------------------------------------------------- sending
// Returns the channel message id of the first part (used to recognise our own echoes).
async function sendText(connection, recipientId, text) {
  const token = tokenOf(connection);
  let firstId = null;
  if (connection.channel === 'whatsapp') {
    const body = text.replace(/\*\*(.+?)\*\*/g, '*$1*'); // WhatsApp bold is *one star*
    for (const part of splitText(body, MAX_LENGTH.whatsapp)) {
      const r = await graph('POST', `${connection.external_id}/messages`, {
        token,
        body: { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipientId, type: 'text', text: { body: part, preview_url: true } },
      });
      firstId = firstId || r.messages?.[0]?.id || null;
    }
    return firstId;
  }
  const host = hostOf(connection);
  const path = host === 'instagram' ? `${connection.external_id}/messages` : 'me/messages';
  const plain = text.replace(/\*\*(.+?)\*\*/g, '$1'); // Messenger / Instagram have no bold
  for (const part of splitText(plain, MAX_LENGTH[connection.channel])) {
    const r = await graph('POST', path, {
      token,
      host,
      body: { recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text: part } },
    });
    firstId = firstId || r.message_id || null;
  }
  return firstId;
}

// Best effort: blue ticks + "typing…" while the AI thinks.
async function showActivity(connection, ev) {
  const token = tokenOf(connection);
  if (connection.channel === 'whatsapp') {
    await graph('POST', `${connection.external_id}/messages`, {
      token,
      body: { messaging_product: 'whatsapp', status: 'read', message_id: ev.messageId, typing_indicator: { type: 'text' } },
    });
    return;
  }
  const host = hostOf(connection);
  const path = host === 'instagram' ? `${connection.external_id}/messages` : 'me/messages';
  await graph('POST', path, { token, host, body: { recipient: { id: ev.userId }, sender_action: 'mark_seen' } }).catch(() => {});
  await graph('POST', path, { token, host, body: { recipient: { id: ev.userId }, sender_action: 'typing_on' } });
}

async function fetchProfileName(connection, ev) {
  if (connection.channel === 'whatsapp') return ev.name || '';
  const fields = connection.channel === 'instagram' ? 'name,username' : 'first_name,last_name';
  const p = await graph('GET', ev.userId, { token: tokenOf(connection), host: hostOf(connection), query: { fields } });
  return ([p.first_name, p.last_name].filter(Boolean).join(' ') || p.name || (p.username ? `@${p.username}` : '')).trim();
}

async function deliver(connection, conversation, text, { ai = null, sender = 'bot' } = {}) {
  let sendError = null;
  let channelMessageId = null;
  try {
    channelMessageId = await sendText(connection, conversation.external_user_id, text);
  } catch (e) {
    sendError = e.message.slice(0, 500);
    await store
      .updateConnection(connection.id, { last_error: sendError, ...(isTokenError(e) ? { status: 'error' } : {}) })
      .catch(() => {});
  }
  const externalId = channelMessageId ? `${connection.channel}:${channelMessageId}` : null;
  await store.addChannelMessage(conversation.id, { role: 'assistant', sender, content: text, ai, sendError, externalId });
  return { sendError };
}

// ---------------------------------------------------------------- inbound
async function ingest(connection, ev) {
  const { conversation, created } = await store.findOrCreateChannelConversation({
    botId: connection.bot_id,
    channel: ev.channel,
    connectionId: connection.id,
    externalUserId: ev.userId,
    name: ev.name,
    contact: ev.contact,
  });
  const messageId = await store.addChannelMessage(conversation.id, {
    role: 'user',
    sender: 'client',
    content: ev.text.slice(0, 4000),
    externalId: `${ev.channel}:${ev.messageId}`,
  });
  if (!messageId) return null; // duplicate delivery

  await store.updateChannelConversation(conversation.id, {
    status: 'open',
    connection_id: connection.id,
    last_client_message_at: new Date(Math.min(ev.timestamp || Date.now(), Date.now())).toISOString(),
  });
  store.updateConnection(connection.id, { last_event_at: new Date().toISOString() }).catch(() => {});

  if (created && !conversation.client_name && connection.channel !== 'whatsapp') {
    const name = await fetchProfileName(connection, ev).catch(() => '');
    if (name) await store.updateChannelConversation(conversation.id, { client_name: name.slice(0, 200) }).catch(() => {});
  }
  return { conversation, messageId };
}

async function respond(connection, ev, { conversation, messageId }) {
  if (!connection.auto_reply || conversation.bot_paused) return;
  const ctx = await servingContext(await db.getBot(connection.bot_id));
  if (!ctx || !ctx.limits.channels.includes(connection.channel)) return; // bot paused by plan: message saved, no reply

  showActivity(connection, ev).catch(() => {});
  // People often send several short messages in a row: wait, then answer them together.
  await sleep(BURST_WAIT_MS);
  if (await store.hasNewerClientMessage(conversation.id, messageId)) return;
  const fresh = await db.getConversation(conversation.id);
  if (!fresh || fresh.bot_paused) return;

  let outcome;
  try {
    outcome = await assistant.replyToConversation({ account: ctx.account, bot: ctx.bot, conversation: fresh });
  } catch (e) {
    console.error(`[${connection.channel}] ${fresh.id}: ${e.message}`);
    await deliver(connection, fresh, ctx.settings.fallbackMessage);
    return;
  }

  if (!outcome.ok) {
    // Monthly allowance used up: give the contact info, at most once a day per client.
    const handoff = ctx.settings.handoff.trim();
    const notice = `${ctx.settings.fallbackMessage}${handoff ? `\n\n${handoff}` : ''}`;
    const last = await store.lastBotMessage(fresh.id);
    if (last && last.content === notice && Date.now() - Date.parse(last.created_at) < REPLY_WINDOW_MS) return;
    await deliver(connection, fresh, notice);
    return;
  }
  await deliver(connection, fresh, outcome.result.text, { ai: outcome.result });
}

// A message the Page sent that did not come from DigiPlus AI means a human answered: pause the bot.
async function handleEcho(connection, ev) {
  if (await store.messageExists(`${ev.channel}:${ev.messageId}`)) return; // our own reply
  const ourApp = connection.mode === 'own_app' ? connection.meta?.app_id : appId();
  if (ev.appId && ourApp && ev.appId === String(ourApp)) return;
  if (!ev.appId && connection.channel === 'instagram') return; // Instagram echoes don't say who sent them
  const conversation = await store.findChannelConversation(connection.bot_id, connection.channel, ev.userId);
  if (conversation && !conversation.bot_paused) await store.updateChannelConversation(conversation.id, { bot_paused: true });
}

// Handles a batch of webhook events. `connection` is set for own-app webhooks (already verified for that asset).
async function processEvents(events, { connection: fixed = null } = {}) {
  const byClient = new Map();
  for (const ev of events) {
    const key = `${ev.channel}:${ev.assetId}:${ev.userId}`;
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key).push(ev);
  }

  await Promise.all(
    [...byClient.values()].map(async (list) => {
      let latest = null;
      for (const ev of list) {
        try {
          const connection = fixed
            ? fixed.channel === ev.channel && String(fixed.external_id) === String(ev.assetId) ? fixed : null
            : await store.findActiveConnection(ev.channel, ev.assetId);
          if (!connection || connection.status === 'disconnected') continue;
          if (!fixed && connection.mode !== 'platform') continue; // own-app assets must use their own verified URL
          if (ev.kind === 'echo') {
            await handleEcho(connection, ev);
            continue;
          }
          const ingested = await ingest(connection, ev);
          if (ingested) latest = { connection, ev, ingested };
        } catch (e) {
          console.error(`[${ev.channel}] ingest: ${e.message}`);
        }
      }
      if (latest) {
        await respond(latest.connection, latest.ev, latest.ingested).catch((e) => console.error(`[${latest.ev.channel}] reply: ${e.message}`));
      }
    })
  );
}

// ---------------------------------------------------------------- human replies from the dashboard
async function humanReply(conversation, text) {
  if (conversation.channel === 'web') {
    await store.addChannelMessage(conversation.id, { role: 'assistant', sender: 'human', content: text });
    await store.updateChannelConversation(conversation.id, { bot_paused: true });
    return;
  }
  const connection = conversation.connection_id ? await store.getConnection(conversation.connection_id) : null;
  if (!connection || connection.status === 'disconnected') {
    throw new HttpError(409, `This ${ASSET_LABEL[conversation.channel]} is no longer connected.`);
  }
  const last = conversation.last_client_message_at ? Date.parse(conversation.last_client_message_at) : 0;
  if (!last || Date.now() - last > REPLY_WINDOW_MS) {
    throw new HttpError(409, "Meta only allows replies within 24 hours of the client's last message.");
  }
  const { sendError } = await deliver(connection, conversation, text, { sender: 'human' });
  if (sendError) throw new HttpError(502, sendError);
  await store.updateChannelConversation(conversation.id, { bot_paused: true });
}

// ---------------------------------------------------------------- connecting accounts
async function saveConnection({ account, bot, channel, externalId, name, token, mode = 'platform', appSecretValue = null, meta = {} }) {
  const existing = await store.findActiveConnection(channel, externalId);
  if (existing) {
    if (existing.bot_id !== bot.id) {
      const other = existing.account_id === account.id ? await db.getBot(existing.bot_id) : null;
      throw new HttpError(
        409,
        other
          ? `This ${ASSET_LABEL[channel]} is already connected to your bot “${other.name}”. Disconnect it there first.`
          : `This ${ASSET_LABEL[channel]} is already connected to another DigiPlus AI account.`
      );
    }
    return store.updateConnection(existing.id, {
      name,
      mode,
      access_token_enc: encrypt(token),
      app_secret_enc: appSecretValue ? encrypt(appSecretValue) : existing.app_secret_enc,
      hook_id: mode === 'own_app' ? existing.hook_id || randomToken(18) : existing.hook_id,
      verify_token: mode === 'own_app' ? existing.verify_token || randomToken(18) : existing.verify_token,
      meta: { ...existing.meta, ...meta },
      status: 'active',
      last_error: null,
    });
  }
  const created = await store.createConnection({
    account_id: account.id,
    bot_id: bot.id,
    channel,
    external_id: String(externalId),
    name,
    mode,
    access_token_enc: encrypt(token),
    app_secret_enc: appSecretValue ? encrypt(appSecretValue) : null,
    hook_id: mode === 'own_app' ? randomToken(18) : null,
    verify_token: mode === 'own_app' ? randomToken(18) : null,
    meta,
  });
  if (!created) throw new HttpError(409, `This ${ASSET_LABEL[channel]} was just connected somewhere else.`);
  return created;
}

async function exchangeLoginCode(code) {
  const r = await graph('GET', 'oauth/access_token', { query: { client_id: appId(), client_secret: appSecret(), code } });
  return r.access_token;
}

async function longLivedUserToken(token) {
  try {
    const r = await graph('GET', 'oauth/access_token', {
      query: { grant_type: 'fb_exchange_token', client_id: appId(), client_secret: appSecret(), fb_exchange_token: token },
    });
    return r.access_token || token;
  } catch {
    return token;
  }
}

// Facebook Login for Business → the Pages (and linked Instagram accounts) the user manages.
async function pagesFromLoginCode(code) {
  const userToken = await longLivedUserToken(await exchangeLoginCode(code));
  const r = await graph('GET', 'me/accounts', {
    token: userToken,
    query: { fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}', limit: 100 },
  });
  return (r.data || [])
    .filter((p) => p.access_token)
    .map((p) => ({
      id: String(p.id),
      name: p.name,
      token: p.access_token,
      picture: p.picture?.data?.url || null,
      instagram: p.instagram_business_account
        ? { id: String(p.instagram_business_account.id), username: p.instagram_business_account.username || '', picture: p.instagram_business_account.profile_picture_url || null }
        : null,
    }));
}

const subscribePage = (pageId, pageToken) =>
  graph('POST', `${pageId}/subscribed_apps`, { token: pageToken, query: { subscribed_fields: 'messages,messaging_postbacks,message_echoes' } });

async function connectPage({ account, bot, page }) {
  await subscribePage(page.id, page.token);
  return saveConnection({
    account, bot, channel: 'messenger', externalId: page.id, name: page.name, token: page.token,
    meta: { page_name: page.name, picture: page.picture, api: 'facebook' },
  });
}

async function connectInstagramViaPage({ account, bot, page }) {
  if (!page.instagram) throw new HttpError(400, `The Page “${page.name}” has no Instagram professional account linked.`);
  await subscribePage(page.id, page.token);
  return saveConnection({
    account, bot, channel: 'instagram', externalId: page.instagram.id,
    name: page.instagram.username ? `@${page.instagram.username}` : page.name,
    token: page.token,
    meta: { page_id: page.id, page_name: page.name, username: page.instagram.username, picture: page.instagram.picture, api: 'facebook' },
  });
}

// WhatsApp Embedded Signup: code → business token, subscribe the WABA, register the number.
async function connectWhatsAppEmbedded({ account, bot, code, phoneNumberId, wabaId }) {
  const token = await exchangeLoginCode(code);
  await graph('POST', `${wabaId}/subscribed_apps`, { token });
  const pin = String(crypto.randomInt(100000, 1000000));
  try {
    await graph('POST', `${phoneNumberId}/register`, { token, body: { messaging_product: 'whatsapp', pin } });
  } catch (e) {
    if (!/already|registered/i.test(e.message)) throw e;
  }
  const info = await graph('GET', phoneNumberId, { token, query: { fields: 'display_phone_number,verified_name' } });
  return saveConnection({
    account, bot, channel: 'whatsapp', externalId: phoneNumberId,
    name: info.display_phone_number || phoneNumberId,
    token,
    meta: { waba_id: String(wabaId), display_phone_number: info.display_phone_number, verified_name: info.verified_name, pin_enc: encrypt(pin) },
  });
}

// Manual: IDs + token from Meta. With an app secret, webhooks come from the business's own Meta app.
async function connectManual({ account, bot, channel, externalId, accessToken, appSecretValue, api, wabaId }) {
  const id = String(externalId || '').trim();
  const token = String(accessToken || '').trim();
  if (!/^\d{5,30}$/.test(id)) throw new HttpError(400, 'The ID must contain only digits.');
  if (token.length < 20) throw new HttpError(400, 'Paste the full access token.');

  let name;
  let meta = {};
  try {
    if (channel === 'whatsapp') {
      const info = await graph('GET', id, { token, query: { fields: 'display_phone_number,verified_name' } });
      name = info.display_phone_number || id;
      meta = { display_phone_number: info.display_phone_number, verified_name: info.verified_name, ...(wabaId ? { waba_id: String(wabaId) } : {}) };
    } else if (channel === 'messenger') {
      const info = await graph('GET', id, { token, query: { fields: 'name,picture{url}' } });
      name = info.name || id;
      meta = { page_name: info.name, picture: info.picture?.data?.url || null, api: 'facebook' };
    } else {
      const host = api === 'instagram' ? 'instagram' : 'facebook';
      const info = await graph('GET', id, { token, host, query: { fields: 'username' } });
      name = info.username ? `@${info.username}` : id;
      meta = { username: info.username || '', api: host };
    }
  } catch (e) {
    throw new HttpError(400, `Meta did not accept these details: ${e.message.replace(/^Meta: /, '')}`);
  }

  const mode = appSecretValue ? 'own_app' : 'platform';
  if (mode === 'own_app') {
    const app = await graph('GET', 'app', { token, host: meta.api === 'instagram' ? 'instagram' : 'facebook' }).catch(() => null);
    if (app?.id) meta.app_id = String(app.id);
  } else {
    try {
      if (channel === 'messenger') await subscribePage(id, token);
      if (channel === 'whatsapp' && wabaId) await graph('POST', `${wabaId}/subscribed_apps`, { token });
    } catch (e) {
      throw new HttpError(
        400,
        `Could not subscribe it to DigiPlus AI (${e.message.replace(/^Meta: /, '')}). If this token comes from your own Meta app, also paste that app's secret.`
      );
    }
  }
  return saveConnection({ account, bot, channel, externalId: id, name, token, mode, appSecretValue, meta });
}

async function disconnect(connection) {
  // Tokens are wiped; webhooks for this asset are ignored from now on.
  return store.updateConnection(connection.id, { status: 'disconnected', access_token_enc: encrypt(''), app_secret_enc: null });
}

module.exports = {
  CHANNEL_NAMES,
  ASSET_LABEL,
  REPLY_WINDOW_MS,
  processEvents,
  humanReply,
  pagesFromLoginCode,
  connectPage,
  connectInstagramViaPage,
  connectWhatsAppEmbedded,
  connectManual,
  disconnect,
  splitText,
};
