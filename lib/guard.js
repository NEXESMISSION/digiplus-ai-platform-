// Checks on an answer before it goes out:
// - every price must be one this business really has (from its brain file, its catalogue, or a total the server computed);
// - a Derja answer must not use words Tunisians don't use (see derja.js).
const fs = require('fs');
const path = require('path');
const derja = require('./derja');
const ai = require('./ai');
const catalog = require('./catalog');

// "45dt", "1 875 dt", "39 DT", "15 dinars"
const AMOUNT = /(\d{1,3}(?:[  ]\d{3})+|\d+)\s?(?:dt|dinars?|tnd)\b/gi;
const amountsIn = (text) => [...String(text || '').matchAll(AMOUNT)].map((m) => Number(m[1].replace(/[  ]/g, '')));

const fromBusiness = new Map();
function knownAmounts(bot, extraTexts = []) {
  if (!fromBusiness.has(bot.slug)) {
    const brain = fs.readFileSync(path.join(__dirname, '..', 'brain', bot.brain), 'utf8');
    const amounts = new Set(amountsIn(brain));
    if (bot.catalog) for (const amount of catalog.amounts(bot.catalog)) amounts.add(amount);
    fromBusiness.set(bot.slug, amounts);
  }
  const amounts = new Set(fromBusiness.get(bot.slug));
  for (const text of extraTexts) for (const amount of amountsIn(text)) amounts.add(amount);
  return amounts;
}

// toolResults: what the server told the AI during this answer (it may contain a computed total).
function problems(bot, { texts, language, toolResults = [] }) {
  const found = language === 'derja' ? derja.problems(texts) : [];
  // The whole answer is in the client's language: never a French message in a Derja chat.
  for (const text of texts) {
    if (language === 'derja' && ai.looksFrench(text)) found.push(`«${String(text).slice(0, 30)}…» is written in French: the client writes Derja, write it in Tunisian Arabizi`);
    if (language === 'fr' && ai.looksDerja(text)) found.push(`«${String(text).slice(0, 30)}…» is written in Derja: the client writes French, write it in French`);
  }
  const known = knownAmounts(bot, toolResults);
  for (const amount of new Set(texts.flatMap(amountsIn))) {
    if (!known.has(amount)) found.push(`«${amount}dt» is not a price of this business: only use the prices written in your instructions`);
  }
  return found;
}

const unknownPrice = (bot, text, toolResults = []) => {
  const known = knownAmounts(bot, toolResults);
  return amountsIn(text).some((amount) => !known.has(amount));
};

module.exports = { problems, unknownPrice };
