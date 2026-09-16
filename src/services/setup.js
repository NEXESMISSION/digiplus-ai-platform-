// AI Setup: turns what the owner can easily give us (a few sentences, a pasted
// menu or price list, a website link) into a complete bot brain they can review.
// The owner never sees a blank form again — they correct a draft instead.
const dns = require('dns').promises;
const net = require('net');
const ai = require('../ai');
const assistant = require('./assistant');
const { DEFAULTS, DEFAULT_GOALS, sanitizeSettings, dataSize } = require('../settings');
const { HttpError } = require('../lib/http');
const { detectAlphabet, repairAlphabet, ALPHABET_RULE } = require('../lib/alphabet');

const PROFILE_MAX_TOKENS = 3000;
const OFFER_MAX_TOKENS = 2500;
const PAGE_TIMEOUT_MS = 12_000;
const PAGE_MAX_BYTES = 1_500_000;
const PAGE_MAX_CHARS = 12_000;
const SOURCE_MAX_CHARS = 24_000;

// ---------------------------------------------------------------- website reading

// The owner picks the URL, but the server does the fetching, so a link like
// http://localhost or http://169.254.169.254 would otherwise reach our own network.
async function assertPublicUrl(url) {
  if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'The link must start with http:// or https://');
  const host = url.hostname.replace(/^\[|\]$/g, '');

  let addresses;
  if (net.isIP(host)) addresses = [{ address: host }];
  else {
    try {
      addresses = await dns.lookup(host, { all: true });
    } catch {
      throw new HttpError(400, `We could not find the website "${url.hostname}". Check the link.`);
    }
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new HttpError(400, 'That link points to a private address, so we cannot read it.');
  }
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateAddress(mapped[1]) : false;
}

// Strips a page down to the words a human would read.
function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|iframe|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

async function readWebsite(rawUrl) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw new HttpError(400, 'That does not look like a web address.');
  }
  await assertPublicUrl(url);

  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: { 'User-Agent': 'DigiPlusAI-Setup/1.0', Accept: 'text/html,text/plain;q=0.9' },
    });
  } catch {
    throw new HttpError(400, `We could not open ${url.hostname}. Check the link, or paste the text instead.`);
  }
  if (!res.ok) throw new HttpError(400, `${url.hostname} answered with an error (${res.status}). Paste the text instead.`);

  const type = res.headers.get('content-type') || '';
  if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) {
    throw new HttpError(400, 'That link is not a normal web page. Paste the text instead.');
  }

  // A redirect can land anywhere, so the final URL is checked too.
  if (res.url && res.url !== url.href) await assertPublicUrl(new URL(res.url));

  const body = (await res.text()).slice(0, PAGE_MAX_BYTES);
  const text = htmlToText(body).slice(0, PAGE_MAX_CHARS);
  if (text.replace(/\s/g, '').length < 120) {
    throw new HttpError(400, `We opened ${url.hostname} but found almost no text — the site probably needs JavaScript. Paste the text instead.`);
  }
  return { host: url.hostname, text };
}

// ---------------------------------------------------------------- the prompts

const SYSTEM = `You set up AI chat assistants for small businesses, mostly in Tunisia and North Africa.

The owner gives you rough material about their business. You turn it into part of a ready-to-use configuration for their assistant.

Rules you must follow:
- Use ONLY facts the owner gave you. Never invent a price, a phone number, an address, an opening hour, a guarantee or a delivery time. If something is missing, leave that field empty instead of guessing.
- Write the way a real person in that business would speak to a customer — warm, short, concrete. Not corporate, not robotic.
- Prices: copy them exactly as the owner wrote them, with the same currency.
- Be compact. Every character you write is sent to the AI on every single reply, and the owner pays for it.

Return ONLY a JSON object. No markdown, no explanation.`;

function sourceBlock({ businessName, text, page }) {
  const parts = [`The business is called: ${businessName || '(not given)'}`];
  if (text) parts.push(`\nWhat the owner told us:\n"""\n${text}\n"""`);
  if (page) {
    parts.push(
      `\nText from their website (${page.host}) — it may contain menus, prices and navigation junk, use only what is clearly about the business:\n"""\n${page.text}\n"""`
    );
  }
  return parts.join('\n');
}

function profilePrompt(source, alphabet, budget) {
  return `${source}

${ALPHABET_RULE[alphabet]}

Return JSON with exactly these keys:

{
  "botName": "a short first name for the assistant that fits the business and its language, e.g. Sara, Amine, Leila",
  "businessDescription": "3-6 sentences: what the business does, who its clients are, what makes it different, where it is, opening hours. Only what you were told.",
  "welcomeMessage": "the first line the client sees in the chat. One or two short sentences, friendly, invites them to ask.",
  "tone": "2-4 lines describing how this assistant should talk, written for this specific business.",
  "knowledge": [{ "title": "short topic name", "content": "the facts about that topic" }],
  "faqs": [{ "q": "a question clients really ask this business", "a": "the answer, from the owner's material" }],
  "missing": ["short plain-language things the owner still needs to add, e.g. 'your phone number', 'delivery prices'. Max 5."]
}

Guidance:
- knowledge: 3-8 blocks, one topic each (services, how it works, delivery, hours, location, guarantees...). Skip topics you have no facts for.
- faqs: 3-8 questions, only ones you can answer from the material.
- Keep this JSON under about ${budget} characters.`;
}

function offerPrompt(source, alphabet, budget) {
  return `${source}

${ALPHABET_RULE[alphabet]}

Return JSON with exactly these keys:

{
  "packages": [{ "name": "service or product", "price": "exactly as given, with currency", "includes": "what the client gets" }],
  "pricingNotes": "payment terms, deposits, what costs extra, delivery fees. Empty string if not given.",
  "rules": "lines starting with '- ': things the assistant must always or never say for this business. Empty string if nothing applies.",
  "handoff": "how a client reaches a human (phone, WhatsApp, address). Empty string if not given.",
  "goals": [{ "key": "lowercase_with_underscores", "label": "short goal name", "enabled": true, "instructions": "how the assistant pursues it here" }]
}

Guidance:
- packages: one per service or product with a price. If the owner gave a menu, each dish or group is a package. If no prices were given at all, return [].
- goals: 3-5. Start from these standard ones and adapt their instructions to this business: understand the client's need, explain prices, close the deal, collect contact details. Add one specific to this business if it obviously needs it.
- "key" stays in lowercase Latin letters and underscores — it is an internal id, never shown to anyone.
- Keep this JSON under about ${budget} characters.`;
}

// ---------------------------------------------------------------- generation

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v) => (Array.isArray(v) ? v : []);

function parseJson(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new HttpError(502, `The AI answer (${what}) could not be read. Please try again.`);
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new HttpError(502, `The AI answer (${what}) could not be read. Please try again.`);
    }
  }
}

// The draft replaces only the fields the model actually filled, so re-running the
// setup never wipes something the owner already wrote by hand.
function mergeDraft(current, raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const next = { ...current };

  for (const key of ['botName', 'businessDescription', 'welcomeMessage', 'tone', 'pricingNotes', 'rules', 'handoff']) {
    if (str(d[key])) next[key] = str(d[key]);
  }

  const knowledge = arr(d.knowledge)
    .map((k) => ({ title: str(k?.title), content: str(k?.content) }))
    .filter((k) => k.title || k.content);
  if (knowledge.length) next.knowledge = knowledge;

  const faqs = arr(d.faqs).map((f) => ({ q: str(f?.q), a: str(f?.a) })).filter((f) => f.q || f.a);
  if (faqs.length) next.faqs = faqs;

  const packages = arr(d.packages)
    .map((p) => ({ name: str(p?.name), price: str(p?.price), includes: str(p?.includes) }))
    .filter((p) => p.name || p.price || p.includes);
  if (packages.length) next.packages = packages;

  const goals = arr(d.goals)
    .map((g) => ({
      key: /^[a-z0-9_]{1,60}$/.test(g?.key) ? g.key : '',
      label: str(g?.label),
      enabled: g?.enabled !== false,
      instructions: str(g?.instructions),
    }))
    .filter((g) => g.label);
  if (goals.length) next.goals = goals;
  else if (!next.goals?.length) next.goals = DEFAULT_GOALS;

  return next;
}

const missingList = (raw) =>
  arr(raw?.missing)
    .map((x) => str(x))
    .filter(Boolean)
    .slice(0, 5);

// Builds a draft brain. Nothing is saved — the owner reviews it first.
// Split into two model calls that run at the same time: one big call took ~40s,
// which is uncomfortably close to the 60s function limit on Vercel.
async function draftSettings({ account, current, businessName, text, url, dataLimit }) {
  if (!ai.isConfigured()) throw new HttpError(503, 'AI setup is not available right now.');

  const page = url ? await readWebsite(url) : null;
  const source = str(text).slice(0, SOURCE_MAX_CHARS);
  if (!source && !page) throw new HttpError(400, 'Tell us about your business, or give us your website link.');

  const alphabet = detectAlphabet(`${businessName || ''}\n${source}`);
  const budget = Math.max(2000, Math.round(dataLimit * 0.7));
  const block = sourceBlock({ businessName, text: source, page });

  const outcome = await assistant.runBatchWithAllowance({
    account,
    calls: [
      {
        system: SYSTEM,
        messages: [{ role: 'user', content: profilePrompt(block, alphabet, Math.round(budget * 0.6)) }],
        json: true,
        maxOutputTokens: PROFILE_MAX_TOKENS,
        effort: 'low',
      },
      {
        system: SYSTEM,
        messages: [{ role: 'user', content: offerPrompt(block, alphabet, Math.round(budget * 0.4)) }],
        json: true,
        maxOutputTokens: OFFER_MAX_TOKENS,
        effort: 'low',
      },
    ],
  });
  if (!outcome.ok) return { ok: false, reason: outcome.reason };

  const profile = parseJson(outcome.results[0].text, 'business profile');
  const offer = parseJson(outcome.results[1].text, 'prices and goals');

  const draft = mergeDraft({ ...DEFAULTS, ...current, businessName: businessName || current.businessName }, { ...profile, ...offer });
  const repaired = repairAlphabet(draft, alphabet);
  if (repaired.fixed) console.warn(`[setup] repaired ${repaired.fixed} field(s) that came back in the wrong alphabet`);
  const settings = sanitizeSettings(repaired.value);

  return {
    ok: true,
    settings,
    missing: missingList(profile),
    dataSize: dataSize(settings),
    readFrom: page ? page.host : null,
  };
}

// ---------------------------------------------------------------- revise

const REVISE_MAX_TOKENS = 3500;

const REVISE_SYSTEM = `You maintain the configuration of a small business's AI chat assistant.

The owner tells you, in their own words, what changed about their business. You apply exactly that change to the configuration and nothing else.

Rules you must follow:
- Change ONLY what the owner asked for. Every other field must stay exactly as it is.
- Never invent a price, a phone number, an address or an opening hour the owner did not give you.
- Keep the wording and the language of the existing configuration.
- If you change a list, return the COMPLETE new list, including the items that did not change.
- If the owner's message asks for nothing you can apply, return {"changed": []} and no other key.

Return ONLY a JSON object. No markdown, no explanation.`;

// A compact view of the brain: enough for the model to edit, without the fields
// it must never touch.
const revisableView = (s) => ({
  botName: s.botName,
  businessDescription: s.businessDescription,
  welcomeMessage: s.welcomeMessage,
  tone: s.tone,
  knowledge: s.knowledge,
  faqs: s.faqs,
  packages: s.packages,
  pricingNotes: s.pricingNotes,
  rules: s.rules,
  handoff: s.handoff,
  goals: s.goals,
});

async function reviseSettings({ account, current, instruction }) {
  if (!ai.isConfigured()) throw new HttpError(503, 'AI is not available right now.');
  const ask = str(instruction).slice(0, 4000);
  if (!ask) throw new HttpError(400, 'Write what you want to change.');

  const alphabet = detectAlphabet(`${ask}\n${current.businessDescription}\n${current.welcomeMessage}`);
  const user = `Current configuration:
"""
${JSON.stringify(revisableView(current), null, 1)}
"""

The owner says:
"""
${ask}
"""

${ALPHABET_RULE[alphabet]}

Return JSON containing ONLY the keys you changed, with the same shapes as above, plus:
  "changed": ["one short line per change you made, in the owner's language. Empty list if you changed nothing."]`;

  const outcome = await assistant.runWithAllowance({
    account,
    system: REVISE_SYSTEM,
    messages: [{ role: 'user', content: user }],
    json: true,
    maxOutputTokens: REVISE_MAX_TOKENS,
    effort: 'minimal', // a mechanical edit, not a design task — this halves the wait
  });
  if (!outcome.ok) return { ok: false, reason: outcome.reason };

  const raw = parseJson(outcome.result.text, 'the change');
  const changed = arr(raw.changed).map((x) => str(x)).filter(Boolean).slice(0, 8);

  const merged = mergeDraft({ ...current }, raw);
  const repaired = repairAlphabet(merged, alphabet);
  const settings = sanitizeSettings({ ...repaired.value, businessName: current.businessName });

  return { ok: true, settings, changed, dataSize: dataSize(settings) };
}

module.exports = { draftSettings, reviseSettings, readWebsite, htmlToText };
