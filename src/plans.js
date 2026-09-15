// Plans, prices and limits — the single source of truth for billing and enforcement.
// Costs measured with gpt-5-mini: ~0.002–0.004 DT per AI reply, ~0.008 DT per summary.

const CHANNEL_NAMES = { web: 'Website chat', messenger: 'Facebook Messenger', instagram: 'Instagram DMs', whatsapp: 'WhatsApp' };

const TRIAL_DAYS = 7;

// Every new account starts here. Never sold, so it is not shown on the pricing page.
const TRIAL = {
  id: 'trial',
  name: 'Free trial',
  priceTND: 0,
  priceUSD: 0,
  bots: 1,
  replies: 300,
  dataChars: 30_000,
  badge: true,
  channels: ['web', 'messenger', 'instagram'],
};

// Trial over (or paid plan expired) and nothing paid: the dashboard and the data stay,
// but the bots stop answering — replies: 0 makes consume_reply refuse every reply,
// so clients get the owner's contact instead of an AI answer.
const EXPIRED = {
  id: 'expired',
  name: 'No plan',
  priceTND: 0,
  priceUSD: 0,
  bots: 1,
  replies: 0,
  dataChars: 30_000,
  badge: true,
  channels: ['web'],
};

// The plans customers can buy, in the order they appear on the pricing page.
const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    priceTND: 39,
    priceUSD: 15,
    bots: 1,
    replies: 2_000,
    dataChars: 30_000,
    badge: true,
    channels: ['web', 'messenger', 'instagram'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceTND: 99,
    priceUSD: 35,
    bots: 3,
    replies: 5_000,
    dataChars: 100_000,
    badge: false,
    channels: ['web', 'messenger', 'instagram', 'whatsapp'],
  },
  business: {
    id: 'business',
    name: 'Business',
    priceTND: 199,
    priceUSD: 69,
    bots: 10,
    replies: 15_000,
    dataChars: 300_000,
    badge: false,
    channels: ['web', 'messenger', 'instagram', 'whatsapp'],
  },
};

// Every plan an account row may carry (trial included), for lookups and validation.
const ALL_PLANS = { trial: TRIAL, ...PLANS };
const planById = (id) => ALL_PLANS[id] || null;

const ADDONS = {
  extraBot: { priceTND: 19, priceUSD: 7 },
  replyPack: { replies: 1_000, priceTND: 15, priceUSD: 5 },
};

const PAID_PLANS = ['starter', 'pro', 'business'];

const currentPeriod = (date = new Date()) => date.toISOString().slice(0, 7);

function isPaidActive(account, now = Date.now()) {
  if (!account || !PAID_PLANS.includes(account.plan)) return false;
  return !account.plan_expires_at || Date.parse(account.plan_expires_at) > now;
}

// A trial always has an end date: without one it counts as finished, never as free forever.
function isTrialActive(account, now = Date.now()) {
  if (!account || account.plan !== 'trial') return false;
  return Boolean(account.plan_expires_at) && Date.parse(account.plan_expires_at) > now;
}

const trialEndsAt = (from = Date.now()) => new Date(from + TRIAL_DAYS * 86_400_000).toISOString();

// What the account can use right now (a finished trial or an expired paid plan stops the bots).
function limitsFor(account) {
  const paid = isPaidActive(account);
  const trial = !paid && isTrialActive(account);
  const plan = paid ? PLANS[account.plan] : trial ? TRIAL : EXPIRED;
  return {
    plan: plan.id,
    planName: plan.name,
    expiresAt: paid || trial ? account.plan_expires_at || null : null,
    trial,
    bots: plan.bots + (paid ? account.extra_bots || 0 : 0),
    replies: plan.replies,
    dataChars: plan.dataChars,
    badge: plan.badge,
    channels: plan.channels,
  };
}

// Cheapest plan on sale that includes a channel (for upgrade messages).
const planForChannel = (channel) => Object.values(PLANS).find((p) => p.channels.includes(channel));

// Manual (Tunisian dinar) price of a payment request.
function manualAmountTND({ plan, months = 1, extraBots = 0, replyPacks = 0 }) {
  const monthly = (plan ? PLANS[plan].priceTND : 0) + extraBots * ADDONS.extraBot.priceTND;
  return monthly * months + replyPacks * ADDONS.replyPack.priceTND;
}

function publicPricing() {
  return { plans: Object.values(PLANS), addons: ADDONS, channelNames: CHANNEL_NAMES, trialDays: TRIAL_DAYS };
}

module.exports = {
  PLANS,
  ALL_PLANS,
  TRIAL,
  EXPIRED,
  TRIAL_DAYS,
  ADDONS,
  PAID_PLANS,
  CHANNEL_NAMES,
  planById,
  currentPeriod,
  isPaidActive,
  isTrialActive,
  trialEndsAt,
  limitsFor,
  planForChannel,
  manualAmountTND,
  publicPricing,
};
