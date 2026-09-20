// The last check before a Derja answer is sent. Two lists, from the Tunisian library
// (Desktop/digiplus/tunisian-library/09-non-tunisian-traps.md) and a native review:
//
// SWAP  — the Tunisian word is always the same one, whatever the sentence: the word is replaced, silently.
// FLAG  — the word is not Tunisian here, but the right word depends on the sentence: the answer is rewritten.
//
// Add a word to the right list and every assistant follows.

// [not Tunisian, what a Tunisian writes]
const SWAP = [
  // Moroccan / Algerian
  ['bzaf', 'barcha'], ['bezzaf', 'barcha'], ['daba', 'tawa'], ['bghit', 'n7eb'],
  ['dyal', 'mte3'], ['dial', 'mte3'], ['nta3', 'mte3'],
  ['kifach', 'kifech'], ['kifash', 'kifech'], ['ch7al', '9adech'],
  ['wach', 'chnowa'], ['wesh', 'chnowa'], ['wech', 'chnowa'],
  ['hada', 'hedha'], ['hadi', 'hedhi'], ['hadak', 'hedheka'], ['hadik', 'hedhika'], ['hadou', 'hedhom'],
  ['kayen', 'famma'], ['kayn', 'famma'], ['makaynch', 'ma fammech'], ['makanch', 'ma fammech'],
  ['walou', '7atta chay'],
  // Egyptian
  ['izzay', 'kifech'], ['ezzay', 'kifech'], ['keda', 'haka'], ['mafeesh', 'ma fammech'], ['mafish', 'ma fammech'],
  ['delwa2ti', 'tawa'], ['leh', '3lech'], ['leih', '3lech'], ['emta', 'wa9tech'],
  ['bokra', 'ghodwa'], ['bukra', 'ghodwa'], ['ba3dein', 'mba3d'], ['ba3den', 'mba3d'], ['ba3dain', 'mba3d'],
  // Levantine / Gulf
  ['shu', 'chnowa'], ['shou', 'chnowa'], ['esh', 'chnowa'], ['aysh', 'chnowa'],
  ['biddi', 'n7eb'], ['baddak', 't7eb'], ['mnih', 'behi'], ['kteer', 'barcha'], ['ktir', 'barcha'],
  ['shway', 'chwaya'], ['lesh', '3lech'], ['leish', '3lech'], ['hon', 'houni'], ['hone', 'houni'],
  ['mafi', 'ma fammech'], ['shlon', 'kifech'], ['shloun', 'kifech'], ['al7een', 'tawa'], ['wayed', 'barcha'],
  // Standard Arabic written in Latin letters
  ['ayna', 'win'], ['kayfa', 'kifech'], ['mata', 'wa9tech'], ['limadha', '3lech'], ['kam', '9adech'],
  ['huna', 'houni'], ['hunaka', 'ghadi'], ['al2an', 'tawa'], ['ghadan', 'ghodwa'], ['jiddan', 'barcha'],
  ['qalilan', 'chwaya'], ['urid', 'n7eb'], ['hadhihi', 'hedhi'], ['hadhaaka', 'hedheka'], ['shukran', 'ya3tik essa7a'],
  // how we write Tunisian (house spelling)
  ['nheb', 'n7eb'], ['theb', 't7eb'], ['nhebou', 'n7ebbou'], ['mta3', 'mte3'], ['hadhom', 'hedhom'],
  ['hedhouma', 'hedhom'], ['eli', 'elli'], ['illi', 'elli'], ['chnoua', 'chnowa'], ['kifeh', 'kifech'],
  ['anhi', 'anahi'], ['anhou', 'anahou'], ['anhom', 'anahom'], ['ania', 'anahi'],
  ['smahli', 'sama7ni'], ['bch', 'bech'], ['bach', 'bech'], ['haja', '7aja'], ['okhra', 'o5ra'],
  // Drift caught in the owner's own replayed chat. The library writes 9adech 32 times, chnowa 102,
  // t7eb 78, and these three spellings not once, so there is nothing to weigh up.
  ['9addeh', '9adech'], ['9addech', '9adech'], ['chnawa', 'chnowa'], ['t7ib', 't7eb'], ['n7ib', 'n7eb'],
];

// [word, what to write instead — the assistant picks the right form]
// «ghir» and «mumkin» are deliberately absent: the library writes «men ghir ma…» (10 §5) and
// «arb3a ghir rob3» (12 §5), and «Ey mumkin» is an approved line (08-sales-conversations.md).
// They were in here and fired on correct Derja.
const FLAG = [
  ['ta3', 'mte3'], ['baad', 'ba3d'], ['fil', 'fel'], ['ila', 'ken'],
  ['njm', 'najjem'], ['nijem', 'najjem'], ['n9der', 'najjem'], ['n9adrou', 'najjmou'],
  ['nsa3dek', 'n3awnek'], ['twa7dha', 'wa7adha'], ['tafassil', 'les détails'], ['tfasil', 'les détails'],
  ['njah', 'ey'], ['na3am', 'ey'], ['tamam', 'behi'], ['tamem', 'behi'],
  // For food, Tunisians say bnin / bnina, never tayeb / tayba (that means cooked).
  ['tayeb', 'behi / bnin'], ['tayba', 'behya / bnina'], ['tayyeb', 'behi / bnin'], ['tayyba', 'behya / bnina'],
  ['safi', 'behi / 5las'], ['wakha', 'ey / behi'], ['zwin', 'behi / mezyen'], ['zwina', 'behya / mezyena'],
  ['7elw', 'behi'], ['7elwa', 'behya'], ['hna', 'houni'], ['hnaya', 'houni'], ['hne', 'houni'],
  ['fin', 'win'], ['fayn', 'win'], ['3ayez', 'n7eb / t7eb'], ['3awz', 'n7eb / t7eb'], ['3ayza', 'n7eb / t7eb'],
  ['3ashan', '5ater'], ['3alshan', '5ater'], ['halla', 'tawa'], ['hal2', 'tawa'], ['hassa', 'tawa'],
  ['zain', 'behi'], ['keefak', 'labes?'], ['kifak', 'labes?'], ['shlonak', 'labes?'],
  ['sorry', 'sama7ni'], ['sory', 'sama7ni'], ['chokran', 'ya3tik essa7a / merci'], ['choukran', 'ya3tik essa7a / merci'],
  ['yumkinuka', 'tnajjem'], ['nurid', 'n7ebbou'], ['sawfa', 'bech'], ['yujad', 'famma'],
];

const WORDS = new Map(FLAG);
const boundary = (word) => new RegExp(`(?<![\\p{L}\\d])${word}(?![\\p{L}\\d])`, 'giu');
const SWAPS = SWAP.map(([wrong, right]) => ({ wrong, right, pattern: boundary(wrong) }));

// "Ma3lich" means "no problem" / "never mind": opening an answer with it reads wrong.
const OPENERS = [[/^\s*ma3lich\b/i, 'starts with «Ma3lich» (it means «no problem», not «sorry»): say «Sama7ni» or nothing']];

// The words that are always the same word in Tunisian are simply replaced: no second call to the AI.
function fix(text) {
  let out = String(text || '');
  const changed = [];
  for (const { wrong, right, pattern } of SWAPS) {
    out = out.replace(pattern, (match) => {
      // Log the word that was really written, capital included: «Anhi → Anahi», never «Anhi → anahi».
      const written = match[0] === match[0].toUpperCase() ? right[0].toUpperCase() + right.slice(1) : right;
      changed.push(`${match} → ${written}`);
      return written;
    });
  }
  return { text: out, changed };
}

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

// The two tables are exported so lib/validate.js reads this list instead of keeping a second copy.
module.exports = { problems, fix, SWAP, FLAG };
