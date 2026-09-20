// Talks to OpenAI: builds the instructions for one assistant and reads its answer.
require('./no-image-api');
const fs = require('fs');
const path = require('path');
const catalog = require('./catalog');
const lines = require('./lines');

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

// ─── what the model is shown of a brain file ─────────────────────────────────
//
// The «@id» blocks in brain/*.md do two jobs at once. They are the owner's exact words for the
// moments that come back in every chat — lib/lines.js reads them and lib/reply.js sends them itself
// at the moments the code knows about — and, until now, they were also a menu the model answered
// from: one message reading «@what-there-is» and the chat looked the id up.
//
// The menu is what made the assistant dumb, and it was measured, not guessed. Replaying the owner's
// own chat, the model answered «@hello» to «slm», «@what-there-is» to «ch3andkom?», and then
// «@what-there-is» again to «advise me» and to «I didn't like it» — two questions no id covers, so
// it picked the nearest one and the client got the catalogue twice. The same model, the same facts,
// no ids, understood every one of them and asked «3lech mab3jbakch?». A bigger model with the menu
// did not fix it: it is the prompt.
//
// What must NOT go with the menu is the lines themselves: shown as examples instead, they kept the
// Derja tight (34 characters a message against 75, and no foreign word on the wire). So the file
// keeps its ids for the code, and everything the model reads goes through here first: the id is
// taken off each block, a mention of one inside a sentence becomes the words it names, and the
// whole set arrives under a heading that says to write like them, not to send them.
const EXAMPLES = `## How this business talks — examples, not a menu
The owner wrote these and a Tunisian checked them. They are the length, the words and the rhythm of
every answer you write. When one of them says exactly what this client needs to hear, write it word
for word. When the client asked something else, answer what they asked, in your own words — never
send the nearest example instead of an answer.`;

const DECLARED = /^@([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s*·\s*(.*?))?\s*$/;
// Two passes, and the guillemets come off first: a brain file writes both «@price» and a bare
// @price, and one pattern that ate the quotes ate the spaces around them with it («Say it with@…»).
const QUOTED = /«\s*(@[a-z0-9]+(?:-[a-z0-9]+)*)\s*»/g;
// Not an address: «nour@patisserie.tn» in a brain file is a thing to say, and a rule that ate the
// «@patisserie» out of it would leave the client a phone number with a hole in it.
const MENTION = /(?<![\w.])@([a-z0-9]+(?:-[a-z0-9]+)*)/g;
const HEADING = /^(#{1,6})\s+Approved lines\b/i;

function forModel(markdown, known) {
  const quote = (id) => {
    const line = known.get(id);
    if (!line?.derja.length) return '';
    // The Derja text, because the Derja is what a mention inside a sentence is teaching. Both
    // languages are in the examples block below, and the language of the answer is ordered last.
    // A line of two messages is joined the way instructions() joins the welcome messages, « / »:
    // run together on one line they read as one long sentence, which is the opposite of the lesson.
    return `«${line.derja.join('\n').replace(/\s*\n\s*/g, ' / ')}»`;
  };
  const out = [];
  let inComment = false;
  for (const raw of String(markdown).split(/\r?\n/)) {
    // A note to whoever edits the file, never to the model.
    if (inComment || /^\s*<!--/.test(raw)) {
      inComment = !/-->\s*$/.test(raw);
      continue;
    }
    const heading = raw.match(HEADING);
    if (heading) {
      out.push(EXAMPLES.replace(/^##/, heading[1]));
      continue;
    }
    const declared = raw.match(DECLARED);
    if (declared) {
      // «@what-there-is · they ask what the shop has» → the situation, without the id to answer with.
      if (declared[2]) out.push(`- ${declared[2]}`);
      continue;
    }
    // A sentence that explains the mechanism itself («Send the id alone as one message»): there is
    // no mechanism any more, and a line about it would teach the model that ids exist.
    if (/\bthe ids?\b/i.test(raw)) continue;
    const written = raw.replace(QUOTED, '$1').replace(MENTION, (whole, id) => quote(id));
    // «→ @unknown» with nothing left to point at says less than nothing.
    if (raw.trim() && !written.trim()) continue;
    out.push(written);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const modelBrains = new Map();
function brainForModel(bot, file) {
  const key = `${bot.slug}:${file}`;
  if (!modelBrains.has(key)) modelBrains.set(key, forModel(readBrain(file), lines.forBot(bot)));
  return modelBrains.get(key);
}

// Asserted at load, over every brain file there is, because the thing this must guarantee is a
// negative and nothing downstream can see it: one «@order-sent» left in the prompt and the model
// learns the menu again, in a chat, silently. It is the brain files that move — a new bot, a new
// approved line, a sentence that mentions an id in a shape the rules here don't match — so the
// check reads the directory rather than a list written down once. The second half is the other
// failure: a forModel that satisfies the first by eating the lines themselves. They are what keeps
// the Derja short, so at least one of them has to survive in every file that had one.
for (const file of fs.readdirSync(BRAIN_DIR).filter((name) => name.endsWith('.md'))) {
  const known = new Map([...lines.parse(readBrain('voice.md')), ...lines.parse(readBrain(file))]);
  const shown = forModel(readBrain(file), known);
  // Wider than the pattern forModel replaces, on purpose. MENTION is the id grammar of
  // lib/lines.js (its ID regex: lower case, digits, hyphens), and an assertion that scanned for
  // exactly that could only confirm the rule ran on what the rule matches. Anything reading as
  // «@word» is refused here — «@Hello» in a new brain file, an id an approved line carries inside
  // its own text — and only an address is let through, since eating the «@patisserie» out of one
  // would be its own bug.
  const left = [...new Set(shown.match(/(?<![\w.])@[A-Za-z]\S*/g) || [])];
  if (left.length) {
    throw new Error(
      `lib/ai.js: forModel leaves ${left.join(' ')} in brain/${file} — the model would read an id it can answer with, ` +
        'and one id is the whole menu back'
    );
  }
  if (/^Derja:/m.test(readBrain(file)) && !/^Derja:/m.test(shown)) {
    throw new Error(`lib/ai.js: forModel dropped every approved line of brain/${file} — the examples are what keeps the Derja short`);
  }
}

const FORMAT = `
# Answer format
Reply with ONLY a JSON object:
{"messages": ["first message", "second message"], "choices": [], "show_slots": false}
- messages: 1 to 3 short messages, sent one after the other. A message may contain line breaks.
  No markdown, no asterisks, no bullet symbols.
- Write every message yourself, in the words of the examples. The client reads exactly what you put
  here, so it is never a code, a label or a word starting with "@": that would arrive broken.
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

// Which language to answer in. clientLanguage answers a different question — what the client writes —
// and says null whenever their words match neither list ("Photo mariage?"). That null leaves the model
// with no language order at all and switches off the checks on the answer, while the Tunisian fixes
// still run on it: the weakest state in the chat. An answer always has a language, so: the last turns
// decide it, then the whole conversation, and Derja when neither said — the page greets in Derja and
// most clients write Derja.
function answerLanguage(history) {
  return clientLanguage(history.slice(-6)) || clientLanguage(history) || 'derja';
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
  fr: 'French. Every message and every choice in French. Follow the "French:" examples, never the "Derja:" ones.',
  derja: 'Tunisian Arabizi in Latin letters. Every message and every choice in Derja. Follow the "Derja:" examples, never the "French:" ones.',
};

function instructions(bot, { now, slots, language }) {
  const brain = brainForModel(bot, bot.brain);
  const parts = [brain];
  if (bot.catalog) parts.push(catalog.promptText(bot.catalog));
  // Both files carry a block of examples, and the paragraph above them says the same thing twice.
  // The shop's own comes first, so the voice file keeps the heading and drops the repeat.
  const voice = brainForModel(bot, 'voice.md');
  parts.push(brain.includes(EXAMPLES) ? voice.replace(EXAMPLES, EXAMPLES.split('\n')[0]) : voice);
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
// Nothing here runs on the way out of readAnswer any more: lib/validate.js has to see the letters
// the model really wrote, or it cannot ask for them back in Latin. reply.js calls this once, in the
// salvage block, on an answer that came back in Arabic script a second time.
// The digits are in the table because anything the table has no entry for is deleted, and an answer
// losing the 45 out of «السوم ٤٥dt» hides a price from guard.js instead of showing it a wrong one.
//
// Every codepoint lib/validate.js calls Arabic script, written once and imported there: toLatin has
// to empty exactly the set the validator counts, and while the two lists were written out separately
// they drifted. The validator counted 1232 codepoints, this file reached the first 256, and the 976
// in between passed both — the validator called «ﻻ ﺍ ﻢ» Arabic and toLatin returned it unchanged, so
// reply.js logged «transliterated: X → X» and sent the Arabic letters to the browser.
//
// Then the one shared list drifted the other way, against Unicode. It named blocks, and Unicode has
// kept adding Arabic outside the blocks somebody once wrote down: 238 codepoints were not in it —
// Arabic Extended-B (U+0870-0891, U+0897-089F), the Rumi numerals (U+10E60-10E7E), Arabic Extended-C
// (U+10EC2-10EC7, U+10ED0-10ED8, U+10EFA-10EFF) and the Arabic Mathematical Alphabetic Symbols
// (U+1EE00-1EEBB and the two operators U+1EEF0-1EEF1; the gaps in that block are unassigned, not
// Arabic). The validator called them Arabizi, so nothing here ever ran on them and they went
// to the client as they were: {"items":[{"text":"<Extended-B> el prix 120dt"}],"choices":[...]}.
// A hand-written list cannot be the definition of "Arabic" — \p{Script=Arabic} is Unicode's own
// answer to the same question, it is what found the gap, and it cannot fall behind a Unicode release.
const ARABIC_SCRIPT = '\\p{Script=Arabic}';
// The blocks stay, but only underneath \p{Script=Arabic} and never as the definition of it: 57 of
// their codepoints are Common or Inherited rather than Arabic, and dropping them would cut holes in
// the net in the same breath as widening it. The table below has rows for two of them («،» → ',',
// «؟» → '?'); MARKS strips the tatweel and the vowel marks; «۝», «﴾», «﴿» and the unassigned holes in
// the presentation-forms block have no row and are emptied, which is what the old class did with them.
const ARABIC_RANGES = [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]];
// \u{...} and not \uXXXX: both files build their regexes with the u flag, and with four hex digits a
// range added above U+FFFF would parse as \uXXXX followed by a stray digit — «\u{1EE00}» would
// become «Ỡ» «0», a range starting at 0 that matches nearly every character there is.
const codepoint = (value) => `\\u{${value.toString(16).toUpperCase()}}`;
const ARABIC_CLASS = ARABIC_SCRIPT + ARABIC_RANGES.map(([from, to]) => `${codepoint(from)}-${codepoint(to)}`).join('');
const ARABIC_ONE = new RegExp(`[${ARABIC_CLASS}]`, 'u');
const ARABIC_ALL = new RegExp(`[${ARABIC_CLASS}]`, 'gu');
const isArabic = (text) => ARABIC_ONE.test(String(text || ''));

const LETTERS = {
  'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ى': 'a', 'ة': 'a', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j',
  'ح': '7', 'خ': '5', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'ch', 'ص': 's', 'ض': 'dh',
  'ط': 't', 'ظ': 'dh', 'ع': '3', 'غ': 'gh', 'ف': 'f', 'ق': '9', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w', 'ي': 'y', 'ء': '2', 'ئ': '2', 'ؤ': '2', '،': ',', '؟': '?',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  // The alef the normalise below makes out of ﭐ and ﭑ. Without the row, that alef is deleted.
  'ٱ': 'a',
  // The letters Tunisian adds to the Arabic alphabet for sounds Arabic has no letter for. Without a
  // row the delete-the-unmapped fallback ate them and left a real-looking Arabizi word with a
  // consonant missing — «مريڨل» came back «mryl» — which nothing downstream can tell apart from a
  // word that never had the letter.
  // ڨ is the library's, not this file's: 11-arabic-script.md:28 «ڨ for the g sound in Derja and
  // borrowed words: مريڨل، ڨاوري», spelled out as mrigel (01-arabizi-spelling.md:108) and as bug
  // «باڨ» and garantie «ڨارونتي» (05-business-sales.md:122, :126). ق stays '9': the same line keeps
  // ق for Arabic-root words (قدّاش، قال) «even if some regions say g».
  'ڨ': 'g',
  // 11-arabic-script.md:29: «پ is exact for p, but most people type ب because keyboards lack پ.
  // Both fine» — the library gives the letter its sound, so the table spells it instead of eating it.
  'پ': 'p',
  // Deliberately absent, both of them. چ appears in the library exactly once and only to be
  // forbidden («don't use چ for p», 11-arabic-script.md:29), so the library gives it no Tunisian
  // sound. ڤ (veh) is not in the library at all — not one line of it. There is no official Tunisian
  // spelling to fall back on (01-arabizi-spelling.md:12, 11-arabic-script.md:4: house style, "the
  // lines the user approved"), so a row written here would be a spelling nobody approved. They stay
  // unmapped and are deleted, and the warning in toLatin is what says so out loud.
};
// The vowel marks and the tatweel. It was written «ً-ٰ», which is U+064B to U+0670 — and that
// range runs straight through U+0660-0669, the digits: «٤٥» was deleted here, before the table
// above ever saw it. The marks are now listed without the digits between them.
const MARKS = /[\u064B-\u065F\u0670\u06DF\u0640]/g;
// NFKC first, and it is what makes a 50-row table enough. The presentation forms (U+FB50-FDFF and
// U+FE70-FEFF) are the same letters at other codepoints, and NFKC folds them back to the letters
// the table knows: ﺍ → ا, and the ligature ﻻ → the two letters ل ا. That is 976 codepoints
// covered by one call instead of 976 more rows here. It cannot run after the strip: NFKC turns ﹱ
// into tatweel plus fatha, so the marks only exist to be stripped once it has run. The digits come
// through it untouched — NFKC leaves ٠-٩ alone and the table turns them into 0-9. Whatever is
// left in any of the ranges after that is deleted, as it always was for U+0600-06FF: a letter this
// file has no Arabizi spelling for must not be the letter a client is shown.
//
// The honest cost of widening the class to the whole script: the table has ~50 rows and the script
// has 1413 codepoints, so most of the new ones are deleted rather than spelled. NFKC absorbs the
// largest group — 141 of the 238 are Arabic Mathematical Alphabetic Symbols, which fold back to plain
// letters the table already knows (U+1EE00 → ا), so «𞸡𞸤 el prix» is spelled, not emptied. The other
// 97 — Arabic Extended-B and -C, the Rumi numerals, the two mathematical operators — have no
// decomposition and no row, and are deleted. That
// is still the right trade against the old behaviour, which sent them to the client unchanged, and it
// is not where the defect is caught: with the class widened, lib/validate.js now sees them as Arabic
// script, so SCRIPT-ARABIC raises its repair and the model is asked for the message again in Latin
// letters. toLatin only runs as the last net in reply.js, after that rewrite has already failed.
// A Rumi numeral is left unmapped on purpose: U+10E69 is the value ten, not the digit 1, so there is
// no single character to write it as, and inventing one would put a wrong price in front of a client.
//
// What must not happen quietly is a message that is nothing but unmapped codepoints: reply.js sends
// back whatever this returns, and an empty string is an empty bubble in the chat with nothing
// anywhere to say why. lib/validate.js already refuses to call that a fix for a tappable choice
// («Honest or nothing»); for a message the least this file can do is name the codepoints it ate.
const toLatin = (text) => {
  const latin = text.normalize('NFKC').replace(MARKS, '').replace(ARABIC_ALL, (c) => LETTERS[c] ?? '');
  if (text.trim() && !latin.trim()) {
    const missing = [...new Set(text.normalize('NFKC').replace(MARKS, '').match(ARABIC_ALL) || [])]
      .filter((c) => LETTERS[c] === undefined)
      .map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
      .slice(0, 8);
    console.warn(
      `lib/ai.js: toLatin emptied «${text.slice(0, 40)}» — the letter table has no row for ${missing.join(' ')}: ` +
        'the message has nothing left to send, and a caller that sends it sends an empty bubble'
    );
  }
  return latin;
};

// The normalise is asserted separately, because the delete-the-unmapped fallback hides its absence:
// without it those 976 codepoints are emptied rather than spelled, which leaves no Arabic behind and
// no answer either. ﺍ is one letter, ﻻ is the ligature — one codepoint, the two letters ل ا.
if (toLatin('ﺍﻻ') !== 'ala') {
  throw new Error(`lib/ai.js: toLatin deletes the Arabic presentation forms instead of spelling them («ﺍﻻ» → «${toLatin('ﺍﻻ')}», expected «ala»)`);
}

// The g of ڨ, asserted as words and not as a table row, because a missing consonant is invisible:
// «مريڨل» came back «mryl», which still reads like an Arabizi word, so nothing after this file could
// have noticed. These three are the library's own examples of the letter (11-arabic-script.md:28,
// 01-arabizi-spelling.md:108, 05-business-sales.md:122 and :126). toLatin writes consonants, not the
// library's vowels — mrigel is spelled mrygl here — so what is checked is that the g is still there.
// «السوم ٤٥dt» rides along for the same reason, and it is the digits' own past bug: the marks range
// used to run through U+0660-0669 and delete the 45 before the table saw it, and a price that is
// simply gone is the one thing guard.js cannot catch.
const SPELLED = [['مريڨل', 'mrygl'], ['باڨ', 'bag'], ['ڨارونتي', 'garwnty'], ['پ', 'p'], ['السوم ٤٥dt', 'alswm 45dt']];
for (const [arabic, expected] of SPELLED) {
  if (toLatin(arabic) !== expected) {
    throw new Error(`lib/ai.js: toLatin drops a letter Tunisian uses («${arabic}» → «${toLatin(arabic)}», expected «${expected}»)`);
  }
}

// Asserted at load, because that drift is what shipped: toLatin must leave nothing the validator
// would still call Arabic. What it is asserted against is the point. The old check walked
// ARABIC_RANGES — the same constant that built the class toLatin empties — so it could only ever
// confirm that the table covered the blocks somebody had already thought of, and 238 codepoints
// outside them passed it for months. Unicode is asked instead: every codepoint there is, offered to
// \p{Script=Arabic}, and the ranges added on top so the Common characters the table has rows for («،»
// and «؟») are covered too. 1.1M codepoints scanned, 2645 kept: measured at 44ms against the 1.1ms
// the ranges-only check took, once per process — forty times the old cost, and still a fortieth of
// one model call. A row deleted, a rewrite of toLatin, or a Unicode release that adds Arabic outside
// the blocks below fails here, at require time, and not in a chat.
const EVERY_ARABIC = (() => {
  const chunks = [];
  const buffer = [];
  const keepArabic = (codepoints) => String.fromCodePoint(...codepoints).replace(/\P{Script=Arabic}+/gu, '');
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue; // a lone surrogate is half a codepoint, not one
    buffer.push(cp);
    if (buffer.length < 0x1000) continue;
    // Filtered per chunk, so the 1.1M-character string this would otherwise build never exists.
    chunks.push(keepArabic(buffer));
    buffer.length = 0;
  }
  chunks.push(keepArabic(buffer));
  for (const [from, to] of ARABIC_RANGES) for (let cp = from; cp <= to; cp++) chunks.push(String.fromCodePoint(cp));
  return chunks.join('');
})();
// The filter is Unicode's test, and isArabic only on top of it. Filtering with isArabic alone is the
// other half of the circle and it is not theoretical: narrow ARABIC_CLASS back to the hand-written
// ranges and toLatin returns U+0870 unchanged, but isArabic no longer calls U+0870 Arabic, so the
// assertion sees nothing left behind and the module loads. That is exactly how 238 codepoints shipped.
const STILL_ARABIC = /\p{Script=Arabic}/u;
const LEFT_BEHIND = [...toLatin(EVERY_ARABIC)].filter((c) => STILL_ARABIC.test(c) || isArabic(c));
if (LEFT_BEHIND.length) {
  const shown = LEFT_BEHIND.slice(0, 8)
    .map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ');
  throw new Error(
    `lib/ai.js: toLatin leaves ${LEFT_BEHIND.length} codepoint(s) that are still Arabic script (${shown}): ` +
      'they would be sent to the client unchanged — as Arabic letters if lib/validate.js counts them, ' +
      'and without even a transliterated log line if it does not'
  );
}

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
  // Emptiness is checked after the strip, not before: a message of "**" passed
  // the old check and then became an empty bubble in the chat.
  const messages = list
    .filter((m) => typeof m === 'string')
    .map((m) => m.replace(/\*\*/g, '').trim())
    .filter((m) => m)
    .slice(0, 3);
  const choices = (Array.isArray(data?.choices) ? data.choices : [])
    .filter((c) => typeof c === 'string' && c.length <= 40)
    .map((c) => c.trim())
    .filter((c) => c)
    .slice(0, 3);
  return { messages, choices, showSlots: data?.show_slots === true };
}

// Every answer is read by readAnswer, repaired by derja.fix and then thrown away, so nothing outside
// this file ever sees what the model actually wrote. The benchmark has to score that raw text — it is
// the only way to tell a prompt that got better from a repair list that got longer — and the same
// call carries usage.prompt_tokens_details.cached_tokens, which turns every cache estimate into a
// measured number. Nothing in api/ or lib/ sets it, so in production this stays null and does nothing.
let trace = null;
const setTrace = (fn) => {
  trace = fn;
};

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
  trace?.({ messages, raw: data.choices?.[0]?.message, usage: data.usage });
  return data.choices?.[0]?.message || {};
}

// ARABIC_CLASS is exported for lib/validate.js, which builds its own two regexes out of it: one
// definition of Arabic script — Unicode's, plus the few ranges this file's table needs on top — and
// it lives in the file whose table has to empty every codepoint of it.
module.exports = { instructions, forModel, clientLanguage, answerLanguage, looksFrench, looksDerja, toTurns, readAnswer, complete, toLatin, isArabic, ARABIC_CLASS, setTrace };
