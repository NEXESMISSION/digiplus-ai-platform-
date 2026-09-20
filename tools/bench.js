// derja-bench — the quality instrument (design-benchmark.md §4).
//
//   npm run bench -- run     --tag baseline-lite --repeats 3 --live   deterministic, PAYS for OpenAI
//   npm run bench -- run     --tag smoke --repeats 1 --only clim-express --dry-run   free, no API
//   npm run bench -- compare baseline-lite after-voice-rewrite
//   npm run bench -- review  baseline-lite
//   npm run bench -- lexicon baseline-lite
//
// `npm run exam` is the contract and must stay green. This is the number that must go up. It drives the
// real pipeline — reply.send, not ai.complete — because half the language behaviour is lines.expand,
// derja.fix, repeat.problems, guard.problems and the rewrite loop (§4.2).
//
// Three things it records that the exam cannot see:
//   · every answer is scored TWICE, on the raw model output and on what the client got. DIA(raw) minus
//     DIA(sent) is exactly how much work lib/derja.js is doing, and whether prompt work is improving the
//     model or hiding behind the swap list (§3.2).
//   · rewrites per 100 answers (D30). Every rewrite is a case the model got wrong first try, at the cost
//     of a second full prompt. It needs no grader and it is the cheapest signal that a prompt got better.
//   · a sha256 of the case set and of every file the answer path reads at runtime — the brain, the
//     three data files and the whole require graph of lib/reply.js, lib/validate.js included — so a
//     run always says what exactly was measured. hashes() is the list, and says what it leaves out.
//
// One departure from §4.3: checks.jsonl carries one row per (case, repeat, VIEW) rather than per answer.
// Half the checks — variant collisions, cross-answer repetition, must/never — only exist across a whole
// conversation, so a per-answer row would have nowhere to put them. Each finding names its own turn.
//
// WI-0.1 has landed: tools/bench-store.js (the memory store) and ai.setTrace (the trace sink) both exist
// now. An unfinished dependency is no longer what stops a run, so two guards say so out loud instead:
//   · the memory store must be wired, or `run` refuses — 58 messages × 3 repeats would hit PER_HOUR = 40
//     (reply.js:19) at message 41, need Supabase, and drop 120 fake conversations into the owner's inbox;
//   · `run` refuses without --live, because it spends money. A reviewer ran it by accident the week the
//     store landed and paid for it. The estimated cost is printed before the first call, either way.
// Without the trace sink the raw model output cannot be recovered, so a run records rawAvailable: false
// and scores the sent view only. It still runs; it just measures half of what it should.
require('../lib/no-image-api');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
// Read before .env is loaded: opting in to a paid run is a decision taken on the command line, never one
// left lying in a file on disk that the next person does not know is there.
const BENCH_LIVE_ENV = process.env.BENCH_LIVE === '1';
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

const checks = require('./bench-checks');

const BENCH = path.join(ROOT, 'bench');
// BENCH_RUNS moves the output elsewhere — used to check the writer offline, and useful for keeping a
// throwaway run out of git. The baselines themselves are committed (§6).
const RUNS = process.env.BENCH_RUNS ? path.resolve(process.env.BENCH_RUNS) : path.join(BENCH, 'runs');
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const grey = (s) => `\x1b[90m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// The clock is pinned so Yasmine's free times are the same next year: bot.booking.daysAhead is 14 and
// noticeHours 3, so freeSlots moves every hour (§4.2). Chosen as a Tuesday morning, when every bot is
// open and the "technician calls today" branch of lib/bots.js is the one taken.
const DEFAULT_NOW = '2026-09-22T09:00:00+01:00';

// ---------------------------------------------------------------------------------------------------
// run.json · what exactly was measured
// ---------------------------------------------------------------------------------------------------

const sha256 = (buffer) => `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
const hashFile = (rel) => {
  try {
    return sha256(fs.readFileSync(path.join(ROOT, rel)));
  } catch {
    return null;
  }
};

// Everything reply.send reads at runtime, because a hash list that misses a file lets two runs either
// side of a change to it look identical, which is the one thing this block exists to prevent. The list
// is the require graph of lib/reply.js, not a memory of it — re-derive it from the repo root after
// adding a require, and add whatever is new here:
//   BENCH_STORE=memory node -e "require('./lib/reply');console.log(Object.keys(require.cache)
//     .filter((f)=>!f.includes('node_modules')).join('\n'))"
//
// Two things this list deliberately does not cover, and a reader should know which. The installed
// packages: the model SDK lives in node_modules and no hash here touches it (run.json records the
// model id, the node version and the git sha instead). And tools/bench-checks.js, the grader: this
// list answers "what was measured", not "what did the measuring".
function hashes() {
  const files = [
    // The prompt and the approved lines are the same files: lines.js parses the blocks out of them.
    ...fs.readdirSync(path.join(ROOT, 'brain')).filter((f) => f.endsWith('.md')).map((f) => `brain/${f}`),
    'data/patisserie-nour.json', // the prices and the products an answer quotes
    'data/language.json', // validate.js's deny list — the only words it ever acts on
    'data/lexicon.json', // written by tools/build-lexicon.js (WI-2.4); null until it exists
    'lib/reply.js',
    'lib/ai.js',
    // validate.js does what derja.fix used to do and moves the score more than anything else in this
    // list; while it was missing a rewrite of the whole layer could read as no change at all.
    'lib/validate.js',
    'lib/derja.js',
    'lib/lines.js',
    'lib/guard.js',
    'lib/repeat.js', // repeat.problems: one of the checks that spend the rewrite
    'lib/bots.js',
    'lib/catalog.js', // every price in an answer comes from here, never from the model
    'lib/tools.js', // the tool rounds, and the cards the client sees
    'lib/schedule.js', // free times and dates: the reason the clock is pinned at all
    'lib/no-image-api.js', // it replaces global fetch, so every model call goes through it
    // History is half of what the model answers to. A run uses the memory store; lib/store.js is
    // hashed anyway because it is the file that decides which store that is.
    'lib/store.js',
    'tools/bench-store.js',
  ];
  return Object.fromEntries(files.map((f) => [f, hashFile(f)]).filter(([, h]) => h));
}

function gitState() {
  const { execFileSync } = require('child_process');
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  try {
    return { sha: git('rev-parse', '--short', 'HEAD'), dirty: git('status', '--porcelain').length > 0 };
  } catch {
    return { sha: null, dirty: null };
  }
}

// ---------------------------------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------------------------------

function loadCaseSet(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const cases = [];
  const raw = [];
  let version = null;
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    raw.push(text);
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed.cases;
    if (!Array.isArray(parsed) && parsed.version != null) version = parsed.version;
    for (const kase of list) cases.push(kase);
  }
  const ids = new Set();
  for (const kase of cases) {
    if (ids.has(kase.id)) throw new Error(`two cases share the id ${kase.id} — the comparison joins runs on it`);
    ids.add(kase.id);
    if (!kase.knows) throw new Error(`${kase.id} has no "knows": the grader cannot tell honest ignorance from evasion`);
    if (!Array.isArray(kase.say) || !kase.say.length) throw new Error(`${kase.id} has no "say"`);
  }
  return { cases, version, hash: sha256(raw.join('\n')) };
}

const matches = (kase, only) =>
  !only || kase.bot === only || kase.kind === only || kase.id === only || kase.id.startsWith(only);

// ---------------------------------------------------------------------------------------------------
// Driving the real pipeline
// ---------------------------------------------------------------------------------------------------

// reply.js calls new Date() itself (reply.js:71), so the only way to pin the clock without editing lib/
// is to replace the constructor for the length of the run. Statics come along with `extends`.
function pinClock(iso) {
  const fixed = Date.parse(iso);
  if (Number.isNaN(fixed)) throw new Error(`--now is not a date: ${iso}`);
  const Real = Date;
  class Pinned extends Real {
    constructor(...args) {
      super(...(args.length ? args : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = Pinned;
  return () => {
    globalThis.Date = Real;
  };
}

// reply.js says out loud what it had to repair — "rewriting a reply", "Tunisian fixes", "still wrong
// after rewrite", "unknown approved line". That log is the only way to count D30 without editing lib/,
// and it hands us the derja.fix list for answers.jsonl at the same time.
function captureLog() {
  const real = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.map(String).join(' '));
  };
  return () => {
    console.log = real;
    return lines;
  };
}

const after = (line, marker) => line.slice(line.indexOf(marker) + marker.length).trim();

function readLog(lines) {
  const out = { rewrites: 0, issues: [], fixes: [], stillWrong: false, unknownLines: [] };
  for (const line of lines) {
    if (line.includes('rewriting a reply:')) {
      out.rewrites += 1;
      out.issues.push(after(line, 'rewriting a reply:'));
    } else if (line.includes('Tunisian fixes:')) {
      out.fixes.push(...after(line, 'Tunisian fixes:').split(', ').filter(Boolean));
    } else if (line.includes('still wrong after rewrite:')) {
      out.stillWrong = true;
      out.issues.push(after(line, 'still wrong after rewrite:'));
    } else if (line.includes('unknown approved line')) {
      out.unknownLines.push(after(line, 'unknown approved line'));
    }
  }
  return out;
}

// ai.parseObject is not exported; this is the same two-step read, for the raw view only.
function parseObject(raw) {
  const text = String(raw || '');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {}
    }
  }
  return null;
}

// One case, one repeat: the whole conversation through reply.send.
async function playCase(kase, { bot, repeat, lib, trace }) {
  const visitor = crypto.randomUUID();
  const turns = [];
  const history = [];
  try {
    for (const [index, say] of kase.say.entries()) {
      const traced = [];
      if (trace) trace.set((entry) => traced.push(entry));
      const restore = captureLog();
      const started = Date.now();
      let result;
      let failed = null;
      try {
        result = await lib.reply.send({ slug: kase.bot, visitor, texts: [say], batch: crypto.randomUUID(), ip: 'bench' });
      } catch (e) {
        failed = e.message;
        result = { items: [], choices: [] };
      }
      const log = readLog(restore());
      if (trace) trace.set(null);

      history.push({ role: 'client', text: say });
      const language = checks.expectedLanguage(history, kase);
      const sent = result.items.filter((it) => it.text).map((it) => it.text);
      const cards = result.items.filter((it) => it.card).map((it) => it.card);
      for (const text of sent) history.push({ role: 'bot', text });

      // The last completion of the send is the one that produced the answer: the earlier ones are the
      // tool rounds, and a rewrite adds one more after them.
      const last = traced[traced.length - 1];
      const rawContent = last?.raw?.content ?? null;
      const rawTexts = (parseObject(rawContent)?.messages || []).filter((m) => typeof m === 'string');
      // lines.expand returns { texts, approved }; the trace field is the expanded lines, as it always was.
      const expanded = rawContent ? lib.lines.expand(bot, lib.ai.readAnswer(rawContent).messages, language).texts : null;

      turns.push({
        turn: index + 1,
        client: say,
        language,
        raw: rawContent,
        rawTexts,
        expanded,
        sent,
        cards,
        fixes: log.fixes,
        issues: log.issues,
        rewrites: log.rewrites,
        stillWrong: log.stillWrong,
        unknownLines: log.unknownLines,
        failed,
        ms: Date.now() - started,
        usage: last?.usage ? { in: last.usage.prompt_tokens, out: last.usage.completion_tokens, cached: last.usage.prompt_tokens_details?.cached_tokens ?? null } : null,
      });
    }
  } finally {
    await lib.reply.restart({ slug: kase.bot, visitor }).catch(() => {});
  }
  return { case: kase.id, bot: kase.bot, repeat, turns };
}

// ---------------------------------------------------------------------------------------------------
// Grading a played conversation, on both views
// ---------------------------------------------------------------------------------------------------

function gradePlay(play, kase, bot, approved) {
  const views = {};
  const toRun = (view, pick) => ({
    view,
    answers: play.turns.map((t) => ({
      turn: t.turn,
      texts: pick(t) || [],
      cards: t.cards,
      language: t.language,
      rewrites: t.rewrites,
      fixes: t.fixes,
    })),
  });
  views.sent = checks.grade(toRun('sent', (t) => t.sent), kase, bot, { approved });
  // No trace sink yet (WI-0.1) → no raw text → the raw view is simply absent, never silently equal to sent.
  const haveRaw = play.turns.some((t) => t.rawTexts && t.rawTexts.length);
  if (haveRaw) views.raw = checks.grade(toRun('raw', (t) => t.rawTexts), kase, bot, { approved });
  return views;
}

// ---------------------------------------------------------------------------------------------------
// Aggregation (§2.5): per case the MEDIAN over repeats, then the mean over cases.
// ---------------------------------------------------------------------------------------------------

const median = (values) => {
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const mean = (values) => {
  const kept = values.filter((v) => v != null);
  return kept.length ? kept.reduce((a, b) => a + b, 0) / kept.length : null;
};
const round1 = (v) => (v == null ? null : Number(v.toFixed(1)));

const sumGates = (results) =>
  Object.fromEntries(
    checks.GATE_IDS.map((g) => [g, results.every((r) => r.gates[g] == null) ? null : results.reduce((s, r) => s + (r.gates[g] || 0), 0)])
  );
const sumGateRows = (rows, key) =>
  Object.fromEntries(
    checks.GATE_IDS.map((g) => [g, rows.every((r) => r[key]?.[g] == null) ? null : rows.reduce((s, r) => s + (r[key]?.[g] || 0), 0)])
  );

function aggregate(graded, caseSet) {
  const byCase = new Map();
  for (const { kase, views } of graded) {
    const entry = byCase.get(kase.id) || { kase, sent: [], raw: [] };
    entry.sent.push(views.sent);
    if (views.raw) entry.raw.push(views.raw);
    byCase.set(kase.id, entry);
  }

  const perCase = [];
  for (const [id, entry] of byCase) {
    const dims = {};
    for (const dim of checks.DIMENSIONS) {
      dims[dim] = median(entry.sent.map((v) => v.scores[dim]));
      if (entry.raw.length) dims[`${dim}_raw`] = median(entry.raw.map((v) => v.scores[dim]));
    }
    perCase.push({
      id,
      bot: entry.kase.bot,
      kind: entry.kase.kind,
      knows: entry.kase.knows,
      repeats: entry.sent.length,
      dims,
      derjaScore: median(entry.sent.map((v) => v.scores.derjaScore)),
      derjaScoreRaw: entry.raw.length ? median(entry.raw.map((v) => v.scores.derjaScore)) : null,
      // Gates and rewrites are SUMS, never medians: a gate that fails once has failed (§2.4). A gate
      // nobody measured stays null all the way to the report — "not measured" must not read as "none".
      gates: sumGates(entry.sent),
      gatesRaw: entry.raw.length ? sumGates(entry.raw) : null,
      rewrites: entry.sent.reduce((s, v) => s + v.diagnostics.rewrites, 0),
      answers: entry.sent.reduce((s, v) => s + v.diagnostics.messages.length, 0),
      approvedShare: mean(entry.sent.map((v) => v.diagnostics.approvedShare)),
    });
  }

  const dimsOver = (rows, suffix = '') =>
    Object.fromEntries(checks.DIMENSIONS.map((d) => [d, round1(mean(rows.map((r) => r.dims[`${d}${suffix}`])))]));
  const group = (key) => {
    const out = {};
    for (const value of new Set(perCase.map((r) => r[key]))) {
      const rows = perCase.filter((r) => r[key] === value);
      out[value] = { cases: rows.length, dims: dimsOver(rows), derjaScore: round1(mean(rows.map((r) => r.derjaScore))) };
    }
    return out;
  };

  const rewrites = perCase.reduce((s, r) => s + r.rewrites, 0);
  const answers = perCase.reduce((s, r) => s + r.answers, 0);
  const haveRaw = perCase.some((r) => r.derjaScoreRaw != null);

  return {
    cases: perCase.length,
    caseSet: { version: caseSet.version, hash: caseSet.hash },
    headline: {
      derjaScore: round1(mean(perCase.map((r) => r.derjaScore))),
      derjaScoreRaw: haveRaw ? round1(mean(perCase.map((r) => r.derjaScoreRaw))) : null,
      // D30, on its own line in the report as well.
      rewritesPer100: answers ? Number(((rewrites / answers) * 100).toFixed(1)) : 0,
      answers,
    },
    dims: dimsOver(perCase),
    dimsRaw: haveRaw ? dimsOver(perCase, '_raw') : null,
    gates: sumGateRows(perCase, 'gates'),
    gatesRaw: haveRaw ? sumGateRows(perCase, 'gatesRaw') : null,
    perBot: group('bot'),
    perKind: group('kind'),
    perCase: perCase.sort((a, b) => a.derjaScore - b.derjaScore),
  };
}

// ---------------------------------------------------------------------------------------------------
// unknown.tsv · D08 is WI-2.4. Until the lexicon exists this is the raw token census, unfiltered, so
// the file the owner is asked to review every run already exists and nobody mistakes it for a verdict.
// ---------------------------------------------------------------------------------------------------

const FRENCH_ISH = /^[a-zéèêàâôûîçïü'-]+$/i;

function unknownTable(graded) {
  const counts = new Map();
  const example = new Map();
  for (const { play } of graded) {
    for (const turn of play.turns) {
      for (const text of turn.sent) {
        for (const token of String(text).toLowerCase().match(/[\p{L}\d]+/gu) || []) {
          if (/^\d/.test(token) || token.length < 3) continue;
          counts.set(token, (counts.get(token) || 0) + 1);
          if (!example.has(token)) example.set(token, String(text).replace(/\s+/g, ' ').slice(0, 90));
        }
      }
    }
  }
  const rows = [...counts.entries()]
    .filter(([token]) => !FRENCH_ISH.test(token) || /[\d]/.test(token))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 300);
  const head = [
    '# D08, the invented-word detector, is NOT active: it needs data/lexicon.json (WI-2.4).',
    '# Until then this is every Arabizi-looking token the run produced, by frequency — candidates, not verdicts.',
    '# The owner marks each line: word (goes into the lexicon) or invented (a G3 gate failure from then on).',
    'token\tcount\tnearest\tverdict\texample',
  ];
  return [...head, ...rows.map(([token, count]) => `${token}\t${count}\t\t\t${example.get(token)}`)].join('\n');
}

// ---------------------------------------------------------------------------------------------------
// review.md · numbers are for the decision, the quoted answers are for the owner's judgement
// ---------------------------------------------------------------------------------------------------

function reviewMarkdown(meta, scores, graded) {
  const byCase = new Map();
  for (const g of graded) if (!byCase.has(g.kase.id)) byCase.set(g.kase.id, g);

  const out = [];
  out.push(`# derja-bench · ${meta.tag}`, '');
  out.push(`${meta.model} · ${meta.repeats} repeat(s) · ${scores.cases} cases · clock pinned to ${meta.pinnedNow}`, '');
  out.push(`**DerjaScore ${scores.headline.derjaScore}** (sent)` + (scores.headline.derjaScoreRaw != null ? ` · **${scores.headline.derjaScoreRaw}** (raw model output)` : ' · raw not measured: no trace sink yet'), '');
  out.push(`**Rewrites per 100 answers: ${scores.headline.rewritesPer100}** — every one of them is an answer the model got wrong first try.`, '');
  out.push('| dimension | sent | raw |', '|---|---|---|');
  for (const dim of checks.DIMENSIONS) out.push(`| ${dim} | ${scores.dims[dim] ?? '—'} | ${scores.dimsRaw?.[dim] ?? '—'} |`);
  out.push('', '| gate | sent | raw |', '|---|---|---|');
  for (const g of checks.GATE_IDS) out.push(`| ${g} | ${scores.gates[g] ?? '—'} | ${scores.gatesRaw?.[g] ?? '—'} |`);
  out.push('', '## The 10 worst answers', '');

  for (const row of scores.perCase.slice(0, 10)) {
    const g = byCase.get(row.id);
    out.push(`### ${row.id} · ${row.bot} · ${row.kind} · knows: ${row.knows} · ${row.derjaScore}`);
    out.push(`> ${g.kase.why}`, '');
    for (const turn of g.play.turns) {
      out.push(`**client:** ${turn.client}`);
      for (const text of turn.sent) out.push(`**assistant:** ${text.replace(/\n/g, '  \n')}`);
      for (const card of turn.cards) out.push(`*[card: ${card.title || card.type}]*`);
      if (turn.fixes.length) out.push(`*derja.js fixed: ${turn.fixes.join(', ')}*`);
      if (turn.rewrites) out.push(`*rewritten ${turn.rewrites}×: ${turn.issues.join('; ')}*`);
    }
    out.push('', '**found:**');
    for (const f of g.views.sent.findings) out.push(`- ${f.id} ${f.dims.join('+')} (${f.sev}) «${f.quote}» — ${f.note}`);
    out.push('');
  }

  // The 5 answers derja.js changed the most: the gap between what the model wrote and what went out.
  const changed = graded
    .map((g) => ({ g, n: g.play.turns.reduce((s, t) => s + t.fixes.length, 0) }))
    .filter((x) => x.n)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  out.push('## The 5 answers lib/derja.js changed the most', '');
  if (!changed.length) out.push('_None: derja.fix swapped nothing this run._', '');
  for (const { g, n } of changed) {
    out.push(`### ${g.kase.id} — ${n} swap(s)`);
    for (const turn of g.play.turns) {
      if (!turn.fixes.length) continue;
      out.push(`**client:** ${turn.client}`);
      if (turn.rawTexts.length) out.push(`**model wrote:** ${turn.rawTexts.join(' / ')}`);
      out.push(`**client got:** ${turn.sent.join(' / ')}`);
      out.push(`*${turn.fixes.join(', ')}*`, '');
    }
  }

  out.push('## Per bot', '', '| bot | cases | DerjaScore |', '|---|---|---|');
  for (const [bot, v] of Object.entries(scores.perBot)) out.push(`| ${bot} | ${v.cases} | ${v.derjaScore} |`);
  out.push('', '## Per kind', '', '| kind | cases | DerjaScore |', '|---|---|---|');
  for (const [kind, v] of Object.entries(scores.perKind)) out.push(`| ${kind} | ${v.cases} | ${v.derjaScore} |`);
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------------------------------

// gpt-5.4-mini, dollars per 1M tokens. Every run is priced at the cheapest model in the table, so the
// number that gets printed is a floor: another --model costs more, never less.
const RATE = { in: 0.75, cached: 0.075, out: 4.50 };
// Measured over the 19 turns of the run that went out by accident. A turn is one client message, and the
// tool rounds and the rewrite inside it are extra prompts, so this is a floor too.
const TOKENS_PER_TURN = { in: 4200, out: 35 };

const money = (usd) => `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(usd < 1 ? 3 : 2)}`;

function estimateCost(selected, repeats) {
  const turns = selected.reduce((n, k) => n + k.say.length, 0) * repeats;
  const input = (turns * TOKENS_PER_TURN.in) / 1e6;
  const output = (turns * TOKENS_PER_TURN.out) / 1e6;
  // Two numbers because the same prompts repeat: cached input is ten times cheaper, and how much of it
  // hits the cache is not knowable before the run.
  return { turns, high: input * RATE.in + output * RATE.out, low: input * RATE.cached + output * RATE.out };
}

function printEstimate(est, model) {
  console.log(bold(`  estimated cost  ${money(est.high)}`));
  console.log(grey(`    ${est.turns} live turn(s) × ~${TOKENS_PER_TURN.in} in / ~${TOKENS_PER_TURN.out} out tokens, at the gpt-5.4-mini rate`));
  console.log(grey(`    ($${RATE.in.toFixed(2)}/1M in, $${RATE.cached.toFixed(3)}/1M cached, $${RATE.out.toFixed(2)}/1M out).`));
  console.log(grey(`    This is an ESTIMATE, not a quote. If the prompt cache hits it falls towards ${money(est.low)};`));
  console.log(grey('    every tool round and every rewrite is another prompt on top.'));
  if (!/^gpt-5\.4-mini/.test(model)) console.log(grey(`    --model ${model} is not gpt-5.4-mini and is priced above it, so expect more.`));
}

// The one thing between this command and the owner's OpenAI bill. A run costs real money, so somebody has
// to say so on purpose; the accidental run that prompted this cost the price of 19 turns.
function requireLiveOptIn(flags, est, model) {
  if (flags.live || BENCH_LIVE_ENV) return true;
  console.log(red('\n  bench run calls the paid OpenAI API. Refusing: nobody opted in.\n'));
  printEstimate(est, model);
  console.log(grey('\n  Add --live (or BENCH_LIVE=1 in the environment) if you mean to spend that,'));
  console.log(grey('  or --dry-run to check the cases and the hashes for free.'));
  console.log(grey('  --force-live is a different switch: it picks the real Supabase store, not the API.\n'));
  return false;
}

// A benchmark must not need the network, must not be able to fail on a database timeout, and must not
// drop 300 fake conversations into the owner's /admin inbox (§4.2). WI-0.1 ships the memory store.
function requireMemoryStore(force) {
  process.env.BENCH_STORE = 'memory'; // set before lib/store is required, or the switch is read too late
  const benchStore = path.join(__dirname, 'bench-store.js');
  const missing = [];
  if (!fs.existsSync(benchStore)) missing.push('tools/bench-store.js does not exist (WI-0.1 step 1)');
  else {
    try {
      if (require(path.join(ROOT, 'lib', 'store')) !== require(benchStore)) {
        missing.push('lib/store.js does not switch to it — the one line of WI-0.1 step 2 is not there yet');
      }
    } catch (e) {
      missing.push(`lib/store.js could not be loaded: ${e.message}`);
    }
  }
  if (!missing.length) return true;
  if (force) {
    console.log(red('\n  --force-live: this run uses the REAL store.'));
    console.log(red('  It needs Supabase, it counts against PER_HOUR = 40 (reply.js:19) and it writes every'));
    console.log(red('  fake conversation into the owner\'s inbox. Only do this for a handful of cases.\n'));
    delete process.env.BENCH_STORE;
    return true;
  }
  console.log(red('\n  bench run needs the memory store, and it is not wired yet:'));
  for (const line of missing) console.log(red(`    · ${line}`));
  console.log(grey('\n  Run with --dry-run to check the cases and the hashes without calling anything,'));
  console.log(grey('  or with --force-live if you really mean to use Supabase and the live rate limit.\n'));
  return false;
}

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        out[index] = await worker(items[index], index);
      }
    })
  );
  return out;
}

async function cmdRun(flags) {
  const dir = flags.cases ? path.resolve(flags.cases) : path.join(BENCH, 'cases');
  const caseSet = loadCaseSet(dir);
  const selected = caseSet.cases.filter((k) => matches(k, flags.only));
  if (!selected.length) throw new Error(`--only ${flags.only} selected no case`);

  const repeats = Number(flags.repeats ?? 3);
  const tag = flags.tag || 'untagged';
  const model = flags.model || process.env.CHAT_MODEL || 'gpt-5.4';
  if (flags.model) process.env.CHAT_MODEL = flags.model; // read at require time by lib/ai.js
  const pinnedNow = flags.now || DEFAULT_NOW;

  const meta = {
    tag,
    started: new Date().toISOString(),
    model,
    reasoning: process.env.CHAT_REASONING || null,
    judgeModel: null, // BUILD-PLAN D20: no judge in v1
    repeats,
    concurrency: Number(flags.concurrency ?? 4),
    pinnedNow,
    dryRun: Boolean(flags['dry-run']),
    estimatedUsd: null, // filled in once the run is opted in, so run.json says what it was expected to cost
    git: gitState(),
    hashes: hashes(),
    cases: { version: caseSet.version, count: selected.length, total: caseSet.cases.length, hash: caseSet.hash, dir: path.relative(ROOT, dir) },
    lexicon: hashFile('data/lexicon.json') ? { hash: hashFile('data/lexicon.json') } : null,
    node: process.version,
    seed: 20260919,
    rawAvailable: false,
    notes: [],
  };

  console.log(bold(`\nderja-bench  run  ${tag}`));
  console.log(`${selected.length} case(s) · ${repeats} repeat(s) · ${model} · clock pinned to ${pinnedNow}`);
  console.log(grey(`case set v${caseSet.version} ${caseSet.hash.slice(0, 19)}…  git ${meta.git.sha}${meta.git.dirty ? ' (dirty)' : ''}\n`));

  if (meta.dryRun) {
    meta.notes.push('dry run: nothing was sent to the model, no answer was graded');
    const out = writeRun(meta, null, [], null);
    console.log(green(`  dry run OK — ${selected.length} cases parse, hashes written to ${path.relative(ROOT, out).replace(/\\/g, '/')}/run.json\n`));
    for (const kind of ['answerable', 'thin', 'flow', 'messy', 'trap']) {
      const rows = selected.filter((k) => k.kind === kind);
      console.log(grey(`    ${kind.padEnd(11)} ${String(rows.length).padStart(2)}  ${rows.map((r) => r.id).join(' ')}`));
    }
    // The refusal above tells the reader to use --dry-run to check the hashes for free, so print them
    // instead of making them open run.json for the one thing this path exists to show.
    console.log(grey('\n    what a run would measure:'));
    for (const [file, hash] of Object.entries(meta.hashes)) {
      console.log(grey(`      ${file.padEnd(26)} ${hash.slice(7, 19)}`));
    }
    console.log(grey(`      ${'bench/cases'.padEnd(26)} ${caseSet.hash.slice(7, 19)}  v${caseSet.version}`));
    console.log('');
    return 0;
  }

  // Before anything is required that could reach the network, and before the store is even chosen.
  const est = estimateCost(selected, repeats);
  if (!requireLiveOptIn(flags, est, model)) return 2;
  meta.estimatedUsd = Number(est.high.toFixed(3));
  printEstimate(est, model);
  console.log('');

  if (!requireMemoryStore(flags['force-live'])) return 2;

  const lib = {
    reply: require('../lib/reply'),
    lines: require('../lib/lines'),
    ai: require('../lib/ai'),
    bots: require('../lib/bots'),
  };
  // §4.2 step 3: the raw output is thrown away by readAnswer. WI-0.1 adds the four-line trace sink.
  let trace = null;
  if (typeof lib.ai.setTrace === 'function') {
    let current = null;
    lib.ai.setTrace((entry) => current?.(entry));
    trace = { set: (fn) => (current = fn) };
    meta.rawAvailable = true;
  } else {
    meta.notes.push('lib/ai.js has no setTrace (WI-0.1 step 3): the raw model output was not recorded, so DIA(raw), G1 and G2 are missing and only the sent view is scored');
    console.log(grey('  no trace sink in lib/ai.js yet — scoring the sent view only (see run.json notes)\n'));
  }

  const jobs = [];
  for (let repeat = 1; repeat <= repeats; repeat++) for (const kase of selected) jobs.push({ kase, repeat });

  const unpin = pinClock(pinnedNow);
  let done = 0;
  let played;
  try {
    played = await pool(jobs, meta.concurrency, async ({ kase, repeat }) => {
      const bot = lib.bots.get(kase.bot);
      const play = await playCase(kase, { bot, repeat, lib, trace });
      done += 1;
      process.stderr.write(`\r  ${done}/${jobs.length} answers played`);
      return { kase, bot, play };
    });
  } finally {
    unpin();
    process.stderr.write('\n');
  }

  const graded = played.map(({ kase, bot, play }) => ({
    kase,
    bot,
    play,
    views: gradePlay(play, kase, bot, checks.approvedTexts(bot)),
  }));
  if (graded.some((g) => g.views.raw)) meta.rawAvailable = true;

  const scores = aggregate(graded, caseSet);
  const dir2 = writeRun(meta, scores, graded, caseSet);
  printRun(meta, scores);
  console.log(grey(`  written to ${path.relative(ROOT, dir2)}\n`));
  return 0;
}

// §4.3 names the folder after the date, the model and the sha. It is named after the tag instead,
// because every command in §4.1 addresses a run by its tag; the descriptive name is in run.json.stamp.
function writeRun(meta, scores, graded, caseSet) {
  const stamp = `${meta.started.replace(/:/g, '-').slice(0, 16)}_${meta.model}_${meta.git.sha}`;
  const dir = path.join(RUNS, `${meta.tag}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ ...meta, stamp, scores: scores?.headline ?? null }, null, 2));
  if (!scores) return dir;

  const answers = [];
  const checkRows = [];
  for (const { kase, play, views } of graded) {
    for (const turn of play.turns) {
      answers.push(JSON.stringify({
        case: kase.id, repeat: play.repeat, turn: turn.turn, client: turn.client, language: turn.language,
        raw: turn.raw, expanded: turn.expanded, sent: turn.sent, fixes: turn.fixes, issues: turn.issues,
        rewrites: turn.rewrites, cards: turn.cards.map((c) => c.title || c.type), usedLines: turn.unknownLines,
        ms: turn.ms, usage: turn.usage, failed: turn.failed,
      }));
    }
    for (const [view, result] of Object.entries(views)) {
      checkRows.push(JSON.stringify({ case: kase.id, repeat: play.repeat, view, scores: result.scores, gates: result.gates, findings: result.findings, diagnostics: result.diagnostics }));
    }
  }
  fs.writeFileSync(path.join(dir, 'answers.jsonl'), answers.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'checks.jsonl'), checkRows.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'scores.json'), JSON.stringify(scores, null, 2));
  fs.writeFileSync(path.join(dir, 'unknown.tsv'), unknownTable(graded) + '\n');
  fs.writeFileSync(path.join(dir, 'review.md'), reviewMarkdown(meta, scores, graded));
  return dir;
}

function printRun(meta, scores) {
  const pad = (s, n) => String(s ?? '—').padEnd(n);
  console.log(`\n${bold(`derja-bench  ${meta.tag}`)}   ${scores.cases} cases, v${scores.caseSet.version}, ${meta.repeats} repeat(s)`);
  console.log(grey(`\n                     sent    raw`));
  for (const dim of checks.DIMENSIONS) {
    const note = dim === 'NAT' ? grey('  (no judge in v1)') : '';
    console.log(`  ${pad(dim, 4)} ${pad('', 14)}${pad(scores.dims[dim], 8)}${pad(scores.dimsRaw?.[dim], 7)}${note}`);
  }
  console.log('  ---------------------------------------------');
  console.log(`  ${bold('DerjaScore')}          ${pad(scores.headline.derjaScore, 8)}${pad(scores.headline.derjaScoreRaw, 7)}`);
  console.log(`\n  gates              sent  raw`);
  for (const g of checks.GATE_IDS) console.log(`    ${g}${' '.repeat(16)}${pad(scores.gates[g], 6)}${pad(scores.gatesRaw?.[g], 5)}`);
  if (scores.gates.G3 == null) console.log(grey('    G3 is «—», not 0: the invented-word detector needs data/lexicon.json (WI-2.4)'));
  console.log(`\n  ${bold(`rewrites per 100 answers   ${scores.headline.rewritesPer100}`)}   ${grey(`(${scores.headline.answers} answers)`)}`);
  for (const note of meta.notes) console.log(grey(`\n  note: ${note}`));
}

// ---------------------------------------------------------------------------------------------------
// compare (§4.4) · the model is not deterministic, so a difference is only real above the jitter
// ---------------------------------------------------------------------------------------------------

const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// 95% interval of the paired mean difference, by bootstrap over cases.
function band(pairs, seed, resamples = 10000) {
  if (pairs.length < 2) return null;
  const random = mulberry32(seed);
  const means = [];
  for (let i = 0; i < resamples; i++) {
    let sum = 0;
    for (let j = 0; j < pairs.length; j++) sum += pairs[(random() * pairs.length) | 0];
    means.push(sum / pairs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(resamples * 0.025)], means[Math.floor(resamples * 0.975)]];
}

function loadRun(tag) {
  const dir = path.join(RUNS, tag);
  if (!fs.existsSync(path.join(dir, 'scores.json'))) throw new Error(`no run tagged «${tag}» in bench/runs`);
  return {
    dir,
    meta: JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')),
    scores: JSON.parse(fs.readFileSync(path.join(dir, 'scores.json'), 'utf8')),
  };
}

function cmdCompare(flags, [baseTag, newTag]) {
  if (!baseTag || !newTag) throw new Error('compare needs two tags: bench compare <base> <new>');
  const base = loadRun(baseTag);
  const fresh = loadRun(newTag);
  if (base.scores.caseSet.hash !== fresh.scores.caseSet.hash && !flags.intersect) {
    throw new Error('the two runs used different case sets. Pass --intersect to compare the cases they share.');
  }

  const baseByCase = new Map(base.scores.perCase.map((r) => [r.id, r]));
  const shared = fresh.scores.perCase.filter((r) => baseByCase.has(r.id));
  const dropped = fresh.scores.perCase.length - shared.length;

  console.log(bold(`\nderja-bench  compare  ${baseTag}  →  ${newTag}`));
  console.log(`cases ${shared.length}${dropped ? ` (${dropped} dropped, --intersect)` : ` (same set, v${base.scores.caseSet.version})`}   repeats ${fresh.meta.repeats}   judge: none\n`);
  console.log(grey('                     base    new     Δ        band     verdict'));

  const verdicts = {};
  for (const dim of checks.DIMENSIONS) {
    const pairs = shared.map((r) => (r.dims[dim] ?? 0) - (baseByCase.get(r.id).dims[dim] ?? 0));
    const a = base.scores.dims[dim];
    const b = fresh.scores.dims[dim];
    if (a == null || b == null) {
      console.log(`  ${dim.padEnd(4)} ${''.padEnd(14)}—       —       —        —       ${grey('(not measured in both runs)')}`);
      continue;
    }
    const ci = band(pairs, fresh.meta.seed ?? 1);
    const verdict = !ci ? 'SAME' : ci[0] > 0 ? 'BETTER' : ci[1] < 0 ? 'WORSE' : 'SAME';
    verdicts[dim] = verdict;
    const width = ci ? ((ci[1] - ci[0]) / 2).toFixed(2) : '—';
    const delta = (b - a).toFixed(1);
    const colour = verdict === 'BETTER' ? green : verdict === 'WORSE' ? red : grey;
    console.log(`  ${dim.padEnd(4)} ${''.padEnd(14)}${String(a).padEnd(8)}${String(b).padEnd(8)}${String(delta >= 0 ? `+${delta}` : delta).padEnd(9)}±${String(width).padEnd(7)} ${colour(verdict)}`);
  }

  console.log('\n  gates              base  new');
  let gateRose = [];
  for (const g of checks.GATE_IDS) {
    const a = base.scores.gates[g];
    const b = fresh.scores.gates[g];
    if (a == null && b == null) {
      console.log(`    ${g}${' '.repeat(16)}${'—'.padEnd(6)}${'—'.padEnd(5)}  ${grey('not measured in either run')}`);
      continue;
    }
    if (b > (a ?? 0)) gateRose.push(`${g} rose from ${a ?? 0} to ${b}`);
    const delta = (b ?? 0) - (a ?? 0);
    const mark = delta < 0 ? green('✓') : delta > 0 ? red('✗') : ' ';
    console.log(`    ${g}${' '.repeat(16)}${String(a ?? '—').padEnd(6)}${String(b ?? '—').padEnd(5)}${mark} ${delta > 0 ? `+${delta}` : delta}`);
  }
  const rw = [base.scores.headline.rewritesPer100, fresh.scores.headline.rewritesPer100];
  console.log(`  ${bold('rewrites per 100')}   ${String(rw[0]).padEnd(6)}${String(rw[1]).padEnd(5)}${rw[1] < rw[0] ? green('✓') : rw[1] > rw[0] ? red('✗') : ' '}`);

  // §4.4 · the overall verdict is not a mean.
  const answerable = [base.scores.perKind.answerable?.derjaScore, fresh.scores.perKind.answerable?.derjaScore];
  let verdict;
  let because;
  if (gateRose.length) [verdict, because] = ['WORSE', gateRose.join('; ')];
  else if (Object.values(verdicts).includes('WORSE')) [verdict, because] = ['WORSE', `${Object.entries(verdicts).filter(([, v]) => v === 'WORSE').map(([d]) => d).join(', ')} fell outside the band`];
  else if (answerable[0] != null && answerable[1] != null && answerable[1] < answerable[0]) {
    [verdict, because] = ['WORSE', `the answerable cases dropped ${answerable[0]} → ${answerable[1]}: a rewrite that fixes thin answers by breaking the ones that worked is not an improvement`];
  } else if (Object.values(verdicts).includes('BETTER')) [verdict, because] = ['BETTER', `${Object.entries(verdicts).filter(([, v]) => v === 'BETTER').map(([d]) => d).join(', ')}`];
  else [verdict, because] = ['SAME', 'every delta is inside the band'];

  const colour = verdict === 'BETTER' ? green : verdict === 'WORSE' ? red : grey;
  console.log(`\n  ${bold('VERDICT')}: ${colour(verdict)} — ${because}\n`);
  return verdict === 'WORSE' ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------

function cmdReview(flags, [tag]) {
  const { dir } = loadRun(tag);
  process.stdout.write(fs.readFileSync(path.join(dir, 'review.md'), 'utf8'));
  return 0;
}

function cmdLexicon(flags, [tag]) {
  const { dir } = loadRun(tag);
  process.stdout.write(fs.readFileSync(path.join(dir, 'unknown.tsv'), 'utf8'));
  return 0;
}

function parseArgv(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[name] = next;
      i++;
    } else flags[name] = true;
  }
  return { flags, rest };
}

const COMMANDS = { run: cmdRun, compare: cmdCompare, review: cmdReview, lexicon: cmdLexicon };

// Exported so the writer, the aggregation and compare can be exercised offline, without the API.
module.exports = { loadCaseSet, gradePlay, aggregate, writeRun, printRun, reviewMarkdown, unknownTable, hashes, gitState, pinClock, band, cmdCompare };

if (require.main === module) {
  (async () => {
    const [command, ...argv] = process.argv.slice(2);
    const run = COMMANDS[command];
    if (!run) {
      console.log('usage: npm run bench -- <run|compare|review|lexicon> [...]');
      console.log('  run     --tag <name> [--repeats 3] [--only <bot|kind|id>] [--model <id>] [--dry-run]');
      console.log('          --live is required for a real run: without it run refuses, and costs nothing');
      console.log('  compare <base-tag> <new-tag> [--intersect]');
      console.log('  review  <tag>            lexicon <tag>');
      process.exit(2);
    }
    const { flags, rest } = parseArgv(argv);
    try {
      process.exit((await run(flags, rest)) || 0);
    } catch (e) {
      console.log(red(`\n  ${e.message}\n`));
      process.exit(2);
    }
  })();
}
