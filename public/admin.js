// The owner inbox: /admin. Sign in with an email link, then read every conversation.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const app = $('app');
  const rowsNode = $('rows');
  const chipsNode = $('chips');
  const searchInput = $('search');
  const log = $('t-log');

  const SESSION_KEY = 'digiplus-admin-session';
  const state = {
    session: null, // {accessToken, refreshToken}
    bots: new Map(),
    conversations: [],
    filter: 'all',
    query: '',
    openId: null,
    openCount: 0,
  };

  // ---------- helpers ----------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  const svg = (markup) => {
    const holder = document.createElement('span');
    holder.innerHTML = markup;
    return holder.firstElementChild;
  };
  const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
  const PERSON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>';
  const PHONE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.6 3.5h2.6l1.6 4.2-2 1.3a11.5 11.5 0 0 0 6.2 6.2l1.3-2 4.2 1.6v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z"/></svg>';

  const storage = {
    get() {
      try {
        return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      } catch {
        return null;
      }
    },
    set(value) {
      try {
        if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
        else localStorage.removeItem(SESSION_KEY);
      } catch {}
    },
  };

  const initials = (name) =>
    String(name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();

  const displayName = (c) => c.name || 'Visiteur';

  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  // 10:58 today, "Hier", a weekday this week, then 12/09.
  function when(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    const now = new Date();
    if (sameDay(date, now)) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(date, yesterday)) return 'Hier';
    if (now - date < 6 * 86_400_000) {
      const day = date.toLocaleDateString('fr-FR', { weekday: 'short' });
      return day.charAt(0).toUpperCase() + day.slice(1);
    }
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  }

  function dayLabel(iso) {
    const date = new Date(iso);
    const now = new Date();
    if (sameDay(date, now)) return "Aujourd'hui";
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(date, yesterday)) return 'Hier';
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function avatarFor(conversation, node = el('span', 'avatar')) {
    const bot = state.bots.get(conversation.bot);
    if (bot) {
      node.style.background = bot.colors.soft;
      node.style.color = bot.colors.ink;
    }
    node.replaceChildren();
    if (conversation.name) node.textContent = initials(conversation.name);
    else node.append(svg(PERSON));
    return node;
  }

  const telLink = (phone) => `tel:+216${String(phone).replace(/\D/g, '')}`;

  // ---------- talking to the server ----------

  async function api(method, { query = '', body } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (state.session?.token) headers.Authorization = `Bearer ${state.session.token}`;
    const res = await fetch(`/api/admin${query}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      signOut(state.session ? 'Session terminée. Reconnectez-vous.' : '');
      throw Object.assign(new Error('signed_out'), { status: 401 });
    }
    if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
    return data;
  }

  // ---------- sign in ----------

  function showLogin(message, tone) {
    app.hidden = true;
    $('login').hidden = false;
    const note = $('login-note');
    note.textContent = message || '';
    note.className = `login-note${tone ? ` ${tone}` : ''}`;
  }

  function signOut(message) {
    state.session = null;
    storage.set(null);
    stopPolling();
    showLogin(message);
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const field = $('login-password');
    const password = field.value;
    if (!password) return showLogin('Entrez le mot de passe.', 'error');
    const button = $('login-button');
    button.disabled = true;
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', password }),
      });
      if (res.status === 429) return showLogin('Trop d’essais. Attendez une minute.', 'error');
      if (res.status === 401) return showLogin('Mot de passe faux.', 'error');
      if (!res.ok) return showLogin('Le serveur ne répond pas. Réessayez.', 'error');
      state.session = await res.json();
      storage.set(state.session);
      field.value = '';
      await open();
    } catch {
      showLogin('Pas de connexion. Réessayez.', 'error');
    } finally {
      button.disabled = false;
    }
  });

  $('logout').addEventListener('click', () => signOut());

  // ---------- conversation list ----------

  function visibleConversations() {
    const query = state.query.toLowerCase();
    return state.conversations.filter((c) => {
      if (state.filter !== 'all' && c.bot !== state.filter) return false;
      if (!query) return true;
      return [c.name, c.phone, c.preview, state.bots.get(c.bot)?.name].some((v) => String(v || '').toLowerCase().includes(query));
    });
  }

  function renderChips() {
    const unread = (slug) => state.conversations.filter((c) => c.unread && (slug === 'all' || c.bot === slug)).length;
    const options = [{ slug: 'all', name: 'Tous' }, ...state.bots.values()];
    chipsNode.replaceChildren(
      ...options.map((option) => {
        const chip = el('button', 'chip', option.name);
        chip.type = 'button';
        chip.setAttribute('role', 'tab');
        chip.setAttribute('aria-selected', String(state.filter === option.slug));
        const count = unread(option.slug);
        if (count) chip.append(el('span', 'count', String(count)));
        chip.addEventListener('click', () => {
          state.filter = option.slug;
          renderChips();
          renderRows();
        });
        return chip;
      })
    );
  }

  function renderRows() {
    const list = visibleConversations();
    if (!list.length) {
      const empty = el('li', 'list-empty', state.conversations.length ? 'Aucun résultat.' : 'Aucune conversation pour le moment.\nElles apparaissent ici dès qu’un client écrit.');
      empty.style.whiteSpace = 'pre-line';
      rowsNode.replaceChildren(empty);
      return;
    }
    rowsNode.replaceChildren(
      ...list.map((c) => {
        const bot = state.bots.get(c.bot);
        const item = el('li');
        const row = el('button', `row${c.unread ? ' is-unread' : ''}`);
        row.type = 'button';
        if (c.id === state.openId) row.setAttribute('aria-current', 'true');
        if (c.unread) {
          const dot = el('span', 'unread-dot');
          dot.setAttribute('aria-label', 'Non lu');
          row.append(dot);
        }
        row.append(avatarFor(c));

        const main = el('span', 'row-main');
        const top = el('span', 'row-top');
        top.append(el('span', 'row-name', displayName(c)), el('span', 'row-time', when(c.lastAt)), svg(CHEVRON));
        const tags = el('span', 'row-tags');
        if (state.filter === 'all' && bot) {
          const tag = el('span', 'tag', bot.name);
          tag.style.background = bot.colors.soft;
          tag.style.color = bot.colors.ink;
          tags.append(tag);
        }
        if (c.request) tags.append(el('span', 'tag request', { booking: 'Rendez-vous', order: 'Commande' }[c.request.kind] || 'Coordonnées'));
        main.append(top, el('span', 'row-preview', c.preview || '…'));
        if (tags.childElementCount) main.append(tags);
        row.append(main);
        row.addEventListener('click', () => openConversation(c.id));
        item.append(row);
        return item;
      })
    );
  }

  async function loadInbox() {
    const data = await api('GET', { query: '?action=inbox' });
    state.bots = new Map(data.bots.map((b) => [b.slug, b]));
    state.conversations = data.conversations;
    if (state.openId) {
      const open = state.conversations.find((c) => c.id === state.openId);
      if (open) open.unread = false;
    }
    renderChips();
    renderRows();
  }

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value.trim();
    renderRows();
  });

  // ---------- one conversation ----------

  const shortDate = (ymd) => new Date(`${ymd}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

  function requestRows(request) {
    const d = request.data || {};
    if (request.kind === 'order') {
      return [
        ...(d.items || []).map((i) => [`${i.name} · ${i.option}${i.quantity > 1 ? ` × ${i.quantity}` : ''}`, `${i.price}dt`]),
        ...(d.fee ? [['Livraison', `${d.fee}dt`]] : []),
        ['Total', `${d.total}dt`],
        [d.delivery === 'livraison' ? 'Livraison' : 'Retrait', d.day ? `${shortDate(d.day)}, ${d.time}` : ''],
        ['Adresse', d.address],
        ['Nom', d.name],
        ['Téléphone', d.phone],
      ];
    }
    if (request.kind === 'booking') {
      return [
        ['Séance', d.service],
        ['Quand', d.date && d.time ? `${new Date(`${d.date}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.time}` : ''],
        ['Nom', d.name],
        ['Téléphone', d.phone],
      ];
    }
    const labels = { name: 'Nom', phone: 'Téléphone', area: 'Quartier', need: 'Besoin', business: 'Activité', plan: 'Formule' };
    return Object.entries(d).map(([key, value]) => [labels[key] || key, value]);
  }

  function contactCard(request) {
    const box = el('div', 'contact');
    const head = el('div', 'contact-head');
    const titles = { booking: 'Demande de rendez-vous', order: 'Commande', details: 'Coordonnées du client' };
    head.append(el('span', 'contact-title', titles[request.kind] || titles.details));
    const status =
      request.kind === 'booking' || request.kind === 'order'
        ? { pending: ['À confirmer', 'pending'], confirmed: ['Confirmé', ''], declined: ['Refusé', ''] }[request.status] || ['', '']
        : ['Nouveau', 'new'];
    if (status[0]) head.append(el('span', `status ${status[1]}`, status[0]));
    const rows = el('div', 'contact-rows');
    for (const [label, value] of requestRows(request)) {
      if (!value) continue;
      const row = el('div', 'contact-row');
      row.append(el('span', null, label), el('span', null, value));
      rows.append(row);
    }
    box.append(head, rows);
    if (request.data?.phone) {
      const call = el('a', 'call-wide');
      call.href = telLink(request.data.phone);
      call.append(svg(PHONE), el('span', null, `Appeler ${request.data.phone}`));
      box.append(call);
    }
    return box;
  }

  // What the client saw as a card, told to the owner in one short note.
  function noteForCard(card) {
    const note = el('div', 'note-card');
    if (card.type === 'slots') {
      note.append(el('b', null, 'Créneaux proposés'), document.createTextNode(card.slots.map((s) => `${s.day} ${s.time}`).join(' · ')));
    } else if (card.type === 'products') {
      note.append(el('b', null, 'Produits montrés'), document.createTextNode(card.items.map((p) => `${p.name} (dès ${p.from}dt)`).join(' · ')));
    } else {
      note.append(el('b', null, card.title), document.createTextNode((card.rows || []).map(([label, value]) => `${label} : ${value}`).join(' · ')));
    }
    return note;
  }

  function renderThread(data, { keepScroll } = {}) {
    const c = data.conversation;
    const bot = state.bots.get(c.bot);
    if (bot) {
      log.parentElement.style.setProperty('--accent', bot.colors.accent);
    }
    $('t-name').textContent = displayName(c);
    $('t-sub').textContent = [bot?.name, c.phone].filter(Boolean).join(' · ');
    avatarFor(c, $('t-avatar'));
    const call = $('t-call');
    call.hidden = !c.phone;
    if (c.phone) call.href = telLink(c.phone);

    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const nodes = [];
    const latestRequest = data.requests[data.requests.length - 1];
    if (latestRequest) nodes.push(contactCard(latestRequest));

    let lastDay = '';
    let lastSide = '';
    for (const item of data.items) {
      const day = new Date(item.created_at).toDateString();
      if (day !== lastDay) {
        nodes.push(el('div', 'day', dayLabel(item.created_at)));
        lastDay = day;
        lastSide = '';
      }
      const side = item.role === 'client' ? 'client' : 'bot';
      if (side !== lastSide) {
        nodes.push(el('div', `side ${side}`, side === 'client' ? displayName(c) : 'Assistant'));
        lastSide = side;
      }
      if (item.card) nodes.push(noteForCard(item.card));
      else nodes.push(el('div', `msg ${side}`, item.text));
    }
    log.replaceChildren(...nodes);
    if (!keepScroll || atBottom) log.scrollTop = log.scrollHeight;
  }

  async function openConversation(id, { fromHistory } = {}) {
    state.openId = id;
    state.openCount = 0;
    app.classList.add('reading');
    $('thread-empty').hidden = true;
    $('thread').hidden = false;
    if (!fromHistory && location.hash !== `#c=${id}`) history.pushState({ id }, '', `#c=${id}`);
    renderRows();
    try {
      const data = await api('GET', { query: `?action=conversation&id=${encodeURIComponent(id)}` });
      if (state.openId !== id) return;
      state.openCount = data.items.length;
      renderThread(data);
      const summary = state.conversations.find((c) => c.id === id);
      if (summary?.unread) {
        summary.unread = false;
        renderChips();
        renderRows();
      }
      api('POST', { body: { action: 'seen', id } }).catch(() => {});
    } catch (error) {
      if (error.status === 404) {
        closeConversation();
        loadInbox().catch(() => {});
      }
    }
  }

  function closeConversation({ fromHistory } = {}) {
    state.openId = null;
    app.classList.remove('reading');
    $('thread').hidden = true;
    $('thread-empty').hidden = false;
    if (!fromHistory && location.hash.startsWith('#c=')) history.pushState(null, '', location.pathname);
    renderRows();
  }

  async function refreshOpenConversation() {
    const id = state.openId;
    if (!id) return;
    const data = await api('GET', { query: `?action=conversation&id=${encodeURIComponent(id)}` });
    if (state.openId !== id || data.items.length === state.openCount) return;
    state.openCount = data.items.length;
    renderThread(data, { keepScroll: true });
    api('POST', { body: { action: 'seen', id } }).catch(() => {});
  }

  $('back').addEventListener('click', () => {
    if (history.state?.id) history.back();
    else closeConversation();
  });

  $('t-delete').addEventListener('click', async () => {
    const id = state.openId;
    if (!id || !confirm('Supprimer cette conversation ? Les messages et les coordonnées du client seront effacés.')) return;
    try {
      await api('POST', { body: { action: 'delete', id } });
      state.conversations = state.conversations.filter((c) => c.id !== id);
      closeConversation();
      renderChips();
    } catch {
      alert("La conversation n'a pas pu être supprimée. Réessayez.");
    }
  });

  addEventListener('popstate', () => {
    const match = location.hash.match(/^#c=([0-9a-f-]{36})$/i);
    if (match) openConversation(match[1], { fromHistory: true });
    else if (state.openId) closeConversation({ fromHistory: true });
  });

  // ---------- keeping it fresh ----------

  let timers = [];
  function startPolling() {
    stopPolling();
    timers = [
      setInterval(() => document.visibilityState === 'visible' && loadInbox().catch(() => {}), 15_000),
      setInterval(() => document.visibilityState === 'visible' && refreshOpenConversation().catch(() => {}), 8_000),
    ];
  }
  function stopPolling() {
    timers.forEach(clearInterval);
    timers = [];
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.session !== undefined && !app.hidden) {
      loadInbox().catch(() => {});
      refreshOpenConversation().catch(() => {});
    }
  });

  // ---------- start ----------

  async function open() {
    try {
      await api('GET', { query: '?action=me' });
    } catch (error) {
      if (error.status !== 401) showLogin('Impossible de joindre le serveur. Rechargez la page.', 'error');
      return;
    }

    $('login').hidden = true;
    app.hidden = false;
    try {
      await loadInbox();
    } catch {
      rowsNode.replaceChildren(el('li', 'list-empty', 'Impossible de charger les conversations. Rechargez la page.'));
    }
    const match = location.hash.match(/^#c=([0-9a-f-]{36})$/i);
    if (match) openConversation(match[1], { fromHistory: true });
    startPolling();
  }

  // ---------- visits: what people do on the site ----------

  const statsNode = $('stats');
  const statsBody = $('stats-body');
  let statsDays = 7;

  const minutes = (seconds) => (seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60}s` : `${seconds}s`);
  const pageName = (page) =>
    page === '/' ? "Accueil" : page.startsWith('/chat/') ? `Chat · ${page.split('/')[2]}` : page === '/privacy' ? 'Confidentialité' : page;

  function statCard(value, label) {
    const card = el('div', 'card-stat');
    card.append(el('b', null, String(value)), el('span', null, label));
    return card;
  }

  function funnelStep(label, count, total) {
    const share = total ? Math.round((count / total) * 100) : 0;
    const step = el('div', 'step');
    step.append(el('b', null, label), el('span', null, `${count} · ${share}%`));
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${share}%`;
    bar.append(fill);
    step.append(bar);
    return step;
  }

  function renderStats(data) {
    const body = statsBody;
    body.replaceChildren();
    if (!data.views) {
      body.append(el('p', 'stats-empty', "Personne n'est encore passé sur ces jours."));
      return;
    }

    const cards = el('div', 'cards');
    cards.append(
      statCard(data.sessions, 'visites'),
      statCard(data.visitors, 'personnes'),
      statCard(data.views, 'pages ouvertes'),
      statCard(data.funnel.request, 'demandes laissées')
    );
    body.append(cards);

    const funnel = el('div', 'panel');
    funnel.append(el('h3', null, 'Le chemin'));
    const steps = el('div', 'funnel');
    const total = data.funnel.visits || 1;
    steps.append(
      funnelStep('Sont venus', data.funnel.visits, total),
      funnelStep('Ont ouvert un chat', data.funnel.chat, total),
      funnelStep('Ont écrit un message', data.funnel.message, total),
      funnelStep('Ont laissé une demande', data.funnel.request, total)
    );
    funnel.append(steps);
    body.append(funnel);

    const pages = el('div', 'panel');
    pages.append(el('h3', null, 'Les pages'));
    const table = el('table', 'table');
    const head = el('tr');
    for (const label of ['Page', 'Ouvertures', 'Temps moyen', "Sont partis d'ici"]) head.append(el('th', null, label));
    table.append(el('thead').appendChild(head).parentNode);
    const tbody = el('tbody');
    for (const row of data.pages) {
      const tr = el('tr');
      tr.append(
        el('td', 'page-name', pageName(row.page)),
        el('td', null, String(row.views)),
        el('td', null, row.seconds ? minutes(row.seconds) : '—'),
        el('td', null, String(row.exits))
      );
      tbody.append(tr);
    }
    table.append(tbody);
    pages.append(table);
    body.append(pages);

    const days = el('div', 'panel');
    days.append(el('h3', null, 'Par jour'));
    const chart = el('div', 'days');
    const top = Math.max(...data.perDay.map((d) => d.count), 1);
    for (const day of data.perDay) {
      const column = el('div');
      const bar = el('i');
      bar.style.height = `${Math.round((day.count / top) * 90)}px`;
      bar.title = `${day.count} pages`;
      column.append(bar, el('small', null, day.day.slice(5)));
      chart.append(column);
    }
    days.append(chart);
    body.append(days);

    // A/B : une ligne par pub, pour voir laquelle amène de vraies conversations.
    if (data.ads?.length) {
      const test = el('div', 'panel');
      test.append(el('h3', null, 'Les pubs'));
      const table = el('table', 'pages');
      const head = el('tr');
      for (const label of ['Pub', 'Visites', 'Chats', 'Messages', 'Demandes']) head.append(el('th', null, label));
      table.append(head);
      for (const ad of data.ads) {
        const row = el('tr');
        row.append(el('td', null, ad.name));
        row.append(el('td', null, String(ad.visits)));
        row.append(el('td', null, String(ad.chat)));
        row.append(el('td', null, String(ad.message)));
        row.append(el('td', null, String(ad.request)));
        table.append(row);
      }
      test.append(table);
      body.append(test);
    }

    const where = el('div', 'panel');
    where.append(el('h3', null, "D'où ils viennent"));
    const tags = el('div', 'tags');
    for (const source of data.sources) {
      const tag = el('span', 'tag');
      const label = source.name.startsWith('ad:') ? `pub ${source.name.slice(3)}` : source.name;
      tag.append(el('b', null, String(source.count)), el('span', null, label === 'direct' ? 'direct' : label));
      tags.append(tag);
    }
    for (const device of data.devices) {
      const tag = el('span', 'tag');
      tag.append(el('b', null, String(device.count)), el('span', null, device.name === 'phone' ? 'téléphone' : 'ordinateur'));
      tags.append(tag);
    }
    where.append(tags);
    body.append(where);
  }

  async function loadStats() {
    statsBody.replaceChildren(el('p', 'stats-empty', 'Un instant…'));
    try {
      renderStats(await api('GET', { query: `?action=analytics&days=${statsDays}` }));
    } catch {
      statsBody.replaceChildren(el('p', 'stats-empty', 'Impossible de charger les visites.'));
    }
  }

  $('stats-open').addEventListener('click', () => {
    statsNode.hidden = false;
    loadStats();
  });
  $('stats-close').addEventListener('click', () => {
    statsNode.hidden = true;
  });
  $('stats-range').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-days]');
    if (!button) return;
    statsDays = Number(button.dataset.days);
    for (const other of $('stats-range').querySelectorAll('button')) other.classList.toggle('on', other === button);
    loadStats();
  });

  // On arrive : si le mot de passe est déjà entré sur cet appareil, on ouvre direct.
  state.session = storage.get();
  if (state.session?.token) open();
  else showLogin();
})();
