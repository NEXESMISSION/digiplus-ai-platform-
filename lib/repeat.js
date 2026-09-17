// Nothing makes a chat feel like a robot faster than saying the same thing again.
// Before an answer goes out, every message is compared with what the assistant already sent
// in this conversation. Too close to an earlier one → the answer is rewritten.
const clean = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim();

const wordsOf = (text) => clean(text).split(' ').filter((word) => word.length > 2);

// How much of the shorter message is already in the other one.
function sameness(a, b) {
  if (clean(a) && clean(a) === clean(b)) return 1; // word for word, however short
  const one = new Set(wordsOf(a));
  const two = new Set(wordsOf(b));
  if (one.size < 4 || two.size < 4) return 0; // a short line may come back in other words
  let shared = 0;
  for (const word of one) if (two.has(word)) shared += 1;
  return shared / Math.min(one.size, two.size);
}

const CLOSE = 0.75;
const short = (text) => `«${String(text).replace(/\s+/g, ' ').trim().slice(0, 40)}…»`;

// Saying an answer again is fine when the client asks for it again; asking the SAME thing again is not.
const ASKS = /\?\s*$|\b(ab3athli|ab3athili|9olli|9ouli|a3tini|3tini|envoyez|donnez|dites)\b/i;
const tooClose = (text, old) => {
  const score = sameness(text, old);
  return score >= 1 || (score >= CLOSE && ASKS.test(String(text).trim()));
};

// texts: the messages about to be sent. history: the conversation so far (items with role and text).
function problems(texts, history = []) {
  const earlier = history
    .filter((item) => item.role !== 'client' && item.text)
    .slice(-8)
    .map((item) => item.text);
  const found = [];
  const sent = [];
  for (const text of texts) {
    const twin = [...earlier, ...sent].find((old) => tooClose(text, old));
    if (twin) {
      found.push(
        `${short(text)} says again what you already sent (${short(twin)}): answer what the client just wrote instead, and don't ask again for something you already asked`
      );
    }
    sent.push(text);
  }
  return found;
}

// Which of these messages repeat something already sent (used when the rewrite didn't help).
function repeated(texts, history = []) {
  const earlier = history.filter((item) => item.role !== 'client' && item.text).slice(-8).map((item) => item.text);
  const keep = [];
  const drop = new Set();
  for (const text of texts) {
    if ([...earlier, ...keep].some((old) => tooClose(text, old))) drop.add(text);
    else keep.push(text);
  }
  return drop;
}

module.exports = { problems, repeated, sameness };
