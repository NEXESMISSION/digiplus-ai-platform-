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

// ─── the lines the code says itself ──────────────────────────────────────────
//
// The model no longer picks an approved line: it never sees an id (lib/ai.js hides them) and may
// never send one (the net below drops it). What it saw instead was a menu, and a menu is what made
// it dumb — asked something no id covered it answered with the nearest one, and the client got the
// catalogue twice in the owner's own chat.
//
// But the sentence a client reads when their order has just been saved must still be the owner's,
// word for word. Those are exactly the moments lib/tools.js already knows about: it saved the order,
// it booked the time, it sent the details. So the code says them, from the same brain files, and
// stops hoping the model will choose the right id.
//
// What is NOT here, and why: show_products. The code knows the cards went out, but not whether the
// client asked what the shop has or asked about one cake — and answering both with one fixed
// sentence is the repetition the owner complained about. The tool result already tells the model
// what is on screen and to answer in one short line of its own. Same for a delivery outside the
// area: nothing in lib/tools.js decides it today (save_order never looks at the city), so the code
// has no moment to hang it on and it stays an example in the brain file.
const SPOKEN_BY_CODE = {
  save_order: ['order-sent'],
  book_appointment: ['booking-sent'],
  // One per bot — except Clim Express, which has two: a technician calls today, or tomorrow morning.
  save_details: ['saved-today', 'saved-tomorrow', 'saved', 'call-saved'],
};

// Lines that tell the client their request is saved: they may only go out with the card.
const SAVED_LINES = new Set(['saved', 'saved-today', 'saved-tomorrow', 'order-sent', 'booking-sent', 'call-saved']);

// The same claim in the model's own words. It used to be enough to watch the ids it sent, and there
// are no ids any more, so what is watched is what the client would read. The list is the one
// tools/bench-checks.js grades with (SAVED_SAID, bench-checks.js:162): the openings of the approved
// lines above, which is how the model writes the claim when it writes it itself. Saying «wsellna
// talabek» with nothing saved is the failure this exists to catch, and it costs one rewrite.
const SAVED_SAID = ['wsellna talabek', 'talabek wsel', 'commande mte3ek wslet', "c'est noté", 'votre commande est envoyée', 'votre demande est envoyée'];
// And the same claim copied out of the examples word for word. Half of those lines open on
// «Mrigel 😊» and say the rest in Derja the list above has no phrase for (@saved, @call-saved), and
// the model now reads them as examples, so copying one is the likeliest way it makes the claim.
// Compared on the letters alone: an emoji or a comma must not walk one past this.
const plain = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
const savedTexts = new Map();
function saysSaved(bot, texts) {
  if (!savedTexts.has(bot.slug)) {
    const set = new Set();
    for (const id of SAVED_LINES) {
      const line = lines.forBot(bot).get(id);
      for (const text of [...(line?.derja || []), ...(line?.fr || [])]) if (text.trim()) set.add(plain(text));
    }
    savedTexts.set(bot.slug, set);
  }
  const copied = savedTexts.get(bot.slug);
  return texts.some((text) => {
    const clean = String(text).toLowerCase().replace(/\s+/g, ' ');
    return SAVED_SAID.some((said) => clean.includes(said)) || copied.has(plain(text));
  });
}

// A message that is nothing but an id. After this change it cannot be an answer — it is the model
// reaching for a menu that no longer exists — and it would reach the client as a broken «@hello».
const BARE_ID = /^@[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

// Which approved line the code says after a tool ran — and only when it worked. The card is what
// says so: lib/tools.js returns one when it saved something and none when it refused ("Not saved:
// the phone number…"), and a confirmation over a refusal would be a lie in the owner's own words.
function spokenLine(bot, name, out) {
  if (!out.card) return null;
  const known = lines.forBot(bot);
  const ids = (SPOKEN_BY_CODE[name] || []).filter((id) => known.has(id));
  if (ids.length < 2) return ids[0] || null;
  // Two lines for one moment (Clim Express: the technician calls «el youm», or «ghodwa el sba7»).
  // The card the client is looking at has already made that choice — lib/bots.js writes it into the
  // footer — so the line is picked to match the card, instead of reading the clock a second time and
  // risking a message that says today under a card that says demain matin.
  const footer = String(out.card.footer || '').replace(/[.…\s]+$/, '');
  const match = footer && ids.find((id) => known.get(id).fr.some((text) => text.includes(footer)));
  if (!match) console.log(`[${bot.slug}] no approved line matches the card footer «${footer}»: sending @${ids[0]}`);
  return match || ids[0];
}

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
  const spoken = []; // the ids the code says itself this turn, in the order the tools ran
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
        // The catalogue is the one card that must never go out twice. brain/patisserie-nour.md says
        // so in as many words — «Sending the catalogue again is the worst thing you can do: they
        // have already read it» — and the model sent it twice anyway, in the owner's own chat and
        // again in the replay of it. A rule the model can read is a rule it can ignore, so this one
        // is code. What it still needs is to be told they have it, or it answers as if it had shown
        // nothing.
        if (out.card?.type === 'products' && history.some((item) => item.card?.type === 'products')) {
          console.log(`[${bot.slug}] catalogue already shown in this chat: card dropped`);
          out.card = null;
          out.result =
            `${out.result} The client has ALREADY been shown these cards earlier in this chat, so they are NOT being sent again. ` +
            'Do not list the products and do not tell them to look at the photos — they have them. Answer what they just asked. ' +
            'If you cannot answer it without knowing more, ask the one thing you still need, in one short question.';
        }
        if (out.card) cards.push(out.card);
        toolResults.push(out.result);
        // The line the code is about to send, shown to the model so it doesn't write the same
        // confirmation a second time. tools.js already asks it for "one short line" here; this says
        // that line is written.
        const say = spokenLine(bot, call.function?.name, out);
        let note = '';
        if (say) {
          // Once, however many times the tool ran: two save_orders in one answer are the same order
          // written over, and the client must not read the confirmation twice.
          if (!spoken.includes(`@${say}`)) spoken.push(`@${say}`);
          note = ` The client is already being sent this, word for word: «${lines.expand(bot, [`@${say}`], language).texts.join(' / ')}». Do not write it again and do not add to it.`;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.result + note + reminder });
      }
      continue;
    }

    let { messages: texts, choices, showSlots } = ai.readAnswer(reply.content);

    // The model answered with an id. It is shown none and told twice not to write one, so this is a
    // bug, not an answer: «@what-there-is» would reach the client as a broken bubble, and it is the
    // menu coming back. Dropped, said out loud, and sent back for a rewrite — an issue is what
    // tools/bench.js counts (it reads the «rewriting a reply:» line), so a run cannot miss it.
    const asIds = texts.filter((text) => BARE_ID.test(String(text).trim()));
    if (asIds.length) {
      texts = texts.filter((text) => !BARE_ID.test(String(text).trim()));
      console.log(`[${bot.slug}] the model answered with a line id instead of words: ${asIds.join(' ')} — dropped`);
    }

    // The moments the code owns. The owner's sentence goes out in place of the model's: the brain
    // files say so themselves («After it is sent: …, and nothing else»), the card carries the
    // details, and the tool result told the model this line was already on its way — so what it
    // wrote here is the same confirmation twice. The flags follow the texts, index for index.
    let approved = texts.map(() => false);
    if (spoken.length) {
      const owner = lines.expand(bot, spoken, language);
      if (owner.texts.length) {
        if (texts.length) console.log(`[${bot.slug}] ${spoken.join(' ')} said by the code: dropped «${texts.join(' | ').replace(/\s+/g, ' ').slice(0, 120)}»`);
        texts = owner.texts;
        approved = owner.approved;
        choices = [];
        // and the free-time buttons: the booking the code is confirming was just made from one of
        // them, so offering the list again under «your booking is confirmed» reads as a failure.
        showSlots = false;
      }
    }
    texts = texts.slice(0, 3);
    approved = approved.slice(0, 3);

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
      // Not the code's own line: it is sent because something was saved, and a second order in one
      // chat is not the assistant repeating itself. Asking for a rewrite of it would spend the one
      // rewrite there is on a sentence the code, not the model, chose.
      ...(toolRefused || spoken.length ? [] : repeat.problems(texts, [...greeted, ...history])),
    ];
    // Never tell the client it is saved when nothing was saved. There is no id to watch any more —
    // the code's own line only goes out with a card — so what is watched is what the client would
    // read: the claim in the model's own words, or one of those lines copied out of the examples.
    if (!cards.length && saysSaved(bot, texts)) {
      issues.push('you told the client their request is saved, but nothing was saved yet: save it first, or ask for what is still missing');
    }
    if (asIds.length) {
      issues.push(`you answered with ${asIds.join(' ')} instead of words: write the message yourself, in the words of the examples`);
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
      // It said "Only wrong prices left after the rewrite" when the price filter above was the only
      // thing that could empty the list. A message that is nothing but a line id is dropped before
      // any of this and reaches the same end, so the line that explains the fallback to the owner
      // names what actually happened instead of naming prices that were never the problem.
      if (!texts.length && !cards.length) throw new Error(`Nothing left to send after the rewrite: ${issues.join('; ').slice(0, 200)}`);
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
