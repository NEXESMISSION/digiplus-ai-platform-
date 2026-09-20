// Approved lines: the exact messages for the moments that come back in every chat, checked by a Tunisian.
// They live in the brain files (and in voice.md for every assistant):
//
//   @call-owner · they want Yasmine to call them
//   Derja: Ey akid 😊
//          Ab3athli esmek w noumrou mte3ek, w Yasmine t3ayetlek
//   French: Bien sûr 😊
//           Envoyez-moi votre nom et votre numéro, et Yasmine vous appelle.
//
// Each "Derja:" or "French:" starts one message; indented lines continue it.
//
// Who asks for an id has changed, and that is the point of this file now. The model used to answer
// with one — «@call-owner» as its whole message — and it turned the assistant into a menu: measured
// on the owner's own chat, it answered «@what-there-is» to «advise me» and to «I didn't like it»,
// and the client got the catalogue twice. The model no longer sees an id (lib/ai.js hides them) and
// may no longer send one (lib/reply.js drops it). The caller is the CODE: at the moments it already
// knows — an order saved, a booking made, the details sent — lib/reply.js asks for the id it chose
// and sends the owner's words word for word, instead of hoping the model picks the same one.
//
// The lines are read for two more things, both of them still true of every id in the brain files:
// lib/ai.js shows their text to the model as examples of how the shop talks, and lib/validate.js
// treats a message that IS one of them as the owner's voice and leaves its style alone.
const fs = require('fs');
const path = require('path');

const BRAIN_DIR = path.join(__dirname, '..', 'brain');
const ID = /^@([a-z0-9]+(?:-[a-z0-9]+)*)$/;

function parse(markdown) {
  const lines = new Map();
  let line = null; // the block being read
  let open = null; // the list whose last message indented lines continue
  for (const raw of String(markdown).split(/\r?\n/)) {
    const head = raw.match(/^@([a-z0-9]+(?:-[a-z0-9]+)*)\b/);
    if (head) {
      line = { derja: [], fr: [] };
      lines.set(head[1], line);
      open = null;
      continue;
    }
    if (raw.startsWith('#')) {
      line = null;
      open = null;
      continue;
    }
    if (!line) continue;
    const start = raw.match(/^(Derja|French):\s*(.*)$/);
    if (start) {
      open = start[1] === 'French' ? line.fr : line.derja;
      open.push(start[2].trim());
    } else if (open && /^\s+\S/.test(raw)) {
      open[open.length - 1] += `\n${raw.trim()}`;
    } else {
      open = null;
    }
  }
  return lines;
}

const cache = new Map();
function forBot(bot) {
  if (!cache.has(bot.slug)) {
    const read = (file) => parse(fs.readFileSync(path.join(BRAIN_DIR, file), 'utf8'));
    cache.set(bot.slug, new Map([...read('voice.md'), ...read(bot.brain)]));
  }
  return cache.get(bot.slug);
}

// "@call-owner" → its approved messages in the client's language (Derja unless they write French).
// Anything else is passed through as it is. Unknown ids are dropped.
// The flag travels with each message because once the id is gone nothing can tell the owner's own
// words from the AI writing the same thing, and the style checks must only correct the AI.
//
// What is handed to it is what changed. It used to be the model's own messages, so that an id it
// emitted became the owner's text; lib/reply.js now hands it the ids the CODE chose for this answer,
// and never the model's words. The shape is unchanged on purpose: tools/bench.js calls it the old
// way on the raw model output (bench.js:265) to show what an answer would have expanded to, and an
// id that reaches it from the model is a bug reply.js has already dropped and logged.
function expand(bot, texts, language) {
  const out = [];
  const approved = [];
  for (const text of texts) {
    const id = String(text).trim().match(ID)?.[1];
    if (!id) {
      out.push(text);
      approved.push(false);
      continue;
    }
    const line = forBot(bot).get(id);
    const messages = line && (language === 'fr' ? line.fr : line.derja);
    if (messages?.length) {
      out.push(...messages);
      approved.push(...messages.map(() => true));
    } else console.log(`[${bot.slug}] unknown approved line @${id}`);
  }
  return { texts: out, approved };
}

module.exports = { parse, forBot, expand };
