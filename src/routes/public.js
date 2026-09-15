// Public endpoints: site config and the visitor chat for each bot.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const store = require('../meta/store');
const assistant = require('../services/assistant');
const { servingContext } = require('../services/serving');
const dodo = require('../billing/dodo');
const { sanitizeSettings } = require('../settings');
const { publicPricing } = require('../plans');
const { HttpError, route, clean, safeEqual, background, rateLimit } = require('../lib/http');

const router = express.Router();
const BRAND = process.env.BRAND_NAME || 'DigiPlus AI';
// A real client question fits easily; longer pastes only inflate the cost of every reply.
const MAX_CLIENT_MESSAGE = 1_200;

router.get('/api/public/config', (req, res) => {
  res.json({
    brand: BRAND,
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    pricing: publicPricing(),
    cardPayments: dodo.isEnabled(),
  });
});

async function servingByPublicId(publicId) {
  const ctx = await servingContext(await db.getBotByPublicId(publicId));
  if (!ctx) throw new HttpError(404, 'This chat is not available.');
  return ctx;
}

router.get('/api/chat/bot/:publicId', route(async (req, res) => {
  const { settings: s, limits } = await servingByPublicId(req.params.publicId);
  res.json({
    botName: s.botName,
    businessName: s.businessName,
    welcomeMessage: s.welcomeMessage,
    askClientInfo: s.askClientInfo,
    accentColor: s.accentColor,
    showBadge: limits.badge,
    brand: BRAND,
  });
}));

router.post('/api/chat/bot/:publicId/start', rateLimit('start', 10, 60_000), route(async (req, res) => {
  const ctx = await servingByPublicId(req.params.publicId);
  const name = clean(req.body?.name, 200);
  const contact = clean(req.body?.contact, 200);
  if (ctx.settings.askClientInfo === 'required' && (!name || !contact)) {
    throw new HttpError(400, 'Please enter your name and phone or email.');
  }
  const conversation = await db.createConversation({
    botId: ctx.bot.id,
    token: crypto.randomBytes(24).toString('hex'),
    name,
    contact,
    source: clean(req.body?.source, 200),
    ip: req.ip,
  });
  res.json({ id: conversation.id, token: conversation.token });
}));

async function loadClientConversation(req) {
  const conversation = await db.getConversation(req.params.id);
  const token = req.get('x-chat-token');
  if (!conversation || conversation.channel !== 'web' || !token || !safeEqual(conversation.token, token)) {
    throw new HttpError(404, 'Conversation not found');
  }
  return conversation;
}

// ?after=<message id> returns only newer messages (used to show replies typed by a human).
router.get('/api/chat/:id', route(async (req, res) => {
  const conversation = await loadClientConversation(req);
  const after = Math.max(0, Number.parseInt(req.query.after, 10) || 0);
  const messages = await store.getMessagesAfter(conversation.id, after);
  res.json({
    status: conversation.status,
    messages: messages.map(({ id, role, content, created_at }) => ({ id, role, content, created_at })),
  });
}));

const inFlight = new Set();
router.post('/api/chat/:id/message', rateLimit('message', 20, 60_000), route(async (req, res) => {
  const conversation = await loadClientConversation(req);
  const content = clean(req.body?.content, 10_000);
  if (!content) throw new HttpError(400, 'Message is empty');
  if (content.length > MAX_CLIENT_MESSAGE) throw new HttpError(400, `Message is too long (max ${MAX_CLIENT_MESSAGE} characters).`);
  if (inFlight.has(conversation.id)) throw new HttpError(429, 'Please wait for the answer to your previous message.');

  const ctx = await servingContext(await db.getBot(conversation.bot_id));
  if (!ctx) throw new HttpError(404, 'This chat is not available.');

  inFlight.add(conversation.id);
  try {
    const messageId = await store.addChannelMessage(conversation.id, { role: 'user', sender: 'client', content });
    await store.updateChannelConversation(conversation.id, { status: 'open', last_client_message_at: new Date().toISOString() });
    if (conversation.bot_paused) return res.json({ reply: null, messageId, paused: true }); // a human is answering

    let outcome;
    try {
      outcome = await assistant.replyToConversation({ account: ctx.account, bot: ctx.bot, conversation });
    } catch (e) {
      console.error(`[chat] ${conversation.id}: ${e.message}`);
      return res.status(502).json({ error: ctx.settings.fallbackMessage });
    }

    if (!outcome.ok) {
      // Monthly allowance used up: the message is saved for the owner, the visitor gets the contact info.
      const contact = ctx.settings.handoff.trim();
      return res.json({ reply: `${ctx.settings.fallbackMessage}${contact ? `\n\n${contact}` : ''}`, unavailable: true, messageId });
    }

    const replyId = await store.addChannelMessage(conversation.id, { role: 'assistant', sender: 'bot', content: outcome.result.text, ai: outcome.result });
    res.json({ reply: outcome.result.text, messageId, replyId });
  } finally {
    inFlight.delete(conversation.id);
  }
}));

router.post('/api/chat/:id/end', route(async (req, res) => {
  const conversation = await loadClientConversation(req);
  await db.updateConversation(conversation.id, { status: 'closed' });
  const bot = await db.getBot(conversation.bot_id);
  if (conversation.message_count > 1 && bot && sanitizeSettings(bot.settings).autoSummary) {
    background(assistant.summarizeConversation(conversation.id), 'summary');
  }
  res.json({ ok: true });
}));

module.exports = router;
