// AI Setup: turns what the owner can easily give us (a few sentences, a pasted
// menu or price list, a website link) into a complete bot brain they can review.
// The owner never sees a blank form again — they correct a draft instead.
const dns = require('dns').promises;
const net = require('net');
const ai = require('../ai');
const assistant = require('./assistant');
const { DEFAULTS, DEFAULT_GOALS, sanitizeSettings, dataSize } = require('../settings');
const { HttpError } = require('../lib/http');

const SETUP_MAX_TOKENS = 6000;
const PAGE_TIMEOUT_MS = 12_000;
const PAGE_MAX_BYTES = 1_500_000;
const PAGE_MAX_CHARS = 18_000;
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
    .replace(/[ \t ]+/g, ' ')
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

// ---------------------------------------------------------------- the prompt

const SYSTEM = `You set up AI chat assistants for small businesses, mostly in Tunisia and North Africa.

The owner gives you rough material about their business. You turn it into a complete, ready-to-use configuration for their assistant.

Rules you must follow:
- Use ONLY facts the owner gave you. Never invent a price, a phone number, an address, an opening hour, a guarantee or a delivery time. If something is missing, leave that field empty instead of guessing.
- Write every text in the SAME language and alphabet the owner used. If the owner wrote in Tunisian Arabizi (Latin letters, like "3andi", "9adeh"), write in that same Arabizi. If they wrote in Arabic letters, use Arabic letters. If French, French.
- Write the way a real person in that business would speak to a customer — warm, short, concrete. Not corporate, not robotic.
- Prices: copy them exactly as the owner wrote them, with the same currency.
- Be compact. Every character you write is sent to the AI on every single reply, and the owner pays for it.

Return ONLY a JSON object. No markdown, no explanation.`;

function buildUserMessage({ businessName, text, page, budget }) {
  const parts = [`The business is called: ${businessName || '(not given)'}`];
  if (text) parts.push(`\nWhat the owner told us:\n"""\n${text}\n"""`);
  if (page) parts.push(`\nText from their website (${page.host}) — it may contain menus, prices and navigation junk, use only what is clearly about the business:\n"""\n${page.text}\n"""`);

  parts.push(`
Return JSON with exactly these keys:

{
  "botName": "a short first name for the assistant that fits the business and its language, e.g. Sara, Amine, Leila",
  "businessDescription": "3-6 sentences: what the business does, who its clients are, what makes it different, where it is, opening hours. Only what you were told.",
  "welcomeMessage": "the first line the client sees in the chat. One or two short sentences, friendly, invites them to ask.",
  "tone": "2-4 lines describing how this assistant should talk, written for this specific business.",
  "knowledge": [{ "title": "short topic name", "content": "the facts about that topic" }],
  "faqs": [{ "q": "a question clients really ask this business", "a": "the answer, from the owner's material" }],
  "packages": [{ "name": "service or product", "price": "exactly as given, with currency", "includes": "what the client gets" }],
  "pricingNotes": "payment terms, deposits, what costs extra, delivery fees. Empty string if not given.",
  "rules": "lines starting with '- ': things the assistant must always or never say for this business. Empty string if nothing applies.",
  "handoff": "how a client reaches a human (phone, WhatsApp, address). Empty string if not given.",
  "goals": [{ "key": "lowercase_with_underscores", "label": "short goal name", "enabled": true, "instructions": "how the assistant pursues it here" }],
  "missing": ["short plain-language things the owner still needs to add, e.g. 'your phone number', 'delivery prices'. Max 5."]
}

Guidance:
- knowledge: 3-8 blocks, one topic each (services, how it works, delivery, hours, location, guarantees...). Skip topics you have no facts for.
- faqs: 3-8 questions, only ones you can answer from the material.
- packages: one per service or product with a price. If the owner gave a menu, each dish or group is a package. If no prices were given at all, return [].
- goals: 3-5. Start from these standard ones and adapt their instructions to this business: understand the client's need, explain prices, close the deal, collect contact details. Add one specific to this business if it obviously needs it.
- Keep the total under about ${budget} characters.`);

  return parts.join('\n');
}

// ---------------------------------------------------------------- generation

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const arr = (v) => (Array.isArray(v) ? v : []);

// The model's draft replaces only the fields it actually filled, so a re-run
// never wipes something the owner already wrote by hand.
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
  next.goals = goals.length ? goals : DEFAULT_GOALS;

  return next;
}

const missingList = (raw) =>
  arr(raw?.missing)
    .map((x) => str(x))
    .filter(Boolean)
    .slice(0, 5);

// Builds a draft brain. Nothing is saved — the owner reviews it first.
async function draftSettings({ account, current, businessName, text, url, dataLimit }) {
  if (!ai.isConfigured()) throw new HttpError(503, 'AI setup is not available right now.');

  const page = url ? await readWebsite(url) : null;
  const source = str(text).slice(0, SOURCE_MAX_CHARS);
  if (!source && !page) throw new HttpError(400, 'Tell us about your business, or give us your website link.');

  const budget = Math.max(2000, Math.round(dataLimit * 0.7));
  const user = buildUserMessage({ businessName, text: source, page, budget });

  const outcome = await assistant.runWithAllowance({
    account,
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
    json: true,
    maxOutputTokens: SETUP_MAX_TOKENS,
    effort: 'medium',
  });
  if (!outcome.ok) return { ok: false, reason: outcome.reason };

  let raw;
  try {
    raw = JSON.parse(outcome.result.text);
  } catch {
    const t = outcome.result.text;
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end <= start) throw new HttpError(502, 'The AI answer could not be read. Please try again.');
    raw = JSON.parse(t.slice(start, end + 1));
  }

  const settings = sanitizeSettings(mergeDraft({ ...DEFAULTS, ...current, businessName: businessName || current.businessName }, raw));
  return {
    ok: true,
    settings,
    missing: missingList(raw),
    dataSize: dataSize(settings),
    readFrom: page ? page.host : null,
  };
}

module.exports = { draftSettings, readWebsite, htmlToText };
