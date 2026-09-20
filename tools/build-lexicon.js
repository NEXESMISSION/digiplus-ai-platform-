// Builds data/lexicon.json: every Latin word an assistant is allowed to write, parsed out of the files
// that already hold the owner's approved Tunisian. Nothing is typed by hand here — a word that is in no
// source is not a word (D24: no agent invents Tunisian).
//
// The library lives outside the repo, in Desktop/digiplus/tunisian-library, and vercel.json bundles only
// {brain,data}/** — the runtime can never read it. So the lexicon is built here, offline, and the result
// is committed (D21). Every file read is listed with its sha256: edit the library and the next build
// rewrites those hashes, so drift shows up in a diff instead of a lexicon that has quietly gone stale.
// With no source change the build is byte-identical, so a diff always means something moved.
//
//   node tools/build-lexicon.js               → rebuild data/lexicon.json and print the counts
//   node tools/build-lexicon.js --nearest X   → the closest entry to a word (for the unknown-word queue)
//   node tools/build-lexicon.js --review [f]  → every word of the watch queue next to its nearest entry
//
// The two sources outside the repo move with DIGIPLUS_LIBRARY and DIGIPLUS_SPEC_LANGUAGE.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'lexicon.json');
const LIBRARY = process.env.DIGIPLUS_LIBRARY || path.join(ROOT, '..', 'digiplus', 'tunisian-library');
// The French keep-list is written down in one place only, and that place is a spec, not the repo.
const SPEC_LANGUAGE =
  process.env.DIGIPLUS_SPEC_LANGUAGE ||
  path.join(
    process.env.TEMP || path.join(ROOT, '..'),
    'claude',
    'C--Users-Med-Saief-Allah-Desktop-digiplus',
    '6a11f35f-052d-42b7-9890-7fc5f21bb975',
    'scratchpad',
    'spec-language.md'
  );
// The unknown-word queue is a plain file for now: the store table and the /admin screen were cut from
// this work item because another session owns lib/store.js and api/admin.js.
// One word per line, or "slug<TAB>word<TAB>the sentence it appeared in".
const QUEUE = path.join(ROOT, 'data', 'unknown-words.tsv');

// Names, brands and places. They are not Tunisian words, so they are in no library table, but an
// assistant writes them every day and the validator must not call them invented.
const PROPER_NOUNS =
  'Sfax · Sakiet Ezzit · Sakiet Eddaier · El Ain · Thyna · Gremda · Chihia · Yasmine · Nour · ' +
  'D17 · Flouci · BTU · Samsung · DigiPlus · WhatsApp · Instagram · Messenger';

// ---------------------------------------------------------------- words

// A word the way these files write one: Latin letters and the Arabizi digits, which sit anywhere in the
// word ("3andek", "9adech", "5edma"). Accents stay ("réparation"); the apostrophe cuts ("l'avance" →
// avance) and a hyphenated form is kept whole and in pieces, so either tokenizer finds it.
const WORD = /[a-zà-öø-ÿ0-9]+(?:-[a-zà-öø-ÿ0-9]+)*/g;
// Prices, sizes and clock times are not words: the validator exempts anything starting with a digit, and
// they would bury the lexicon under "45dt", "9000", "12h30". The unit list is short on purpose — "3la"
// and "3id" are words, "3m" is three metres.
const NUMBERISH = /^\d+(?:[.,:/h]\d+)*(?:dt|dh|h|kg|g|km|cm|mm|m|min|mn|ml|cl|l|%|e|er|eme|ème|pers)?$/;

function wordsIn(text) {
  const found = [];
  for (const match of String(text || '').toLowerCase().match(WORD) || []) {
    for (const token of match.includes('-') ? [match, ...match.split('-')] : [match]) {
      if (!token || NUMBERISH.test(token)) continue;
      if (!/[a-zà-öø-ÿ]/.test(token)) continue; // a bare number, or a piece of one
      found.push(token);
    }
  }
  return found;
}

// ---------------------------------------------------------------- reading

const sources = [];
const hashed = new Set();

// Reads a source and records its sha256. A missing source is recorded too, and loudly: a lexicon that
// has silently lost a source is worse than one that is late.
function read(file, name) {
  let text = null;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    console.warn(`! missing source: ${name} (${file})`);
  }
  if (!hashed.has(name)) {
    hashed.add(name);
    sources.push(
      text === null ? { file: name, missing: true } : { file: name, sha256: crypto.createHash('sha256').update(text).digest('hex') }
    );
  }
  return text;
}

const label = (file) => {
  const inside = path.relative(ROOT, file);
  return inside.startsWith('..') ? file : inside.split(path.sep).join('/');
};
const listMd = (dir) => {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  } catch {
    return [];
  }
};
// The gloss of a word is in brackets ("t3ayetlek (calls you)", "5dem (to work)") — English, every time.
const withoutGloss = (text) => text.replace(/\([^)]*\)/g, ' ');

// ---------------------------------------------------------------- the library's tables

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

// A markdown table: a header row, the |---|---| row, then rows until something that is not a row.
function tablesIn(text) {
  const lines = text.split(/\r?\n/);
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].trim().startsWith('|') || !/^\|?\s*:?-{2,}/.test(lines[i + 1].trim())) continue;
    const headers = splitRow(lines[i]).map((header) => header.toLowerCase());
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(splitRow(lines[j]));
    tables.push({ headers, rows });
    i = j - 1;
  }
  return tables;
}

// The trap column is never a source: it holds Moroccan, Algerian and textbook Arabic on purpose. Its
// words go to `forbidden` instead.
const isTrapColumn = (header) =>
  header.includes('❌') || ['avoid', 'not (standard arabic / other)', 'why it failed'].includes(header);
// The English (or Arabic-script) side of a table. Nothing to learn there, and its English would teach the
// lexicon that "customer" is a word an assistant may write.
const GLOSS_COLUMNS = new Set([
  'arabic', 'arabic script', 'english', 'meaning', 'meaning / when', 'means', 'when', 'why', 'note',
  'risk', 'register', 'conf.', 'dialect', 'status', 'file', "what's inside", '#', 'case', 'situation',
]);
// The Tunisian columns, as they are spelled today. A header that is in none of the three lists is still
// read — losing a column of approved Derja costs more than a few English words — but it is printed,
// because a new column is a column this parser has never been checked against.
const TUNISIAN_COLUMNS = new Set([
  'arabizi', 'tunisian', 'word', 'term', 'use', 'example', 'client example', 'tunisian example', 'tunisian examples',
  'explain to a client', 'client says', 'said', 'offer', 'message', 'condition', 'house style', 'write',
  'say / write', '✅', '✅ use', '✅ say', '✅ write', '✅ write instead', '✅ tunisian', '✅ rule',
  'also seen (ok to understand)', 'to a man', 'to a woman', 'to a group',
  'verb (meaning)', 'ena', 'enta / enti', 'houwa', 'a7na', 'entouma', 'past: ena', 'past: a7na',
  'imperative (one / group)',
]);

// A trap column holds one of two things. In 01 §2 or 09 §1 it is a list of words never to write — those
// are words, and they are denied. In 10 and 13 it is whole lines that failed for the way they were
// phrased: "el site yb9a working" is there for the English, and denying it word by word would lose
// "yb9a", which the next table calls correct. Short cells are words, long cells are sentences.
const looksLikeWordList = (cells) => {
  const counts = cells.map((cell) => wordsIn(withoutGloss(cell)).length).filter((n) => n > 0);
  return !counts.length || counts.reduce((sum, n) => sum + n, 0) / counts.length <= 2.5;
};

// Two files keep their Tunisian in fenced blocks and not in tables: 07 is one ready chat per concept,
// 08 is 50 ready replies and has no table at all. Read only by their tables they contribute two words
// between them, and every word the owner wrote there — "ma7loula", "yhemmek", "sma3t" — comes back as a
// watch row later, which is the queue this whole design is trying to keep short.
// A block is read only when nothing around it says the opposite: 09 §8 is a fenced blacklist of
// Moroccan and Egyptian, and reading that one would teach the lexicon "bzaf". So the heading above the
// block and the line just before it must both be clean — in 07 and 08 the warning ("Don't say:",
// "Avoid: …") always sits *after* the block, so it never hides one that is good.
const TRAP_CONTEXT = /❌|never|don'?t|do not|blacklist|avoid|wrong|mistake|jamais/i;
// 07's two prose bullets above each ready chat — "- **Simply:** …" and "- **Like:** …" — are Tunisian
// too and hold ~50 words no table has ("ma7loula", "yetchaf", "tsayyer"). They are deliberately NOT
// read: their comparisons reach for one business to explain another ("kima entretien mte3 el karhba",
// 07:95), and one trade's French noun in the shared list is a word every assistant may then write
// unnoticed — which is the leave-one-brain-out guarantee the watch queue is built on. Those words come
// back through the queue instead, once, into the brain file of the business that needs them.

function fencedIn(text) {
  const blocks = [];
  let heading = '';
  let before = ''; // the last line before the fence: in 07 it is the "- **Like:** …" of that concept
  let block = null; // the lines being read, null between blocks
  let keep = true;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('```')) {
      if (block) {
        if (keep) blocks.push(block.join('\n'));
        block = null;
        before = ''; // the next block is judged by its own heading, not by this one's last line
      } else {
        keep = !TRAP_CONTEXT.test(`${heading} ${before} ${line}`);
        block = [];
      }
      continue;
    }
    if (block) block.push(raw);
    else if (line) before = line;
    if (!block && line.startsWith('#')) heading = line;
  }
  return blocks;
}

function fromLibrary(add, deny) {
  const files = listMd(LIBRARY).filter((f) => f !== 'README.md'); // the README is an index, not Tunisian
  if (files.length !== 14) console.warn(`! the library has ${files.length} files, not the 14 it had when this was written`);
  const strangers = new Set();
  for (const name of files) {
    const text = read(path.join(LIBRARY, name), `tunisian-library/${name}`);
    if (text === null) continue;
    for (const block of fencedIn(text)) add(`tunisian-library/${name}`, block);
    for (const { headers, rows } of tablesIn(text)) {
      for (const header of headers) if (!isTrapColumn(header) && !GLOSS_COLUMNS.has(header) && !TUNISIAN_COLUMNS.has(header)) strangers.add(`${name}: ${header}`);
      const denies = headers.map((header, column) => isTrapColumn(header) && looksLikeWordList(rows.map((row) => row[column] || '')));
      for (const row of rows) {
        row.forEach((cell, column) => {
          const header = headers[column] || '';
          if (isTrapColumn(header)) return denies[column] ? deny(cell) : undefined;
          if (cell.includes('❌')) return wordsIn(cell).length <= 3 ? deny(cell) : undefined; // the trap can sit inside a cell too
          if (GLOSS_COLUMNS.has(header)) return;
          add(`tunisian-library/${name}`, withoutGloss(cell));
        });
      }
    }
  }
  if (strangers.size) console.warn(`! table columns this parser has not seen before: ${[...strangers].join(' · ')}`);
}

// ---------------------------------------------------------------- the brain files

// An approved line is "Derja: …" and may run over several indented lines up to its "French:" twin. Those
// continuations carry words nothing else has ("yetna7a", "n2akkedlek"), so they count too.
function derjaLines(text) {
  const lines = [];
  let inside = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^Derja\s*:/i.test(line)) {
      inside = true;
      lines.push(line.replace(/^Derja\s*:/i, ''));
    } else if (inside && raw.startsWith(' ') && line && !/^French\s*:/i.test(line)) {
      lines.push(line);
    } else {
      inside = false;
    }
  }
  return lines;
}

const section = (text, heading) => {
  const match = text.match(new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, 'm'));
  return match ? match[1] : '';
};

function fromBrain(add, deny) {
  for (const name of listMd(path.join(ROOT, 'brain'))) {
    const slug = name.replace(/\.md$/, '');
    const file = path.join(ROOT, 'brain', name);
    const text = read(file, label(file));
    if (text === null) continue;
    // voice.md is how every assistant talks, so its words belong to all of them; a business's brain file
    // belongs to that business alone (a new assistant must not inherit the pâtisserie's vocabulary).
    const owner = slug === 'voice' ? null : slug;
    for (const line of derjaLines(text)) add(label(file), line, owner);
    // What the owner adds after reading the watch queue (design-validator §7.3). Empty in every brain
    // file today; the weekly loop needs it to work the day it is not.
    add(label(file), withoutGloss(section(text, 'Words')), owner);
    if (slug === 'voice') fromVoiceLists(text, add, deny, label(file));
  }
}

// voice.md holds two lists no other file has: "Words and phrases to use", which is the core of the
// lexicon, and "Never write these … → write this instead", where only the right of the arrow is Tunisian
// — the left is mumkin, bzaf, daba, hada. Reading that block whole would put the traps in the lexicon.
function fromVoiceLists(text, add, deny, from) {
  const use = text.match(/^Words and phrases to use:$([\s\S]*?)^\s*$/m);
  if (use) add(from, withoutGloss(use[1]));
  const never = text.match(/^Never write these[^\n]*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/m);
  if (!never) return console.warn('! brain/voice.md: the "Never write these" block moved — check what this parser is reading');
  for (const line of never[1].split(/\r?\n/)) {
    if (!line.trim().startsWith('-')) continue;
    // Several pairs can share a line, separated by a run of spaces:
    //   "- baad / b3d → ba3d        hne / hna / hnaya → houni"
    for (const pair of line.replace(/^\s*-\s*/, '').split(/\s{2,}/)) {
      const arrow = pair.indexOf('→');
      if (arrow < 0) continue; // prose inside the block, and the prose there quotes the traps
      deny(pair.slice(0, arrow));
      add(from, withoutGloss(pair.slice(arrow + 1)));
    }
  }
}

// ---------------------------------------------------------------- the catalogues and the chat pages

// Every string in a catalogue: the product names, the option labels, the categories, and the
// descriptions the model reads in its prompt and quotes back. Skips what this tool generates, and
// language.json above all — half of that file is the deny list.
const GENERATED = new Set(['lexicon.json', 'language.json']);

function fromCatalogues(add) {
  const dir = path.join(ROOT, 'data');
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !GENERATED.has(f)).sort()) {
    const text = read(path.join(dir, name), `data/${name}`);
    if (text === null) continue;
    const strings = [];
    JSON.parse(text, (key, value) => {
      if (typeof value === 'string') strings.push(value);
      return value;
    });
    add(`data/${name}`, strings.join(' '), name.replace(/\.json$/, ''));
  }
}

// How clients write a product ("gato", "ba9lewa") and what the catalogue calls it. lib/catalog.js does
// not export ALIASES, so the object literal is parsed out of the source — a copy here would be one more
// thing to keep in step.
function fromAliases(add) {
  const file = path.join(ROOT, 'lib', 'catalog.js');
  const text = read(file, label(file));
  if (text === null) return;
  const aliases = text.match(/const ALIASES = \{([\s\S]*?)\n\};/);
  if (!aliases) return console.warn('! lib/catalog.js: no ALIASES object — the lexicon is missing the words clients use for a product');
  add(label(file), aliases[1].replace(/'/g, ' '));
}

// The first two messages and the suggested questions of each chat page (design-validator §7.3 counts
// welcome and starters in the lexicon). They are owner-approved Derja that exists nowhere else.
function fromBots(add) {
  const file = path.join(ROOT, 'lib', 'bots.js');
  if (read(file, label(file)) === null) return;
  for (const bot of require(file).all()) add(label(file), [...(bot.welcome || []), ...(bot.starters || [])].join(' '), bot.slug);
}

// ---------------------------------------------------------------- the French keep-list

// spec-language §4: the French nouns that stay French, the fillers, and the "✅ Say" column of the stiff
// table. Never §4.2's conjugated French verbs, never the "❌ Stiff" column.
function fromSpecLanguage(add) {
  const text = read(SPEC_LANGUAGE, 'spec-language.md');
  if (text === null) return false;
  const french = text.match(/^# 4\. FRENCH WORDS THAT STAY FRENCH$([\s\S]*?)(?=^# \d)/m);
  if (!french) {
    console.warn('! spec-language.md: section 4 moved — the lexicon is missing the French keep-list');
    return false;
  }
  for (const raw of french[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('|')) {
      const cells = splitRow(line);
      if (cells.length >= 2 && !cells[1].includes('❌')) add('spec-language.md', cells[1]); // the ✅ Say column
      continue;
    }
    if (line.includes('❌') || /^(##|\*\*The rule|Marketer jargon)/.test(line)) continue;
    add('spec-language.md', withoutGloss(line.replace(/^✅\s*/, '')));
  }
  return true;
}

// ---------------------------------------------------------------- the nearest entry

// Strip the clitics the model bolts onto a verb, so a mangled word lands next to the verb it mangled and
// not next to some short unrelated one: nfazzellek → fazzel, nfasserlek → fasser, three edits apart,
// while the written forms are ten letters each and further from each other than that.
const stem = (word) =>
  word
    .replace(/ch$/, '')
    .replace(/(lek|ek|na|ha|hom)$/, '')
    .replace(/^[nty]/, '');

function distance(a, b) {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[b.length];
}

let cached = null;
const load = () => (cached ??= JSON.parse(fs.readFileSync(OUT, 'utf8')));

// The closest entry to a word, counted twice: stripped of its clitics, which finds the verb the model
// was reaching for, and as written, which keeps the clitics honest. Stripped alone would answer
// "nfazzellek" with "mazel" (two edits from "fazzel", and nothing at all like the word); as written
// alone would answer it with any ten-letter word. The two together give "nfasserlek". Ties go to the
// shorter word, then to the alphabet, so the answer never depends on the order the sources were read.
const firstDifference = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};

function nearest(word, slug) {
  const lexicon = load();
  const target = String(word || '').toLowerCase();
  const targetStem = stem(target);
  let best = null;
  for (const entry of [...lexicon.words, ...(lexicon.bots[slug] || [])]) {
    if (entry === target) return { word: entry, distance: 0 };
    const written = distance(target, entry);
    const score = [distance(targetStem, stem(entry)) + written, written, entry.length, entry];
    if (!best || firstDifference(score, best.score) < 0) best = { word: entry, distance: written, score };
  }
  return best && { word: best.word, distance: best.distance };
}

// ---------------------------------------------------------------- building

function build() {
  sources.length = 0; // a second build in the same process starts from an empty source list
  hashed.clear();
  const shared = new Set();
  const bots = new Map();
  const forbidden = new Set();
  const approved = new Set(); // everything that is not the library: the owner wrote it, so it wins
  const counts = new Map();

  const add = (from, text, slug) => {
    const target = slug ? bots.get(slug) || bots.set(slug, new Set()).get(slug) : shared;
    for (const word of wordsIn(text)) {
      if (!from.startsWith('tunisian-library/')) approved.add(word);
      if (target.has(word)) continue;
      target.add(word);
      counts.set(from, (counts.get(from) || 0) + 1);
    }
  };
  // "hada / hadi" is two words never to write; "yalla bina" is one phrasing never to write, and a
  // phrasing is not the lexicon's business — "yalla" on its own is normal Tunisian (09 §1). So a trap
  // counts as a word only where it is written as one.
  const deny = (text) => {
    for (const piece of withoutGloss(text).split(/[/,;·]/)) {
      const words = (piece.toLowerCase().match(WORD) || []).filter((word) => !NUMBERISH.test(word) && /[a-zà-öø-ÿ]/.test(word));
      if (words.length === 1) forbidden.add(words[0]);
    }
  };

  fromLibrary(add, deny);
  fromBrain(add, deny);
  fromCatalogues(add);
  fromAliases(add);
  fromBots(add);
  const hasSpec = fromSpecLanguage(add);
  add('proper nouns', PROPER_NOUNS);

  // An example cell in the library can quote a trap ("hada" inside a sentence), and the library's own
  // trap columns are the authority on what a trap is. Everywhere else the owner is the authority, so a
  // word they write stays even when a table lists it as one to avoid.
  const dropped = [];
  for (const word of forbidden) {
    if (approved.has(word)) continue;
    if (shared.delete(word)) dropped.push(word);
  }

  // The French keep-list lives in a spec outside the repo. When it is out of reach, keep what is already
  // committed rather than shipping a lexicon that has quietly lost its French.
  if (!hasSpec && fs.existsSync(OUT)) {
    const previous = load();
    let kept = 0;
    for (const word of previous.words) {
      if (shared.has(word) || forbidden.has(word)) continue;
      shared.add(word);
      kept++;
    }
    const before = (previous.sources || []).find((source) => source.file === 'spec-language.md');
    const index = sources.findIndex((source) => source.file === 'spec-language.md');
    if (before && index >= 0) sources[index] = { ...before, carried: true };
    console.warn(`! spec-language.md out of reach: carried ${kept} word(s) over from the committed lexicon`);
  }

  const sorted = (set) => [...set].sort();
  const lexicon = {
    note: 'Generated by tools/build-lexicon.js — never edited by hand. Rebuild it after touching the library, a brain file or a catalogue.',
    reading:
      'The words one assistant may write are words + bots[slug]. Lowercase; a word can start with an Arabizi digit (3andek); prices and clock times (45dt, 12h30) are not words, and the validator exempts anything starting with a digit.',
    traps: "What the library's trap columns hold, minus everything the owner approved. This is not the deny list — data/language.json is.",
    counts: {
      words: shared.size,
      bots: Object.fromEntries([...bots].sort().map(([slug, set]) => [slug, set.size])),
      forbidden: forbidden.size,
    },
    sources: sources.slice().sort((a, b) => a.file.localeCompare(b.file)),
    words: sorted(shared),
    bots: Object.fromEntries([...bots].sort().map(([slug, set]) => [slug, sorted(set)])),
    forbidden: sorted(forbidden),
  };
  return { lexicon, counts, dropped };
}

// ---------------------------------------------------------------- the watch queue

// Reviewing the queue is the weekly job of design-validator §7.3: each word is either Tunisian, and goes
// into the "## Words" section of that bot's brain file, or it is not, and goes into the deny list. The
// nearest entry is what makes the second answer obvious — "nfazzellek" next to "nfasserlek".
function review(file) {
  if (!fs.existsSync(file)) return console.log(`No queue yet: ${label(file)} does not exist.`);
  const lexicon = load();
  const done = new Set();
  let open = 0;
  for (const row of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!row.trim() || row.startsWith('#')) continue;
    const cells = row.split('\t');
    const slug = cells.length > 1 ? cells[0].trim() : '';
    const word = (cells.length > 1 ? cells[1] : cells[0]).trim().toLowerCase();
    if (!word || done.has(`${slug}\0${word}`)) continue;
    done.add(`${slug}\0${word}`);
    if (lexicon.words.includes(word) || (lexicon.bots[slug] || []).includes(word)) continue; // already answered
    open++;
    const close = nearest(word, slug);
    console.log(`${(slug || '—').padEnd(16)} ${word.padEnd(20)} nearest: ${close.word} (${close.distance})`);
  }
  console.log(`\n${open} word(s) still to answer, out of ${done.size} in ${label(file)}.`);
}

// ---------------------------------------------------------------- cli

if (require.main === module) {
  const [flag, value] = process.argv.slice(2);
  if (flag === '--nearest') {
    if (!value) {
      console.error('Usage: node tools/build-lexicon.js --nearest <word>');
      process.exit(1);
    }
    const close = nearest(value.toLowerCase());
    console.log(`${value} → ${close.word} (${close.distance} edit${close.distance === 1 ? '' : 's'})`);
  } else if (flag === '--review') {
    review(value ? path.resolve(value) : QUEUE);
  } else {
    const { lexicon, counts, dropped } = build();
    // Overwriting a good lexicon with one built from nothing is the drift D21 is about. Say where the
    // library is and change nothing.
    if (!lexicon.sources.some((source) => source.file.startsWith('tunisian-library/') && !source.missing)) {
      console.error(`\nNo library at ${LIBRARY}. Set DIGIPLUS_LIBRARY to where it is; ${label(OUT)} is untouched.`);
      process.exit(1);
    }
    fs.writeFileSync(OUT, `${JSON.stringify(lexicon, null, 2)}\n`);
    cached = null; // whatever nearest() read before the rebuild is now a version behind
    for (const source of lexicon.sources) console.log(`  ${source.file.padEnd(42)} ${source.missing ? 'MISSING' : `+${counts.get(source.file) || 0}`}`);
    console.log(`  ${'proper nouns'.padEnd(42)} +${counts.get('proper nouns') || 0}`);
    if (dropped.length) console.log(`\n  dropped, they are in a trap column: ${dropped.join(' ')}`);
    const perBot = Object.entries(lexicon.counts.bots).map(([slug, size]) => `${slug} +${size}`).join(' · ');
    console.log(`\n${label(OUT)}: ${lexicon.counts.words} words, ${perBot}, ${lexicon.counts.forbidden} forbidden.`);
  }
}

module.exports = { nearest, stem, distance, wordsIn, build };
