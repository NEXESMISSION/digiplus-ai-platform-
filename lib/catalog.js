// A shop's catalogue: search it, show it, and price an order from it.
// Prices always come from here, never from what the AI writes.

const normalize = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// How clients write things (Derja, short forms) → the catalogue's words.
const ALIASES = {
  'gato': 'gateau', 'gatou': 'gateau', 'gateaux': 'gateau',
  'choco': 'chocolat', 'chocola': 'chocolat', 'chocolate': 'chocolat',
  'fraise': 'fraisier', 'fraises': 'fraisier', 'frez': 'fraisier',
  'baklewa': 'baklawa', 'ba9lewa': 'baklawa', 'baklava': 'baklawa',
  'makrouth': 'makroud', 'makroudh': 'makroud', 'ma9roudh': 'makroud', 'ma9roud': 'makroud',
  'ka3k': 'kaak',
  'anniv': 'anniversaire', '3id': 'fete', 'aid': 'fete', 'mariage': 'fete', '3ors': 'fete', '3ers': 'fete',
  'tiramisou': 'tiramisu', 'plateaux': 'plateau', 'mignardise': 'mignardises',
};

const categoryName = (catalog, id) => catalog.categories.find((c) => c.id === id)?.name || id;
const priceFrom = (product) => Math.min(...product.options.map((o) => o.price));

function search(catalog, { query = '', category = '' } = {}, limit = 6) {
  const words = normalize(query)
    .split(' ')
    .map((w) => ALIASES[w] || w)
    .filter((w) => w.length > 1);
  const wanted = normalize(category);
  const results = [];
  for (const product of catalog.products) {
    if (wanted && ![normalize(product.category), normalize(categoryName(catalog, product.category))].some((c) => c.includes(wanted))) continue;
    const name = normalize(product.name);
    const haystack = normalize([product.name, product.description, categoryName(catalog, product.category), ...(product.tags || [])].join(' '));
    const score = words.length ? words.reduce((sum, w) => sum + (name.includes(w) ? 3 : haystack.includes(w) ? 1 : 0), 0) : 1;
    if (score > 0) results.push({ product, score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit).map((r) => r.product);
}

// "10", "10 pers", "1kg" → the option they mean.
function findOption(product, label) {
  const wanted = normalize(label).replace(/\s/g, '');
  return (
    product.options.find((o) => normalize(o.label).replace(/\s/g, '') === wanted) ||
    product.options.find((o) => normalize(o.label).replace(/\s/g, '').startsWith(wanted)) ||
    null
  );
}

// Prices an order from the catalogue. Returns {lines, total} or {error} (for the AI to fix).
function priceOrder(catalog, { items, delivery }) {
  if (!Array.isArray(items) || !items.length) return { error: 'The order has no product.' };
  const lines = [];
  for (const item of items) {
    const product = catalog.products.find((p) => p.id === item.product);
    if (!product) return { error: `"${item.product}" is not in the catalogue. Use a product id from the catalogue.` };
    const option = findOption(product, item.option);
    if (!option) return { error: `"${item.option}" is not a size of ${product.name}. Sizes: ${product.options.map((o) => o.label).join(', ')}.` };
    const quantity = Math.max(1, Math.min(20, Math.round(Number(item.quantity) || 1)));
    lines.push({ product: product.id, category: product.category, name: product.name, option: option.label, quantity, price: option.price * quantity });
  }
  const fee = delivery === 'livraison' ? catalog.delivery.fee : 0;
  const total = lines.reduce((sum, l) => sum + l.price, 0) + fee;
  return { lines, fee, total };
}

// Every amount this shop can quote, so a reply with any other price is caught.
function amounts(catalog) {
  const set = new Set([catalog.delivery.fee]);
  for (const p of catalog.products) for (const o of p.options) set.add(o.price);
  return set;
}

// What the AI reads about the catalogue.
function promptText(catalog) {
  const lines = catalog.categories.map((c) => {
    const products = catalog.products
      .filter((p) => p.category === c.id)
      .map((p) => `  - ${p.name} [id: ${p.id}]: ${p.options.map((o) => `${o.label} ${o.price}dt`).join(', ')}. ${p.notice}.`);
    return `${c.name}:\n${products.join('\n')}`;
  });
  return `# Catalogue — the ONLY products and prices\n${lines.join('\n')}\nDelivery in ${catalog.delivery.area}: ${catalog.delivery.fee}dt. Pick-up at the shop: ${catalog.hours.label}.`;
}

// What the chat page shows (no internal fields).
const publicView = (catalog) => ({
  currency: catalog.currency,
  categories: catalog.categories,
  products: catalog.products.map((p) => ({ ...p, image: `/img/catalog/${p.id}.webp`, from: priceFrom(p) })),
  delivery: catalog.delivery,
  hours: catalog.hours,
});

module.exports = { search, priceOrder, amounts, promptText, publicView, priceFrom };
