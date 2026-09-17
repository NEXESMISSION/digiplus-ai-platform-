// Talks to OpenAI: builds the instructions for one assistant and reads its answer.
const fs = require('fs');
const path = require('path');
const catalog = require('./catalog');

// gpt-5.4 with reasoning "none" answered in 1.5–3s in tests, with the most natural Derja and reliable
// tool calls (gpt-5-mini and gpt-5.4-mini wrote broken Derja or missed saves). Newer gpt-5.x models
// only accept tools with reasoning "none"; older gpt-5 models are fastest on "minimal".
const MODEL = process.env.CHAT_MODEL || 'gpt-5.4';
const REASONING = process.env.CHAT_REASONING || (/^gpt-5\.\d/.test(MODEL) ? 'none' : /^(gpt-5|o\d)/.test(MODEL) ? 'minimal' : null);
const BRAIN_DIR = path.join(__dirname, '..', 'brain');

const brains = new Map();
function readBrain(file) {
  if (!brains.has(file)) brains.set(file, fs.readFileSync(path.join(BRAIN_DIR, file), 'utf8'));
  return brains.get(file);
}

const FORMAT = `
# Answer format
Reply with ONLY a JSON object:
{"messages": ["first message", "second message"], "choices": [], "show_slots": false}
- messages: 1 to 3 short messages, sent one after the other. A message may contain line breaks.
  No markdown, no asterisks, no bullet symbols.
- A message may be the id of an approved line on its own, like "@ask-name-phone". The chat then sends
  that line exactly as the owner wrote it, in the client's language. Whenever an approved line says what
  you want to say, send its id instead of writing your own words.
- choices: up to 3 tappable answers of 1 to 3 words, only when your question has obvious answers
  (e.g. the kinds of séance). Written in the client's language. Otherwise [].
- show_slots: true only when you ask the client to choose a day and time without naming the times
  yourself; the page then shows the free times as buttons under your message. When your message already
  offers specific times, or the client already chose one, false.
- Tunisian Arabizi is written in Latin letters only. Never write Arabic letters.`;

// Which language the client writes, from their recent messages: 'fr', 'derja', or null when unclear.
// The model tends to drift back to the Derja examples, so it is told the language outright.
// Words both languages use (samedi, prix, rendez-vous, possible…) are left out on purpose.
const FRENCH_WORDS = new Set(
  // not "ma" or "la": Derja uses them too (ma tbarredch, la).
  'je j vous est c bonjour bonsoir merci pour avec le les des une un du de et ou si combien quel quelle quels quand comment oui non votre vos mon mes faites faire voudrais voulez veux peux pouvez que qui dans sur pas ne svp aujourd hui demain il elle nous suis avez fait coûte cher'.split(' ')
);
const DERJA_WORDS = new Set(
  'n7eb t7eb nheb theb chnowa chnouwa chnoua chnia 9adech qadech behi ey famma fama ken w mte3 mta3 mte3i mte3ek mte3ha mta3i 3andi 3andek aslema slm ahla ya5dem yji barcha tawa bech wala walla lel fel fi el 3la 3al ma3lich sahit m3a ena enti inti houa hiya kifech 3lech wa9tech nhar ghodwa sba7 ama zeda chkoun kifach 9bal ba3d mouch moch chay barra ok'.split(' ')
);

function clientLanguage(items) {
  const lastBot = items.map((it) => it.role).lastIndexOf('bot');
  const recent = items
    .map((it, index) => ({ it, index }))
    .filter(({ it }) => it.role === 'client' && it.text)
    .slice(-6);
  let fr = 0;
  let derja = 0;
  recent.forEach(({ it, index }) => {
    const weight = index > lastBot ? 2 : 1; // what they just wrote counts double
    if (/[؀-ۿ]/.test(it.text)) derja += 3 * weight;
    for (const word of it.text.toLowerCase().match(/[\p{L}\d]+/gu) || []) {
      if (/\d/.test(word) && /\p{L}/u.test(word)) {
        if (!/^\d+[a-z]{0,3}\d*$/.test(word)) derja += weight; // Arabizi (n7eb, 9adech, 3andi), not 11h30 or 45dt
      }
      else if (FRENCH_WORDS.has(word)) fr += weight;
      else if (DERJA_WORDS.has(word)) derja += weight;
    }
  });
  // Most clients write Derja: French needs a clear lead, Derja only a small one.
  if (fr - derja >= 2) return 'fr';
  if (derja > fr) return 'derja';
  return null;
}

// Is this message French, or Tunisian Arabizi? Used to catch an answer written in the wrong one.
// Arabizi is recognised by its numbers inside words (n7eb, 9adech, 3andi), never by a price like 45dt.
const arabiziWords = (text) =>
  (String(text || '').toLowerCase().match(/[\p{L}\d]+/gu) || []).filter(
    (word) => /\d/.test(word) && /\p{L}/u.test(word) && !/^\d+[a-z]{0,3}\d*$/.test(word)
  ).length;

function looksFrench(text) {
  const words = String(text || '').toLowerCase().match(/[\p{L}]+/gu) || [];
  const french = words.filter((word) => FRENCH_WORDS.has(word)).length;
  return french >= 3 && arabiziWords(text) === 0;
}

const looksDerja = (text) => arabiziWords(text) >= 2;

const LANGUAGE = {
  fr: 'French. Every message and every choice in French. Use the "French:" approved lines, never the "Derja:" ones.',
  derja: 'Tunisian Arabizi in Latin letters. Every message and every choice in Derja. Use the "Derja:" approved lines, never the "French:" ones.',
};

function instructions(bot, { now, slots, language }) {
  const parts = [readBrain(bot.brain)];
  if (bot.catalog) parts.push(catalog.promptText(bot.catalog));
  parts.push(readBrain('voice.md'));
  parts.push(`# Context\n- Now: ${now} (Tunisia time).\n- The chat page already greeted the client with: «${bot.welcome.join(' / ')}». Don't greet again.`);
  if (slots) {
    const byDay = new Map();
    for (const s of slots) byDay.set(`${s.day} (${s.date})`, [...(byDay.get(`${s.day} (${s.date})`) || []), s.time]);
    const lines = [...byDay].map(([day, times]) => `- ${day}: ${times.join(', ')}`);
    parts.push(`# Free times (only these can be booked)\n${lines.join('\n') || '- None in the next two weeks.'}`);
  }
  parts.push(FORMAT);
  parts.push(`# Language of this answer\n${LANGUAGE[language] || "The client's language (see How every assistant talks)."}`);
  return parts.join('\n\n');
}

// What the AI reads for a card shown earlier in the chat.
function cardText(card) {
  if (card.type === 'slots') return `[Free times shown to the client as buttons: ${card.slots.map((s) => `${s.day} ${s.time}`).join(', ')}]`;
  if (card.type === 'products') return `[Products shown to the client as cards with photo and price: ${card.items.map((p) => `${p.name} (from ${p.from}dt)`).join(', ')}]`;
  return `[Card shown to the client: ${card.title} — ${(card.rows || []).map(([label, value]) => `${label}: ${value}`).join(', ')}]`;
}

// The chat must start with the client and alternate: merge consecutive items from the same side.
function toTurns(items) {
  const turns = [];
  for (const it of items) {
    const role = it.role === 'client' ? 'user' : 'assistant';
    const content = (it.card ? cardText(it.card) : String(it.text || '')).trim();
    if (!content) continue;
    if (!turns.length && role === 'assistant') continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${content}`;
    else turns.push({ role, content });
  }
  return turns;
}

// The model sometimes slips Arabic letters into an Arabizi sentence ("kif nجم").
// Rewrite them the way Tunisians write Arabizi: 3 = ع, 7 = ح, 9 = ق, 5 = خ, 2 = ء.
const LETTERS = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ى': 'a', 'ة': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j',
  'ح': '7', 'خ': '5', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'ch', 'ص': 's', 'ض': 'dh',
  'ط': 't', 'ظ': 'dh', 'ع': '3', 'غ': 'gh', 'ف': 'f', 'ق': '9', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w', 'ي': 'y', 'ء': '2', 'ئ': '2', 'ؤ': '2', '،': ',', '؟': '?',
};
const toLatin = (text) => text.replace(/[ً-ٰ۟ـ]/g, '').replace(/[؀-ۿ]/g, (c) => LETTERS[c] ?? '');

function parseObject(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {}
    }
  }
  return null;
}

// The final answer: messages to send, tappable choices, and whether to show free times.
function readAnswer(raw) {
  const data = parseObject(raw || '');
  const text = String(raw || '').trim();
  const list = Array.isArray(data?.messages) ? data.messages : text && !text.startsWith('{') ? [text] : [];
  const messages = list
    .filter((m) => typeof m === 'string' && m.trim())
    .slice(0, 3)
    .map((m) => toLatin(m.replace(/\*\*/g, '').trim()));
  const choices = (Array.isArray(data?.choices) ? data.choices : [])
    .filter((c) => typeof c === 'string' && c.trim() && c.length <= 40)
    .slice(0, 3)
    .map((c) => toLatin(c.trim()));
  return { messages, choices, showSlots: data?.show_slots === true };
}

async function complete(messages, { tools = [], toolChoice } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const body = {
    model: MODEL,
    messages,
    response_format: { type: 'json_object' },
    max_completion_tokens: 2500,
  };
  if (tools.length) {
    body.tools = tools;
    if (toolChoice) body.tool_choice = toolChoice;
  }
  if (REASONING) body.reasoning_effort = REASONING;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(40_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message || res.statusText}`);
  return data.choices?.[0]?.message || {};
}

module.exports = { instructions, clientLanguage, looksFrench, looksDerja, toTurns, readAnswer, complete, toLatin };
