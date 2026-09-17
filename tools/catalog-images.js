// Makes a photo for every product of a catalogue that doesn't have one yet (OpenAI images).
//   node tools/catalog-images.js patisserie-nour            → public/img/catalog/<product>.webp
//   node tools/catalog-images.js patisserie-nour fraisier   → only that product (replaces it)
// Needs OpenAI credits. About 0.20$ per photo.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

const [slug, ...only] = process.argv.slice(2);
if (!slug) {
  console.error('Usage: node tools/catalog-images.js <catalogue> [product …]');
  process.exit(1);
}
const catalog = require(path.join(ROOT, 'data', `${slug}.json`));
const OUT = path.join(ROOT, 'public', 'img', 'catalog');
fs.mkdirSync(OUT, { recursive: true });

const STYLE =
  'Appetizing professional food photograph for an online shop catalogue. Seen from a slight 45-degree angle, the whole product ' +
  'centred and fully in frame with space around it, on a light beige linen tablecloth, soft natural window light, warm and ' +
  'fresh colours, shallow depth of field, plain softly blurred background. A pastry shop in Sfax, Tunisia. ' +
  'No text, no letters, no logos, no hands, no people.';

async function photograph(product) {
  const prompt = `${product.name}: ${product.description} ${STYLE}`;
  for (const model of ['gpt-image-2', 'gpt-image-1.5']) {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model, prompt, size: '1024x1024', quality: 'high', output_format: 'webp', output_compression: 80, n: 1 }),
      signal: AbortSignal.timeout(300_000),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.data?.[0]?.b64_json) {
      fs.writeFileSync(path.join(OUT, `${product.id}.webp`), Buffer.from(data.data[0].b64_json, 'base64'));
      return `${model} ok`;
    }
    console.log(`  ${product.id}: ${model} refused (${res.status}: ${data.error?.message || 'no image'})`);
    if (res.status === 429 && /credit|quota/i.test(data.error?.message || '')) throw new Error('No OpenAI credits left.');
  }
  throw new Error('No model made the photo.');
}

(async () => {
  const todo = catalog.products.filter((p) => (only.length ? only.includes(p.id) : !fs.existsSync(path.join(OUT, `${p.id}.webp`))));
  if (!todo.length) return console.log('Every product already has a photo.');
  console.log(`Making ${todo.length} photo(s)…`);
  // Three at a time: fast, without hitting the rate limit.
  for (let i = 0; i < todo.length; i += 3) {
    await Promise.all(
      todo.slice(i, i + 3).map(async (product) => {
        try {
          console.log(`  ${product.id}: ${await photograph(product)}`);
        } catch (e) {
          console.log(`  ${product.id}: FAILED — ${e.message}`);
        }
      })
    );
  }
})();
