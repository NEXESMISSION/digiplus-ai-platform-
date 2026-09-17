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
    snowflake: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M4.2 7.5l15.6 9"/><path d="M4.2 16.5l15.6-9"/><path d="M9.5 4.8L12 6.3l2.5-1.5"/><path d="M9.5 19.2l2.5-1.5 2.5 1.5"/></svg>',
    camera: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5h3.2L9 6h6l1.8 2.5H20v10.5H4z"/><circle cx="12" cy="13.5" r="3.3"/></svg>',
    check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    checkSmall: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    clock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    clockSmall: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    calendar: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16"/><path d="M8.5 3.5v4"/><path d="M15.5 3.5v4"/></svg>',
    cake: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M5 20v-6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6"/><path d="M5 16c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0"/><path d="M12 12V8"/><path d="M12 5.5c.8-.8.8-1.7 0-2.5-.8.8-.8 1.7 0 2.5z"/></svg>',
    search: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    grid: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
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

  const bubble = (role, text, options) => add(el('div', `msg ${role}`, text), options);

  function summaryCard(card) {
    const box = el('div', 'card');
    const head = el('div', 'card-head');
    const badge = el('div', 'card-icon');
    badge.append(icon(card.icon === 'clock' ? 'clock' : 'check'));
    const titles = el('div', 'card-titles');
    titles.append(el('div', 'card-title', card.title), el('div', 'card-sub', card.subtitle));
    head.append(badge, titles);

    const rows = el('div', 'card-rows');
    for (const [label, value] of card.rows || []) {
      const row = el('div', 'card-row');
      row.append(el('span', null, label), el('span', null, value));
      rows.append(row);
    }

    const foot = el('div', 'card-foot');
    foot.append(card.pending ? el('span', 'pending-dot') : icon('clockSmall'), el('span', null, card.footer));
    box.append(head, rows, foot);
    return box;
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
    const box = el('div', className);
    const placeholder = () => {
      const ph = el('div', 'ph');
      ph.append(icon('cake'));
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
    tile.append(picture(product), el('b', null, product.name), el('span', null, `dès ${product.from}dt`));
    tile.addEventListener('click', () => openProduct(product.id));
    return tile;
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
      shop.append(el('h2', null, bot.name), el('span', null, `${bot.profile?.kind || ''} · ${catalog.hours.label}`));
      panel.append(shop);
    }

    const searchBox = el('label', 'catalog-search');
    const query = el('input');
    query.type = 'search';
    query.placeholder = 'Rechercher un gâteau, une pâtisserie…';
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
      $('catalog-sheet-body').replaceChildren(catalogPanel({ withShop: false }));
      catalogReady = true;
    }
    catalogSheet.showModal();
  }

  // Phones: "Catalogue" and a small preview of each product, just above the message box.
  function renderStrip() {
    const strip = $('catalog-strip');
    strip.hidden = !bot?.catalog;
    if (!bot?.catalog) return;
    const all = el('button', 'strip-all');
    all.type = 'button';
    all.append(icon('grid'), el('span', null, 'Catalogue'));
    all.addEventListener('click', openCatalog);
    const items = bot.catalog.products.map((product) => {
      const item = el('button', 'strip-item');
      item.type = 'button';
      item.setAttribute('aria-label', `${product.name}, dès ${product.from}dt`);
      const text = el('span', 'strip-text');
      text.append(el('b', null, product.name), el('span', null, `dès ${product.from}dt`));
      item.append(picture(product), text);
      item.addEventListener('click', () => openProduct(product.id));
      return item;
    });
    strip.replaceChildren(all, ...items);
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
      button.append(el('small', null, option.label), el('b', null, `${option.price}dt`));
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
    $('product-total').textContent = `${chosen.option.price * chosen.quantity}dt`;
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
    // Written like a client would in Derja, so the assistant answers in Derja.
    submit(`🛒 N7eb: ${product.name} · ${option.label}${quantity > 1 ? ` × ${quantity}` : ''}`);
  });

  // Close buttons, and a tap on the dimmed background.
  for (const sheet of [catalogSheet, productSheet]) {
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
    const avatar = $('avatar');
    if (info.icon === 'logo') {
      avatar.classList.add('logo');
      avatar.replaceChildren(Object.assign(new Image(), { src: '/logo.png', alt: '' }));
    } else {
      avatar.innerHTML = ICONS[info.icon] || ICONS.check;
    }
    document.querySelector('.chat').classList.remove('is-loading');
    for (const node of document.querySelectorAll('[data-demo]')) node.hidden = !info.demo;
    for (const node of document.querySelectorAll('[data-not-demo]')) node.hidden = info.demo;
    restartButton.hidden = false;
    renderProfile(info);
    renderStrip();
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

  // Phones don't have room for the card: a short intro sits at the top of the conversation instead.
  function introCard() {
    const p = bot.profile;
    const box = el('div', 'intro');
    const media = el('div', 'intro-media');
    const photo = mediaFor(p);
    if (photo) media.append(photo);
    else if (bot.icon === 'logo') {
      media.classList.add('brand-tile');
      media.append(Object.assign(new Image(), { src: '/logo.png', alt: '' }));
    } else {
      media.classList.add('icon-tile');
      media.append(icon(bot.icon));
    }
    const text = el('div', 'intro-text');
    text.append(el('b', null, bot.name), el('p', null, p.about));
    const skills = el('div', 'intro-skills');
    for (const skill of p.skills || []) skills.append(el('span', null, skill));
    text.append(skills);
    box.append(media, text);
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
