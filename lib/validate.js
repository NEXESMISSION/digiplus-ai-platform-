// The last look at an answer before it is sent: no model call, no clock, no network.
//
// It runs where derja.fix used to run, and it does four kinds of thing:
//   fix     rewritten here, silently, and logged            — unlimited, deterministic
//   repair  added to reply.js's issues: ONE rewrite call    — shared with guard and repeat
//   drop    the message is deleted if the rewrite didn't help
//   watch   written to the log and sent anyway              — costs nothing, blocks nothing
//
// Two things this layer deliberately does NOT do. It does not decide that a word is invented: a
// whitelist of Tunisian stems was measured against the owner's own approved Derja and flagged 11.2 %
// of it — about 1.4 false repairs per answer — and rewriting a sentence that was already right is
// exactly how the model ends up inventing a spelling. Unknown words are watched, a Tunisian labels
// them once a week, and only labelled words (data/language.json "deny") are ever acted on. And it
// does not score length: the library says "short lines" and gives no number, so TOO-LONG may not
// spend the rewrite until the owner sets one.
//
// Every rule was measured against the 152 approved message blocks in brain/*.md and lib/bots.js.
// tools/validate-test.js re-runs that measurement offline, in milliseconds, with no API call.
const fs = require('fs');
const path = require('path');
const derja = require('./derja');
const repeat = require('./repeat');
const catalog = require('./catalog');
const lines = require('./lines');
// Two things, and never the model call: the list of what counts as Arabic script, and toLatin — the
// letter table, and only for a tappable choice.
const ai = require('./ai');
const LANG = require('../data/language.json');

const BRAIN_DIR = path.join(__dirname, '..', 'brain');

// Built offline by tools/build-lexicon.js from the Tunisian library, which lives outside the repo and
// cannot be read at runtime. Until that file exists the lexicon is only what the repo itself says,
// which means more watch rows and nothing else: an unknown word never blocks and never rewrites.
let LIBRARY_WORDS = [];
try {
  LIBRARY_WORDS = require('../data/lexicon.json').words || [];
} catch {
  LIBRARY_WORDS = [];
}

// The shapes, once:
//   Finding { rule, severity:'fix'|'repair'|'drop'|'watch', message:number, line:number|null,
//             found:string, expected:string|null, note:string }
//   Report  { texts, choices, changed:Finding[], issues:string[], drop:Set<number>,
//             watch:{rule,token,message}[] }
//   Ctx     { bot, language:'derja'|'fr'|null, script:'arabizi'|'arabic', history, clientText,
//             toolResults, approved:boolean[], lexicon, forms:Map, texts:string[] }

// One list of ranges, and it lives in lib/ai.js because that is the file whose letter table has to
// empty every one of them. Written out in both files, the two drifted: this one counted 1232
// codepoints Arabic while toLatin reached 256, so 976 of them were found here, handed to toLatin,
// returned unchanged, and logged as transliterated on the way to the browser.
const ARABIC_RUN = new RegExp(`[${ai.ARABIC_CLASS}]+`, 'u');
const ARABIC = new RegExp(`[${ai.ARABIC_CLASS}]`, 'u');
const LATIN = /\p{Script=Latin}/u;
const WORD = /[\p{L}\d]+/gu;
// The article in front of a Latin word. «الـsite» is how the library writes it (11 §3) and «ال site»
// is not, so the second one is closed up and the first one is never «a word in two scripts».
const ARTICLE_LOOSE = /ال\s*(?=[A-Za-zÀ-ÿ])/g;
const ARTICLE_LATIN = /^الـ?(?=[A-Za-zÀ-ÿ])/;
const EMOJI = /\p{Extended_Pictographic}(?:[\u{1F3FB}-\u{1F3FF}]|️|‍\p{Extended_Pictographic})*/gu;

// A message's physical lines and an answer's messages are the same operation: split, drop the empties.
const messagesOf = (text) =>
  String(text || '')
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);

function tokensOf(text) {
  const out = [];
  for (const match of String(text || '').matchAll(WORD)) out.push({ word: match[0], start: match.index });
  return out;
}

const scriptOf = (text) =>
  ARABIC.test(text) ? (LATIN.test(text) ? 'mixed' : 'arabic') : LATIN.test(text) ? 'arabizi' : 'none';

const emojiOf = (text) => String(text || '').match(EMOJI) || [];

// «Anhi» became «Anahi», never «anahi»: the capital the model wrote is the capital the client reads.
const capitalLike = (written, replacement) =>
  written[0] === written[0].toUpperCase() ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;

// Deleting an emoji leaves behind the space that was in front of it.
const tidy = (text) =>
  text
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .trim();

// Invisible, and carrying nothing a client can read: the soft hyphen and the zero-width marks. They
// go before the trim because String.trim() does not take them out — U+FEFF is whitespace to it, the
// other five are not. That is how a choice of «harakat + ZWNJ» got through: the harakat was stripped
// by the letter table, the ZWNJ was not, and it passed every emptiness check below because it is not
// whitespace. The client got a tappable button with nothing written on it. U+FEFF is in the list all
// the same: trim only reaches the two ends of a string, and an invisible in the middle of a word is
// the same nothing. An emoji written as a ZWJ sequence (👨‍🍳) falls into its parts here; each part is
// still an emoji and EMOJI-SET deletes the ones that are not the three approved marks, none of which
// is a part of such a sequence. The bidi marks (U+200E, U+200F, U+061C) are deliberately NOT here:
// they are invisible too, but they order a mixed Arabic/Latin line, so deleting one would change
// what the line says instead of emptying it.
const INVISIBLE = /[\u00AD\u200B\u200C\u200D\u2060\uFEFF]/g;

// What may be stripped and what counts as visible are two different questions, and using one
// list for both is how a blank bubble reached the client and the database. A bidi mark inside a
// sentence orders the line and has to stay; a string that is nothing BUT bidi marks still draws
// an empty grey bubble and an empty tappable button. String.trim() sees none of these.
//   \p{Cf} is every format character (the bidi marks, the zero-widths, the BOM), \p{Mn} every
//   combining mark (a lone harakat draws nothing), and the four named ones are blank glyphs that
//   are neither. Written as classes, not as literal invisibles: a character class you cannot see
//   in the source is a rule nobody can review.
const BLANK_ONLY = /^[\s\p{Cf}\p{Mn}ᅟᅠ⠀ㅤ]*$/u;
const visible = (text) => !BLANK_ONLY.test(String(text || ''));

// ai.readAnswer already does most of this; doing it again costs nothing and makes validate() usable
// on its own, which is what the whole test suite depends on.
const normalise = (text) =>
  String(text || '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*/g, '')
    .replace(INVISIBLE, '')
    .trim();

// A conversation holds clients' names and phone numbers, so a logged line carries the word and about
// 40 characters around it, and any run of 6 digits or more is taken out first.
function excerpt(text, start = 0, span = 40) {
  const flat = String(text || '').replace(/\s+/g, ' ');
  const from = Math.max(0, Math.min(flat.length - span, start - Math.floor(span / 3)));
  const cut = flat.slice(from, from + span).trim();
  return `${from > 0 ? '…' : ''}${cut}${from + span < flat.length ? '…' : ''}`.replace(/\d{6,}/g, '######');
}

const short = (text) => excerpt(text, 0, 40);

// ─── the lexicon ─────────────────────────────────────────────────────────────
// Everything this assistant was allowed to read: the library (once it is built), the shared voice,
// its own brain file, its catalogue, its welcome and its starters. The other bots' brain files are
// left out on purpose — a word the pâtisserie knows is not a word the clim assistant was taught, and
// the watch log is how the owner finds out that it needs teaching.
const lexicons = new Map();
function lexiconFor(bot) {
  if (!lexicons.has(bot.slug)) {
    const words = new Set(LIBRARY_WORDS.map((word) => String(word).toLowerCase()));
    const add = (text) => {
      for (const { word } of tokensOf(text)) words.add(word.toLowerCase());
    };
    add(fs.readFileSync(path.join(BRAIN_DIR, 'voice.md'), 'utf8'));
    add(fs.readFileSync(path.join(BRAIN_DIR, bot.brain), 'utf8'));
    if (bot.catalog) add(catalog.promptText(bot.catalog));
    for (const text of bot.welcome || []) add(text);
    for (const text of bot.starters || []) add(text);
    // The right-hand side of both tables is, by definition, how a Tunisian writes it.
    for (const [, right] of derja.SWAP) add(right);
    for (const [, right] of derja.FLAG) add(right);

    const variants = new Map();
    LANG.variants.forEach((forms, id) => {
      for (const form of forms) variants.set(form.toLowerCase(), { id, forms });
    });
    lexicons.set(bot.slug, { words, variants });
  }
  return lexicons.get(bot.slug);
}

// Three forms are in a variant set AND on the left of the SWAP table (chnoua, kifeh, bach). Aligning
// an answer to one of them would hand SWAP a word it always rewrites, and the two rules would undo
// each other on every pass. The swapped spelling is never the one this chat has chosen.
const SWAPPED = new Set(derja.SWAP.map(([wrong]) => wrong.toLowerCase()));

// The spelling this conversation already chose, per variant set. Bot messages only: a client may
// write a word any way they like, and mirroring their spelling is not the assistant's job.
function formsUsed(history, variants) {
  const chosen = new Map();
  for (const item of history || []) {
    if (item.role === 'client' || !item.text) continue;
    for (const { word } of tokensOf(item.text)) {
      const set = variants.get(word.toLowerCase());
      if (set && !chosen.has(set.id) && !SWAPPED.has(word.toLowerCase())) chosen.set(set.id, word.toLowerCase());
    }
  }
  return chosen;
}

// The owner's own messages, word for word, as lib/lines.js reads them out of the brain files. A
// message that lines.expand substituted for an «@id» arrives with approved:true and every style rule
// skips it — but reply.js:96 says the model sometimes writes one of those lines out instead of citing
// its id, and then nothing can tell his words from the assistant's. The flag exists to mark his
// voice (lines.js:62); a text that IS one of his lines is his voice whatever the flag says, and
// correcting it spends the single rewrite on a sentence a Tunisian already approved.
const approvals = new Map();
function approvedFor(bot) {
  if (!approvals.has(bot.slug)) {
    const texts = new Set();
    for (const line of lines.forBot(bot).values()) {
      for (const text of [...line.derja, ...line.fr]) if (text.trim()) texts.add(normalise(text));
    }
    approvals.set(bot.slug, texts);
  }
  return approvals.get(bot.slug);
}

// ─── shared matchers ─────────────────────────────────────────────────────────
// The same word boundary lib/derja.js uses, so a word imported from its tables matches there and here.
const boundary = (word) => new RegExp(`(?<![\\p{L}\\d])${word}(?![\\p{L}\\d])`, 'giu');
const SWAPS = derja.SWAP.map(([wrong, right]) => ({ wrong, right, pattern: boundary(wrong) }));
const FLAGS = new Map(derja.FLAG);
const DENIALS = LANG.deny.map((row) => ({ ...row, pattern: boundary(row.word) }));
const DENIED = new Set(LANG.deny.map((row) => row.word.toLowerCase()));
const KH5 = Object.entries(LANG.kh5).map(([kh, five]) => ({ kh, five, pattern: boundary(kh) }));
const CORPORATE = LANG.corporateFrench.map(([word, say]) => ({ word, say, pattern: boundary(word) }));
// Inside a French answer the table is the library's 09 §6 list, «French / English that sounds
// corporate in a simple chat», minus «beaucoup». It is not §6 word for word, and the three
// differences are each on purpose. «beaucoup» is not a §6 row: it is here so a Derja sentence says
// «barcha» (§7 lists it as a Tunisian word), and in French «beaucoup» is just French, so a French
// answer is the one place it is taken out. «prospect» is not a §6 row either and it stays in:
// 05-business-sales.md:145 marks prospect / lead / conversion as marketer jargon never used with
// clients, which is true in either language. The other way round, §6 has «veuillez noter» and the
// table has no such row — it needs none, «veuillez» already matches inside it.
const CORPORATE_FR = CORPORATE.filter(({ word }) => word !== 'beaucoup');
const ALLOWED_EMOJI = new Set(LANG.emoji);

// The whole number is captured, comma included, so the log reads «3,500 dt → 3500dt» and never
// «500 dt → 500dt» while the message became 3500dt: a log that says something other than what the
// text became is how the anhi drift was mis-read for weeks (derja.js:73).
const PRICE_SPACE = /((?:\d+,)*\d+)[   ]+(dt|DT|TND|dinars?)\b/g;
const THOUSANDS = /(\d),(\d{3})\b/g;
const plain = (number) => number.replace(/,/g, '');
const TILDE = /~\s*(\d+)/g;
// Not «\bdt»: in «30dt/mois» there is no word boundary between the 0 and the d.
const PERIOD = /\d+\s*dt\s*\/\s*(mois|month|an|year|chhar)\b/i;
const CHAHRIYA = /\bchahriya\b/i;
const RECURRING = /\bfel (chhar|3am)\b/i;
const COVERS = /(h[ée]bergement|base de données|maintenance|domaine|r[ée]ponses|assistants?)/i;
const ONE_OFF = /\bmara wa7da\b/i;
// 00-rules.md: «Every monthly or yearly fee says, in the same message, what it pays for» — a fee, so
// an amount. «3andek 3 formules, t5alles fel chhar 😊» names none: it is message 1 of the owner's own
// approved @price block (brain/digiplus.md:87) and message 2 is what each formule covers.
const AMOUNT = /\d[\d, ]*\s*(dt|tnd|dinars?)\b/i;
const FRENCH_SENTENCE = /\b(est-ce que|vous pouvez|vous avez|je vous|nous vous|veuillez|n'h[ée]sitez)\b/i;
// A closed stem list, never a pattern over all French: «n + French stem» would eat nettoyage,
// nharek and najjem. The misses (nlivriw) are accepted; the list grows from the watch log.
const FRENCH_VERB = /\b[nty](?:e|é)?(customi|optimi|configur|confirm|réserv|reserv|valid|ann?ul|modifi|process|manag)[a-zéè]{1,3}\b/i;
const WANTS_DETAIL = /\b(fasser|fassar|fasserli|akther|d[ée]tails?|explique|expliquez|kifech ya5dem|chnowa fih)\b/i;
// A price or a time (45dt, 11h30) is not a word. Only a token mixing letters and digits is Arabizi,
// and that is the same test ai.js uses to tell the two apart.
const NUMBER_LIKE = /^\d+[a-z]{0,3}\d*$/i;

// Does this answer look at dialect at all? reply.js has always run the Tunisian fixes on anything
// that is not French, and every false-positive number behind these rules was measured on Derja.
const isDerja = (ctx) => ctx.language !== 'fr';
const about = (ctx) => (isDerja(ctx) ? 'ta9riban' : 'environ');

// A global regex remembers where it stopped, so .test() on the same one twice skips the second time.
// .match() on a global regex ignores that, which is why every table lookup below uses it.
const hits = (text, pattern) => String(text).match(pattern) || [];

const at = (message, line = null) => ({ message, line });
const finding = (id, severity, where, extra) => ({
  rule: id,
  severity,
  message: where.message,
  line: where.line ?? null,
  found: '',
  expected: null,
  note: '',
  ...extra,
});

// ─── the rules ───────────────────────────────────────────────────────────────
// kind 'safety' runs on every message, including the owner's own approved lines.
// kind 'style' skips approved lines: they are his voice, and correcting them is how the one rewrite
// gets spent on a sentence that was already right.
// `apply` rewrites the message and the choices; `fixChoice` rewrites a choice only, for a rule that
// asks the model to redo a message but has to mend a button itself.
const RULES = [
  // 1–4. Script. In the chat only rule 1 ships: the library and ai.js's FORMAT both say a chat answer
  // is Arabizi, Latin letters only. Rules 2–4 are the posts and ads channel (11-arabic-script.md),
  // where the library itself puts Latin words inside Arabic («الـsite vitrine يبدا من 120 دينار»), so
  // a blanket ban would be wrong there. They are written and inert until the owner rules on it (O8).
  {
    id: 'SCRIPT-ARABIC',
    severity: 'repair',
    kind: 'safety',
    scope: 'message',
    when: (ctx) => ctx.script === 'arabizi',
    find: (unit, ctx, where) => {
      const run = unit.match(ARABIC_RUN);
      if (!run) return [];
      return [
        finding('SCRIPT-ARABIC', 'repair', where, {
          found: run[0],
          note: `«${short(unit)}» is written in Arabic letters: the whole answer must be Tunisian Arabizi in Latin letters`,
        }),
      ];
    },
    // A message is worth the rewrite: the model writes its own sentence in Arabizi better than a
    // letter table can. A choice is two words on a tappable button, and nothing downstream looks at
    // it again — reply.js's salvage transliterates the messages only. So the table is all a choice
    // has, and «نعم بركا» transliterated is still a button the client can press, while a choice
    // dropped or left in Arabic script is a button they cannot use at all.
    fixChoice: (choice) => {
      const latin = ai.toLatin(choice);
      // Honest or nothing. Arabic letters still in the output mean the table did not mend the
      // button; nothing but spaces means there was no word on it to mend. Neither is a fix, and
      // logging one as a fix is the «transliterated: X → X» that hid this for weeks. So the choice
      // is left exactly as the model wrote it, nothing goes in the changed log, and the two filters
      // at the end of validate() take the button away instead.
      return !visible(latin) || ARABIC.test(latin) ? choice : latin;
    },
  },
  {
    id: 'SCRIPT-MIX-LINE',
    severity: 'repair',
    kind: 'safety',
    scope: 'line',
    when: (ctx) => ctx.script === 'arabic',
    find: (unit, ctx, where) => {
      if (!ARABIC.test(unit)) return [];
      const keep = LANG.keepLatinInArabic;
      const stray = (unit.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]*/g) || []).filter((word) => {
        const lower = word.toLowerCase();
        return !keep.some((allowed) => allowed === lower || allowed.split(' ').includes(lower));
      });
      if (!stray.length) return [];
      return [
        finding('SCRIPT-MIX-LINE', 'repair', where, {
          found: stray[0],
          note: `«${stray[0]}» is a Latin word on an Arabic-script line: only the keep-list words, brands, links and numbers stay in Latin letters`,
        }),
      ];
    },
  },
  {
    id: 'SCRIPT-MIX-WORD',
    severity: 'repair',
    kind: 'safety',
    scope: 'message',
    when: (ctx) => ctx.script === 'arabic',
    find: (unit, ctx, where) =>
      tokensOf(unit)
        // «الـsite vitrine» is the library's own spelling (11 §3, and all 20 approved lines of 11 §7),
        // and it is what SCRIPT-ARTICLE writes: the article is not a word in two scripts.
        .filter(({ word }) => {
          const bare = word.replace(ARTICLE_LATIN, '');
          return ARABIC.test(bare) && LATIN.test(bare);
        })
        .slice(0, 1)
        .map(({ word }) =>
          finding('SCRIPT-MIX-WORD', 'repair', where, {
            found: word,
            note: `«${word}» is written in two scripts at once: write the whole word in one of them`,
          })
        ),
  },
  {
    id: 'SCRIPT-ARTICLE',
    severity: 'fix',
    kind: 'safety',
    scope: 'message',
    when: (ctx) => ctx.script === 'arabic',
    find: (unit, ctx, where) =>
      hits(unit, ARTICLE_LOOSE)
        .slice(0, 1)
        .map((written) =>
          finding('SCRIPT-ARTICLE', 'fix', where, {
            found: written,
            expected: 'الـ',
            note: 'a Latin word after the article is attached with الـ, never «ال site»',
          })
        ),
    apply: (unit) => unit.replace(ARTICLE_LOOSE, 'الـ'),
  },

  // 5. SWAP — the table in lib/derja.js, imported, never copied. The audit measured 0 foreign-word
  // leaks across 47 answers: that list is the one thing in this system already proven to work. Every
  // entry is a word whose Tunisian form is the same in every sentence, so it is replaced in silence.
  {
    id: 'SWAP',
    severity: 'fix',
    kind: 'safety',
    scope: 'message',
    when: isDerja,
    find: (unit, ctx, where) => {
      const out = [];
      for (const { right, pattern } of SWAPS) {
        for (const written of hits(unit, pattern)) {
          out.push(
            finding('SWAP', 'fix', where, {
              found: written,
              expected: capitalLike(written, right),
              note: `«${written}» is not how a Tunisian writes it`,
            })
          );
        }
      }
      return out;
    },
    apply: (unit) => derja.fix(unit).text,
  },

  // 6. FLAG — the other table in lib/derja.js. Each of these has several possible Tunisian forms, so
  // the model has to choose the right one: it costs the rewrite and is never replaced here.
  {
    id: 'FLAG',
    severity: 'repair',
    kind: 'safety',
    scope: 'message',
    when: isDerja,
    find: (unit, ctx, where) => {
      const out = [];
      const seen = new Set();
      for (const { word } of tokensOf(unit)) {
        const lower = word.toLowerCase();
        const right = FLAGS.get(lower);
        if (!right || seen.has(lower)) continue;
        seen.add(lower);
        out.push(
          // The wording derja.problems has always used, so the rewrite prompt keeps its shape.
          finding('FLAG', 'repair', where, { found: word, expected: right, note: `«${lower}» → «${right}»` })
        );
      }
      return out;
    },
  },

  // 7. DENY — the only deterministic invented-word check there can be, and it only ever knows what a
  // Tunisian already labelled. With a right word it is a silent replacement; without one the model
  // has to find the words itself, because guessing is what put the word there in the first place.
  {
    id: 'DENY',
    severity: 'fix',
    kind: 'safety',
    scope: 'message',
    find: (unit, ctx, where) => {
      const out = [];
      for (const { word, use, pattern } of DENIALS) {
        for (const written of hits(unit, pattern)) {
          out.push(
            finding('DENY', use ? 'fix' : 'repair', where, {
              found: written,
              expected: use ? capitalLike(written, use) : null,
              note: use ? `«${word}» is not a Tunisian word: «${use}»` : `«${word}» is not a Tunisian word: say it in other words`,
            })
          );
        }
      }
      return out;
    },
    apply: (unit) => {
      let out = unit;
      for (const { use, pattern } of DENIALS) if (use) out = out.replace(pattern, (written) => capitalLike(written, use));
      return out;
    },
  },

  // 8. VARIANT-DRIFT — the audit's most visible failure (four spellings of one word in one run), and
  // it costs nothing: both forms are right, so the answer is aligned to the one this chat already
  // used. Nothing is invented, and no winner is picked between two spellings the library disputes.
  {
    id: 'VARIANT-DRIFT',
    severity: 'fix',
    kind: 'safety',
    scope: 'message',
    when: isDerja,
    find: (unit, ctx, where) => {
      const out = [];
      for (const { word } of tokensOf(unit)) {
        const set = ctx.lexicon.variants.get(word.toLowerCase());
        if (!set) continue;
        const chosen = ctx.forms.get(set.id);
        // Nothing earlier in this chat: the first form written wins, and the rest follow it.
        if (!chosen) {
          ctx.forms.set(set.id, word.toLowerCase());
          continue;
        }
        if (chosen === word.toLowerCase()) continue;
        out.push(
          finding('VARIANT-DRIFT', 'fix', where, {
            found: word,
            expected: capitalLike(word, chosen),
            note: `this chat already writes «${chosen}»`,
          })
        );
      }
      return out;
    },
    apply: (unit, ctx) => {
      let out = unit;
      for (const [id, chosen] of ctx.forms) {
        for (const form of LANG.variants[id]) {
          if (form === chosen) continue;
          out = out.replace(boundary(form), (written) => capitalLike(written, chosen));
        }
      }
      return out;
    },
  },

  // 9. KH-5-MIX — خ is written 5 or kh, both are fine, never both in one message (01 §1). Only a
  // word-initial kh counts and only mapped words are rewritten: a blind kh → 5 would break checkout,
  // Khaled and WhatsApp. A kh word that is not in the map is left alone, and costs no rewrite.
  {
    id: 'KH-5-MIX',
    severity: 'fix',
    kind: 'style',
    scope: 'message',
    when: isDerja,
    find: (unit, ctx, where) => {
      if (!/\bkh/i.test(unit) || !/5[a-z]/i.test(unit)) return [];
      return KH5.filter(({ pattern }) => hits(unit, pattern).length).map(({ kh, five }) =>
        finding('KH-5-MIX', 'fix', where, { found: kh, expected: five, note: 'kh and 5 for خ in the same message' })
      );
    },
    apply: (unit) => {
      let out = unit;
      for (const { five, pattern } of KH5) out = out.replace(pattern, (written) => capitalLike(written, five));
      return out;
    },
  },

  // 10–11. Price typography. Both have one right answer in every sentence, so both are silent.
  {
    id: 'PRICE-SPACE',
    severity: 'fix',
    kind: 'safety',
    scope: 'message',
    find: (unit, ctx, where) => {
      const out = [];
      const prices = [];
      for (const match of unit.matchAll(PRICE_SPACE)) {
        prices.push([match.index, match.index + match[0].length]);
        out.push(finding('PRICE-SPACE', 'fix', where, { found: match[0], expected: `${plain(match[1])}dt`, note: 'a price is written 45dt' }));
      }
      for (const match of unit.matchAll(THOUSANDS)) {
        // «3,500 dt» is one row, not two: the row above already says what the whole price becomes.
        if (prices.some(([from, to]) => match.index >= from && match.index < to)) continue;
        out.push(finding('PRICE-SPACE', 'fix', where, { found: match[0], expected: `${match[1]}${match[2]}`, note: 'no comma inside a number' }));
      }
      return out;
    },
    // The price first, because it takes its own comma out; the second pass is for a bare number.
    apply: (unit) => unit.replace(PRICE_SPACE, (whole, number) => `${plain(number)}dt`).replace(THOUSANDS, '$1$2'),
  },
  {
    id: 'TILDE',
    severity: 'fix',
    kind: 'safety',
    scope: 'message',
    find: (unit, ctx, where) =>
      [...unit.matchAll(TILDE)].map((match) =>
        finding('TILDE', 'fix', where, {
          found: match[0],
          expected: `${about(ctx)} ${match[1]}`,
          note: '«~» is not understood: say it in a word',
        })
      ),
    // 13-past-mistakes.md: «~45 dt» went to a client and was not understood. In Derja the library's
    // word is ta9riban; in French the owner's own approved line writes «environ 250 conversations».
    apply: (unit, ctx) => unit.replace(TILDE, `${about(ctx)} $1`),
  },

  // 12–14. What a price means. A monthly number with no reason is the complaint 13-past-mistakes.md
  // records twice, and the sentence that fixes it is the model's to write, not ours.
  {
    id: 'PRICE-PERIOD',
    severity: 'repair',
    kind: 'safety',
    scope: 'message',
    // spec-language §3.5 gives this rule under «French typography inside Arabizi». «30dt / mois» is
    // ordinary French and the home page writes it that way, so it is only wrong in a Derja message.
    when: isDerja,
    find: (unit, ctx, where) => {
      const match = unit.match(PERIOD) || unit.match(CHAHRIYA);
      if (!match) return [];
      return [
        finding('PRICE-PERIOD', 'repair', where, {
          found: match[0],
          expected: 'fel chhar',
          note: `«${match[0].trim()}» is not how a price per period is written in Derja: «30dt fel chhar», «50dt fel 3am»`,
        }),
      ];
    },
  },
  {
    id: 'FEE-UNEXPLAINED',
    severity: 'repair',
    kind: 'safety',
    scope: 'message',
    // Only a business that really charges every month. Run everywhere, it would fire on any assistant
    // that happens to say «fel chhar», and its COVERS list is thin enough already: «30dt fel chhar,
    // fih kol chay» passes it while being exactly the line 13-past-mistakes.md rejects.
    when: (ctx) => ctx.bot?.recurring === true,
    find: (unit, ctx, where) => {
      if (!RECURRING.test(unit) || !AMOUNT.test(unit) || COVERS.test(unit)) return [];
      return [
        finding('FEE-UNEXPLAINED', 'repair', where, {
          found: unit.match(RECURRING)[0],
          note: `«${short(unit)}» gives a price per month without saying what it pays for: say what it covers, in the same message`,
        }),
      ];
    },
  },
  {
    id: 'FEE-MIXED',
    severity: 'repair',
    kind: 'safety',
    scope: 'message',
    find: (unit, ctx, where) => {
      if (!ONE_OFF.test(unit) || !RECURRING.test(unit)) return [];
      return [
        finding('FEE-MIXED', 'repair', where, {
          found: unit.match(ONE_OFF)[0],
          note: `«${short(unit)}» puts a one-off price and a monthly one in the same message: say them in two messages`,
        }),
      ];
    },
  },

  // 15. OPENER. Style, because «Voici les photos et les prix 😊» is an approved line and was the one
  // false positive in the whole 152-block measurement. «bien sûr,» carries its comma for the same
  // reason: «Bien sûr 😊» on its own is the approved @more line.
  {
    id: 'OPENER',
    severity: 'repair',
    kind: 'style',
    scope: 'message',
    find: (unit, ctx, where) => {
      const start = unit.trim().toLowerCase();
      const list = isDerja(ctx) ? LANG.openers.derja : LANG.openers.fr;
      const hit = list.find((opener) => start.startsWith(opener) && !/[\p{L}\d]/u.test(start[opener.length] || ''));
      if (!hit) return [];
      // The words as the model wrote them, capital included: the note is read by the model next.
      const written = unit.trim().slice(0, hit.length);
      return [
        finding('OPENER', 'repair', where, {
          found: written,
          note:
            hit === 'ma3lich'
              ? 'starts with «Ma3lich» (it means «no problem», not «sorry»): say «Sama7ni» or nothing'
              : `starts with «${written}»: answer what the client asked, without an opening formula`,
        }),
      ];
    },
  },

  // 16–17. French inside Derja. French nouns are required (el site, les prix, l'hébergement) and are
  // never touched: this is about clauses and about conjugating a French verb. «Ey bien sûr, najem
  // n3awnek» is the right answer and has two French words in it.
  {
    id: 'FRENCH-SENTENCE',
    severity: 'repair',
    kind: 'safety',
    scope: 'message',
    when: (ctx) => ctx.language === 'derja',
    find: (unit, ctx, where) => {
      const match = unit.match(FRENCH_SENTENCE);
      if (!match) return [];
      return [
        finding('FRENCH-SENTENCE', 'repair', where, {
          found: match[0],
          note: `«${match[0]}» is a French sentence inside a Derja message: French words are fine, French sentences are not — ask it in Derja`,
        }),
      ];
    },
  },
  {
    id: 'FRENCH-VERB',
    severity: 'repair',
    kind: 'safety',
    scope: 'message',
    when: isDerja,
    find: (unit, ctx, where) => {
      const match = unit.match(FRENCH_VERB);
      if (!match) return [];
      return [
        finding('FRENCH-VERB', 'repair', where, {
          found: match[0],
          note: `«${match[0]}» is a French verb conjugated in Derja: use a Derja verb (t2akked, t7ajjez, n7otou)`,
        }),
      ];
    },
  },

  // 18. CORPORATE. The library's 09 §6 is titled «French / English that sounds corporate in a simple
  // chat», so «Concernant votre demande, voici la procédure» is the sentence the table was written
  // for and a French answer is checked too. What it is told differs: every replacement §6 gives is
  // Tunisian, and the library has no French wording to put in a French answer, so there the word is
  // named and the sentence is the model's to write. Making a French replacement up here is exactly
  // the guessing this layer refuses to do everywhere else.
  {
    id: 'CORPORATE',
    severity: 'repair',
    kind: 'style',
    scope: 'message',
    find: (unit, ctx, where) =>
      (isDerja(ctx) ? CORPORATE : CORPORATE_FR)
        .filter(({ pattern }) => hits(unit, pattern).length)
        .map(({ word, say }) =>
          finding('CORPORATE', 'repair', where, {
            found: word,
            expected: isDerja(ctx) ? say : null,
            note: isDerja(ctx)
              ? `«${word}» sounds like a company writing to a file number: say «${say}»`
              : `«${word}» sounds like a company writing to a file number: say it in the words the client uses`,
          })
        ),
  },

  // 19–20. Emoji. Deleting one is safe: it carries nothing the sentence needs.
  {
    id: 'EMOJI-COUNT',
    severity: 'fix',
    kind: 'style',
    scope: 'message',
    find: (unit, ctx, where) => {
      const allowed = emojiOf(unit).filter((mark) => ALLOWED_EMOJI.has(mark));
      return allowed.slice(1).map((mark) => finding('EMOJI-COUNT', 'fix', where, { found: mark, expected: '', note: 'at most one emoji per message' }));
    },
    // Only the allowed ones: anything else is EMOJI-SET's, so the log says which rule deleted what.
    apply: (unit) => {
      let kept = 0;
      return tidy(unit.replace(EMOJI, (mark) => (!ALLOWED_EMOJI.has(mark) ? mark : kept++ === 0 ? mark : '')));
    },
  },
  {
    id: 'EMOJI-SET',
    severity: 'fix',
    kind: 'style',
    scope: 'message',
    find: (unit, ctx, where) =>
      emojiOf(unit)
        .filter((mark) => !ALLOWED_EMOJI.has(mark))
        .map((mark) => finding('EMOJI-SET', 'fix', where, { found: mark, expected: '', note: `only ${LANG.emoji.join(' ')} are used here` })),
    apply: (unit) => tidy(unit.replace(EMOJI, (mark) => (ALLOWED_EMOJI.has(mark) ? mark : ''))),
  },

  // 21. Too many messages. Dropping them costs nothing: messages 4 and up are the model's own
  // additions, never an approved line and never a card. reply.js already cuts the list to three, so
  // this is the rule that says the number out loud rather than the thing that enforces it.
  {
    id: 'TOO-MANY-MESSAGES',
    severity: 'drop',
    kind: 'safety',
    scope: 'answer',
    find: (unit, ctx) =>
      ctx.texts
        .slice(LANG.lengths.messages)
        .map((text, index) =>
          finding('TOO-MANY-MESSAGES', 'drop', at(LANG.lengths.messages + index), {
            found: short(text),
            note: `an answer is at most ${LANG.lengths.messages} messages`,
          })
        ),
  },

  // 22. TOO-LONG — watch only. 110 / 240 / 160 are the measured maxima of the owner's own approved
  // text (101 / 231 / 157), not a library rule: the library says «short lines» and gives no number
  // (spec-language §7.2). Until he sets one this may not spend the single rewrite.
  {
    id: 'TOO-LONG',
    severity: 'watch',
    kind: 'style',
    scope: 'message',
    find: (unit, ctx, where) => {
      const cap = WANTS_DETAIL.test(ctx.clientText) ? LANG.lengths.messageChars : LANG.lengths.messageCharsSoft;
      const out = [];
      if (unit.length > cap) {
        out.push(finding('TOO-LONG', 'watch', where, { found: `${unit.length} characters`, expected: String(cap), note: short(unit) }));
      }
      for (const [line, part] of messagesOf(unit).entries()) {
        if (part.length <= LANG.lengths.lineChars) continue;
        out.push(
          finding('TOO-LONG', 'watch', at(where.message, line), {
            found: `${part.length} characters on one line`,
            expected: String(LANG.lengths.lineChars),
            note: short(part),
          })
        );
      }
      return out;
    },
  },

  // 23. TOO-MANY-QUESTIONS. Every approved block has at most one «?», but there is no corpus of real
  // multi-message answers to measure a whole answer against, so it is watched before it blocks.
  {
    id: 'TOO-MANY-QUESTIONS',
    severity: 'watch',
    kind: 'style',
    scope: 'answer',
    find: (unit, ctx) => {
      const asked = ctx.texts.filter((text, index) => !ctx.approved[index]).reduce((sum, text) => sum + hits(text, /\?/g).length, 0);
      if (asked < 2) return [];
      return [finding('TOO-MANY-QUESTIONS', 'watch', at(0), { found: `${asked} questions`, note: short(ctx.texts.join(' ')) })];
    },
  },

  // 24. REPEAT lives in lib/repeat.js, and reply.js composes it into the same issues array. Running
  // it here too would report every repetition twice and spend the one rewrite on a duplicate. It is
  // in the registry so that nobody later "adds the missing rule": turn `when` on only if reply.js
  // stops calling repeat.problems itself.
  {
    id: 'REPEAT',
    severity: 'repair',
    kind: 'safety',
    scope: 'answer',
    when: () => false,
    find: (unit, ctx) => repeat.problems(ctx.texts, ctx.history).map((note) => finding('REPEAT', 'repair', at(0), { note })),
  },

  // 25. UNKNOWN-WORD — watch, forever, by measurement. A whitelist of Tunisian stems flags 11.2 % of
  // the owner's own correct Derja (4.7 % counting only real verb forms), about 1.4 false repairs per
  // answer; the near-miss variant that catches «nfazzellek» rejects 22 of 59 known-good words and
  // still misses «feragh», which is a real Arabic word no string function can tell from Derja. So the
  // word goes out, the log records it, and once a week a Tunisian decides: a real word joins
  // «## Words» in that bot's brain file, anything else joins "deny" and is deterministic forever.
  {
    id: 'UNKNOWN-WORD',
    severity: 'watch',
    kind: 'safety',
    scope: 'message',
    when: isDerja,
    find: (unit, ctx, where) => {
      const out = [];
      const seen = new Set();
      for (const { word, start } of tokensOf(unit)) {
        const lower = word.toLowerCase();
        // An Arabic-script word is SCRIPT-ARABIC's, not a word to ask a Tunisian about.
        if (seen.has(lower) || lower.length <= 2 || NUMBER_LIKE.test(lower) || ARABIC.test(lower)) continue;
        // A word a Tunisian already labelled is DENY's, and putting it back in the weekly review
        // queue is how a list that is supposed to shrink stops shrinking.
        if (ctx.lexicon.words.has(lower) || DENIED.has(lower)) continue;
        seen.add(lower);
        out.push(finding('UNKNOWN-WORD', 'watch', where, { found: word, note: excerpt(unit, start) }));
      }
      return out;
    },
  },
];

const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));
const enabled = (rule, ctx) => !rule.when || rule.when(ctx);

// ─── running them ────────────────────────────────────────────────────────────
// Exported so the per-rule tests can run one rule on its own, including the ones that are inert in
// the chat: a test builds a ctx with script 'arabic' and the posts rules answer.
function runRule(rule, input, ctx) {
  const texts = Array.isArray(input) ? input : input.texts || [];
  if (!enabled(rule, ctx)) return [];
  ctx.texts = texts;
  const approved = ctx.approved || [];
  if (rule.scope === 'answer') return rule.find(texts.join('\n'), ctx, at(0));
  const out = [];
  for (const [index, text] of texts.entries()) {
    if (rule.kind === 'style' && approved[index]) continue;
    if (rule.scope === 'line') for (const [line, part] of messagesOf(text).entries()) out.push(...rule.find(part, ctx, at(index, line)));
    else out.push(...rule.find(text, ctx, at(index)));
  }
  return out;
}

function contextFor(bot, input = {}) {
  const lexicon = lexiconFor(bot);
  return {
    bot,
    language: input.language === 'fr' ? 'fr' : input.language === 'derja' ? 'derja' : null,
    script: input.script || 'arabizi',
    history: input.history || [],
    clientText: String(input.clientText || ''),
    toolResults: input.toolResults || [],
    approved: input.approved || [],
    lexicon,
    forms: formsUsed(input.history, lexicon.variants),
    texts: [],
  };
}

// The same rule fires on both passes over a message it could not change (a denied word with no right
// word). Reporting it twice would put the same sentence in the rewrite prompt twice.
function dedupe(findings) {
  const seen = new Set();
  return findings.filter((found) => {
    const key = `${found.rule}|${found.severity}|${found.message}|${found.line}|${found.found}|${found.note}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── the whole layer ─────────────────────────────────────────────────────────
// normalise → fix → run the fixes once more (bounded, never a loop) → detect → return.
function validate(bot, input = {}) {
  const ctx = contextFor(bot, input);
  const texts = [];
  const approved = [];
  for (const [index, text] of (input.texts || []).entries()) {
    const clean = normalise(text);
    if (!visible(clean)) continue; // a message of «**» used to pass this and arrive as an empty bubble
    texts.push(clean);
    // The flag, or the text being one of his lines word for word: both mean «the owner wrote this».
    approved.push(Boolean((input.approved || [])[index]) || approvedFor(bot).has(clean));
  }
  ctx.approved = approved;
  ctx.texts = texts;
  let choices = (input.choices || []).map(normalise).filter(Boolean);

  const collected = [];
  for (let pass = 0; pass < 2; pass++) {
    let touched = false;
    for (const rule of RULES) {
      if (!(rule.apply || rule.fixChoice) || !enabled(rule, ctx)) continue;
      // A rule with fixChoice and no apply leaves the messages alone: for those it wants the rewrite.
      if (rule.apply) {
        for (const [index, text] of texts.entries()) {
          if (rule.kind === 'style' && approved[index]) continue;
          const found = rule.find(text, ctx, at(index));
          if (!found.length) continue;
          collected.push(...found);
          const out = rule.apply(text, ctx);
          if (out === text) continue;
          texts[index] = out;
          touched = true;
        }
      }
      // A tappable choice is two or three words of the model's own: the same silent fixes and no
      // checks — reply.js already sends the choices through guard.problems with the messages.
      choices = choices.map((choice) => {
        if (!rule.find(choice, ctx, at(-1)).length) return choice;
        const out = (rule.fixChoice || rule.apply)(choice, ctx);
        if (out === choice) return choice;
        touched = true;
        // The rule's own findings are not collected here: they belong to the message it would have
        // asked the model to rewrite. A choice mended by fixChoice is reported as the silent fix it
        // is, or «Tunisian fixes» says the answer went out untouched while a button was rewritten.
        if (rule.fixChoice) {
          collected.push(
            finding(rule.id, 'fix', at(-1), { found: choice, expected: out, note: 'a tappable choice cannot be asked for again: rewritten here' })
          );
        }
        return out;
      });
    }
    if (!touched) break;
  }
  // A fix can empty a message too, and the check on the input above could not see it coming: the
  // message was «🚀» when it went past line 877, and EMOJI-SET's apply returned «». report.texts is
  // this function's promise that what comes back can be sent, so the message is taken out here and
  // not only in reply.js — an empty item is a grey bubble public/chat.js draws, store.addBotItems
  // saves it, and every later page load replays it. In place, and approved with it: the two lists
  // are index for index, ctx holds these very arrays, and the drop indices the rules below hand to
  // reply.js have to count the same messages reply.js is about to send.
  for (let index = texts.length - 1; index >= 0; index--) {
    if (visible(normalise(texts[index]))) continue;
    texts.splice(index, 1);
    approved.splice(index, 1);
  }
  // A fix can empty a choice: a button of one emoji, or a word of nothing but vowel marks. The same
  // guard the messages get above, and it has to be the same normalise — an empty bubble was bad, an
  // empty button is worse, it is tappable. filter(Boolean) was not that guard and kept «  »:
  // stripping two harakat leaves the space that was between them, and the client got a blank button.
  choices = choices.map(normalise).filter(visible);
  // A choice the letter table could not mend is still Arabic script. On the posts channel that is
  // right; in this chat it is a button a client who writes Arabizi cannot read and nothing
  // downstream looks at it again, so it does not go out — no button beats an unreadable one, and
  // the message it belongs to is raising SCRIPT-ARABIC and being asked for again anyway.
  if (ctx.script === 'arabizi') choices = choices.filter((choice) => !ARABIC.test(choice));

  for (const rule of RULES) {
    if (rule.apply) continue; // its findings were collected while it was fixing
    collected.push(...runRule(rule, { texts }, ctx));
  }

  const changed = [];
  const issues = [];
  const drop = new Set();
  const watch = [];
  for (const found of dedupe(collected)) {
    if (found.severity === 'fix') changed.push(found);
    else if (found.severity === 'repair') issues.push(found.note);
    else if (found.severity === 'drop') drop.add(found.message);
    else watch.push({ rule: found.rule, token: found.found, message: found.note });
  }
  return { texts, choices, changed, issues: [...new Set(issues)], drop, watch };
}

module.exports = {
  validate,
  lexiconFor,
  contextFor,
  runRule,
  RULES,
  RULE_BY_ID,
  messagesOf,
  visible,
  tokensOf,
  scriptOf,
  emojiOf,
  formsUsed,
};
