// A last check before a Derja answer is sent: words that aren't Tunisian (or not how Tunisians write them).
// When one shows up, the answer is rewritten once. Add a word here and every assistant avoids it.

// [word as the AI writes it, what a Tunisian writes instead]
const NOT_TUNISIAN = [
  ['mumkin', 'tnajjem / ynajjem'],
  ['momkin', 'tnajjem / ynajjem'],
  ['baad', 'ba3d'],
  ['hne', 'houni'],
  ['hna', 'houni'],
  ['hnaya', 'houni'],
  ['fil', 'fel'],
  ['ta3', 'mte3'],
  ['nta3', 'mte3'],
  ['mta3', 'mte3'],
  ['dyal', 'mte3'],
  ['bch', 'bech'],
  ['bach', 'bech'],
  ['ila', 'ken'],
  ['njm', 'najjem'],
  ['nijem', 'najjem'],
  ['n9der', 'najjem'],
  ['n9adrou', 'najjmou'],
  ['nsa3dek', 'n3awnek'],
  ['twa7dha', 'wa7adha'],
  ['tafassil', 'les détails'],
  ['njah', 'ey'],
  ['na3am', 'ey'],
  ['tayeb', 'behi'],
  ['tamam', 'behi'],
  ['safi', 'behi'],
  ['sorry', 'sama7ni'],
  ['sory', 'sama7ni'],
  ['smahli', 'sama7ni'],
  ['chokran', 'ya3tik essa7a'],
  ['choukran', 'ya3tik essa7a'],
  ['haja', '7aja'],
  ['okhra', 'o5ra'],
  ['hada', 'hedha'],
  ['hadi', 'hedhi'],
  ['hedhouma', 'hedhom'],
  ['bzaf', 'barcha'],
  ['bezzaf', 'barcha'],
  ['daba', 'tawa'],
  ['bghit', 'n7eb'],
  ['wach', 'chnowa'],
  ['kifach', 'kifech'],
  ['ch7al', '9adech'],
  ['izzay', 'kifech'],
  ['keda', 'haka'],
  ['3ayez', 't7eb'],
  ['shu', 'chnowa'],
  ['kteer', 'barcha'],
  ['eli', 'elli'],
];
const WORDS = new Map(NOT_TUNISIAN);

// "Ma3lich" means "no problem" / "never mind": opening an answer with it reads wrong.
const OPENERS = [[/^\s*ma3lich\b/i, 'starts with «Ma3lich» (it means «no problem», not «sorry»): say «Sama7ni» or nothing']];

function problems(texts) {
  const found = new Set();
  for (const text of texts) {
    for (const word of String(text || '').toLowerCase().match(/[\p{L}\d]+/gu) || []) {
      if (WORDS.has(word)) found.add(`«${word}» → «${WORDS.get(word)}»`);
    }
    for (const [pattern, note] of OPENERS) if (pattern.test(text)) found.add(note);
  }
  return [...found];
}

module.exports = { problems };
