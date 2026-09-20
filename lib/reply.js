// One send from the chat page: store the client's messages, let the AI answer
// (saving details or a booking on the way), store the answer and return it.
const crypto = require('crypto');
const bots = require('./bots');
const store = require('./store');
const ai = require('./ai');
const tools = require('./tools');
const schedule = require('./schedule');
const guard = require('./guard');
const lines = require('./lines');
const repeat = require('./repeat');
const { validate, scriptOf, visible } = require('./validate');

// Lines that tell the client their request is saved: they may only go out with the card.
const SAVED_LINES = new Set(['saved', 'saved-today', 'saved-tomorrow', 'order-sent', 'booking-sent', 'call-saved']);

const MAX_TEXT = 600; // characters per message
const MAX_TEXTS = 6; // messages per send
const PER_HOUR = 40; // messages per hour from one connection, all chats together
const PER_CHAT = 120; // messages in one conversation
const HISTORY = 40; // messages the AI reads
const TOOL_ROUNDS = 2;

// Written by hand, used when the AI can't answer. The conversation is saved, so asking for the
// number lets the owner call back from the inbox.
const FALLBACK = {
  derja: 'Sama7ni, ma najjemch njawbek tawa 🙏\nEkteblna noumrou mte3ek, w nkallmouk fissa3.',
  fr: 'Désolé, je ne peux pas vous répondre pour le moment 🙏\nLaissez-nous votre numéro, on vous rappelle très vite.',
};
const TOO_LONG = {
  derja: 'El conversation hedhi walet twila barcha 🙏\nEnzel 3al bouton "Recommencer" el fou9 bech nebdew men jdid.',
  fr: 'Cette conversation est devenue trop longue 🙏\nAppuyez sur « Recommencer » en haut pour en commencer une nouvelle.',
};
// answerLanguage, not clientLanguage: a hand-written text is an answer, and it must come out in the
// same language answer() would have used — clientLanguage returns null on a history that shows
// neither language, and that silently picked Derja on a French chat.
const inLanguage = (texts, history) => texts[ai.answerLanguage(history) === 'fr' ? 'fr' : 'derja'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ChatError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const hashIp = (ip) => crypto.createHash('sha256').update(`digiplus-ai:${ip || 'unknown'}`).digest('hex').slice(0, 32);

function botOrThrow(slug) {
  const bot = bots.get(String(slug || ''));
  if (!bot) throw new ChatError(404, 'unknown_bot');
  return bot;
}

function visitorOrThrow(visitor) {
  if (!UUID.test(String(visitor || ''))) throw new ChatError(400, 'bad_visitor');
  return String(visitor).toLowerCase();
}

// The page opens: who the assistant is, and the conversation so far.
async function load({ slug, visitor }) {
  const bot = botOrThrow(slug);
  let items = [];
  if (UUID.test(String(visitor || ''))) {
    const conversation = await store.findConversation(bot.slug, String(visitor).toLowerCase());
    if (conversation) items = await store.lastItems(conversation.id, 300);
  }
  return { bot: bots.publicInfo(bot), items };
}

// The two verdicts of validate.scriptOf that mean "there are Arabic letters in this message".
const ARABIC_SCRIPT = new Set(['arabic', 'mixed']);

// A watch row is only ever read in the log, and the log of a real chat carries whatever the client
// typed: their name, their phone number. The validator already cuts the context to 40 characters
// and blanks long runs of digits; a watched word can be a number itself, so it is blanked here too.
const noDigits = (text) => String(text).replace(/\d{6,}/g, '######');

// The client's own last words: some rules read them (an answer may be longer when the client asked
// for detail).
const lastClientText = (history) =>
  history
    .filter((item) => item.role === 'client' && item.text)
    .map((item) => item.text)
    .pop() || '';

async function answer(bot, conversation, history) {
  const now = new Date();
  const slots = bot.booking ? await tools.freeSlots(bot, now) : null;
  const toolList = tools.definitions(bot);
  const language = ai.answerLanguage(history);
  const reminder = { fr: ' Write your answer in French.', derja: ' Write your answer in Tunisian Arabizi.' }[language] || '';
  const messages = [
    { role: 'developer', content: ai.instructions(bot, { now: schedule.nowLabel(now), slots: slots?.slice(0, 40), language }) },
    ...ai.toTurns(history),
  ];
  // Said again after the chat: the model otherwise sometimes copies the French approved lines.
  if (reminder) messages.push({ role: 'developer', content: reminder.trim() });
  const cards = [];
  const toolResults = [];
  let rewritten = false;
  // The page greeted the client itself, so those messages are not in the history: the assistant
  // must not send them again either.
  const greeted = bot.welcome.map((text) => ({ role: 'bot', text }));

  for (let round = 0; ; round++) {
    const lastRound = round >= TOOL_ROUNDS;
    const reply = await ai.complete(messages, { tools: toolList, toolChoice: lastRound && toolList.length ? 'none' : undefined });

    if (!lastRound && reply.tool_calls?.length) {
      messages.push({ role: 'assistant', content: reply.content || null, tool_calls: reply.tool_calls });
      for (const call of reply.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || '{}');
        } catch {}
        const out = await tools.run(bot, conversation, call.function?.name, args).catch((e) => {
          console.error(`[${bot.slug}] tool ${call.function?.name} failed: ${e.message}`);
          return { result: 'Failed because of a technical problem. Tell the client there was a small problem and to try again.' };
        });
        if (out.card) cards.push(out.card);
        toolResults.push(out.result);
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.result + reminder });
      }
      continue;
    }

    let { messages: texts, choices, showSlots } = ai.readAnswer(reply.content);
    // "@ask-name-phone" → the line the owner approved, word for word.
    const usedLines = texts.map((text) => String(text).trim().match(/^@([a-z0-9-]+)$/)?.[1]).filter(Boolean);
    // The approved flags are cut with the texts they belong to: the two lists stay index for index.
    const expanded = lines.expand(bot, texts, language);
    texts = expanded.texts.slice(0, 3);
    const approved = expanded.approved.slice(0, 3);

    // The last look at the answer: words that are the same in Tunisian whatever the sentence are
    // corrected here without asking the AI again, the rest becomes issues below. The greeting the
    // page sent is part of the history the validator reads — the client has already seen it.
    const report = validate(bot, {
      texts,
      choices,
      language,
      history: [...greeted, ...history],
      toolResults,
      approved,
      clientText: lastClientText(history),
    });
    texts = report.texts;
    choices = report.choices;
    // A 'drop' verdict means the message may not be sent at all (validate.js:6). Nothing drops today
    // — the list above is already cut to three, so TOO-MANY-MESSAGES never fires — but reading the
    // set here is what keeps the next drop rule from being inert the day it is written.
    if (report.drop.size) texts = texts.filter((_, index) => !report.drop.has(index));
    // Nothing empty goes out. validate() takes an emptied message out itself — that is its contract
    // and that is where the fix that empties one lives — but the wire is here, so what this file is
    // about to hand over is checked here too: an empty item is a visible grey bubble in
    // public/chat.js, store.addBotItems saves it, and it comes back on every page load, forever.
    // trim() is enough on this line: report.texts has been through validate's normalise, which takes
    // the invisibles out. Below, after the salvage, it is not the same string any more.
    texts = texts.filter(visible);
    // "Tunisian fixes" is the phrase tools/bench.js counts every run (bench.js:171): the wording is
    // part of what the log promises, not decoration.
    if (report.changed.length) {
      const fixes = report.changed.map((fix) => `${fix.found} → ${fix.expected || '(removed)'}`);
      console.log(`[${bot.slug}] Tunisian fixes: ${fixes.join(', ')}`);
    }
    // A watched word goes out with the answer and a Tunisian labels it once a week, so this log is
    // the whole of the review queue: without it the word is simply gone.
    for (const row of report.watch) {
      const what = row.rule === 'UNKNOWN-WORD' ? 'unknown word' : row.rule.toLowerCase().replace(/-/g, ' ');
      console.log(`[${bot.slug}] ${what} «${noDigits(row.token)}» in «${noDigits(row.message)}»`);
    }

    // A tool refused what the client gave (a phone number of 5 digits…): asking again, with the reason,
    // is not repeating oneself.
    const toolRefused = toolResults.some((result) => /^Not (saved|booked)/i.test(String(result)));

    // Before anything goes out: prices must exist, Derja must be Tunisian, and nothing may be said twice.
    const issues = [
      ...report.issues,
      ...guard.problems(bot, { texts: [...texts, ...choices], language, toolResults }),
      ...(toolRefused ? [] : repeat.problems(texts, [...greeted, ...history])),
    ];
    // Never tell the client it is saved when nothing was saved.
    if (!cards.length && usedLines.some((id) => SAVED_LINES.has(id))) {
      issues.push('you sent the line that says the request is saved, but nothing was saved yet: save it first, or ask for what is still missing');
    }
    if (issues.length && !rewritten) {
      console.log(`[${bot.slug}] rewriting a reply: ${issues.join('; ')}`);
      rewritten = true;
      messages.push(
        { role: 'assistant', content: reply.content || '' },
        {
          role: 'developer',
          content: `Fix your answer before it is sent: ${issues.join('; ')}. Rewrite it with the same meaning, in the same JSON format.`,
        }
      );
      round = TOOL_ROUNDS - 1; // the rewrite is a plain answer, no tools
      continue;
    }
    if (issues.length) {
      // Still wrong after the rewrite: never send a price that doesn't exist, never say it twice.
      console.log(`[${bot.slug}] still wrong after rewrite: ${issues.join('; ')}`);
      // readAnswer no longer transliterates, so the validator reads the letters the model really
      // wrote. The rewrite was its chance to write them in Latin; this is the last net before a
      // client who writes Arabizi is sent Arabic script. It runs before the price filter because an
      // Arabic-Indic price only becomes a number guard.js can read once it is in Latin digits.
      const toLatin = (text) => {
        if (!ARABIC_SCRIPT.has(scriptOf(text))) return text;
        const latin = ai.toLatin(text);
        // Window on the first character that actually differs, not on the first 40. Truncating both
        // sides at a fixed 40 printed a real change as «X → X» whenever the Arabic sat further in,
        // which is the same false "fix" log that hid the transliteration bug for weeks.
        let at = 0;
        while (at < text.length && text[at] === latin[at]) at++;
        const window = (s) => `${at > 12 ? '…' : ''}${s.slice(Math.max(0, at - 12), at + 28)}${s.length > at + 28 ? '…' : ''}`;
        console.log(`[${bot.slug}] Arabic letters transliterated: «${window(text)}» → «${window(latin)}»`);
        return latin;
      };
      // A choice is sent with the answer and is read by the same client, so both nets run on it too:
      // a price that doesn't exist must not arrive on a tappable button either.
      texts = texts.map(toLatin);
      choices = choices.map(toLatin);
      // The salvage writes new strings after validate() has stopped looking, and toLatin deletes an
      // Arabic letter it has no Arabizi spelling for: «ـ» comes back «». So the same guard again,
      // and on the choices as well — an empty bubble is bad, an empty button is worse, it is
      // tappable. Nothing empty is left for the throw below to count.
      texts = texts.filter(visible);
      choices = choices.filter(visible);
      texts = texts.filter((text) => !guard.unknownPrice(bot, text, toolResults));
      choices = choices.filter((choice) => !guard.unknownPrice(bot, choice, toolResults));
      const twins = repeat.repeated(texts, [...greeted, ...history]);
      const fresh = texts.filter((text) => !twins.has(text));
      if (fresh.length) texts = fresh;
      if (!texts.length && !cards.length) throw new Error('Only wrong prices left after the rewrite');
    }

    const items = texts.map((text) => ({ text }));
    items.push(...cards.map((card) => ({ card })));
    if (showSlots && bot.booking) {
      const card = await tools.slotsCard(bot);
      if (card.slots.length) items.push({ card });
    }
    if (!items.length) throw new Error('The AI returned nothing to send');
    return { items, choices: showSlots ? [] : choices, toolResults };
  }
}

// What a send gives back. toolResults — what the server told the AI while it was answering, a
// computed total among it — travels with the answer because tools/exam.js cannot otherwise tell a
// total the server computed from a price the model invented. It is hidden from JSON.stringify: it is
// developer text, and api/chat.js sends this object to the browser exactly as it is.
const sendable = ({ items, choices = [], toolResults = [] }) =>
  Object.defineProperty({ items, choices }, 'toolResults', { value: toolResults });

async function send({ slug, visitor, texts, batch, ip }) {
  const bot = botOrThrow(slug);
  const visitorId = visitorOrThrow(visitor);
  if (!UUID.test(String(batch || ''))) throw new ChatError(400, 'bad_batch');
  const list = (Array.isArray(texts) ? texts : [])
    .filter((t) => typeof t === 'string' && t.trim())
    .map((t) => t.trim().slice(0, MAX_TEXT))
    .slice(0, MAX_TEXTS);
  if (!list.length) throw new ChatError(400, 'empty');

  const ipHash = hashIp(ip);
  const [sentLastHour, conversation] = await Promise.all([
    store.clientMessagesFromIpSince(ipHash, new Date(Date.now() - 3_600_000)),
    store.openConversation({ bot: bot.slug, visitorId, ipHash }),
  ]);
  if (sentLastHour >= PER_HOUR) throw new ChatError(429, 'too_many');

  const fresh = await store.addClientMessages(conversation.id, list, batch);
  if (!fresh) {
    const earlier = await store.repliesAfterBatch(conversation.id, batch);
    if (earlier.length) return sendable({ items: earlier.map(({ text, card }) => ({ text, card })) });
  }

  const [total, history] = await Promise.all([store.clientMessageCount(conversation.id), store.lastItems(conversation.id, HISTORY)]);
  let result;
  if (total > PER_CHAT) {
    result = { items: [{ text: inLanguage(TOO_LONG, history) }], choices: [] };
  } else {
    try {
      const started = Date.now();
      result = await answer(bot, conversation, history);
      console.log(`[${bot.slug}] answered in ${Date.now() - started} ms`);
    } catch (e) {
      console.error(`[${bot.slug}] reply failed for ${conversation.id}: ${e.message}`);
      result = { items: [{ text: inLanguage(FALLBACK, history) }], choices: [] };
    }
  }

  await store.addBotItems(conversation.id, result.items);
  return sendable(result);
}

async function restart({ slug, visitor }) {
  const bot = botOrThrow(slug);
  await store.deleteConversation(bot.slug, visitorOrThrow(visitor));
}

module.exports = { load, send, restart, ChatError };
