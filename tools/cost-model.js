// What each plan can cost you in the worst case — run: node tools/cost-model.js
// Reads the real plans and the real OpenAI prices, so it stays true when you change them.

const { PLANS, TRIAL, ADDONS } = require('../src/plans');
const { PRICE, MODEL } = require('../src/ai');

const USD_TND = Number(process.env.USD_TND) || 2.92;

// French/Arabizi is ~3.5 characters per token. Arabic script is denser (~2.5),
// so a bot written in Arabic letters costs roughly 40% more than these numbers.
const CHARS_PER_TOKEN = 3.5;
const PROMPT_OVERHEAD = 700;   // the fixed instructions in prompts.js
const MAX_HISTORY = 20;          // services/assistant.js
const MAX_HISTORY_CHARS = 6000;  // services/assistant.js — trimHistory budget
const MAX_CLIENT_MESSAGE = 1200; // routes/public.js accepts up to this
const MAX_OUTPUT = 1200;         // REPLY_MAX_TOKENS, reasoning included
// What the conversation can actually weigh now that history is trimmed.
const WORST_HISTORY = Math.min(MAX_HISTORY * MAX_CLIENT_MESSAGE, MAX_HISTORY_CHARS);

const tok = (chars) => Math.round(chars / CHARS_PER_TOKEN);
const usd = (n) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const dt = (n) => `${(n * USD_TND).toFixed(2)} DT`;

// cached = the share of input tokens OpenAI serves from its prompt cache (10x cheaper).
function costPerReply({ dataChars, historyChars, outputTokens, cachedShare }) {
  const input = PROMPT_OVERHEAD + tok(dataChars) + tok(historyChars);
  const cached = Math.round(input * cachedShare);
  return ((input - cached) * PRICE.input + cached * PRICE.cached + outputTokens * PRICE.output) / 1e6;
}

const SCENARIOS = {
  // A normal Tunisian business: a page or two of services, short messages.
  normal: (plan) => ({ dataChars: Math.min(6000, plan.dataChars), historyChars: 1600, outputTokens: 250, cachedShare: 0.7 }),
  // Everything pushed to the limit the code allows today.
  abuse: (plan) => ({ dataChars: plan.dataChars, historyChars: WORST_HISTORY, outputTokens: MAX_OUTPUT, cachedShare: 0.5 }),
  // Same abuse, but the attacker spaces requests so the prompt cache expires.
  abuseNoCache: (plan) => ({ dataChars: plan.dataChars, historyChars: WORST_HISTORY, outputTokens: MAX_OUTPUT, cachedShare: 0 }),
};

console.log(`\nModel: ${MODEL} — input ${usd(PRICE.input)}/1M · cached ${usd(PRICE.cached)}/1M · output ${usd(PRICE.output)}/1M · 1 USD = ${USD_TND} DT\n`);

const rows = [];
for (const plan of [TRIAL, ...Object.values(PLANS)]) {
  const revenueUSD = plan.priceUSD;
  const line = { plan: plan.name, replies: plan.replies, revenue: revenueUSD };
  for (const [name, build] of Object.entries(SCENARIOS)) {
    const per = costPerReply(build(plan));
    line[name] = { per, month: per * plan.replies };
  }
  rows.push(line);
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(pad('Plan', 12) + padL('Replies', 9) + padL('Revenue', 10) + padL('Normal/mo', 12) + padL('Abused/mo', 12) + padL('No cache/mo', 13) + padL('Worst margin', 14));
console.log('-'.repeat(82));
for (const r of rows) {
  const margin = r.revenue - r.abuseNoCache.month;
  console.log(
    pad(r.plan, 12) +
    padL(r.replies.toLocaleString('en-US'), 9) +
    padL(r.revenue ? usd(r.revenue) : 'free', 10) +
    padL(usd(r.normal.month), 12) +
    padL(usd(r.abuse.month), 12) +
    padL(usd(r.abuseNoCache.month), 13) +
    padL(`${margin >= 0 ? '' : '-'}${usd(Math.abs(margin))}`, 14)
  );
}

console.log('\nPer reply:');
for (const r of rows) {
  console.log(`  ${pad(r.plan, 10)} normal ${padL(usd(r.normal.per), 9)} (${dt(r.normal.per)})   abused ${padL(usd(r.abuseNoCache.per), 9)} (${dt(r.abuseNoCache.per)})   = ${(r.abuseNoCache.per / r.normal.per).toFixed(0)}x more`);
}

console.log('\nHow many abused replies before a plan stops making money:');
for (const r of rows) {
  if (!r.revenue) { console.log(`  ${pad(r.plan, 10)} free plan — every reply is pure cost`); continue; }
  const n = Math.floor(r.revenue / r.abuseNoCache.per);
  console.log(`  ${pad(r.plan, 10)} ${padL(n.toLocaleString('en-US'), 7)} of ${r.replies.toLocaleString('en-US')} included (${((n / r.replies) * 100).toFixed(0)}% of the allowance)`);
}

// ---------------------------------------------------------------- proposed caps
const CAP_HISTORY_CHARS = 6000;   // trim the conversation sent to the model
const CAP_DATA_CHARS = 40_000;    // business data actually sent with each reply
console.log(`\nWITH CAPS — history ${CAP_HISTORY_CHARS.toLocaleString('en-US')} chars, business data ${CAP_DATA_CHARS.toLocaleString('en-US')} chars sent per reply:`);
console.log(pad('Plan', 12) + padL('Revenue', 10) + padL('Abused/mo', 12) + padL('No cache/mo', 13) + padL('Worst margin', 14) + padL('Worst cost %', 14));
console.log('-'.repeat(75));
for (const plan of [TRIAL, ...Object.values(PLANS)]) {
  const build = (cachedShare) => costPerReply({
    dataChars: Math.min(plan.dataChars, CAP_DATA_CHARS),
    historyChars: CAP_HISTORY_CHARS,
    outputTokens: MAX_OUTPUT,
    cachedShare,
  });
  const month = build(0.5) * plan.replies;
  const monthNoCache = build(0) * plan.replies;
  const margin = plan.priceUSD - monthNoCache;
  console.log(
    pad(plan.name, 12) +
    padL(plan.priceUSD ? usd(plan.priceUSD) : 'free', 10) +
    padL(usd(month), 12) +
    padL(usd(monthNoCache), 13) +
    padL(`${margin >= 0 ? '' : '-'}${usd(Math.abs(margin))}`, 14) +
    padL(plan.priceUSD ? `${((monthNoCache / plan.priceUSD) * 100).toFixed(0)}%` : '—', 14)
  );
}

// The backstop: stop AI once a month's cost passes this, whatever the reason.
console.log('\nMonthly cost ceiling per account (the hard backstop):');
for (const plan of [TRIAL, ...Object.values(PLANS)]) {
  const normal = costPerReply(SCENARIOS.normal(plan)) * plan.replies;
  const ceiling = plan.priceUSD ? Math.max(plan.priceUSD * 0.35, normal * 3) : 0.5;
  console.log(`  ${pad(plan.name, 12)} ceiling ${padL(usd(ceiling), 8)}  (normal use is ${usd(normal)}, so a real customer has ${(ceiling / Math.max(normal, 0.0001)).toFixed(1)}x headroom)  → worst margin ${plan.priceUSD ? usd(plan.priceUSD - ceiling) : usd(-ceiling)}`);
}

console.log('\nOne extra bot add-on:');
const extra = ADDONS.extraBot;
console.log(`  sells for ${usd(extra.priceUSD)}/month and adds no replies — safe.`);
const pack = ADDONS.replyPack;
const packWorst = costPerReply(SCENARIOS.abuseNoCache(PLANS.business)) * pack.replies;
console.log(`  reply pack: ${pack.replies.toLocaleString('en-US')} replies for ${usd(pack.priceUSD)} — worst case costs ${usd(packWorst)} on Business.\n`);
