// The assistants' exam: plays real conversations and checks every answer.
//   npm run exam                    → every assistant
//   npm run exam -- clim-express    → one assistant
// Run it after changing a brain file, before putting the site online. Needs OpenAI credits.
//
// Each test in exams/<assistant>.json:
//   say          what the client writes, one message after the other
//   expect       checked on the last answer:
//     language     "derja" or "fr"
//     mentions     every text must appear          mentionsAny  at least one must appear
//     avoid        none of these may appear
//     card         a card title ("Demande enregistrée") or type ("products", "slots")
// On every answer, always: at most 3 messages, only real prices, Tunisian words in Derja.
require('../lib/no-image-api');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
const reply = require('../lib/reply');
const bots = require('../lib/bots');
const guard = require('../lib/guard');
const ai = require('../lib/ai');

const EXAMS = path.join(ROOT, 'exams');
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const grey = (s) => `\x1b[90m${s}\x1b[0m`;

const lower = (s) => String(s).toLowerCase();

function check(bot, test, answers) {
  const failures = [];
  const history = [];
  for (const [i, answer] of answers.entries()) {
    history.push({ role: 'client', text: test.say[i] });
    const texts = answer.items.filter((it) => it.text).map((it) => it.text);
    if (texts.length > 3) failures.push(`answer ${i + 1} has ${texts.length} messages (max 3)`);
    const language = ai.clientLanguage(history);
    for (const problem of guard.problems(bot, { texts, language })) failures.push(`answer ${i + 1}: ${problem}`);
    for (const text of texts) history.push({ role: 'bot', text });
  }

  const last = answers[answers.length - 1];
  const lastText = lower(last.items.filter((it) => it.text).map((it) => it.text).join('\n'));
  const cards = answers.flatMap((a) => a.items.filter((it) => it.card).map((it) => it.card));
  const expect = test.expect || {};

  if (expect.language) {
    const said = ai.clientLanguage(last.items.filter((it) => it.text).map((it) => ({ role: 'client', text: it.text })));
    if (said && said !== expect.language) failures.push(`answered in ${said}, expected ${expect.language}`);
  }
  for (const text of expect.mentions || []) if (!lastText.includes(lower(text))) failures.push(`doesn't mention «${text}»`);
  if (expect.mentionsAny && !expect.mentionsAny.some((text) => lastText.includes(lower(text)))) {
    failures.push(`mentions none of «${expect.mentionsAny.join('», «')}»`);
  }
  for (const text of expect.avoid || []) if (lastText.includes(lower(text))) failures.push(`says «${text}»`);
  if (expect.card && !cards.some((c) => c.type === expect.card || c.title === expect.card)) {
    failures.push(`no «${expect.card}» card (got: ${cards.map((c) => c.title || c.type).join(', ') || 'none'})`);
  }
  return failures;
}

(async () => {
  const wanted = process.argv.slice(2);
  const files = fs.readdirSync(EXAMS).filter((f) => f.endsWith('.json') && (!wanted.length || wanted.includes(f.replace('.json', ''))));
  let passed = 0;
  let total = 0;

  for (const file of files) {
    const slug = file.replace('.json', '');
    const bot = bots.get(slug);
    if (!bot) continue;
    console.log(`\n${bot.name}`);
    const tests = JSON.parse(fs.readFileSync(path.join(EXAMS, file), 'utf8'));

    for (const test of tests) {
      total++;
      const visitor = crypto.randomUUID();
      const started = Date.now();
      const answers = [];
      try {
        for (const text of test.say) {
          answers.push(await reply.send({ slug, visitor, texts: [text], batch: crypto.randomUUID(), ip: 'exam' }));
        }
        const failures = check(bot, test, answers);
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        if (failures.length) {
          console.log(`  ${red('✗')} ${test.name} ${grey(`(${seconds}s)`)}`);
          for (const failure of failures) console.log(`      ${red(failure)}`);
          for (const [i, answer] of answers.entries()) {
            console.log(grey(`      client: ${test.say[i]}`));
            console.log(grey(`      assistant: ${answer.items.map((it) => (it.card ? `[${it.card.title || it.card.type}]` : it.text.replace(/\n/g, ' / '))).join(' | ')}`));
          }
        } else {
          passed++;
          console.log(`  ${green('✓')} ${test.name} ${grey(`(${seconds}s)`)}`);
        }
      } catch (e) {
        console.log(`  ${red('✗')} ${test.name}: ${red(e.message)}`);
      } finally {
        await reply.restart({ slug, visitor }).catch(() => {});
      }
    }
  }

  console.log(`\n${passed === total ? green(`All ${total} tests passed.`) : red(`${passed}/${total} tests passed.`)}\n`);
  process.exit(passed === total ? 0 : 1);
})();
