// Prints the photo prompts for a catalogue. The pictures are made in ChatGPT in the browser
// (included in the account), never with the paid API — see lib/no-image-api.js.
//   node tools/catalog-images.js patisserie-nour            → the prompts for the missing photos
//   node tools/catalog-images.js patisserie-nour fraisier   → one prompt
// Save what ChatGPT gives you as public/img/catalog/<product>.webp (square, about 760px).
require('../lib/no-image-api');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const [slug, ...only] = process.argv.slice(2);
if (!slug) {
  console.error('Usage: node tools/catalog-images.js <catalogue> [product …]');
  process.exit(1);
}
const catalog = require(path.join(ROOT, 'data', `${slug}.json`));
const OUT = path.join(ROOT, 'public', 'img', 'catalog');

const STYLE =
  'Appetizing professional food photograph for an online shop catalogue. Seen from a slight 45-degree angle, the whole product ' +
  'centred and fully in frame with space around it, on a light beige linen tablecloth, soft natural window light, warm and ' +
  'fresh colours, shallow depth of field, plain softly blurred background. A pastry shop in Sfax, Tunisia. ' +
  'No text, no letters, no logos, no hands, no people. Square image.';

const todo = catalog.products.filter((p) => (only.length ? only.includes(p.id) : !fs.existsSync(path.join(OUT, `${p.id}.webp`))));
if (!todo.length) {
  console.log('Every product already has a photo.');
  process.exit(0);
}

console.log(`\nPaste this in ChatGPT (one message), then save each picture as public/img/catalog/<id>.webp\n`);
console.log(`Style for all of them: ${STYLE}\n`);
for (const product of todo) {
  console.log(`— ${product.id}: ${product.name}: ${product.description}`);
}
console.log(`\n${todo.length} photo(s) to make.\n`);
