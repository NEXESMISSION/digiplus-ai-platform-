// The deterministic half of derja-bench: checks D01–D30 of design-benchmark.md §3.3, minus D08.
// Pure functions over (conversation, case, bot). No network, no model, no clock.
//
//   grade(run, kase, bot, options) -> { scores, gates, findings, diagnostics }
//
// `run` is one conversation seen through one lens: { view: 'raw' | 'sent', answers: [{ texts, cards, ... }] }.
// The same conversation is graded twice, once on what the model wrote and once on what the client got;
// the gap between DIA(raw) and DIA(sent) is how much work lib/derja.js is doing (§3.2).
//
// A finding is { id, dims, sev, quote, note, turn }. Severity follows §3.4: hard = -3, soft = -1.5,
// fatal = the dimension is 0, report = counted and printed, never scored.
//
// Three places where this file does NOT do what §3.3 says, each because the ceiling (bench/ceiling.json)
// is the owner's own approved text and a check that marks it down is a wrong check, not a wrong answer:
//
//   1. D18 accepts 🙏 as well as 😊 and 👌 (BUILD-PLAN D10). The library says 😊 / 👌; the brain files use
//      🙏 eighteen times, including in @unknown, @outside-area and the FALLBACK. Owner question O11.
//   2. D12 (a recurring fee must say what it pays for, R9) is measured over the whole ANSWER, not per
//      message. @price in brain/digiplus.md deliberately splits «t5alles fel chhar» and the list of what
//      each formule includes into two messages; per-message it would fail its own approved line.
//   3. `must` / `mustAny` / `never` / `card` are matched over every answer of the conversation, not only
//      the last one as §1.3 says. §1.4's own yasm-c02 carries must: ["200dt"] on a four-turn booking whose
//      whole point is that the price is said once and never repeated — last-answer matching contradicts it.
//      For the 27 single-turn cases the two readings are the same.
//
// D08 (invented words) is not here: it needs the lexicon, which is WI-2.4. Gate G3 therefore reads null,
// not 0, so nobody mistakes "not measured" for "none found".
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// lib/ is required lazily: this file must load and self-test even when a lib file is mid-edit.
const lazy = (name) => {
  let mod;
  return () => (mod ??= require(path.join(ROOT, 'lib', name)));
};
const libDerja = lazy('derja.js');
const libRepeat = lazy('repeat.js');
const libGuard = lazy('guard.js');
const libAi = lazy('ai.js');
const libLines = lazy('lines.js');

// ---------------------------------------------------------------------------------------------------
// The word lists. Everything below is copied from spec-language.md, which copied it from the library.
// ---------------------------------------------------------------------------------------------------

// The house-spelling half of lib/derja.js SWAP: wrong spellings of Tunisian words, not foreign words.
// They must not count against DIA ("no foreign dialect") — they are ARZ, the Arabizi quality dimension.
const HOUSE_SPELLING_SWAPS = new Set([
  'nheb', 'theb', 'nhebou', 'mta3', 'hadhom', 'hedhouma', 'eli', 'illi', 'chnoua', 'kifeh',
  'anhi', 'anhou', 'anhom', 'ania', 'smahli', 'bch', 'bach', 'haja', 'okhra',
]);

// Standard Arabic written in Latin letters. §3.1 makes MSA feed the TUN cap as well as DIA.
const MSA = new Set([
  'ayna', 'kayfa', 'mata', 'limadha', 'kam', 'huna', 'hunaka', 'al2an', 'ghadan', 'jiddan',
  'qalilan', 'urid', 'hadhihi', 'hadhaaka', 'shukran', 'yumkinuka', 'nurid', 'sawfa', 'yujad',
]);

// lib/derja.js FLAG holds two different kinds of word. These are the foreign-dialect ones (DIA);
// everything else in FLAG is a wrong Tunisian word or a register slip, which is TUN.
const FLAG_FOREIGN = new Set([
  '3ayez', '3awz', '3ayza', '3ashan', '3alshan', 'halla', 'hal2', 'hassa', 'zain', 'keefak', 'kifak',
  'shlonak', 'hna', 'hnaya', 'hne', 'fin', 'fayn', 'safi', 'wakha', 'zwin', 'zwina',
  'tayeb', 'tayba', 'tayyeb', 'tayyba', 'ta3', 'ila',
]);

// The library contradicts itself on these, so they are reported and never counted (§2.2 DIA anchor 6,
// spec-language §9.1–9.4, BUILD-PLAN O2/O3). Scoring them would mark down correct Derja.
const DISPUTED = new Map([
  ['chnou', '09 §7 allows it, 09 §1 bans it'],
  ['ghir', 'Tunisian in «men ghir ma…» (10 §5) and «arb3a ghir rob3» (12 §5)'],
  ['mumkin', '«Ey mumkin» is an approved line in 08-sales-conversations.md'],
  ['momkin', 'spelling of mumkin, same dispute'],
  ['7elw', 'banned as «nice»; 7elou for a sweet taste is not covered by the library (owner O3)'],
  ['7elwa', 'same as 7elw (owner O3)'],
  ['bnin', 'in @tasty and in the derja.js review note, nowhere in the library (owner O2)'],
  ['bnina', 'the only bnina in the library is the past tense of bna, «to build» (owner O2)'],
]);

// spec-language §3.3, the ❌ column: a settled spelling written the wrong way.
const NEVER_FORMS = new Set([
  'shnowa', 'chno', 'chnouwa', '9adesh', '9addech', 'mt3ek', 'n7ib', 'nheb', 'theb', 'nhebou', 'tw',
  'bhey', 'brcha', 'kifach', 'kifash', '3lach', 'wa9ta', 'merhbe', '8odwa', 'ghdwa', 'mezian',
  'embare7', 'mbare7', 'ems', '2akher', 'bch', '9oli', 'ab3at', 'ma3le5', 'ma3lesh', 'hada', 'hadi',
  'hadak', 'hadhom', 'hedhouma', 'hethi', 'eli', 'illi', 'anhou', 'anhi', 'anhom', 'ania', 'ala',
  'smahli', 'sma7lna', 'netsam7ou', 'mochkel', 'fhemtik', 'sa7it', 'nbadewou', 'wsletna', 'simana',
  'njm', 'nijem', 'najm', 'n9assoulek', 'yet7added',
]);

// The same table's middle column: understandable, not the house spelling.
const TOLERATED = new Set([
  'chnoua', 'chnwa', '9adeh', 'mta3ek', 'n7ebb', 't7ebb', 'taw', 'bahi', 'barsha', 'kifeh', '3leh',
  'waqtech', 'mar7be', 'marhba', 'lbera7', 'bach', '9oulli', 'eb3athli', 'ab3athilna', 'khater',
]);

// Spelled out, so the regex cannot confuse «9ouli» (the feminine imperative, 03) with «9olli».
const PHRASE_NEVER = [
  ['bel dhabt', 'bedhabt'],
  ['ma 3andnach', 'ma 3andnech'],
  ['haja okhra', '7aja o5ra'],
  ['3la heka', '3la haka'],
  ['el reste', 'el ba9i'],
  ['ma jeni ch', 'ma jenich'],
];

// spec-language §3.4, minus two sets on purpose: {le, la} (BUILD-PLAN D23 — «la» is also the French
// article) and {najjem, najem} (design-benchmark §8.4 — the library itself writes both, owner O4).
const VARIANT_SETS = [
  ['chnowa', 'chnoua', 'chnwa'],
  ['9adech', '9adeh'],
  ['mte3ek', 'mta3ek'],
  ['n7eb', 'n7ebb'],
  ['tawa', 'taw'],
  ['behi', 'bahi'],
  ['barcha', 'barsha'],
  ['kifech', 'kifeh'],
  ['3lech', '3leh'],
  ['wa9tech', 'waqtech'],
  ['marhbe', 'mar7be', 'marhba'],
  ['bech', 'bach'],
  ['9olli', '9oulli'],
  ['ab3athli', 'eb3athli'],
  ['5ater', 'khater'],
  ['ey', 'eyh'],
];

// 01 §1: sh for ش and 8 for غ are "rare in Tunisia, don't use". A bare /sh/ would flag «shooting»
// and «cash», so only Arabizi-looking tokens and the known sh-forms count.
const SH_FORMS = new Set(['shnowa', 'shnou', 'shu', 'shou', 'shway', 'shwaya', 'shlon', 'shloun', 'shkoun', 'kifash', 'shnia']);

// 09 §6 plus the English list of D14. «beaucoup» is correct French and is only stiff inside Derja.
const JARGON = [
  'veuillez', 'cordialement', 'néanmoins', 'toutefois', 'concernant', 'conformément', 'absolument',
  'parfaitement', 'procédure', 'démarche', 'prestation', 'réalisation', 'prospect', 'campagne',
  'ciblage', 'audience', 'dashboard', 'checkout', 'lead', 'feedback', 'workflow', 'onboarding',
  'cms', 'api', 'ssl', 'responsive', 'backend', 'nlp', 'milestones',
];
const JARGON_DERJA_ONLY = ['beaucoup'];
const JARGON_PHRASES = ['solution digitale', 'expérience utilisateur', 'interface utilisateur', 'merci de bien vouloir'];

const CONJUGATED_FRENCH = /(?<![\p{L}\d])[nty](?:e|é)?(?:customi|optimi|configur|confirm|reserv|réserv|valid|activ|install|command|paye?)\w*(?:i|iw|ou|ch)(?![\p{L}\d])/giu;
const FRENCH_SENTENCE = /\b(est-ce que|vous pouvez|je vous|veuillez|nous allons|n'hésitez)\b/gi;
const PRICE_TYPO = [
  [/\d+\s+dt\b/gi, 'a space between the number and dt'],
  [/~/g, '«~» is not understood (13)'],
  [/\bdt\s*\/\s*(mois|month)\b/gi, 'write «fel chhar», not «dt/mois»'],
  [/chahriya/gi, '«chahriya» with no explanation'],
  [/\d,\d{3}/g, 'a comma inside a number (3,500 DT)'],
];
// R9: a monthly or yearly fee must say what it pays for, in the same answer.
const FEE_REASONS = ['hébergement', 'hebergement', 'base de données', 'maintenance', 'domaine', 'réponses', 'reponses', 'assistant'];
const SLANG = ['khouya', '5ouya', 'okhti', 'sa7bi', 'bro'];
const EMOJI_OK = new Set(['😊', '👌', '🙏']);

// The @unknown lines, word for word, so an honest «I don't know» can be told apart from an evasion.
const EVASION = ['ma na3refhech bedhabt', 'je ne sais pas exactement'];
// R22: an honest line is only honest when it carries a next step.
const NEXT_STEP = /(technicien|nraja3lek|n3ayetlek|t3ayetlek|nchoufouha|nchouflek|t2akkedlek|noumrou|numéro|esmek|votre nom)/i;
// The lines that say a request is saved (reply.js SAVED_LINES): they may only go out with a card.
const SAVED_SAID = ['wsellna talabek', 'talabek wsel', 'commande mte3ek wslet', "c'est noté", 'votre commande est envoyée', 'votre demande est envoyée'];
// reply.js FALLBACK: the pipeline threw and the hand-written text went out.
const FALLBACK_SAID = ['ma najjemch njawbek tawa', 'je ne peux pas vous répondre pour le moment'];
const DOMAIN = /\b[a-z0-9][a-z0-9-]*\.(?:tn|com|net|org|fr)\b/gi;
const ALLOWED_DOMAIN = 'esm-el-projet.tn';

const DIMENSIONS = ['NAT', 'TUN', 'ARZ', 'USE', 'CNC', 'FRA', 'SCR', 'DIA'];
const WEIGHTS = { NAT: 25, TUN: 15, ARZ: 15, USE: 15, CNC: 10, FRA: 8, SCR: 6, DIA: 6 };
const GATE_IDS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'];

// ---------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------

const lower = (s) => String(s || '').toLowerCase();
const tokens = (text) => lower(text).match(/[\p{L}\d]+/gu) || [];
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const emojiOf = (text) => String(text || '').match(/\p{Extended_Pictographic}/gu) || [];
const cut = (s, n = 60) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);
const arabizi = (token) => /[23579]/.test(token) && /\p{L}/u.test(token);
// A price, a time or a size: "38dt", "1h", "500g", "18000". ai.js:76 draws the line the same way, and
// D07 has to skip these or every 8 in a price reads as a غ.
const numberish = (token) => /^\d+[a-z]{0,3}\d*$/i.test(token);

// The two tables live in lib/derja.js (BUILD-PLAN D7). Read them if they are exported, fall back to
// the SWAP shape this file was written against so a mid-edit lib/derja.js cannot break the bench.
function foreignWords() {
  const derja = libDerja();
  const swap = Array.isArray(derja.SWAP) ? derja.SWAP.map(([wrong]) => wrong) : [];
  const flag = Array.isArray(derja.FLAG) ? derja.FLAG.map(([word]) => word) : [];
  const out = new Map();
  for (const word of swap) if (!HOUSE_SPELLING_SWAPS.has(word) && !DISPUTED.has(word)) out.set(word, 'swap');
  for (const word of flag) {
    if (DISPUTED.has(word)) continue;
    if (FLAG_FOREIGN.has(word) || MSA.has(word)) out.set(word, 'flag');
  }
  return out;
}

// Everything in FLAG that is not a foreign dialect word is still not the Tunisian word (TUN, not DIA).
function wrongWords() {
  const derja = libDerja();
  const flag = new Map(Array.isArray(derja.FLAG) ? derja.FLAG : []);
  const out = new Map();
  for (const [word, right] of flag) {
    if (DISPUTED.has(word) || FLAG_FOREIGN.has(word) || MSA.has(word)) continue;
    out.set(word, right);
  }
  return out;
}

// Which language the answer had to be in. Recomputed per turn with the engine's own detector, because
// a client may switch mid-chat (gen-x01); the case's clientLang is only the fallback (BUILD-PLAN D3).
function expectedLanguage(history, kase) {
  const detected = libAi().clientLanguage(history);
  if (detected) return detected;
  return kase.clientLang === 'fr' ? 'fr' : 'derja';
}

// The messages the owner approved for this bot, as the client receives them (after derja.fix).
// Used by D20, and by the self-test to prove nothing in bench/ceiling.json was written by an agent.
function approvedTexts(bot) {
  const out = new Set();
  for (const line of libLines().forBot(bot).values()) {
    for (const text of line.derja) out.add(libDerja().fix(text).text.trim());
    for (const text of line.fr) out.add(text.trim());
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------------

// One answer, seen on its own. `turn` is 1-based and only used to point at the offending message.
function checkAnswer(answer, kase, bot, ctx) {
  const found = [];
  const add = (id, dims, sev, quote, note) => found.push({ id, dims: [].concat(dims), sev, quote, note, turn: answer.turn });
  const texts = answer.texts || [];
  const whole = texts.join('\n');
  const foreign = ctx.foreign;
  const wrong = ctx.wrong;

  for (const text of texts) {
    // D01 · a dialect blacklist token. Word boundaries, the way lib/derja.js draws them.
    for (const token of tokens(text)) {
      if (DISPUTED.has(token)) {
        add('D01', 'DIA', 'report', token, `disputed: ${DISPUTED.get(token)}`);
        continue;
      }
      if (foreign.has(token)) add('D01', MSA.has(token) ? ['DIA', 'TUN'] : ['DIA'], 'hard', token, 'not a Tunisian word');
      else if (wrong.has(token)) add('D01', 'TUN', 'hard', token, `the Tunisian word is «${wrong.get(token)}»`);
    }

    // D02 · Arabic codepoints in an Arabizi answer. ai.js FORMAT: Latin letters only, never Arabic.
    if (ctx.language !== 'fr') {
      const arabic = text.match(/[؀-ۿ]/gu) || [];
      if (arabic.length) add('D02', 'SCR', 'hard', cut(text), `${arabic.length} Arabic codepoint(s) in an Arabizi message`);
    }
    // D03 · both scripts inside one word («nجم»): the worst of them, so the dimension goes to 0.
    for (const token of String(text).split(/\s+/)) {
      if (/[؀-ۿ]/u.test(token) && /[A-Za-z]/.test(token)) add('D03', 'SCR', 'fatal', token, 'two scripts inside one word');
    }
    // D04 · Arabic punctuation or Arabic-Indic digits.
    const marks = text.match(/[؟،٠-٩]/gu) || [];
    if (marks.length) add('D04', 'SCR', 'soft', marks.join(''), 'Arabic punctuation or digits');

    // D05 · a settled spelling written a way the library calls wrong, and D05b the tolerated variants.
    for (const token of tokens(text)) {
      if (foreign.has(token) || DISPUTED.has(token)) continue; // already counted by D01
      if (NEVER_FORMS.has(token)) add('D05', ['ARZ', 'TUN'], 'hard', token, 'a spelling the library marks ❌ (§3.3)');
      else if (TOLERATED.has(token)) add('D05', 'ARZ', 'soft', token, 'a tolerated variant, not the house spelling');
    }
    for (const [phrase, right] of PHRASE_NEVER) {
      if (lower(text).includes(phrase)) add('D05', ['ARZ', 'TUN'], 'hard', phrase, `write «${right}»`);
    }

    // D07 · sh for ch and 8 for gh, inside one message. The 5-vs-kh half is conversation-level.
    for (const token of tokens(text)) {
      if (numberish(token)) continue;
      if (SH_FORMS.has(token) || (token.includes('sh') && arabizi(token))) add('D07', 'ARZ', 'hard', token, '«sh» for ش (01 §1: rare in Tunisia)');
      if (/[a-z]8|8[a-z]/.test(token)) add('D07', 'ARZ', 'hard', token, '«8» for غ (01 §1: don\'t use)');
    }

    // D09 · a French verb conjugated in Derja, D10 · a French sentence inside a Derja message.
    for (const hit of text.match(CONJUGATED_FRENCH) || []) add('D09', 'FRA', 'hard', hit, 'a conjugated French verb (R6)');
    if (ctx.language !== 'fr') {
      for (const hit of text.match(FRENCH_SENTENCE) || []) add('D10', 'FRA', 'hard', hit, 'a French sentence inside a Derja message (R7)');
    }

    // D11 · price typography.
    for (const [pattern, note] of PRICE_TYPO) {
      for (const hit of text.match(pattern) || []) add('D11', 'FRA', 'hard', hit, note);
    }
    // D13 · paid-once and paid-monthly on the same line (R10).
    for (const line of String(text).split('\n')) {
      if (/mara wa7da/i.test(line) && /fel chhar/i.test(line)) add('D13', ['FRA', 'CNC'], 'soft', cut(line), 'once and monthly in one line (R10)');
    }

    // D14 · jargon and the stiff French of 09 §6.
    for (const word of JARGON) {
      if (new RegExp(`(?<![\\p{L}\\d])${word}(?![\\p{L}\\d])`, 'iu').test(text)) add('D14', ['TUN', 'FRA'], 'hard', word, 'jargon (R23)');
    }
    if (ctx.language !== 'fr') {
      for (const word of JARGON_DERJA_ONLY) {
        if (new RegExp(`(?<![\\p{L}\\d])${word}(?![\\p{L}\\d])`, 'iu').test(text)) add('D14', ['TUN', 'FRA'], 'hard', word, 'say «barcha» (09 §6)');
      }
    }
    for (const phrase of JARGON_PHRASES) if (lower(text).includes(phrase)) add('D14', ['TUN', 'FRA'], 'hard', phrase, 'jargon (R23)');

    // D18 · emoji budget. The set is 😊 👌 🙏 (BUILD-PLAN D10), not the library's two.
    const emoji = emojiOf(text);
    if (emoji.length > 1) add('D18', 'CNC', 'soft', emoji.join(''), `${emoji.length} emoji in one message (R13)`);
    for (const e of emoji) if (!EMOJI_OK.has(e)) add('D18', 'CNC', 'soft', e, 'an emoji outside 😊 👌 🙏');

    // D26 · «Ma3lich» as an opener. D27 · slang the client has not used. Both feed NAT, which has no
    // judge in v1, so they are printed and not scored.
    if (/^\s*ma3lich\b/i.test(text)) add('D26', 'NAT', 'report', cut(text, 30), 'opens with «Ma3lich» (it means «no problem», not «sorry») — R18');
    for (const word of SLANG) {
      if (new RegExp(`(?<![\\p{L}\\d])${word}(?![\\p{L}\\d])`, 'iu').test(text) && !ctx.clientSlang) {
        add('D27', 'NAT', 'report', word, 'forced slang the client never used (R19)');
      }
    }

    // D29 · an example domain that is not the one the library fixes (R16).
    for (const hit of text.match(DOMAIN) || []) {
      if (lower(hit) !== ALLOWED_DOMAIN) add('D29', 'USE', 'hard', hit, `the example domain is always ${ALLOWED_DOMAIN} (R16)`);
    }

    // G7 · the hand-written FALLBACK went out, which means the pipeline threw.
    for (const said of FALLBACK_SAID) if (lower(text).includes(said)) add('G7', 'USE', 'fatal', cut(text, 40), 'the FALLBACK text was sent (reply.js:26)');

    // D24 · a price this business does not have. guard.unknownPrice is reused as it is.
    try {
      if (libGuard().unknownPrice(bot, text, answer.toolResults || [])) add('D24', 'USE', 'hard', cut(text, 40), 'a price that is not in the brain file or the catalogue');
    } catch {
      // The brain file is being rewritten by another item: record nothing rather than a false failure.
    }
  }

  // D12 · a recurring fee with no reason. Answer-scope, see the header.
  if (/fel chhar|fel 3am/i.test(whole) && !FEE_REASONS.some((r) => lower(whole).includes(r))) {
    add('D12', ['FRA', 'USE'], 'soft', cut(whole, 50), 'a monthly fee with nothing saying what it pays for (R9)');
  }

  // D15 · message count. The engine allows 4 (reply.js:114) and the exam fails above 3 (exam.js:39):
  // both are recorded, the score is on 3 (BUILD-PLAN D4).
  if (!texts.length) add('D15', 'CNC', 'hard', '', 'no message sent');
  else if (texts.length > 3) add('D15', 'CNC', 'hard', `${texts.length} messages`, 'more than 3 messages (R12)');
  else if (kase.maxMessages && texts.length > kase.maxMessages) {
    add('D15', 'CNC', 'soft', `${texts.length} messages`, `this case expects at most ${kase.maxMessages}`);
  }

  // D17 · one question per answer, at the end (R11).
  const questions = (whole.match(/\?/g) || []).length;
  if (questions > 1) add('D17', 'CNC', 'hard', `${questions} «?»`, 'more than one question in one answer (R11)');

  // D25 · the answer is in the client's language. Mirrors guard.problems, which only flags the wrong
  // language — it never demands proof of the right one, and neither may this. One finding per answer,
  // because G5 counts answers, not messages. §2.2 FRA: the WHOLE answer in the wrong language is a 0,
  // one message among several is a violation like any other.
  const ai = libAi();
  const wrongLanguage = texts.filter((t) => (ctx.language === 'fr' ? ai.looksDerja(t) : ai.looksFrench(t)));
  if (wrongLanguage.length) {
    const other = ctx.language === 'fr' ? 'Derja' : 'French';
    const all = wrongLanguage.length === texts.length;
    add('D25', 'FRA', all ? 'fatal' : 'hard', cut(wrongLanguage[0], 40), `${all ? 'the answer is' : `${wrongLanguage.length} of ${texts.length} messages are`} written in ${other}, and the client writes ${ctx.language === 'fr' ? 'French' : 'Derja'} (R1)`);
  }

  return found;
}

// Everything that can only be seen across the whole conversation.
function checkConversation(run, kase, bot, ctx) {
  const found = [];
  const add = (id, dims, sev, quote, note, turn) => found.push({ id, dims: [].concat(dims), sev, quote, note, turn });
  const answers = run.answers || [];
  const allTexts = answers.flatMap((a) => a.texts || []);
  const allCards = answers.flatMap((a) => a.cards || []);
  const haystack = lower(allTexts.join('\n'));
  const last = answers[answers.length - 1] || { texts: [] };
  const lastText = lower((last.texts || []).join('\n'));

  // D06 · one surface form per variant set for the whole conversation (R4). This is the rule the
  // Anahou / Anahi / Anhou / Anhi run broke.
  const seen = new Set(allTexts.flatMap(tokens));
  for (const set of VARIANT_SETS) {
    const used = set.filter((form) => seen.has(form));
    if (used.length > 1) add('D06', 'ARZ', 'hard', used.join(' / '), 'two spellings of one word in one conversation (R4)');
  }
  // D07 · the 5-vs-kh half: the same root written both ways somewhere in the run.
  for (const token of seen) {
    if (!token.includes('5')) continue;
    const kh = token.replace(/5/g, 'kh');
    if (seen.has(kh)) add('D07', 'ARZ', 'hard', `${token} / ${kh}`, '5 and kh for the same word in one conversation (01 §1)');
  }
  // Accents consistent inside one conversation (§3.5): hébergement then hebergement.
  const byBare = new Map();
  for (const token of seen) {
    const bare = stripAccents(token);
    if (bare === token && !/[a-z]/.test(token)) continue;
    byBare.set(bare, (byBare.get(bare) || new Set()).add(token));
  }
  for (const [bare, forms] of byBare) {
    if (forms.size > 1) add('D05', 'ARZ', 'soft', [...forms].join(' / '), `accents written two ways for «${bare}»`);
  }

  // D19 · repetition. lib/repeat.js only compares the last 8 bot messages; the bench compares every
  // earlier one, which is the whole point of a flow case. tooClose is mirrored, not imported: it is
  // not exported, and repeat.js deliberately lets a SHORT line come back word for word.
  const sameness = libRepeat().sameness;
  const asks = /\?\s*$|\b(ab3athli|ab3athili|9olli|9ouli|a3tini|3tini|envoyez|donnez|dites)\b/i;
  const earlier = [];
  for (const answer of answers) {
    for (const text of answer.texts || []) {
      const twin = earlier.find((old) => {
        const score = sameness(text, old);
        if (score >= 1) return asks.test(String(text).trim()) || tokens(text).filter((w) => w.length > 2).length > 5;
        return score >= 0.75 && asks.test(String(text).trim());
      });
      if (twin) add('D19', 'CNC', 'hard', cut(text, 40), `says again «${cut(twin, 40)}»`, answer.turn);
      earlier.push(text);
    }
  }

  // D21 · must / mustAny / never / card. Conversation-scope, see the header.
  for (const want of kase.must || []) if (!haystack.includes(lower(want))) add('D21', 'USE', 'hard', want, 'never said it');
  if ((kase.mustAny || []).length && !kase.mustAny.some((want) => haystack.includes(lower(want)))) {
    add('D21', 'USE', 'hard', kase.mustAny.join(' / '), 'said none of them');
  }
  for (const banned of kase.never || []) if (haystack.includes(lower(banned))) add('D21', 'USE', 'hard', banned, 'said a word this case forbids');
  if (kase.card && !allCards.some((c) => c && (c.type === kase.card || c.title === kase.card))) {
    add('D21', 'USE', 'hard', kase.card, `no «${kase.card}» card (got: ${allCards.map((c) => c.title || c.type).join(', ') || 'none'})`);
  }

  // D22 · evasion. @unknown is the right answer when the brain is thin and a failure when it is not.
  if (kase.knows === 'yes' && EVASION.some((marker) => lastText.includes(marker))) {
    add('D22', 'USE', 'hard', '@unknown', 'said it does not know something the brain file says');
  }
  // D23 · when the brain really is thin, the honest line needs a concrete next step (R22).
  if (kase.knows === 'no' && lastText && !NEXT_STEP.test(lastText)) {
    add('D23', 'USE', 'hard', cut(lastText, 50), 'honest, but with no next step for the client (R22)');
  }

  // D28 · inchallah more than once reads mechanical (01 §6). Diagnostic, never scored.
  const inchallah = (haystack.match(/inchallah/g) || []).length;
  if (inchallah > 1) add('D28', 'NAT', 'report', `${inchallah}×`, 'inchallah more than once in one conversation');

  // G6 · «it is saved» with no card anywhere in the conversation.
  if (!allCards.length && SAVED_SAID.some((said) => haystack.includes(said))) {
    add('G6', 'USE', 'hard', 'saved line', 'told the client the request is saved, and nothing was saved', last.turn);
  }

  return found;
}

// §3.4 · counted violations become a 0–9 sub-score. One hard lands on 6, two on 3, three on 0.
function scoreFindings(findings) {
  const scores = {};
  for (const dim of DIMENSIONS) {
    const mine = findings.filter((f) => f.dims.includes(dim));
    if (mine.some((f) => f.sev === 'fatal')) {
      scores[dim] = 0;
      continue;
    }
    const hard = mine.filter((f) => f.sev === 'hard').length;
    const soft = mine.filter((f) => f.sev === 'soft').length;
    scores[dim] = Math.max(0, Math.round(9 - 3 * hard - 1.5 * soft));
  }
  // NAT is the one dimension no code can see (§3.1). No judge in v1 (BUILD-PLAN D20), so it is null
  // and DerjaScore is renormalised over the 75 weight points that were actually measured.
  scores.NAT = null;
  return scores;
}

function derjaScore(scores) {
  let total = 0;
  let weight = 0;
  for (const dim of DIMENSIONS) {
    if (scores[dim] === null || scores[dim] === undefined) continue;
    total += scores[dim] * WEIGHTS[dim];
    weight += WEIGHTS[dim];
  }
  return weight ? Number((total / weight).toFixed(2)) : null;
}

// The gates (§2.4). They are counts, they are never folded into DerjaScore, and G3 is null because
// D08 does not exist yet — "not measured" must not read as "none found".
// G1 and G2 are RAW gates (§2.4). They are counted on both views and reported side by side: on the
// sent view they are informational, because derja.fix and toLatin have already hidden whatever the
// model wrote, and the gap between the two columns is the point.
function gatesFrom(findings) {
  const gates = { G1: 0, G2: 0, G3: null, G4: 0, G5: 0, G6: 0, G7: 0 };
  for (const f of findings) {
    if (f.sev === 'report') continue;
    if (f.id === 'D01' && f.dims.includes('DIA')) gates.G1 += 1;
    if (f.id === 'D02' || f.id === 'D03') gates.G2 += 1;
    if (f.id === 'D24' || f.id === 'D29') gates.G4 += 1;
    if (f.id === 'D25') gates.G5 += 1;
    if (f.id === 'G6') gates.G6 += 1;
    if (f.id === 'G7') gates.G7 += 1;
  }
  return gates;
}

/**
 * Grade one conversation.
 *   run     { view: 'raw' | 'sent', answers: [{ turn, texts, cards, toolResults, rewrites }] }
 *   kase    one case from bench/cases/*.json
 *   bot     the bot object from lib/bots.js
 *   options { approved: Set<string> }  — the approved lines, for the D20 diagnostic
 */
function grade(run, kase, bot, options = {}) {
  const ctxBase = { foreign: foreignWords(), wrong: wrongWords() };
  const findings = [];
  const history = [];
  const say = kase.say || [];
  const clientSlang = SLANG.some((w) => new RegExp(`(?<![\\p{L}\\d])${w}(?![\\p{L}\\d])`, 'iu').test(say.join(' ')));

  (run.answers || []).forEach((answer, index) => {
    answer.turn = answer.turn ?? index + 1;
    history.push({ role: 'client', text: say[index] ?? '' });
    const language = answer.language || expectedLanguage(history, kase);
    findings.push(...checkAnswer(answer, kase, bot, { ...ctxBase, language, clientSlang }));
    for (const text of answer.texts || []) history.push({ role: 'bot', text });
  });
  findings.push(...checkConversation(run, kase, bot, ctxBase));

  const scores = scoreFindings(findings);
  scores.derjaScore = derjaScore(scores);

  const texts = (run.answers || []).flatMap((a) => a.texts || []);
  const approved = options.approved || new Set();
  const diagnostics = {
    // D15 records both caps, D16 the distributions the library gives no number for (§7).
    messages: (run.answers || []).map((a) => (a.texts || []).length),
    linesPerMessage: texts.map((t) => String(t).split('\n').length),
    charsPerMessage: texts.map((t) => String(t).length),
    questions: (texts.join('\n').match(/\?/g) || []).length,
    // D20 · how much of the answer is the owner's own text. High is safe and not thinking.
    approvedShare: texts.length ? Number((texts.filter((t) => approved.has(String(t).trim())).length / texts.length).toFixed(2)) : 0,
    // D30 · the rewrites reply.js had to ask for. The cheapest single signal that a prompt got better.
    rewrites: (run.answers || []).reduce((sum, a) => sum + (a.rewrites || 0), 0),
    disputed: findings.filter((f) => f.id === 'D01' && f.sev === 'report').map((f) => f.quote),
    fixes: (run.answers || []).flatMap((a) => a.fixes || []),
  };

  return { case: kase.id, bot: bot.slug, kind: kase.kind, knows: kase.knows, view: run.view || 'sent', scores, gates: gatesFrom(findings), findings, diagnostics };
}

// ---------------------------------------------------------------------------------------------------
// self-test · B2, the ceiling (design-benchmark §6)
// Fifteen conversations made only of lines the owner already approved must score at or near 9.
// If they do not, these checks are wrong, not the answers.
// ---------------------------------------------------------------------------------------------------

function loadCases(dir = path.join(ROOT, 'bench', 'cases')) {
  const out = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const kase of Array.isArray(parsed) ? parsed : parsed.cases) out.set(kase.id, kase);
  }
  return out;
}

// The negative control. A ceiling that scores 9 proves nothing on its own — it also scores 9 when
// every check is broken. Each probe below is a string quoted from the audit, from spec-language.md or
// from the design document, paired with the check that must catch it. Nothing here is invented
// Tunisian: the bad lines are bad in the sources too.
const PROBES = [
  { why: 'Moroccan bzaf (09 §1)', say: ['9adech?'], texts: ['El prix bzaf'], expect: ['D01'] },
  { why: 'Standard Arabic in Latin letters (09 §5)', say: ['9adech?'], texts: ['Kam el entretien?'], expect: ['D01'] },
  { why: "ai.js:130's own example of a slipped Arabic letter", say: ['9adech?'], texts: ['kif nجم n3awnek'], expect: ['D02', 'D03'] },
  { why: 'Arabic question mark (11 §4)', say: ['9adech?'], texts: ['Entretien b 45dt؟'], expect: ['D04'] },
  { why: 'anhi — the ❌ form of anahi (§3.3), the root of the four-spellings run', say: ['9adech?'], texts: ['W enti fi anhi quartier'], expect: ['D05'] },
  { why: 'two spellings of chnowa in one conversation (R4)', say: ['9adech?', 'w ba3d?'], turns: [['Chnowa t7eb?'], ['Chnoua el marque mte3ek?']], expect: ['D06'] },
  { why: '8 for غ and sh for ش (01 §1)', say: ['9adech?'], texts: ['Shnowa t7eb 8odwa'], expect: ['D07'] },
  { why: 'a conjugated French verb (voice.md, 13)', say: ['9adech?'], texts: ['Tconfirmi el rendez-vous'], expect: ['D09'] },
  { why: 'a French sentence inside a Derja message (01 §6)', say: ['9adech?'], texts: ['Est-ce que t7eb entretien'], expect: ['D10'] },
  { why: '«~45 dt» — 13: "\'~\' is not understood"', say: ['9adech?'], texts: ['El entretien ~45 dt'], expect: ['D11'] },
  { why: '13: once and monthly in one line (R10)', say: ['9adech?'], texts: ['500dt mara wa7da w 30dt fel chhar'], expect: ['D13'] },
  { why: 'dashboard — 09 §6 says espace admin', say: ['9adech?'], texts: ['El dashboard mte3ek behi'], expect: ['D14'] },
  { why: '4 messages (R12)', say: ['9adech?'], texts: ['Aslema', 'Entretien b 45dt', 'T7eb technicien', 'Ab3athli esmek'], expect: ['D15'] },
  { why: 'two questions in one answer (R11)', say: ['9adech?'], texts: ['Chnowa t7eb?', 'W wa9tech yesle7lek?'], expect: ['D17'] },
  { why: 'an emoji wall outside 😊 👌 🙏 (R13)', say: ['9adech?'], texts: ['Entretien b 45dt 😂😂'], expect: ['D18'] },
  { why: 'the same long sentence sent twice (R14)', say: ['9adech?', 'w 9adech?'], turns: [['Entretien complet lel clim b 45dt: nettoyage filtres w unité extérieure'], ['Entretien complet lel clim b 45dt: nettoyage filtres w unité extérieure']], expect: ['D19'] },
  { why: 'the price the case demands is never said', say: ['9adech el entretien?'], texts: ['Behi, technicien y3ayetlek'], must: ['45dt'], expect: ['D21'] },
  { why: '@unknown fired at a fact that is in the brain file', say: ['9adech el entretien?'], texts: ['Hedhi ma na3refhech bedhabt 🙏'], expect: ['D22'] },
  { why: 'honest, and no next step (R22)', say: ['El bit 20 m²?'], texts: ['Hedhi ma na3refhech bedhabt 🙏'], knows: 'no', expect: ['D23'] },
  { why: 'a price this business does not have (guard.unknownPrice)', say: ['9adech?'], texts: ['El entretien b 999dt'], expect: ['D24'] },
  { why: "08's rejected French, answered to a client writing Derja (R1)", say: ['9adech el entretien?'], texts: ['Nous offrons une large gamme de solutions digitales innovantes pour vous.'], expect: ['D25'] },
  { why: '13: the «Ma3lich» opener (R18)', say: ['9adech?'], texts: ['Ma3lich nfasserlek 😊'], expect: ['D26'] },
  { why: '13: «cabinet-belhadj.com» became a preview of a real company (R16)', say: ['9adech?'], texts: ['Kima cabinet-belhadj.com'], expect: ['D29'] },
  { why: 'told the client it is saved, and nothing was saved (reply.js:137)', say: ['Karim 20 000 101'], texts: ['Mrigel, wsellna talabek 👌'], expect: ['G6'] },
  { why: 'the pipeline threw and the FALLBACK went out (G7)', say: ['9adech?'], texts: ['Sama7ni, ma najjemch njawbek tawa 🙏'], expect: ['G7'] },
];

function probeTest(bot) {
  const grey = (s) => `\x1b[90m${s}\x1b[0m`;
  const green = (s) => `\x1b[32m${s}\x1b[0m`;
  const red = (s) => `\x1b[31m${s}\x1b[0m`;
  console.log(`\nderja-bench  self-test  ·  the probes: ${PROBES.length} known-bad lines, each must be caught`);
  console.log(grey('a ceiling of 9 also happens when every check is broken — this is the other half\n'));

  let failed = 0;
  let total = 0;
  for (const probe of PROBES) {
    const kase = {
      id: 'probe', bot: bot.slug, kind: 'answerable', knows: probe.knows || 'yes', clientLang: 'derja',
      clientDialect: 'tn', say: probe.say, must: probe.must || [], mustAny: [], never: [], card: null, maxMessages: 3,
    };
    const turns = probe.turns || [probe.texts];
    const run = { view: 'sent', answers: turns.map((texts, i) => ({ turn: i + 1, texts, cards: [] })) };
    const result = grade(run, kase, bot);
    // D26/D27/D28 feed NAT, which has no judge in v1, so they are reports. They still have to fire.
    const fired = new Set(result.findings.map((f) => f.id));
    const missing = probe.expect.filter((id) => !fired.has(id));
    const scored = probe.expect.every((id) => id === 'D26' || id === 'D27' || id === 'D28') ? true : result.scores.derjaScore < 9;
    total += result.scores.derjaScore;
    if (missing.length || !scored) {
      failed += 1;
      const line = cut(probe.texts ? probe.texts.join(' / ') : probe.turns.flat().join(' / '), 50);
      console.log(`  ${red('✗')} ${probe.expect.join('+')} ${missing.length ? 'did not fire' : 'fired but cost nothing'} on «${line}» — ${probe.why}`);
    } else {
      console.log(`  ${green('✓')} ${probe.expect.join('+').padEnd(9)} score ${String(result.scores.derjaScore).padEnd(5)} ${grey(probe.why)}`);
    }
  }
  const mean = Number((total / PROBES.length).toFixed(2));
  // One violation costs one dimension three points, so a single-fault probe lands near 8.4, not near 3.
  // That is §3.4 working as written; what matters is that no probe is still sitting on 9.
  console.log(`\n  DerjaScore over the probes: ${mean} ${grey('(one fault, one dimension, -3 — none of them may stay at 9)')}`);
  return failed === 0;
}

function selfTest() {
  const bots = require(path.join(ROOT, 'lib', 'bots.js'));
  const cases = loadCases();
  const ceiling = JSON.parse(fs.readFileSync(path.join(ROOT, 'bench', 'ceiling.json'), 'utf8'));
  const green = (s) => `\x1b[32m${s}\x1b[0m`;
  const red = (s) => `\x1b[31m${s}\x1b[0m`;
  const grey = (s) => `\x1b[90m${s}\x1b[0m`;

  console.log(`derja-bench  self-test  ·  the ceiling: ${ceiling.answers.length} conversations of approved lines`);
  console.log(grey('every dimension must come out at or near 9 — if it does not, the checks are wrong\n'));

  const rows = [];
  const notApproved = [];
  let worst = 9;

  for (const entry of ceiling.answers) {
    const kase = cases.get(entry.case);
    if (!kase) throw new Error(`bench/ceiling.json names a case that does not exist: ${entry.case}`);
    const bot = bots.get(kase.bot);
    const approved = approvedTexts(bot);
    for (const turn of entry.turns) for (const text of turn.texts) if (!approved.has(text.trim())) notApproved.push([entry.case, text]);

    const run = { view: 'sent', answers: entry.turns.map((t, i) => ({ turn: i + 1, texts: t.texts, cards: t.cards || [] })) };
    const result = grade(run, kase, bot, { approved });
    const scored = DIMENSIONS.filter((d) => result.scores[d] !== null);
    const low = Math.min(...scored.map((d) => result.scores[d]));
    worst = Math.min(worst, low);
    rows.push({ id: entry.case, result, low, scored });
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(grey(`  ${pad('case', 11)} ${DIMENSIONS.filter((d) => d !== 'NAT').map((d) => pad(d, 4)).join('')} score  gates`));
  for (const { id, result, low } of rows) {
    const cells = DIMENSIONS.filter((d) => d !== 'NAT').map((d) => pad(result.scores[d], 4)).join('');
    const gates = GATE_IDS.filter((g) => result.gates[g]).join(',') || '-';
    const mark = low >= 8 ? green('✓') : red('✗');
    console.log(`  ${mark} ${pad(id, 9)} ${cells} ${pad(result.scores.derjaScore, 6)} ${gates}`);
    if (low < 9) {
      for (const f of result.findings.filter((x) => x.sev !== 'report')) {
        console.log(red(`        ${f.id} ${f.dims.join('+')} ${f.sev}: «${f.quote}» — ${f.note}`));
      }
    }
  }

  const mean = Number((rows.reduce((s, r) => s + r.result.scores.derjaScore, 0) / rows.length).toFixed(2));
  const gateTotal = rows.reduce((s, r) => s + GATE_IDS.reduce((g, id) => g + (r.result.gates[id] || 0), 0), 0);
  console.log(`\n  DerjaScore over the ceiling: ${mean}   lowest single dimension: ${worst}   gate failures: ${gateTotal}`);

  const reports = rows.flatMap((r) => r.result.findings.filter((f) => f.sev === 'report'));
  if (reports.length) {
    console.log(grey(`\n  reported, never scored (${reports.length}):`));
    for (const f of reports) console.log(grey(`    ${f.id} «${f.quote}» — ${f.note}`));
  }
  if (notApproved.length) {
    console.log(grey(`\n  lines in bench/ceiling.json that are NOT an approved line word for word (${notApproved.length}):`));
    for (const [id, text] of notApproved) console.log(grey(`    ${id}: «${cut(text, 70)}»`));
    console.log(grey('    (the catalogue prices and the three gaps listed in bench/ceiling.json — no agent wrote Tunisian)'));
  }

  const ceilingOk = worst >= 8 && mean >= 8.5 && gateTotal === 0;
  console.log(ceilingOk ? green('\n  PASS — the ceiling scores at the ceiling.') : red('\n  FAIL — fix the checks, not the answers.'));

  const probesOk = probeTest(bots.get('clim-express'));
  console.log(probesOk ? green('\n  PASS — every check fires on the line it exists for.\n') : red('\n  FAIL — a check is dead.\n'));
  return ceilingOk && probesOk ? 0 : 1;
}

module.exports = {
  grade,
  checkAnswer,
  checkConversation,
  scoreFindings,
  derjaScore,
  gatesFrom,
  approvedTexts,
  expectedLanguage,
  loadCases,
  DIMENSIONS,
  WEIGHTS,
  GATE_IDS,
};

if (require.main === module) {
  const what = process.argv[2] || 'self-test';
  if (what !== 'self-test' && what !== '--self-test') {
    console.log('usage: node tools/bench-checks.js self-test');
    process.exit(2);
  }
  process.exit(selfTest());
}
