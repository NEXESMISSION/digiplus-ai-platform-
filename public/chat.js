// The chat page: /chat/<assistant>. Talks to /api/chat.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const log = $('log');
  const form = $('form');
  const input = $('input');
  const sendButton = $('send');
  const restartButton = $('restart');
  const restartDialog = $('restart-dialog');

  const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || '') || new URLSearchParams(location.search).get('bot') || '';

  const ICONS = {
    check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    checkSmall: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    clockSmall: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    calendar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16"/><path d="M8.5 3.5v4"/><path d="M15.5 3.5v4"/></svg>',
    search: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 6l6 6-6 6"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5.5v13"/><path d="M5.5 12h13"/></svg>',
    image: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-4.8-4.8L6 19.5"/></svg>',
  };

  // ---------- small helpers ----------

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(name) {
    const holder = document.createElement('span');
    holder.innerHTML = ICONS[name];
    return holder.firstElementChild;
  }

  function uuid() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const storage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {}
    },
  };

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  let visitor = storage.get('digiplus-ai-visitor');
  if (!UUID.test(visitor || '')) {
    visitor = uuid();
    storage.set('digiplus-ai-visitor', visitor);
  }

  // Back goes to the page the visitor came from on this site, else to the home page.
  for (const link of document.querySelectorAll('[data-back]')) {
    link.addEventListener('click', (event) => {
      const cameFromHere = document.referrer && new URL(document.referrer).origin === location.origin;
      if (cameFromHere && history.length > 1) {
        event.preventDefault();
        history.back();
      }
    });
  }

  // ---------- drawing the conversation ----------

  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 140;
  const toBottom = (smooth = true) => log.scrollTo({ top: log.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

  function add(node, { animate = true, follow = false } = {}) {
    const stick = follow || atBottom();
    if (animate) node.classList.add('new');
    log.appendChild(node);
    if (stick) requestAnimationFrame(() => toBottom(animate));
    return node;
  }

  const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  let lastDay = null;
  function dayChip(when, options) {
    const date = when ? new Date(when) : new Date();
    const key = dayKey(date);
    if (key === lastDay) return;
    lastDay = key;
    const yesterday = new Date(Date.now() - 86_400_000);
    const label =
      key === dayKey(new Date())
        ? "Aujourd'hui"
        : key === dayKey(yesterday)
          ? 'Hier'
          : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
    add(el('div', 'day', label), options);
  }

  const bubble = (role, text, options) => add((role === 'client' && orderBubble(text)) || el('div', `msg ${role}`, text), options);

  // An order sent from the catalogue ("N7eb: Fraisier · 6 personnes × 2") shows the product with its photo.
  const ORDER = /^(?:🛒\s*)?N7eb:\s*(.+?)\s+·\s+(.+?)(?:\s+×\s+(\d+))?$/u;
  function orderBubble(text) {
    const match = bot?.catalog ? ORDER.exec(text) : null;
    const product = match && bot.catalog.products.find((p) => p.name === match[1]);
    if (!product) return null;
    const node = el('div', 'msg client order');
    const info = el('span', 'order-info');
    info.append(el('b', null, product.name), el('span', null, match[3] ? `${match[2]} × ${match[3]}` : match[2]));
    node.append(picture(product, 'pic order-pic'), info);
    return node;
  }

  // The card shown when a request is saved. Tapping it opens everything that was sent.
  const SHOWN_ROWS = 4;

  function cardHead(card) {
    const head = el('div', 'card-head');
    const badge = el('div', 'card-icon');
    badge.append(icon(card.icon === 'clock' ? 'clock' : 'check'));
    const titles = el('div', 'card-titles');
    titles.append(el('div', 'card-title', card.title), el('div', 'card-sub', card.subtitle));
    head.append(badge, titles);
    return head;
  }

  function cardRows(list) {
    const rows = el('div', 'card-rows');
    for (const [label, value] of list) {
      const row = el('div', 'card-row');
      row.append(el('span', null, label), el('span', null, value));
      rows.append(row);
    }
    return rows;
  }

  function cardFoot(card) {
    const foot = el('div', 'card-foot');
    foot.append(card.pending ? el('span', 'pending-dot') : icon('clockSmall'), el('span', null, card.footer));
    return foot;
  }

  function summaryCard(card) {
    const box = el('button', 'card summary');
    box.type = 'button';
    box.setAttribute('aria-haspopup', 'dialog');
    box.setAttribute('aria-label', `${card.title} — voir le détail`);
    const all = card.rows || [];
    box.append(cardHead(card), cardRows(all.slice(0, SHOWN_ROWS)));
    const more = el('span', 'card-more');
    more.append(el('span', null, all.length > SHOWN_ROWS ? `Voir le détail · ${all.length - SHOWN_ROWS} de plus` : 'Voir le détail'), icon('chevron'));
    box.append(more, cardFoot(card));
    box.addEventListener('click', () => openRequest(card));
    return box;
  }

  // Everything the client sent, as a receipt they can open again whenever they want.
  function openRequest(card) {
    const sheet = $('request-sheet');
    const body = $('request-body');
    const view = el('div', 'request-view');
    view.append(cardHead(card));

    const product = bot?.catalog?.products.find((p) => (card.rows || []).some(([label]) => label.startsWith(p.name)));
    if (product) {
      const media = el('div', 'request-photo');
      media.append(picture(product, 'pic'));
      view.append(media);
    }
    view.append(cardRows(card.rows || []), cardFoot(card));
    body.replaceChildren(view);
    sheet.showModal();
  }

  function slotsCard(card) {
    const box = el('div', 'card slots');
    const title = el('div', 'slots-title');
    title.append(icon('calendar'), el('span', null, card.title || 'Créneaux disponibles'));

    const grid = el('div', 'slot-grid');
    const buttons = (card.slots || []).map((slot, i) => {
      const button = el('button', 'slot');
      button.type = 'button';
      button.hidden = i >= 4;
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', slot.text);
      button.append(el('small', null, slot.day), el('b', null, slot.time));
      button.addEventListener('click', () => {
        for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
        submit(slot.text);
      });
      grid.append(button);
      return button;
    });
    box.append(title, grid);

    if (buttons.length > 4) {
      const more = el('button', 'more', "Voir d'autres dates");
      more.type = 'button';
      more.addEventListener('click', () => {
        for (const b of buttons) b.hidden = false;
        more.remove();
      });
      box.append(more);
    } else {
      box.style.paddingBottom = '12px';
    }
    return box;
  }

  function drawItem(item, options) {
    if (item.card?.type === 'products') return add(productsCard(item.card), options);
    if (item.card) return add(item.card.type === 'slots' ? slotsCard(item.card) : summaryCard(item.card), options);
    return bubble(item.role === 'client' ? 'client' : 'bot', item.text, options);
  }

  // ---------- catalogue ----------

  const normalize = (text) =>
    String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();

  // The product photo, or a soft placeholder while there is none.
  function picture(product, className = 'pic') {
    const box = el('span', className);
    const placeholder = () => {
      const ph = el('span', 'ph');
      ph.append(icon('image'));
      box.replaceChildren(ph);
    };
    if (!product.image) {
      placeholder();
      return box;
    }
    const img = new Image();
    img.alt = product.name;
    img.loading = 'lazy';
    img.onerror = placeholder;
    img.src = product.image;
    box.append(img);
    return box;
  }

  function productTile(product) {
    const tile = el('button', 'tile');
    tile.type = 'button';
    tile.setAttribute('aria-label', `${product.name}, dès ${product.from} DT`);
    const media = el('span', 'tile-media');
    const plus = el('span', 'tile-add');
    plus.append(icon('plus'));
    media.append(picture(product), plus);
    tile.append(media, el('b', null, product.name), el('span', 'tile-price', `dès ${product.from} DT`));
    tile.addEventListener('click', () => openProduct(product.id));
    return tile;
  }

  // The shop's logo, round; our own logo sits on white.
  function logo(className) {
    const box = el('span', `logo${bot.logo?.inset ? ' inset' : ''}${className ? ` ${className}` : ''}`);
    if (bot.logo?.src) box.append(Object.assign(new Image(), { src: bot.logo.src, alt: '' }));
    return box;
  }

  function productsCard(card) {
    const row = el('div', 'products');
    for (const item of card.items || []) {
      const product = bot?.catalog?.products.find((p) => p.id === item.id) || item;
      row.append(productTile(product));
    }
    return row;
  }

  // Search box, categories and the product grid. Used in the left column and in the phone sheet.
  function catalogPanel({ withShop }) {
    const catalog = bot.catalog;
    const panel = el('div', 'catalog');
    if (withShop) {
      const shop = el('div', 'catalog-shop');
      const text = el('div', 'catalog-shop-text');
      text.append(el('h2', null, bot.name), el('span', null, `${bot.profile?.kind || ''} · ${catalog.hours.label}`));
      shop.append(logo('shop-logo'), text);
      panel.append(shop);
    }

    const searchBox = el('label', 'catalog-search');
    const query = el('input');
    query.type = 'search';
    query.placeholder = 'Rechercher dans le catalogue';
    query.setAttribute('aria-label', 'Rechercher dans le catalogue');
    searchBox.append(icon('search'), query);

    let category = '';
    const cats = el('div', 'catalog-cats');
    const chips = [{ id: '', name: 'Tout' }, ...catalog.categories].map((c) => {
      const chip = el('button', 'cat-chip', c.name);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(c.id === category));
      chip.addEventListener('click', () => {
        category = c.id;
        for (const other of chips) other.setAttribute('aria-pressed', String(other === chip));
        draw();
      });
      cats.append(chip);
      return chip;
    });

    const grid = el('div', 'catalog-grid');
    function draw() {
      const words = normalize(query.value).split(/\s+/).filter(Boolean);
      const list = catalog.products.filter((p) => {
        if (category && p.category !== category) return false;
        const text = normalize([p.name, p.description, ...(p.tags || [])].join(' '));
        return words.every((w) => text.includes(w));
      });
      grid.replaceChildren(...(list.length ? list.map(productTile) : [el('p', 'catalog-empty', 'Aucun produit trouvé.')]));
    }
    query.addEventListener('input', draw);
    draw();

    panel.append(searchBox, cats, grid);
    return panel;
  }

  const catalogSheet = $('catalog-sheet');
  const productSheet = $('product-sheet');
  let catalogReady = false;

  function openCatalog() {
    if (!bot?.catalog) return;
    if (!catalogReady) {
      $('catalog-logo').replaceChildren(logo());
      $('catalog-meta').textContent = `${bot.name} · ${bot.catalog.products.length} produits`;
      $('catalog-sheet-body').replaceChildren(catalogPanel({ withShop: false }));
      catalogReady = true;
    }
    catalogSheet.showModal();
  }

  // Phones: one clear way into the catalogue, just above the message box,
  // with a photo from each category as a preview.
  function renderCatalogBar() {
    const bar = $('catalog-bar');
    bar.hidden = !bot?.catalog;
    if (!bot?.catalog) return;
    const { products, categories } = bot.catalog;
    const button = el('button', 'shop-bar');
    button.type = 'button';
    const thumbs = el('span', 'shop-thumbs');
    const firsts = categories.map((c) => products.find((p) => p.category === c.id)).filter(Boolean);
    for (const product of firsts.slice(0, 3)) thumbs.append(picture(product, 'pic shop-thumb'));
    const text = el('span', 'shop-text');
    const from = Math.min(...products.map((p) => p.from));
    text.append(el('b', null, 'Catalogue'), el('span', null, `${products.length} produits · dès ${from} DT`));
    const cta = el('span', 'shop-cta');
    cta.append(el('span', null, 'Voir'), icon('chevron'));
    button.append(thumbs, text, cta);
    button.addEventListener('click', openCatalog);
    bar.replaceChildren(button);
  }

  let chosen = null; // {product, option, quantity}

  function openProduct(id) {
    const product = bot?.catalog?.products.find((p) => p.id === id);
    if (!product) return;
    chosen = { product, option: product.options[0], quantity: 1 };
    $('product-media').replaceWith(Object.assign(picture(product, 'pic product-media'), { id: 'product-media' }));
    $('product-cat').textContent = bot.catalog.categories.find((c) => c.id === product.category)?.name || '';
    $('product-name').textContent = product.name;
    $('product-desc').textContent = product.description;
    $('product-notice').textContent = product.notice || '';

    const options = $('product-options');
    const buttons = product.options.map((option) => {
      const button = el('button', 'option');
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(option === chosen.option));
      button.append(el('small', null, option.label), el('b', null, `${option.price} DT`));
      button.addEventListener('click', () => {
        chosen.option = option;
        for (const other of buttons) other.setAttribute('aria-checked', String(other === button));
        updateTotal();
      });
      return button;
    });
    options.replaceChildren(...buttons);
    updateTotal();
    if (!productSheet.open) productSheet.showModal();
  }

  function updateTotal() {
    $('qty-value').textContent = String(chosen.quantity);
    $('product-total').textContent = `${chosen.option.price * chosen.quantity} DT`;
  }

  $('qty-minus').addEventListener('click', () => {
    chosen.quantity = Math.max(1, chosen.quantity - 1);
    updateTotal();
  });
  $('qty-plus').addEventListener('click', () => {
    chosen.quantity = Math.min(20, chosen.quantity + 1);
    updateTotal();
  });

  $('product-order').addEventListener('click', () => {
    if (!chosen) return;
    const { product, option, quantity } = chosen;
    productSheet.close();
    if (catalogSheet.open) catalogSheet.close();
    // Written like a client would in Derja, so the assistant answers in Derja. Shown as a product card.
    submit(`N7eb: ${product.name} · ${option.label}${quantity > 1 ? ` × ${quantity}` : ''}`);
  });

  // Close buttons, and a tap on the dimmed background.
  for (const sheet of [catalogSheet, productSheet, $('request-sheet')]) {
    sheet.querySelector('[data-close]').addEventListener('click', () => sheet.close());
    sheet.addEventListener('click', (event) => {
      if (event.target === sheet) sheet.close();
    });
  }

  let typingNode = null;
  function showTyping() {
    if (!typingNode) {
      typingNode = el('div', 'typing');
      typingNode.setAttribute('aria-label', "L'assistant écrit");
      typingNode.append(el('i'), el('i'), el('i'));
    }
    add(typingNode, { animate: false });
  }
  const hideTyping = () => typingNode?.remove();

  let choicesNode = null;
  function showChoices(list) {
    clearChoices();
    if (!Array.isArray(list) || !list.length) return;
    choicesNode = el('div', 'choices');
    for (const text of list) {
      const button = el('button', 'choice', text);
      button.type = 'button';
      button.addEventListener('click', () => submit(text));
      choicesNode.append(button);
    }
    add(choicesNode);
  }
  function clearChoices() {
    choicesNode?.remove();
    choicesNode = null;
  }

  let noticeNode = null;
  function showNotice(error, retry) {
    clearNotice();
    noticeNode = el('div', 'notice');
    noticeNode.append(el('span', null, error.status === 429 ? 'Trop de messages. Réessayez dans quelques minutes.' : 'Message non envoyé.'));
    const button = el('button', null, 'Réessayer');
    button.type = 'button';
    button.addEventListener('click', () => {
      clearNotice();
      retry();
    });
    noticeNode.append(button);
    add(noticeNode, { follow: true });
  }
  function clearNotice() {
    noticeNode?.remove();
    noticeNode = null;
  }

  // ---------- talking to the server ----------

  async function api(method, body, query = '', timeout = 20_000) {
    const res = await fetch(`/api/chat${query}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || `HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  // People often send two or three short messages in a row: wait a moment and answer them together.
  const WAIT_BEFORE_SENDING = 900;
  const pending = [];
  let timer = null;
  let busy = false;
  let generation = 0; // changes when the conversation restarts, so late answers are dropped

  function submit(raw) {
    const text = String(raw || '').trim().slice(0, 600);
    if (!text || !bot) return;
    clearChoices();
    clearNotice();
    dayChip(null, { follow: true });
    bubble('client', text, { follow: true });
    pending.push(text);
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (!busy) timer = setTimeout(flush, WAIT_BEFORE_SENDING);
  }

  function flush() {
    if (busy || !pending.length) return;
    deliver(pending.splice(0), uuid());
  }

  async function deliver(texts, batch) {
    const mine = generation;
    busy = true;
    showTyping();
    try {
      const data = await api('POST', { bot: slug, visitor, texts, batch }, '', 75_000);
      if (mine !== generation) return;
      hideTyping();
      await reveal(data.items || [], mine);
      if (mine === generation) showChoices(data.choices);
    } catch (error) {
      if (mine !== generation) return;
      hideTyping();
      showNotice(error, () => deliver(texts, batch));
    } finally {
      if (mine === generation) {
        busy = false;
        if (pending.length) schedule();
      }
    }
  }

  async function reveal(items, mine) {
    for (const [i, item] of items.entries()) {
      if (i > 0) {
        showTyping();
        await sleep(item.card ? 450 : Math.min(1300, 400 + (item.text || '').length * 14));
        if (mine !== generation) return;
        hideTyping();
      }
      drawItem({ role: 'bot', ...item });
    }
  }

  // ---------- the business: header, card on the left, intro on phones ----------

  let bot = null;

  function applyBot(info) {
    bot = info;
    document.title = `${info.name} · Chat`;
    const root = document.documentElement.style;
    root.setProperty('--accent', info.colors.accent);
    root.setProperty('--accent-soft', info.colors.soft);
    root.setProperty('--accent-ink', info.colors.ink);

    $('name').textContent = info.name;
    $('avatar').replaceChildren(logo());
    document.querySelector('.chat').classList.remove('is-loading');
    for (const node of document.querySelectorAll('[data-demo]')) node.hidden = !info.demo;
    for (const node of document.querySelectorAll('[data-not-demo]')) node.hidden = info.demo;
    restartButton.hidden = false;
    renderProfile(info);
    renderCatalogBar();
  }

  function mediaFor(profile, className) {
    if (profile.photo) {
      const img = new Image();
      img.src = profile.photo;
      img.alt = '';
      img.width = 760;
      img.height = 760;
      if (className) img.className = className;
      return img;
    }
    return null;
  }

  function renderProfile(info) {
    const p = info.profile;
    if (!p) return;
    // A shop with a catalogue shows its products on the left instead.
    if (info.catalog) {
      $('profile').classList.add('wide');
      $('profile').replaceChildren(catalogPanel({ withShop: true }));
      return;
    }
    const card = el('div', 'profile-card');

    const photo = mediaFor(p, 'profile-photo');
    if (photo) card.append(photo);
    else {
      const brand = el('div', 'profile-brand');
      brand.append(Object.assign(new Image(), { src: '/logo.png', alt: '', width: 96, height: 96 }));
      card.append(brand);
    }

    const body = el('div', 'profile-body');
    // Like a social profile: the logo overlaps the bottom of the photo.
    if (photo) body.append(logo('profile-logo'));
    body.append(el('span', 'profile-kind', p.kind), el('h2', null, info.name), el('p', null, p.about));
    const skills = el('ul', 'skills');
    for (const skill of p.skills || []) {
      const li = el('li');
      const tick = el('i');
      tick.append(icon('checkSmall'));
      li.append(tick, el('span', null, skill));
      skills.append(li);
    }
    const hours = el('p', 'hours');
    hours.append(icon('clockSmall'), el('span', null, p.hours));
    body.append(skills, hours);
    card.append(body);

    $('profile').replaceChildren(card);
  }

  // Phones don't have room for the card: the business introduces itself at the top of the conversation.
  function introCard() {
    const p = bot.profile;
    const box = el('div', 'intro');
    box.append(logo('intro-logo'), el('b', 'intro-name', bot.name), el('span', 'intro-kind', p.kind), el('p', 'intro-about', p.about));
    const skills = el('ul', 'intro-skills');
    for (const skill of p.skills || []) {
      const li = el('li');
      li.append(icon('checkSmall'), el('span', null, skill));
      skills.append(li);
    }
    box.append(skills);
    return box;
  }

  function resetLog() {
    typingNode = null;
    choicesNode = null;
    noticeNode = null;
    lastDay = null;
    log.replaceChildren(el('div', 'spacer'));
    if (bot?.profile) log.append(introCard());
  }

  async function greet({ chips = true } = {}) {
    dayChip(null, { animate: false });
    for (const [i, text] of bot.welcome.entries()) {
      if (i > 0) {
        showTyping();
        await sleep(650);
        hideTyping();
      }
      bubble('bot', text);
    }
    if (chips) showChoices(bot.starters);
  }

  function showProblem(message, { retry, home } = {}) {
    const box = el('div', 'empty');
    box.append(el('span', null, message));
    if (retry) {
      const button = el('button', null, 'Réessayer');
      button.type = 'button';
      button.addEventListener('click', start);
      box.append(button);
    }
    if (home) {
      const link = el('a', null, 'Voir les démos');
      link.href = '/';
      box.append(link);
    }
    log.replaceChildren(box);
  }

  async function start() {
    if (!slug) return showProblem("Ce chat n'existe pas.", { home: true });
    const loader = el('div', 'loader');
    loader.setAttribute('aria-label', 'Chargement');
    loader.append(el('i'), el('i'), el('i'));
    log.replaceChildren(loader);
    let data;
    try {
      data = await api('GET', null, `?bot=${encodeURIComponent(slug)}&visitor=${encodeURIComponent(visitor)}`);
    } catch (error) {
      if (error.status === 404) return showProblem("Ce chat n'existe pas.", { home: true });
      return showProblem('Le chat ne répond pas pour le moment. Vérifiez votre connexion.', { retry: true });
    }

    applyBot(data.bot);
    input.disabled = false;
    sendButton.disabled = false;

    // A plan button on the home page (/chat/digiplus?plan=pro) sends the choice by itself.
    // The address is cleaned first, so reloading the page doesn't send it twice.
    const autoMessage = firstMessageFromLink();
    if (autoMessage) history.replaceState(null, '', location.pathname);

    resetLog();
    if (data.items.length) {
      for (const item of data.items) {
        dayChip(item.created_at, { animate: false });
        drawItem(item, { animate: false });
      }
      requestAnimationFrame(() => toBottom(false));
    } else {
      await greet({ chips: !autoMessage });
    }
    if (autoMessage) submit(autoMessage);
  }

  const PLAN_MESSAGES = {
    starter: 'N7eb el formule Starter (39dt fel chhar)',
    pro: 'N7eb el formule Pro (99dt fel chhar)',
    business: 'N7eb el formule Business (199dt fel chhar)',
  };

  function firstMessageFromLink() {
    const params = new URLSearchParams(location.search);
    return PLAN_MESSAGES[params.get('plan')] || (params.get('m') || '').slice(0, 600);
  }

  // ---------- composer ----------

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    input.classList.toggle('tall', input.scrollHeight > 140);
  }

  function sendTyped() {
    if (!input.value.trim()) return;
    submit(input.value);
    input.value = '';
    autosize();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    sendTyped();
    input.focus();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendTyped();
    }
  });
  input.addEventListener('input', autosize);
  const composer = form.parentElement;
  // Not "typing": that class is the assistant's "writing…" bubble.
  input.addEventListener('focus', () => {
    composer.classList.add('is-focused');
    setTimeout(() => toBottom(), 250);
  });
  input.addEventListener('blur', () => composer.classList.remove('is-focused'));

  // ---------- starting over ----------

  async function restart() {
    generation++;
    clearTimeout(timer);
    pending.length = 0;
    busy = false;
    try {
      await api('DELETE', { bot: slug, visitor });
    } catch {}
    resetLog();
    greet();
  }

  restartButton.addEventListener('click', () => {
    if (!bot) return;
    if (typeof restartDialog.showModal !== 'function') {
      if (confirm('Recommencer la conversation ?')) restart();
      return;
    }
    restartDialog.showModal();
  });
  // Handled on the buttons themselves: some browsers don't fire the dialog's close event reliably.
  restartDialog.querySelector('[value="confirm"]').addEventListener('click', (event) => {
    event.preventDefault();
    restartDialog.close('confirm');
    restart();
  });
  restartDialog.querySelector('[value="cancel"]').addEventListener('click', (event) => {
    event.preventDefault();
    restartDialog.close('cancel');
  });
  // A tap on the dimmed background closes the sheet.
  restartDialog.addEventListener('click', (event) => {
    if (event.target === restartDialog) restartDialog.close('cancel');
  });

  start();
})();
