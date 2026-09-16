// Tunisian clients write in Arabizi (Latin letters plus digits: 3 = ع, 7 = ح, 9 = ق).
// Told only to "match the client's language", the model drifts into Arabic script
// mid-sentence — "kif nجم n3awnك" — which looks broken to everyone. Prompting alone
// does not stop it, so the alphabet is decided here and the output is repaired.

const ARABIC_G = /[؀-ۿݐ-ݿ]/g;
const ARABIC = /[؀-ۿݐ-ݿ]/;

function detectAlphabet(text) {
  const arabic = (String(text).match(ARABIC_G) || []).length;
  const latin = (String(text).match(/[A-Za-z]/g) || []).length;
  return arabic > latin ? 'arabic' : 'latin';
}

const ALPHABET_RULE = {
  latin: `ALPHABET — this is absolute: write every single string using ONLY Latin letters (a-z), digits and normal punctuation.
Tunisian Arabizi writes Arabic sounds with digits: 3 = ع, 7 = ح, 9 = ق, 5 = خ, 2 = ء. Use that.
Your JSON must not contain ONE Arabic-script character anywhere. Not in a word, not in a title, not in a goal name.
Wrong: "kif nجم n3awnك". Right: "kif njem n3awnek".`,
  arabic: `ALPHABET — this is absolute: write every single string using ONLY Arabic script.
Do not mix in Latin letters, except inside a price unit, a phone number, or a brand name that is really written in Latin letters.`,
};

// Vowels are lost ("نجم" becomes "njm"), which still reads fine inside a Latin
// sentence and is always better than two alphabets in one word.
const ARABIZI = {
  'ا': 'a', 'آ': 'a', 'أ': 'a', 'إ': 'i', 'ٱ': 'a', 'ى': 'a', 'ة': 'a',
  'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j', 'ح': '7', 'خ': 'kh',
  'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'ch',
  'ص': 's', 'ض': 'dh', 'ط': 't', 'ظ': 'dh', 'ع': '3', 'غ': 'gh',
  'ف': 'f', 'ق': '9', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n',
  'ه': 'h', 'و': 'w', 'ي': 'y', 'ی': 'y', 'پ': 'p', 'چ': 'ch', 'ڤ': 'v', 'ڨ': 'g',
  'ء': '2', 'ئ': '2', 'ؤ': '2',
  '،': ',', '؛': ';', '؟': '?', '٪': '%',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};
const DROP = /[ؐ-ًؚ-ٰٟـ]/g; // harakat, shadda, tatweel

function arabizify(text) {
  if (!ARABIC.test(text)) return text;
  return text
    .replace(DROP, '')
    .replace(ARABIC_G, (c) => ARABIZI[c] ?? '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// Walks a string, an array or a whole settings object and fixes every field that
// came back in the wrong alphabet. Returns how many it had to touch.
function repairAlphabet(value, alphabet) {
  if (alphabet !== 'latin') return { value, fixed: 0 };
  let fixed = 0;
  const walk = (v) => {
    if (typeof v === 'string') {
      const out = arabizify(v);
      if (out !== v) fixed += 1;
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), fixed };
}

module.exports = { detectAlphabet, arabizify, repairAlphabet, ALPHABET_RULE };
