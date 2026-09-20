// The validator's exam, and unlike npm run exam it costs nothing and takes milliseconds:
//   node tools/validate-test.js                 → everything
//   node tools/validate-test.js SWAP OPENER     → only those rules (the regression always runs)
//
// Two parts, and the second one matters more.
//
// 1. Per rule, from tests/validator.json: something that must pass, something that must fail, and —
//    for a case that says so — what the whole of validate() then does with it: the exact text a
//    silent fix produces («out»), what the model is asked to rewrite («issues»), and what the client
//    is left able to tap («buttons»). The bare rule and validate() are not the same answer: the
//    identity exemption and the two choice filters live in validate() alone and the rule knows
//    nothing about them, so a case that only reads the rule cannot see them at all.
// 2. THE REGRESSION. Every «Derja:» and «French:» line in brain/*.md and every welcome and starter in
//    lib/bots.js — every message block the owner wrote and a Tunisian approved — must come back with
//    issues == [] and changed == []. If a rule flags one of them the rule is wrong, not the line.
//    That corpus is where every false-positive number in design-validator.md came from.
//
// Watch rows are not failures anywhere: a watch never blocks an answer and never rewrites one.
//
// Where this file stops. It calls validate() and nothing else, so everything reply.js does after
// validate() has answered is out of reach here: its own empty-message net (reply.js:162), and the
// second one after the toLatin salvage writes new strings the validator never saw (reply.js:224-225).
// Reaching those means calling reply.answer(), which means a model call and a store — a reply-level
// test with both stubbed, not a case in tests/validator.json. Until that test exists those three
// lines can be deleted and this suite stays green.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const validate = require('../lib/validate');
const bots = require('../lib/bots');

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const grey = (s) => `\x1b[90m${s}\x1b[0m`;

const BOTS = ['clim-express', 'yasmine-photo', 'patisserie-nour', 'digiplus'];
// voice.md belongs to all four; its lines are checked against the one bot that has no catalogue and
// the widest vocabulary, so a false positive there cannot be blamed on a missing product name.
const SHARED = 'digiplus';

const failures = [];
const note = (rule, message) => failures.push(`${rule}: ${message}`);

// ─── the cases ───────────────────────────────────────────────────────────────
// A case is a string, or an object that may override anything in the input.
function inputOf(rule, kase) {
  const body = typeof kase === 'string' ? { text: kase } : kase;
  const texts = body.texts || [body.text];
  return {
    texts,
    choices: body.choices || [],
    language: body.language || rule.language || 'derja',
    script: body.script || rule.script || 'arabizi',
    history: body.history || [],
    toolResults: body.toolResults || [],
    // One flag for the whole case, or one per message: an array is what reply.js really passes.
    approved: texts.map((_, index) => Boolean(Array.isArray(body.approved) ? body.approved[index] : body.approved)),
    clientText: body.clientText || '',
    slug: body.bot || rule.bot || SHARED,
    // Only a business that really charges every month runs FEE-UNEXPLAINED.
    recurring: body.recurring ?? rule.recurring ?? false,
    out: body.out,
    severity: body.severity,
    count: body.count,
    says: body.says,
    log: body.log,
    issues: body.issues,
    buttons: body.buttons,
  };
}

const botFor = (input) => ({ ...bots.get(input.slug), recurring: input.recurring });

const firings = (id, input) => validate.runRule(validate.RULE_BY_ID.get(id), { texts: input.texts }, validate.contextFor(botFor(input), input));

const label = (kase) => JSON.stringify(typeof kase === 'string' ? kase : kase.text || kase.texts).slice(0, 90);

// What a rule says it is and what it emits have to be the same word: validate() routes on the
// finding, so a rule promoted from watch to repair in the table alone would change nothing at all,
// and TOO-LONG or UNKNOWN-WORD quietly costing the one rewrite is the failure D9 and D6 forbid.
// DENY is the one rule with two severities by design: a fix when the right word is known.
function severityMatches(rule, found) {
  const allowed = rule.id === 'DENY' ? ['fix', 'repair'] : [rule.severity];
  return allowed.includes(found.severity);
}

function runCases(rule) {
  const id = rule.rule;
  if (!validate.RULE_BY_ID.has(id)) return note(id, 'no rule with this id is in the registry');
  const entry = validate.RULE_BY_ID.get(id);

  for (const kase of rule.pass || []) {
    const input = inputOf(rule, kase);
    const found = firings(id, input);
    if (found.length) note(id, `${label(kase)} should pass, but ${id} fired: ${found.map((f) => f.note).join(' / ')}`);
  }

  for (const kase of rule.fail || []) {
    const input = inputOf(rule, kase);
    const found = firings(id, input);
    if (!found.length) {
      note(id, `${label(kase)} should fail, and ${id} said nothing`);
      continue;
    }
    if (input.severity && !found.some((f) => f.severity === input.severity)) {
      note(id, `${label(kase)} fired as ${found.map((f) => f.severity).join('/')}, expected ${input.severity}`);
    }
    for (const one of found.filter((f) => !severityMatches(entry, f))) {
      note(id, `${label(kase)} fired as «${one.severity}» while the registry calls ${id} «${entry.severity}»`);
    }
    // Which message it fired on matters: it is how the per-message approved flag is proved to work.
    if (input.count !== undefined && found.length !== input.count) {
      note(id, `${label(kase)} fired ${found.length} time(s) on message(s) ${found.map((f) => f.message).join(',')}, expected ${input.count}`);
    }
    // The note goes into the rewrite prompt, so it has to say the words the model actually wrote.
    if (input.says && !found.some((f) => f.note.includes(input.says))) {
      note(id, `${label(kase)} said ${found.map((f) => JSON.stringify(f.note)).join(' / ')}, expected «${input.says}» in it`);
    }
    if (input.out === undefined && input.issues === undefined && input.buttons === undefined && !input.log) continue;
    const report = validate.validate(botFor(input), input);
    const got = report.texts.join('\n');
    if (input.out !== undefined && got !== input.out) {
      note(id, `${label(kase)} became ${JSON.stringify(got)}, expected ${JSON.stringify(input.out)}`);
    }
    // What reply.js puts in the rewrite prompt, and the only place the identity exemption can be
    // seen. The bare rule above fires on the owner's own sentence — his «Voici les photos et les
    // prix 😊» starts with an opener like any other — and validate() then throws the finding away
    // because the text IS one of his lines, flag or no flag (validate.js:892). «out» cannot show
    // that: an exempted message comes back unchanged and so does a message whose only finding was a
    // repair, which never rewrites anything here. Nor can two copies of one message: issues comes
    // back de-duplicated, so the exempted copy and the model's own collapse into the same string
    // either way. Exact, both directions: an issue nobody expected costs the one rewrite too.
    if (input.issues !== undefined) {
      const missing = input.issues.filter((want) => !report.issues.includes(want));
      const extra = report.issues.filter((one) => !input.issues.includes(one));
      if (missing.length || extra.length) {
        note(id, `${label(kase)} raised ${JSON.stringify(report.issues)}, expected ${JSON.stringify(input.issues)}`);
      }
    }
    // What the client can tap. The last two filters in validate() write to report.choices and to
    // nothing else — a button still in Arabic script after the letter table gave up, and a button a
    // fix emptied — so a case that reads report.texts alone leaves both of them unasserted.
    if (input.buttons !== undefined && JSON.stringify(report.choices) !== JSON.stringify(input.buttons)) {
      note(id, `${label(kase)} sent buttons ${JSON.stringify(report.choices)}, expected ${JSON.stringify(input.buttons)}`);
    }
    // A silent fix is logged for the owner to read, and a log that says something other than what
    // the text became is how the anhi drift was mis-read in the first place.
    for (const row of input.log || []) {
      if (!report.changed.some((change) => `${change.found}→${change.expected}` === row)) {
        note(id, `${label(kase)} logged ${report.changed.map((c) => `${c.found}→${c.expected}`).join(', ') || 'nothing'}, expected «${row}»`);
      }
    }
  }

  // A rule the chat does not run today (the Arabic-script channel, REPEAT, a bot with no monthly fee)
  // must stay silent in the chat, whatever it would say in its own channel.
  for (const kase of rule.inert || []) {
    const input = { ...inputOf(rule, kase), script: 'arabizi', recurring: false };
    const found = firings(id, input);
    if (found.length) note(id, `${label(kase)} must be inert in the chat, but ${id} fired`);
  }

  // A rule switched off in the chat still has to see its bad input: REPEAT's gate is off because
  // lib/repeat.js already reports it to reply.js, not because the rule body is allowed to be wrong.
  for (const kase of rule.detects || []) {
    const input = inputOf(rule, kase);
    const ctx = validate.contextFor(botFor(input), input);
    ctx.texts = input.texts;
    const unit = entry.scope === 'answer' ? input.texts.join('\n') : input.texts[0];
    if (!entry.find(unit, ctx, { message: 0, line: null }).length) {
      note(id, `${label(kase)} must be detected by ${id} itself, past the gate that keeps it quiet, and it said nothing`);
    }
  }

  // UNKNOWN-WORD may only ever watch. One word costing one rewrite is the failure this whole design
  // was built to avoid, so it is asserted on the words most likely to trip it.
  for (const word of rule.neverAnIssue || []) {
    const input = inputOf(rule, `Ey, ${word} 😊`);
    const report = validate.validate(botFor(input), input);
    const blamed = [...report.issues, ...report.changed.map((c) => c.note)].filter((line) => line.includes(word));
    if (blamed.length) note(id, `«${word}» must only ever be watched, and it produced: ${blamed.join(' / ')}`);
  }
}

// ─── the regression ──────────────────────────────────────────────────────────
// Every approved message block, exactly as lib/lines.js reads it out of the file.
function approvedBlocks() {
  const blocks = [];
  for (const file of fs.readdirSync(path.join(ROOT, 'brain'))) {
    if (!file.endsWith('.md')) continue;
    const slug = file === 'voice.md' ? SHARED : file.replace('.md', '');
    let open = null;
    for (const raw of fs.readFileSync(path.join(ROOT, 'brain', file), 'utf8').split(/\r?\n/)) {
      const start = raw.match(/^(Derja|French):\s*(.*)$/);
      if (start) {
        open = { where: `brain/${file}`, slug, language: start[1] === 'French' ? 'fr' : 'derja', text: start[2].trim() };
        blocks.push(open);
        continue;
      }
      // An indented line continues the message above it; anything else closes it (lines.js:40).
      if (open && /^\s+\S/.test(raw)) open.text += `\n${raw.trim()}`;
      else open = null;
    }
  }
  for (const slug of BOTS) {
    const bot = bots.get(slug);
    for (const text of bot.welcome) blocks.push({ where: `bots.js ${slug} welcome`, slug, language: 'derja', text });
    for (const text of bot.starters) blocks.push({ where: `bots.js ${slug} starter`, slug, language: 'derja', text });
  }
  return blocks.filter((block) => block.text);
}

function regression(blocks) {
  let strict = 0;
  for (const block of blocks) {
    const bot = bots.get(block.slug);
    // approved: true is what production does — lines.expand marks a message it substituted from an
    // @id, and every style rule skips it. The owner's voice is not something to correct.
    const report = validate.validate(bot, { texts: [block.text], language: block.language, approved: [true], history: [] });
    for (const issue of report.issues) note('REGRESSION', `${block.where} «${block.text.slice(0, 50)}…» → ${issue}`);
    for (const change of report.changed) note('REGRESSION', `${block.where} «${block.text.slice(0, 50)}…» rewrote «${change.found}» → «${change.expected}»`);

    // The same corpus with the approved flag off: this is how design-validator measured its
    // false-positive numbers, and it is the only way the style rules get exercised at all. It is
    // reported, not failed. It printed 1 for as long as the flag was the only thing that marked the
    // owner's voice, and the one hit was the approved «Voici les photos…» tripping OPENER. It
    // prints 0 now, and not because the rule changed: validate() exempts a text that IS one of his
    // lines whatever the flag says, so the flag-off pass no longer reaches that sentence either.
    // The number is therefore no longer a measurement of the style rules against his corpus — turn
    // the exemption off and it is 1 again. The OPENER case in tests/validator.json asserts that
    // exemption directly, which is where it has to be proved now.
    const raw = validate.validate(bot, { texts: [block.text], language: block.language, approved: [false], history: [] });
    if (raw.issues.length || raw.changed.length) strict += 1;
  }
  return strict;
}

// ─── run ─────────────────────────────────────────────────────────────────────
const wanted = process.argv.slice(2);
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'validator.json'), 'utf8'));
const chosen = cases.filter((rule) => !wanted.length || wanted.includes(rule.rule));

// The case count, said out loud: a gap is closed by adding cases, and a refactor that quietly stops
// reading one of the lists (a «buttons» nobody compares, an «issues» spelled wrong) takes the number
// down while every row still prints green.
const countOf = (rule) =>
  ['pass', 'fail', 'inert', 'detects', 'neverAnIssue'].reduce((sum, list) => sum + (rule[list] || []).length, 0);
const total = chosen.reduce((sum, rule) => sum + countOf(rule), 0);

console.log(`\n${chosen.length} rules, ${total} cases, ${validate.RULES.length} in the registry`);
for (const rule of chosen) {
  const before = failures.length;
  runCases(rule);
  const broken = failures.length - before;
  console.log(`  ${broken ? red('✗') : green('✓')} ${rule.rule}${broken ? red(` (${broken})`) : ''}`);
}

const missing = validate.RULES.filter((rule) => !cases.some((kase) => kase.rule === rule.id)).map((rule) => rule.id);
if (missing.length && !wanted.length) note('COVERAGE', `no case in tests/validator.json for ${missing.join(', ')}`);

// Every rule needs both halves: something correct it must leave alone, and something wrong it must
// see. A rule with only one half passes this file while being able to fire on everything or nothing.
if (!wanted.length) {
  for (const kase of cases) {
    if (!(kase.pass || []).length) note('COVERAGE', `${kase.rule} has nothing that must pass`);
    if (!(kase.fail || []).length && !(kase.detects || []).length) note('COVERAGE', `${kase.rule} has nothing that must fail`);
  }
}

const blocks = approvedBlocks();
console.log(`\nRegression: ${blocks.length} approved message blocks`);
const before = failures.length;
const strict = regression(blocks);
console.log(
  `  ${failures.length > before ? red('✗') : green('✓')} issues == [] and changed == [] on all ${blocks.length}` +
    grey(`   (with the approved flag off: ${strict} block${strict === 1 ? '' : 's'} flagged by a style rule)`)
);

if (failures.length) {
  console.log('');
  for (const failure of failures) console.log(`  ${red(failure)}`);
}
console.log(`\n${failures.length ? red(`${failures.length} failures.`) : green('All green.')}\n`);
process.exit(failures.length ? 1 : 0);
