// Billing: manual dinar payments (D17 / bank transfer, approved by the super admin)
// and card payments in USD through Dodo Payments.
const express = require('express');
const db = require('../db');
const dodo = require('../billing/dodo');
const { requireUser, requireAccount } = require('../auth');
const { PAID_PLANS, limitsFor, isPaidActive, currentPeriod, manualAmountTND, publicPricing } = require('../plans');
const { HttpError, route, clean, intIn, rateLimit, appUrl } = require('../lib/http');

const router = express.Router();
router.use('/api/billing', requireUser, requireAccount);

const METHODS = ['d17', 'bank', 'cash', 'other'];

router.get('/api/billing', route(async (req, res) => {
  const account = req.account;
  const limits = limitsFor(account);
  const [platform, requests, usage] = await Promise.all([
    db.getPlatformSettings(),
    db.listPaymentRequests({ accountId: account.id, limit: 10 }),
    db.getUsage(account.id, currentPeriod()),
  ]);
  res.json({
    pricing: publicPricing(),
    limits,
    account: {
      plan: account.plan,
      plan_expires_at: account.plan_expires_at,
      billing_provider: account.billing_provider,
      extra_bots: account.extra_bots,
      dodo_status: account.dodo_status,
      hasCardSubscription: Boolean(account.billing_provider === 'dodo' && account.dodo_subscription_id && isPaidActive(account)),
      hasCardCustomer: Boolean(account.dodo_customer_id),
    },
    usage: { period: currentPeriod(), replies: usage.replies, bonusReplies: usage.bonus_replies, limit: limits.replies + usage.bonus_replies },
    cardPayments: dodo.isEnabled(),
    manual: {
      d17: platform.d17Number || '',
      bankName: platform.bankName || '',
      bankRib: platform.bankRib || '',
      whatsapp: platform.whatsapp || '',
      instructions: platform.paymentInstructions || '',
    },
    requests: requests.map(({ accounts, ...r }) => r),
  });
}));

router.post(
  '/api/billing/manual',
  rateLimit('manual-payment', 10, 3600_000, (req) => req.account?.id || req.ip),
  route(async (req, res) => {
    const plan = PAID_PLANS.includes(req.body?.plan) ? req.body.plan : null;
    const months = intIn(req.body?.months, 1, 12, 1);
    const extraBots = plan ? intIn(req.body?.extraBots, 0, 20, 0) : 0;
    const replyPacks = intIn(req.body?.replyPacks, 0, 50, 0);
    const method = METHODS.includes(req.body?.method) ? req.body.method : null;
    const reference = clean(req.body?.reference, 200);

    if (!plan && !replyPacks) throw new HttpError(400, 'Choose a plan or a reply pack.');
    if (!method) throw new HttpError(400, 'Choose how you paid.');
    if (!reference) throw new HttpError(400, 'Add the transaction reference so we can find your payment.');

    const pending = await db.listPaymentRequests({ accountId: req.account.id, status: 'pending', limit: 5 });
    if (pending.length >= 3) throw new HttpError(429, 'You already have payments waiting for confirmation.');

    const request = await db.createPaymentRequest({
      account_id: req.account.id,
      plan,
      months,
      extra_bots: extraBots,
      reply_packs: replyPacks,
      amount: manualAmountTND({ plan, months, extraBots, replyPacks }),
      currency: 'TND',
      method,
      reference,
    });
    res.status(201).json({ request });
  })
);

// Card (Dodo): new subscription, or a prorated change on the existing one.
router.post('/api/billing/checkout', route(async (req, res) => {
  const plan = PAID_PLANS.includes(req.body?.plan) ? req.body.plan : null;
  if (!plan) throw new HttpError(400, 'Choose a plan.');
  const extraBots = intIn(req.body?.extraBots, 0, 20, 0);
  const account = req.account;

  if (account.billing_provider === 'dodo' && account.dodo_subscription_id && isPaidActive(account)) {
    await dodo.changeSubscription(account, plan, extraBots);
    return res.json({ changed: true });
  }
  const url = await dodo.createSubscriptionCheckout({
    account,
    email: req.user.email,
    plan,
    extraBots,
    returnUrl: `${appUrl(req)}/app#billing`,
  });
  res.json({ url });
}));

router.post('/api/billing/reply-packs', route(async (req, res) => {
  const packs = intIn(req.body?.packs, 1, 20, 1);
  const url = await dodo.createReplyPackCheckout({
    account: req.account,
    email: req.user.email,
    packs,
    returnUrl: `${appUrl(req)}/app#billing`,
  });
  res.json({ url });
}));

router.post('/api/billing/portal', route(async (req, res) => {
  res.json({ url: await dodo.portalLink(req.account, `${appUrl(req)}/app#billing`) });
}));

// Dodo webhook — mounted with a raw body parser (signatures are computed over the exact bytes).
async function dodoWebhook(req, res) {
  if (!dodo.isWebhookConfigured()) return res.status(503).json({ error: 'Webhooks are not configured' });
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : '';

  let event;
  try {
    event = dodo.unwrapWebhook(raw, req.headers);
  } catch {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const id = String(req.get('webhook-id') || '');
  try {
    const isNew = await db.recordWebhookEvent({ id, provider: 'dodo', type: event.type, payload: event });
    if (!isNew) return res.json({ received: true, duplicate: true });
  } catch (e) {
    console.error(`[dodo webhook] ${e.message}`);
    return res.status(500).json({ error: 'Could not store the event' });
  }

  try {
    await dodo.handleEvent(event);
    await db.markWebhookProcessed(id);
    res.json({ received: true });
  } catch (e) {
    console.error(`[dodo webhook] ${event.type}: ${e.message}`);
    await db.forgetWebhookEvent(id).catch(() => {}); // let Dodo's retry process it again
    res.status(500).json({ error: 'Processing failed' });
  }
}

module.exports = router;
module.exports.dodoWebhook = dodoWebhook;
