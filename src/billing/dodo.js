// Card payments in USD through Dodo Payments (merchant of record).
// Products are created in the Dodo dashboard; their IDs go in .env.
const DodoModule = require('dodopayments');
const db = require('../db');
const { ADDONS, currentPeriod } = require('../plans');
const { HttpError } = require('../lib/http');

const DodoPayments = DodoModule.default || DodoModule;
const GRACE_MS = 3 * 864e5; // access continues 3 days after the billing date while a renewal settles
const env = (k) => process.env[k] || '';

const isEnabled = () => Boolean(env('DODO_PAYMENTS_API_KEY') && env('DODO_PRODUCT_STARTER') && env('DODO_PRODUCT_PRO'));
const isWebhookConfigured = () => Boolean(env('DODO_PAYMENTS_WEBHOOK_KEY'));

let client;
function dodo() {
  if (!client) {
    client = new DodoPayments({
      bearerToken: env('DODO_PAYMENTS_API_KEY') || 'not-configured',
      webhookKey: env('DODO_PAYMENTS_WEBHOOK_KEY') || null,
      environment: env('DODO_PAYMENTS_ENVIRONMENT') === 'live_mode' ? 'live_mode' : 'test_mode',
    });
  }
  return client;
}

const PRODUCT_ENV = { starter: 'DODO_PRODUCT_STARTER', pro: 'DODO_PRODUCT_PRO', business: 'DODO_PRODUCT_BUSINESS' };

const productFor = (plan) => (PRODUCT_ENV[plan] ? env(PRODUCT_ENV[plan]) : '') || '';

function planForProduct(productId) {
  if (!productId) return null;
  return Object.keys(PRODUCT_ENV).find((plan) => productId === env(PRODUCT_ENV[plan])) || null;
}

function requireEnabled() {
  if (!isEnabled()) throw new HttpError(400, 'Card payments are not available yet. Please use D17 or bank transfer.');
}

async function createSubscriptionCheckout({ account, email, plan, extraBots, returnUrl }) {
  requireEnabled();
  const item = { product_id: productFor(plan), quantity: 1 };
  if (!item.product_id) throw new HttpError(400, 'Unknown plan');
  if (extraBots > 0) {
    if (!env('DODO_ADDON_EXTRA_BOT')) throw new HttpError(400, 'Extra bots cannot be paid by card yet.');
    item.addons = [{ addon_id: env('DODO_ADDON_EXTRA_BOT'), quantity: extraBots }];
  }
  const session = await dodo().checkoutSessions.create({
    product_cart: [item],
    customer: { email, name: account.name },
    return_url: returnUrl,
    metadata: { account_id: account.id, kind: 'subscription' },
  });
  return session.checkout_url;
}

async function createReplyPackCheckout({ account, email, packs, returnUrl }) {
  requireEnabled();
  if (!env('DODO_PRODUCT_REPLY_PACK')) throw new HttpError(400, 'Reply packs cannot be paid by card yet.');
  const session = await dodo().checkoutSessions.create({
    product_cart: [{ product_id: env('DODO_PRODUCT_REPLY_PACK'), quantity: packs }],
    customer: { email, name: account.name },
    return_url: returnUrl,
    metadata: { account_id: account.id, kind: 'reply_pack', packs: String(packs) },
  });
  return session.checkout_url;
}

// Upgrade/downgrade or change extra bots on an existing card subscription (prorated).
async function changeSubscription(account, plan, extraBots) {
  requireEnabled();
  if (account.billing_provider !== 'dodo' || !account.dodo_subscription_id) {
    throw new HttpError(400, 'You need an active card subscription to change it.');
  }
  if (extraBots > 0 && !env('DODO_ADDON_EXTRA_BOT')) throw new HttpError(400, 'Extra bots cannot be paid by card yet.');
  await dodo().subscriptions.changePlan(account.dodo_subscription_id, {
    product_id: productFor(plan),
    quantity: 1,
    proration_billing_mode: 'prorated_immediately',
    addons: extraBots > 0 ? [{ addon_id: env('DODO_ADDON_EXTRA_BOT'), quantity: extraBots }] : [],
  });
}

async function portalLink(account, returnUrl) {
  requireEnabled();
  if (!account.dodo_customer_id) throw new HttpError(400, 'No card subscription on this account.');
  const session = await dodo().customers.customerPortal.create(account.dodo_customer_id, { return_url: returnUrl });
  return session.link;
}

// Throws when the signature is invalid.
function unwrapWebhook(rawBody, headers) {
  return dodo().webhooks.unwrap(rawBody, {
    headers: {
      'webhook-id': String(headers['webhook-id'] || ''),
      'webhook-signature': String(headers['webhook-signature'] || ''),
      'webhook-timestamp': String(headers['webhook-timestamp'] || ''),
    },
  });
}

async function accountForSubscription(data) {
  const byMetadata = data.metadata?.account_id ? await db.getAccount(data.metadata.account_id) : null;
  return byMetadata || (await db.findAccountByDodoSubscription(data.subscription_id));
}

async function handleSubscriptionEvent(type, data) {
  const account = await accountForSubscription(data);
  if (!account) {
    console.warn(`[dodo] ${type}: no account for subscription ${data.subscription_id}`);
    return;
  }
  // Events about an older subscription must not touch the one the account uses now.
  const isCurrent = !account.dodo_subscription_id || account.dodo_subscription_id === data.subscription_id;
  const plan = planForProduct(data.product_id);
  const extraBots = (data.addons || [])
    .filter((a) => a.addon_id === env('DODO_ADDON_EXTRA_BOT'))
    .reduce((n, a) => n + (a.quantity || 0), 0);
  const base = {
    billing_provider: 'dodo',
    dodo_subscription_id: data.subscription_id,
    dodo_customer_id: data.customer?.customer_id || account.dodo_customer_id,
    dodo_status: data.status || type.split('.')[1],
  };

  switch (type) {
    case 'subscription.active':
    case 'subscription.renewed':
    case 'subscription.plan_changed':
    case 'subscription.unpaused':
    case 'subscription.updated': {
      if (!plan || (data.status && data.status !== 'active')) {
        if (isCurrent) await db.updateAccount(account.id, { dodo_status: base.dodo_status });
        return;
      }
      const paidUntil = Date.parse(data.next_billing_date) || Date.now() + 31 * 864e5;
      await db.updateAccount(account.id, {
        ...base,
        plan,
        extra_bots: extraBots,
        plan_expires_at: new Date(paidUntil + GRACE_MS).toISOString(),
      });
      return;
    }
    case 'subscription.past_due':
      if (isCurrent && data.past_due_ends_at) await db.updateAccount(account.id, { ...base, plan_expires_at: data.past_due_ends_at });
      return;
    case 'subscription.on_hold':
    case 'subscription.paused':
    case 'subscription.failed':
    case 'subscription.expired':
      if (isCurrent) await db.updateAccount(account.id, { ...base, plan_expires_at: new Date().toISOString() });
      return;
    case 'subscription.cancelled':
      // Already paid until plan_expires_at: keep access until then.
      if (isCurrent) await db.updateAccount(account.id, base);
      return;
    default:
  }
}

async function handleEvent(event) {
  const type = event?.type || '';
  const data = event?.data || {};
  if (type.startsWith('subscription.')) return handleSubscriptionEvent(type, data);
  if (type === 'payment.succeeded' && data.metadata?.kind === 'reply_pack') {
    const account = await db.getAccount(data.metadata.account_id);
    if (!account) return console.warn(`[dodo] reply pack payment ${data.payment_id}: account not found`);
    const packs = Math.max(1, Number.parseInt(data.metadata.packs, 10) || 1);
    await db.addBonusReplies(account.id, currentPeriod(), packs * ADDONS.replyPack.replies);
  }
}

module.exports = {
  isEnabled,
  isWebhookConfigured,
  createSubscriptionCheckout,
  createReplyPackCheckout,
  changeSubscription,
  portalLink,
  unwrapWebhook,
  handleEvent,
};
