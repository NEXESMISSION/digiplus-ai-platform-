// Super admin (platform owner): accounts, revenue, AI costs, manual payment approvals.
const express = require('express');
const db = require('../db');
const { requireUser, requireSuper } = require('../auth');
const { ADDONS, EXPIRED, planById, limitsFor, isPaidActive, currentPeriod } = require('../plans');
const { HttpError, route, clean, intIn } = require('../lib/http');

const router = express.Router();
router.use('/api/super', requireUser, requireSuper);

const USD_TND = () => Number(process.env.USD_TND) || 2.92;

router.get('/api/super/overview', route(async (req, res) => {
  const period = currentPeriod();
  const [rows, pending] = await Promise.all([db.superAccounts(period), db.listPaymentRequests({ status: 'pending', limit: 100 })]);

  const accounts = rows.map((r) => {
    const paid = isPaidActive(r);
    const plan = planById(r.plan) || EXPIRED;
    // A paid plan without an expiry date is complimentary (given for free): no revenue.
    const billed = paid && Boolean(r.plan_expires_at);
    const monthlyTND = billed && r.billing_provider !== 'dodo' ? plan.priceTND + r.extra_bots * ADDONS.extraBot.priceTND : 0;
    const monthlyUSD = billed && r.billing_provider === 'dodo' ? plan.priceUSD + r.extra_bots * ADDONS.extraBot.priceUSD : 0;
    return {
      ...r,
      cost_usd: Number(r.cost_usd),
      bots: Number(r.bots),
      conversations: Number(r.conversations),
      paid,
      limits: limitsFor(r),
      monthlyTND,
      monthlyUSD,
    };
  });

  const sum = (key) => accounts.reduce((n, a) => n + a[key], 0);
  res.json({
    period,
    usdToTnd: USD_TND(),
    totals: {
      accounts: accounts.length,
      paying: accounts.filter((a) => a.paid && (a.monthlyTND || a.monthlyUSD)).length,
      monthlyTND: sum('monthlyTND'),
      monthlyUSD: sum('monthlyUSD'),
      aiCostUSD: Number(sum('cost_usd').toFixed(4)),
      replies: sum('replies'),
      pendingPayments: pending.length,
    },
    accounts,
  });
}));

router.patch('/api/super/accounts/:id', route(async (req, res) => {
  const account = await db.getAccount(req.params.id);
  if (!account) throw new HttpError(404, 'Account not found');
  const body = req.body || {};
  const patch = {};

  if ('plan' in body) {
    if (!planById(body.plan)) throw new HttpError(400, 'Unknown plan');
    patch.plan = body.plan;
    if (body.plan !== 'trial' && account.billing_provider === 'none') patch.billing_provider = 'manual';
  }
  if ('plan_expires_at' in body) {
    if (body.plan_expires_at === null || body.plan_expires_at === '') patch.plan_expires_at = null;
    else if (Number.isFinite(Date.parse(body.plan_expires_at))) patch.plan_expires_at = new Date(body.plan_expires_at).toISOString();
    else throw new HttpError(400, 'Invalid expiry date');
  }
  if ('extra_bots' in body) patch.extra_bots = intIn(body.extra_bots, 0, 100, 0);
  if (typeof body.name === 'string' && clean(body.name, 120)) patch.name = clean(body.name, 120);

  if (Object.keys(patch).length) await db.updateAccount(account.id, patch);
  const bonus = intIn(body.add_bonus_replies, 0, 1_000_000, 0);
  if (bonus) await db.addBonusReplies(account.id, currentPeriod(), bonus);
  res.json({ ok: true });
}));

router.get('/api/super/payments', route(async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : undefined;
  res.json({ requests: await db.listPaymentRequests({ status, limit: 200 }) });
}));

router.post('/api/super/payments/:id/approve', route(async (req, res) => {
  const request = await db.reviewPaymentRequest(req.params.id, 'approved', clean(req.body?.note, 500));
  if (!request) throw new HttpError(409, 'This payment was already reviewed (or does not exist).');

  try {
    const account = await db.getAccount(request.account_id);
    if (!account) throw new HttpError(404, 'Account not found');
    if (request.plan) {
      // Renewing the same plan extends it; switching plan starts from today.
      const sameActivePlan = isPaidActive(account) && account.plan === request.plan && account.plan_expires_at;
      const start = new Date(sameActivePlan ? Math.max(Date.now(), Date.parse(account.plan_expires_at)) : Date.now());
      start.setUTCMonth(start.getUTCMonth() + request.months);
      await db.updateAccount(account.id, {
        plan: request.plan,
        plan_expires_at: start.toISOString(),
        extra_bots: request.extra_bots,
        billing_provider: 'manual',
      });
    }
    if (request.reply_packs) {
      await db.addBonusReplies(account.id, currentPeriod(), request.reply_packs * ADDONS.replyPack.replies);
    }
  } catch (e) {
    await db.reopenPaymentRequest(request.id).catch(() => {});
    throw e;
  }
  res.json({ ok: true });
}));

router.post('/api/super/payments/:id/reject', route(async (req, res) => {
  const request = await db.reviewPaymentRequest(req.params.id, 'rejected', clean(req.body?.note, 500));
  if (!request) throw new HttpError(409, 'This payment was already reviewed (or does not exist).');
  res.json({ ok: true });
}));

const PLATFORM_FIELDS = { d17Number: 60, bankName: 120, bankRib: 60, whatsapp: 60, supportEmail: 200, paymentInstructions: 2000 };

router.get('/api/super/settings', route(async (req, res) => res.json(await db.getPlatformSettings())));

router.put('/api/super/settings', route(async (req, res) => {
  const data = Object.fromEntries(Object.entries(PLATFORM_FIELDS).map(([k, max]) => [k, clean(req.body?.[k], max)]));
  res.json(await db.savePlatformSettings(data));
}));

module.exports = router;
