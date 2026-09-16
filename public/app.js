'use strict';
/* global DP, FB */
const { el, api, toast, fmt, timeAgo, dateTime, date } = DP;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const BOT_TABS = ['conversations', 'brain', 'channels', 'settings'];
const TAB_TITLES = {
  conversations: 'Inbox', brain: 'Brain', channels: 'Channels & links', settings: 'Settings',
  billing: 'Plan & billing', account: 'Account', setup: 'Set up your assistant',
};
// Mirrors readiness() on the server, so the meter moves while the owner types.
const READY_STEPS = [
  ['Describe the business', (s) => s.businessDescription.trim().length >= 60],
  ['Add your services and prices', (s) => s.packages.length > 0],
  ['Add what the bot should know', (s) => s.knowledge.length > 0],
  ['Answer the questions clients ask', (s) => s.faqs.length > 0],
  ['Say how clients reach a human', (s) => s.handoff.trim().length > 0],
];
const ACCOUNT_TABS = ['billing', 'account'];
const STAGE_LABELS = { new: 'New', exploring: 'Exploring', interested: 'Interested', negotiating: 'Negotiating', ready_to_buy: 'Ready to buy', won: 'Won', lost: 'Lost', support: 'Support' };
const GOAL_STATUS_LABELS = { achieved: 'Achieved', in_progress: 'In progress', not_started: 'Not started', not_applicable: 'N/A' };
const PLAN_NAMES = { trial: 'Free trial', expired: 'No plan', starter: 'Starter', pro: 'Pro', business: 'Business' };
const METHOD_LABELS = { d17: 'D17', bank: 'Bank transfer', cash: 'Cash', other: 'Other' };
const CHANNEL = {
  web: { label: 'Website', icon: '💬' },
  messenger: { label: 'Messenger', icon: '📘' },
  instagram: { label: 'Instagram', icon: '📸' },
  whatsapp: { label: 'WhatsApp', icon: '🟢' },
};
const REPLY_WINDOW_MS = 24 * 3600_000;
const likelyClass = (n) => (n >= 70 ? 'hi' : n >= 40 ? 'mid' : 'lo');
const channelBadge = (ch) => el('span', { class: `ch ${ch}`, text: `${CHANNEL[ch]?.icon || ''} ${CHANNEL[ch]?.label || ch}` });
const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

let me = null; // /api/me
let bot = null; // selected bot
let settings = null; // editable copy of the bot settings
let savedJson = '';
let dataLimit = 0;
let tab = 'conversations';
let selectedId = null;
let selectedStamp = '';
let listTimer = null;
let testHistory = [];
let billing = null;
let metaConfig = null;
let staticReady = false;
let setupDraft = null;

// ============================================================ boot
boot();

async function boot() {
  try {
    const session = await DP.session();
    if (!session) return (location.href = '/login?next=/app');
    if (/access_token=|type=(signup|recovery|magiclink)/.test(location.hash)) history.replaceState(null, '', '/app');
    initStatic();
    await loadMe();
    const saved = safeGet('dp_bot');
    const first = me.bots.find((b) => b.id === saved) || me.bots[0];
    if (first) await selectBot(first.id, { keepTab: true });
    $('#boot').hidden = true;
    $('#app').hidden = false;
    const wanted = location.hash.slice(1);
    switchTab(BOT_TABS.includes(wanted) || ACCOUNT_TABS.includes(wanted) ? wanted : 'conversations');
  } catch (e) {
    $('#bootText').textContent = e.message || 'Could not load the dashboard';
  }
}

async function loadMe() {
  me = await api('/api/me');
  renderSidebar();
  renderBanners();
}

function renderSidebar() {
  $('#botNav').hidden = !me.bots.length;
  // One bot is the normal case, so nothing about bots is shown until there are two.
  $('#botMenuBtn').hidden = me.bots.length < 2 || !bot;
  if (bot) $('#botMenuName').textContent = bot.name;
  $('#planPill').textContent = me.limits.planName;
  const u = me.usage;
  const pct = Math.min(100, Math.round((u.replies / Math.max(1, u.limit)) * 100));
  $('#usageText').textContent = `${fmt(u.replies)} / ${fmt(u.limit)} replies`;
  $('#usageBar').style.width = `${pct}%`;
  $('#usageBar').className = pct >= 100 ? 'danger' : pct >= 80 ? 'warn' : '';
  $('#superLink').hidden = !me.isSuperAdmin;
}

function renderBanners() {
  const list = [];
  const u = me.usage;
  if (u.replies >= u.limit) {
    list.push(['danger', `You used all ${fmt(u.limit)} AI replies of this month. Your bots can't answer until you add a reply pack or upgrade.`]);
  } else if (u.replies >= u.limit * 0.8) {
    list.push(['', `You used ${Math.round((u.replies / u.limit) * 100)}% of this month's AI replies.`]);
  }
  if (me.limits.plan === 'expired') {
    list.push(['danger', me.account.plan === 'trial'
      ? 'Your free trial is over. Choose a plan so your bots start answering clients again.'
      : `Your ${PLAN_NAMES[me.account.plan]} plan has expired. Your bots stopped answering clients.`]);
  } else if (me.limits.trial) {
    const days = Math.max(0, Math.ceil((Date.parse(me.limits.expiresAt) - Date.now()) / 86400000));
    list.push(['', `Free trial: ${days} day${days === 1 ? '' : 's'} left. Choose a plan before it ends.`]);
  }
  const paused = me.bots.filter((b) => b.is_active && !b.serving).length;
  if (paused) list.push(['', `${paused} bot${paused > 1 ? 's are' : ' is'} paused: your plan allows ${me.limits.bots} active bot${me.limits.bots > 1 ? 's' : ''}.`]);
  $('#banners').replaceChildren(
    ...list.map(([kind, text]) =>
      el('div', { class: `banner ${kind}` }, el('span', { text }), el('span', { class: 'spacer' }), el('button', { class: 'btn sm', text: 'Plan & billing', onclick: () => switchTab('billing') }))
    )
  );
}

// ============================================================ navigation
function initStatic() {
  if (staticReady) return;
  staticReady = true;
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#logout').addEventListener('click', confirmLogout);
  $('#logout2').addEventListener('click', confirmLogout);
  $('#newBotBtn').addEventListener('click', openNewBot);
  $('#botMenuBtn').addEventListener('click', () => {
    renderBotPick();
    $('#botDialog').showModal();
  });
  $('#botDialogClose').addEventListener('click', () => $('#botDialog').close());
  $('#askGo').addEventListener('click', runRevise);
  $('#editSave').addEventListener('click', saveEdit);
  $('#editCancel').addEventListener('click', cancelEdit);
  $('#editX').addEventListener('click', cancelEdit);
  $('#editDialog').addEventListener('cancel', (e) => {
    e.preventDefault();
    cancelEdit();
  });
  $('#newBotForm').addEventListener('submit', createBotFromDialog);
  initBindings();
  initSetup();
  initDrawer();
  initConversations();
  initChannels();
  initTest();
  initInstall();
  initBotSettings();
  initBilling();
  initAccount();
  $('#save').addEventListener('click', saveSettings);
  $('#discard').addEventListener('click', () => {
    settings = JSON.parse(savedJson);
    renderSettings();
  });
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault();
  });
}

function switchTab(next) {
  if (!me.bots.length && BOT_TABS.includes(next)) next = 'setup';
  tab = next;
  $$('.sidebar [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === next));
  $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== next));
  $('#pageTitle').textContent = TAB_TITLES[next] || '';
  $('#openTest').hidden = !bot || next === 'setup';
  if (next !== 'setup') history.replaceState(null, '', `#${next}`);
  clearInterval(listTimer);
  if (next === 'conversations') {
    loadConversations();
    listTimer = setInterval(() => document.visibilityState === 'visible' && loadConversations(true), 15000);
  }
  if (next === 'brain') {
    renderReady();
    renderSummaries();
  }
  if (next === 'channels') {
    loadChannels();
    renderInstall();
  }
  if (next === 'settings') renderBotSettings();
  if (next === 'billing') loadBilling();
  if (next === 'account') renderAccount();
  $('#sidebar').classList.remove('open');
  markDirty();
  window.scrollTo(0, 0);
}

async function confirmLogout() {
  if (isDirty() && !confirm('You have unsaved changes. Log out anyway?')) return;
  savedJson = settings ? JSON.stringify(settings) : '';
  DP.logout();
}

// ============================================================ bots
async function selectBot(id, { keepTab = false } = {}) {
  if (bot && id !== bot.id && isDirty() && !confirm('You have unsaved changes. Switch bot anyway?')) return;
  try {
    const data = await api(`/api/bots/${id}`);
    bot = data.bot;
    settings = data.settings;
    savedJson = JSON.stringify(settings);
    dataLimit = data.dataLimit;
    safeSet('dp_bot', bot.id);
    selectedId = null;
    testHistory = [];
    $('#convDetail').replaceChildren(emptyDetail('Select a conversation to see the summary and the full chat.'));
    renderSettings();
    renderSidebar();
    if (!keepTab) switchTab(BOT_TABS.includes(tab) ? tab : 'conversations');
  } catch (e) {
    toast(e.message, true);
  }
}

function openNewBot() {
  const used = me.bots.length;
  $('#newBotHint').textContent =
    used >= me.limits.bots
      ? `Your ${me.limits.planName} plan includes ${me.limits.bots} bot${me.limits.bots > 1 ? 's' : ''}. Upgrade or add an extra bot in Plan & billing first.`
      : `You're using ${used} of ${me.limits.bots} bot${me.limits.bots > 1 ? 's' : ''} on your plan.`;
  $('#newBotName').value = '';
  $('#newBotDialog').showModal();
}

async function createBotFromDialog(e) {
  if (e.submitter?.value !== 'create') return;
  e.preventDefault();
  const ok = await createBot($('#newBotName').value);
  if (ok) $('#newBotDialog').close();
}

async function createBot(name) {
  name = String(name || '').trim();
  if (!name) return toast('Enter a name', true), false;
  if (isDirty() && !confirm('You have unsaved changes on the current bot. Continue anyway?')) return false;
  try {
    const { bot: created } = await api('/api/bots', { body: { name } });
    savedJson = settings ? JSON.stringify(settings) : '';
    await loadMe();
    await selectBot(created.id, { keepTab: true });
    resetSetup(name);
    switchTab('setup');
    return true;
  } catch (err) {
    toast(err.message, true);
    if (err.data?.code === 'bot_limit') switchTab('billing');
    return false;
  }
}

// ============================================================ settings editing
function initBindings() {
  $$('[data-bind]').forEach((input) => {
    const key = input.dataset.bind;
    const evt = ['checkbox', 'color'].includes(input.type) || input.tagName === 'SELECT' ? 'change' : 'input';
    input.addEventListener(evt, () => {
      if (!settings) return;
      settings[key] = input.type === 'checkbox' ? input.checked : input.value;
      markDirty();
    });
  });
  $$('[data-add]').forEach((b) =>
    b.addEventListener('click', () => {
      const name = b.dataset.add;
      settings[name].push(LISTS[name].blank());
      renderList(name);
      markDirty();
      $$(`#${name}List .item-card`).at(-1)?.querySelector('input:not([type=checkbox]), textarea')?.focus();
    })
  );
}

function renderSettings() {
  if (!settings) return;
  $$('[data-bind]').forEach((input) => {
    const v = settings[input.dataset.bind];
    if (input.type === 'checkbox') input.checked = !!v;
    else input.value = v ?? '';
  });
  Object.keys(LISTS).forEach(renderList);
  markDirty();
}

const isDirty = () => Boolean(settings && JSON.stringify(settings) !== savedJson);

function dataSize(s) {
  const parts = [
    s.businessDescription, s.tone, s.languageRule, s.pricingNotes, s.rules, s.handoff, s.welcomeMessage,
    ...s.knowledge.flatMap((k) => [k.title, k.content]),
    ...s.faqs.flatMap((f) => [f.q, f.a]),
    ...s.packages.flatMap((p) => [p.name, p.price, p.includes]),
    ...s.goals.filter((g) => g.enabled).flatMap((g) => [g.label, g.instructions]),
  ];
  return parts.reduce((n, x) => n + (x ? x.length : 0), 0);
}

function markDirty() {
  const dirty = isDirty();
  $('#savebar').hidden = !dirty || !BOT_TABS.includes(tab) || $('#editDialog').open;
  if (!settings) return;
  const size = dataSize(settings);
  const pct = Math.min(100, Math.round((size / Math.max(1, dataLimit)) * 100));
  $$('[data-meter-text]').forEach((n) => (n.textContent = `${fmt(size)} / ${fmt(dataLimit)} characters`));
  $$('[data-meter-bar]').forEach((n) => {
    n.style.width = `${pct}%`;
    n.className = size > dataLimit ? 'danger' : pct >= 85 ? 'warn' : '';
  });
  if (tab === 'brain') renderReady();
  const ready = readyOf(settings);
  $('#brainDot').hidden = ready.percent === 100;
}

// ============================================================ readiness
function readyOf(s) {
  if (!s) return { percent: 0, steps: [] };
  const steps = READY_STEPS.map(([label, done]) => ({ label, done: done(s) }));
  return { percent: Math.round((steps.filter((x) => x.done).length / steps.length) * 100), steps };
}

function renderReady() {
  const box = $('#readyBox');
  if (!box || !settings) return;
  const { percent, steps } = readyOf(settings);
  const left = steps.filter((x) => !x.done);
  box.replaceChildren(
    el('div', { class: 'ready-top' },
      el('span', { class: 'ready-pct', text: `${percent}%` }),
      el('div', {},
        el('b', { text: percent === 100 ? 'Your assistant is ready' : 'Your assistant is almost there' }),
        el('div', { class: 'hint', text: left.length ? `${left.length} thing${left.length > 1 ? 's' : ''} left to add.` : 'It knows everything it needs to sell for you.' })
      )
    ),
    el('div', { class: 'bar' }, el('div', { style: `width:${percent}%` })),
    el('div', { class: 'ready-steps' },
      ...steps.map((x) =>
        el('span', { class: `ready-step${x.done ? ' done' : ''}` },
          iconEl(x.done ? 'i-check' : 'i-dot'),
          el('span', { text: x.label })
        )
      )
    )
  );
}

function iconEl(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${name}`);
  svg.append(use);
  return svg;
}

async function saveSettings() {
  $('#save').disabled = true;
  try {
    const data = await api(`/api/bots/${bot.id}/settings`, { method: 'PUT', body: settings });
    settings = data.settings;
    savedJson = JSON.stringify(settings);
    dataLimit = data.dataLimit;
    renderSettings();
    toast('Saved — the bot uses it from the next message');
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  } finally {
    $('#save').disabled = false;
  }
}

const LISTS = {
  knowledge: {
    fields: [
      { key: 'title', label: 'Topic', placeholder: 'e.g. Our services / How we work / Delivery' },
      { key: 'content', label: 'Details', type: 'textarea', rows: 6, placeholder: 'Everything the bot should know about this topic…' },
    ],
    blank: () => ({ title: '', content: '' }),
    empty: 'Nothing yet. Add your services, your process, delivery times, guarantees, location…',
  },
  faqs: {
    fields: [
      { key: 'q', label: 'Question', placeholder: 'e.g. How long does it take?' },
      { key: 'a', label: 'Answer', type: 'textarea', rows: 3, placeholder: 'Your exact answer' },
    ],
    blank: () => ({ q: '', a: '' }),
    empty: 'No FAQ yet.',
  },
  packages: {
    fields: [
      { key: 'name', label: 'Package name', placeholder: 'e.g. Starter', half: true },
      { key: 'price', label: 'Price', placeholder: 'e.g. 120 DT', half: true },
      { key: 'includes', label: "What's included", type: 'textarea', rows: 4, placeholder: '- 4 pages\n- Contact form\n- WhatsApp button' },
    ],
    blank: () => ({ name: '', price: '', includes: '' }),
    empty: "No packages yet — the bot will say it'll check prices with the team.",
  },
  goals: {
    toggle: 'enabled',
    fields: [
      { key: 'label', label: 'Goal', placeholder: 'e.g. Book a discovery call' },
      { key: 'instructions', label: 'How the bot should pursue it', type: 'textarea', rows: 3, placeholder: 'What a good result looks like and how to get there' },
    ],
    blank: () => ({ key: `custom_${Date.now().toString(36)}`, label: '', enabled: true, instructions: '' }),
    canDelete: (g) => g.key.startsWith('custom_'),
    empty: 'No goals. Add at least one so the bot knows what to aim for.',
  },
};

function renderList(name) {
  const cfg = LISTS[name];
  const box = $(`#${name}List`);
  const items = settings[name];
  box.replaceChildren();
  if (!items.length) return box.append(el('div', { class: 'empty-list', text: cfg.empty }));

  items.forEach((item, i) => {
    const card = el('div', { class: `item-card${cfg.toggle && !item[cfg.toggle] ? ' is-off' : ''}` });
    const head = el('div', { class: 'item-head' }, el('span', { class: 'item-num', text: `#${i + 1}` }));
    if (cfg.toggle) {
      const label = el('span', { text: item[cfg.toggle] ? 'On' : 'Off' });
      const cb = el('input', { type: 'checkbox', checked: !!item[cfg.toggle] });
      cb.addEventListener('change', () => {
        item[cfg.toggle] = cb.checked;
        card.classList.toggle('is-off', !cb.checked);
        label.textContent = cb.checked ? 'On' : 'Off';
        markDirty();
      });
      head.append(el('label', { class: 'switch' }, cb, label));
    }
    head.append(
      el('span', { class: 'grow' }),
      el('button', { class: 'icon-btn', title: 'Move up', text: '↑', disabled: i === 0, onclick: () => move(name, i, -1) }),
      el('button', { class: 'icon-btn', title: 'Move down', text: '↓', disabled: i === items.length - 1, onclick: () => move(name, i, 1) })
    );
    if (!cfg.canDelete || cfg.canDelete(item)) {
      head.append(
        el('button', {
          class: 'icon-btn',
          title: 'Remove',
          text: '✕',
          onclick: () => {
            if (!confirm('Remove this item?')) return;
            items.splice(i, 1);
            renderList(name);
            markDirty();
          },
        })
      );
    }
    card.append(head);

    let halfRow = null;
    for (const f of cfg.fields) {
      const input = f.type === 'textarea'
        ? el('textarea', { rows: f.rows || 3, placeholder: f.placeholder || '', dir: 'auto' })
        : el('input', { placeholder: f.placeholder || '', dir: 'auto' });
      input.value = item[f.key] || '';
      input.addEventListener('input', () => {
        item[f.key] = input.value;
        markDirty();
      });
      const field = el('label', { class: 'field' }, el('span', { text: f.label }), input);
      if (f.half) {
        if (!halfRow) card.append((halfRow = el('div', { class: 'grid-2' })));
        halfRow.append(field);
      } else {
        halfRow = null;
        card.append(field);
      }
    }
    box.append(card);
  });
}

function move(name, i, dir) {
  const items = settings[name];
  const j = i + dir;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  renderList(name);
  markDirty();
}

// ============================================================ bot settings tab
function initBotSettings() {
  $('#botNameSave').addEventListener('click', async () => {
    try {
      const { bot: updated } = await api(`/api/bots/${bot.id}`, { method: 'PATCH', body: { name: $('#botNameInput').value } });
      bot = updated;
      await loadMe();
      toast('Bot renamed');
    } catch (e) {
      toast(e.message, true);
    }
  });
  $('#botActive').addEventListener('change', async (e) => {
    try {
      const { bot: updated } = await api(`/api/bots/${bot.id}`, { method: 'PATCH', body: { is_active: e.target.checked } });
      bot = updated;
      await loadMe();
      renderBotSettings();
      toast(bot.is_active ? 'Bot is answering clients' : 'Bot paused');
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message, true);
    }
  });
  $('#deleteBot').addEventListener('click', async () => {
    const typed = prompt(`This deletes "${bot.name}", its channel connections and all its conversations forever.\nType the bot name to confirm:`);
    if (typed === null) return;
    if (typed.trim() !== bot.name) return toast('The name did not match — nothing was deleted', true);
    try {
      await api(`/api/bots/${bot.id}`, { method: 'DELETE' });
      savedJson = JSON.stringify(settings);
      bot = null;
      settings = null;
      safeSet('dp_bot', '');
      await loadMe();
      if (me.bots.length) await selectBot(me.bots[0].id, { keepTab: true });
      switchTab('conversations');
      toast('Bot deleted');
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function renderBotSettings() {
  if (!bot) return;
  renderBotsCard();
  const info = me.bots.find((b) => b.id === bot.id);
  $('#botNameInput').value = bot.name;
  $('#botActive').checked = bot.is_active;
  $('#botActiveLabel').textContent = bot.is_active ? 'Answering clients' : 'Paused';
  $('#botServingHint').textContent =
    bot.is_active && info && !info.serving
      ? `Paused by your plan: it allows ${me.limits.bots} active bot${me.limits.bots > 1 ? 's' : ''}. Pause another bot or upgrade.`
      : '';
}

// ============================================================ AI setup
function initSetup() {
  $('#setupGo').addEventListener('click', runAutofill);
  $('#setupRetry').addEventListener('click', runAutofill);
  $('#setupSkip').addEventListener('click', skipSetup);
  $('#setupSave').addEventListener('click', saveDraft);
  $('#setupBack').addEventListener('click', () => showSetupStep(1));
  $('#rebuildAll').addEventListener('click', () => {
    resetSetup(settings?.businessName || bot?.name || '');
    switchTab('setup');
  });
}

function resetSetup(name = '') {
  setupDraft = null;
  $('#setupName').value = name;
  $('#setupText').value = '';
  $('#setupUrl').value = '';
  showSetupStep(1);
}

function showSetupStep(n) {
  $('#setupStep1').hidden = n !== 1;
  $('#setupWorking').hidden = n !== 2;
  $('#setupReview').hidden = n !== 3;
  $$('#setupSteps span').forEach((dot, i) => (dot.className = i + 1 === n ? 'on' : i + 1 < n ? 'done' : ''));
}

// The first bot does not exist yet when the wizard opens, and autofill needs one.
async function ensureBot(name) {
  if (bot) return true;
  if (!name.trim()) {
    toast('Enter your business name first', true);
    $('#setupName').focus();
    return false;
  }
  try {
    const { bot: created } = await api('/api/bots', { body: { name: name.trim() } });
    await loadMe();
    await selectBot(created.id, { keepTab: true });
    return true;
  } catch (e) {
    toast(e.message, true);
    if (e.data?.code === 'bot_limit') switchTab('billing');
    return false;
  }
}

async function skipSetup() {
  if (!(await ensureBot($('#setupName').value))) return;
  switchTab('brain');
}

let workTimer = null;
function runWorkAnimation() {
  const items = $$('#workSteps li');
  items.forEach((li) => (li.className = ''));
  let i = 0;
  const tick = () => {
    if (i > 0) items[i - 1].className = 'done';
    if (i < items.length) items[i].className = 'on';
    i += 1;
  };
  tick();
  clearInterval(workTimer);
  workTimer = setInterval(() => (i <= items.length ? tick() : clearInterval(workTimer)), 7000);
}

async function runAutofill() {
  const name = $('#setupName').value.trim();
  const text = $('#setupText').value.trim();
  const url = $('#setupUrl').value.trim();
  if (!text && !url) return toast('Tell us about your business, or give us your website link', true);
  if (!(await ensureBot(name || text.slice(0, 60)))) return;

  showSetupStep(2);
  runWorkAnimation();
  try {
    const data = await api(`/api/bots/${bot.id}/autofill`, { body: { businessName: name, text, url } });
    setupDraft = data;
    renderReview(data);
    showSetupStep(3);
    window.scrollTo(0, 0);
  } catch (e) {
    showSetupStep(1);
    toast(e.message, true);
    if (e.data?.code === 'reply_limit') switchTab('billing');
  } finally {
    clearInterval(workTimer);
    loadMe().catch(() => {}); // the draft cost one AI reply
  }
}

function renderReview(data) {
  const s = data.settings;
  $('#reviewNote').textContent = data.readFrom
    ? `Written from what you told us and from ${data.readFrom}. Read it quickly — you can change anything after saving.`
    : 'Read it quickly — you can change anything after saving.';

  $('#missingBox').replaceChildren(
    data.missing?.length
      ? el('div', { class: 'missing-box' },
          el('b', { text: 'The AI had no information about these. Add them later in the Brain:' }),
          el('ul', {}, ...data.missing.map((m) => el('li', { dir: 'auto', text: m })))
        )
      : ''
  );

  const block = (label, body, count) =>
    el('div', { class: 'rv' },
      el('b', {}, count && el('span', { class: 'rv-count', text: count }), el('span', { text: label })),
      body
    );
  const textBlock = (label, v) => (v && v.trim() ? block(label, el('div', { class: 'v', dir: 'auto', text: v })) : null);
  const listBlock = (label, items, line) =>
    items.length ? block(label, el('ul', {}, ...items.map((x) => el('li', { dir: 'auto', text: line(x) }))), String(items.length)) : null;

  $('#reviewBody').replaceChildren(
    ...[
      textBlock('Assistant name', s.botName),
      textBlock('First message the client sees', s.welcomeMessage),
      textBlock('About the business', s.businessDescription),
      listBlock('Services & prices', s.packages, (p) => `${p.name}${p.price ? ` — ${p.price}` : ''}`),
      listBlock('Topics it knows', s.knowledge, (k) => k.title || k.content.slice(0, 60)),
      listBlock('Questions it can answer', s.faqs, (f) => f.q),
      listBlock('Goals in every chat', s.goals.filter((g) => g.enabled), (g) => g.label),
      textBlock('How it talks', s.tone),
      textBlock('Rules it follows', s.rules),
      textBlock('How clients reach you', s.handoff),
    ].filter(Boolean)
  );
}

async function saveDraft() {
  if (!setupDraft) return;
  $('#setupSave').disabled = true;
  try {
    const data = await api(`/api/bots/${bot.id}/settings`, { method: 'PUT', body: setupDraft.settings });
    settings = data.settings;
    savedJson = JSON.stringify(settings);
    dataLimit = data.dataLimit;
    renderSettings();
    setupDraft = null;
    switchTab('brain');
    toast('Saved. Hit "Try your bot" and talk to it like a client.');
  } catch (e) {
    toast(e.message, true);
  } finally {
    $('#setupSave').disabled = false;
  }
}

// ============================================================ test drawer
function initDrawer() {
  $('#openTest').addEventListener('click', openTestDrawer);
  $('#testClose').addEventListener('click', closeTestDrawer);
  $('#testBack').addEventListener('click', closeTestDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#testDrawer').hidden) closeTestDrawer();
  });
}

function openTestDrawer() {
  if (!bot) return toast('Create your assistant first', true);
  $('#testBack').hidden = false;
  $('#testDrawer').hidden = false;
  renderTest();
  $('#testInput').focus();
}

function closeTestDrawer() {
  $('#testDrawer').hidden = true;
  $('#testBack').hidden = true;
}

// ============================================================ brain summary
// The owner reads short cards and opens one focused editor at a time; the real
// form lives in #editGroups and is moved in and out of the dialog, so every
// binding set up by initBindings() keeps working.
const SUMMARIES = [
  { key: 'identity', label: 'Name', title: 'Name & greeting',
    preview: (s) => [s.botName, s.welcomeMessage].filter(Boolean).join(' — ') },
  { key: 'about', label: 'About', title: 'About the business',
    preview: (s) => s.businessDescription },
  { key: 'prices', label: 'Prices', title: 'Services & prices',
    count: (s) => s.packages.length,
    preview: (s) => s.packages.map((p) => `${p.name}${p.price ? ` ${p.price}` : ''}`).join(' · ') },
  { key: 'knowledge', label: 'Topics', title: 'What the bot should know',
    count: (s) => s.knowledge.length,
    preview: (s) => s.knowledge.map((k) => k.title).filter(Boolean).join(' · ') },
  { key: 'faqs', label: 'Answers', title: 'Questions clients ask',
    count: (s) => s.faqs.length,
    preview: (s) => s.faqs.map((f) => f.q).filter(Boolean).join(' · ') },
  { key: 'contact', label: 'Contact', title: 'How clients reach a human',
    preview: (s) => s.handoff },
  { key: 'style', label: 'How it talks', title: 'Tone and rules',
    preview: (s) => s.tone },
  { key: 'goals', label: 'Goals', title: 'What it aims for in every chat',
    count: (s) => s.goals.filter((g) => g.enabled).length,
    preview: (s) => s.goals.filter((g) => g.enabled).map((g) => g.label).join(' · ') },
];

function renderSummaries() {
  const box = $('#sumList');
  if (!box || !settings) return;
  box.replaceChildren(
    ...SUMMARIES.map((cfg) => {
      const n = cfg.count ? cfg.count(settings) : 0;
      const text = String(cfg.preview(settings) || '').trim();
      return el('button', { class: 'sum', onclick: () => openEdit(cfg) },
        el('span', { class: 'sum-label' },
          el('span', { text: cfg.label }),
          n ? el('span', { class: 'pill gray', text: String(n) }) : null
        ),
        el('span', { class: `sum-body${text ? '' : ' empty'}`, dir: 'auto', text: text || 'Nothing yet — click to add' }),
        el('span', { class: 'sum-go', text: 'Edit' })
      );
    })
  );
}

let editGroup = null;

function openEdit(cfg) {
  const group = $(`#editGroups [data-group="${cfg.key}"]`);
  if (!group) return;
  editGroup = group;
  $('#editTitle').textContent = cfg.title;
  $('#editBody').replaceChildren(group);
  $('#editDialog').showModal();
  markDirty();
  $('#editBody').querySelector('input:not([type=checkbox]), textarea')?.focus();
}

function putGroupBack() {
  if (editGroup) $('#editGroups').append(editGroup);
  editGroup = null;
  $('#editDialog').close();
  renderSummaries();
  markDirty();
}

async function saveEdit() {
  $('#editSave').disabled = true;
  try {
    if (await saveSettings()) putGroupBack();
  } finally {
    $('#editSave').disabled = false;
  }
}

function cancelEdit() {
  settings = JSON.parse(savedJson);
  renderSettings();
  putGroupBack();
}

// "Tell the AI what to change" — one sentence instead of hunting for a field.
async function runRevise() {
  const instruction = $('#askText').value.trim();
  if (!instruction) return toast('Write what you want to change', true);
  $('#askGo').disabled = true;
  $('#askResult').replaceChildren(el('div', { class: 'ask-result hint', text: 'Working…' }));
  try {
    const data = await api(`/api/bots/${bot.id}/revise`, { body: { instruction } });
    if (!data.changed.length) {
      $('#askResult').replaceChildren(el('div', { class: 'ask-result hint', text: 'That did not change anything. Try saying it another way.' }));
      return;
    }
    settings = data.settings;
    if (!(await saveSettings())) return;
    $('#askText').value = '';
    renderSummaries();
    $('#askResult').replaceChildren(
      el('div', { class: 'ask-result' },
        el('b', { text: 'Changed:' }),
        el('ul', {}, ...data.changed.map((c) => el('li', { dir: 'auto', text: c })))
      )
    );
  } catch (e) {
    $('#askResult').replaceChildren();
    toast(e.message, true);
    if (e.data?.code === 'reply_limit') switchTab('billing');
  } finally {
    $('#askGo').disabled = false;
    loadMe().catch(() => {});
  }
}

// ============================================================ bots
const botRow = (b, onclick) =>
  el('button', { class: `bot-row${bot && b.id === bot.id ? ' current' : ''}`, onclick },
    el('span', { class: 'bot-name', dir: 'auto', text: b.name }),
    el('span', { class: `pill ${b.serving ? 'green' : 'gray'}`, text: b.serving ? 'Answering' : 'Paused' })
  );

function renderBotPick() {
  $('#botPickList').replaceChildren(
    ...me.bots.map((b) =>
      botRow(b, () => {
        $('#botDialog').close();
        if (!bot || b.id !== bot.id) selectBot(b.id, { keepTab: true });
      })
    )
  );
}

function renderBotsCard() {
  $('#botsHint').textContent = `${me.bots.length} of ${me.limits.bots} bot${me.limits.bots > 1 ? 's' : ''} on your ${me.limits.planName} plan.`;
  $('#botsList').replaceChildren(
    ...me.bots.map((b) => botRow(b, () => (!bot || b.id !== bot.id) && selectBot(b.id, { keepTab: true })))
  );
}

// ============================================================ conversations
function initConversations() {
  let searchTimer;
  $('#search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadConversations(), 300);
  });
  ['#channelFilter', '#stageFilter', '#statusFilter'].forEach((s) => $(s).addEventListener('change', () => loadConversations()));
}

const emptyDetail = (text) => el('div', { class: 'empty-state' }, el('div', { class: 'big', text: '🗂' }), el('p', { text }));

async function loadConversations(silent = false) {
  if (!bot) return;
  const botId = bot.id;
  const params = new URLSearchParams();
  if ($('#search').value.trim()) params.set('q', $('#search').value.trim());
  if ($('#channelFilter').value) params.set('channel', $('#channelFilter').value);
  if ($('#stageFilter').value) params.set('stage', $('#stageFilter').value);
  if ($('#statusFilter').value) params.set('status', $('#statusFilter').value);
  try {
    const [list, stats] = await Promise.all([api(`/api/bots/${botId}/conversations?${params}`), api(`/api/bots/${botId}/stats`)]);
    if (!bot || bot.id !== botId) return;
    renderStats(stats);
    renderConversationList(list.conversations);
    const current = list.conversations.find((c) => c.id === selectedId);
    if (current && `${current.updated_at}|${current.summary_at}|${current.bot_paused}` !== selectedStamp && !notesDirty() && !replyDirty()) {
      openConversation(selectedId, true);
    }
    if (silent) loadMe().catch(() => {});
  } catch (e) {
    if (!silent) toast(e.message, true);
  }
}

function renderStats(s) {
  const items = [
    ['Conversations', s.total ?? 0],
    ['Last 7 days', s.last7days ?? 0],
    ['Hot leads (70%+)', s.hotLeads ?? 0],
    ['Ready to buy', s.readyToBuy ?? 0],
    ['Avg. deal likelihood', s.avgLikelihood == null ? '—' : `${s.avgLikelihood}%`],
  ];
  $('#stats').replaceChildren(...items.map(([l, v]) => el('div', { class: 'stat' }, el('div', { class: 'v', text: v }), el('div', { class: 'l', text: l }))));
}

function renderConversationList(rows) {
  const box = $('#convList');
  const scroll = box.scrollTop;
  box.replaceChildren();
  if (!rows.length) {
    box.append(emptyDetail($('#search').value || $('#channelFilter').value ? 'No matches.' : 'No conversations yet. Connect a channel or share your chat link.'));
    return;
  }
  for (const c of rows) {
    box.append(
      el('button', { class: `conv-item${c.id === selectedId ? ' active' : ''}`, 'data-id': c.id, onclick: () => openConversation(c.id) },
        el('div', { class: 'row' },
          el('span', { class: 'name', dir: 'auto', text: c.client_name || c.client_contact || 'Anonymous client' }),
          el('span', { class: 'time', text: timeAgo(c.updated_at) })),
        el('div', { class: 'headline', dir: 'auto', text: c.headline || 'No summary yet' }),
        el('div', { class: 'meta' },
          channelBadge(c.channel),
          c.bot_paused && el('span', { class: 'badge stage-interested', text: '✋ Human' }),
          c.stage && el('span', { class: `badge stage-${c.stage}`, text: STAGE_LABELS[c.stage] || c.stage }),
          c.deal_likelihood != null && el('span', { class: `likely ${likelyClass(c.deal_likelihood)}`, text: `${c.deal_likelihood}%` }),
          c.status === 'closed' && el('span', { class: 'badge', text: 'Closed' }),
          el('span', { text: `${c.message_count} msgs` })))
    );
  }
  box.scrollTop = scroll;
}

const notesDirty = () => {
  const t = $('#notes');
  return Boolean(t && t.value !== (t.dataset.saved || ''));
};
const replyDirty = () => Boolean($('#replyText')?.value.trim());

async function openConversation(id, silent = false) {
  if (!silent && (notesDirty() || replyDirty()) && !confirm('You have unsaved text. Leave anyway?')) return;
  selectedId = id;
  $$('.conv-item').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
  try {
    const { conversation, messages } = await api(`/api/bots/${bot.id}/conversations/${id}`);
    selectedStamp = `${conversation.updated_at}|${conversation.summary_at}|${conversation.bot_paused}`;
    renderDetail(conversation, messages);
  } catch (e) {
    toast(e.message, true);
  }
}

function renderDetail(c, messages) {
  const box = $('#convDetail');
  const keepScroll = box.scrollTop;
  const same = box.dataset.id === c.id;
  box.dataset.id = c.id;
  const base = `/api/bots/${bot.id}/conversations/${c.id}`;

  const head = el('div', { class: 'detail-head' },
    el('div', {},
      el('h2', { dir: 'auto', text: c.client_name || 'Anonymous client' }),
      el('div', { class: 'row', style: 'margin-top:4px' },
        channelBadge(c.channel),
        el('span', { class: 'sub', dir: 'auto', text: [c.client_contact, c.channel === 'web' && c.source && `via ${c.source}`, `started ${dateTime(c.created_at)}`].filter(Boolean).join(' · ') }))),
    el('div', { class: 'detail-actions' },
      el('button', { class: 'btn sm', text: 'Edit client', onclick: () => editClient(c) }),
      el('button', { class: 'btn sm', text: c.status === 'open' ? 'Mark closed' : 'Reopen', onclick: () => patchConversation(c.id, { status: c.status === 'open' ? 'closed' : 'open' }) }),
      el('button', {
        class: 'btn sm', text: '⬇ Transcript',
        onclick: async () => {
          try {
            DP.download(`chat_${(c.client_name || 'client').replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${c.created_at.slice(0, 10)}.txt`, await api(`${base}/transcript`));
          } catch (e) { toast(e.message, true); }
        },
      }),
      el('button', { class: 'btn sm danger', text: 'Delete', onclick: () => deleteConversation(c.id) })));

  const takeover = el('div', { class: `takeover${c.bot_paused ? ' paused' : ''}` },
    el('span', { text: c.bot_paused ? '✋ You are handling this conversation — the bot stays quiet.' : '🤖 The bot answers this client automatically.' }),
    el('span', { class: 'spacer' }),
    el('button', {
      class: `btn sm${c.bot_paused ? ' primary' : ''}`,
      text: c.bot_paused ? 'Give back to the bot' : 'Pause bot & take over',
      onclick: async () => {
        try {
          await api(`${base}/takeover`, { body: { paused: !c.bot_paused } });
          await openConversation(c.id, true);
          loadConversations(true);
        } catch (e) { toast(e.message, true); }
      },
    }));

  const notes = el('textarea', { id: 'notes', rows: 3, dir: 'auto', placeholder: 'Private notes about this client…' });
  notes.value = c.admin_notes || '';
  notes.dataset.saved = c.admin_notes || '';
  const saveNotes = el('button', {
    class: 'btn sm', text: 'Save notes',
    onclick: async () => {
      try {
        await api(base, { method: 'PATCH', body: { admin_notes: notes.value } });
        notes.dataset.saved = notes.value;
        toast('Notes saved');
      } catch (e) { toast(e.message, true); }
    },
  });

  const transcript = el('div', { class: 'transcript' },
    messages.map((m) => {
      const human = m.role === 'assistant' && m.sender === 'human';
      const who = m.role === 'user' ? 'Client' : human ? 'You' : settings.botName;
      return el('div', { class: `t-msg ${m.role}${human ? ' human' : ''}` },
        el('div', { class: 'b', dir: 'auto', text: m.content }),
        el('div', { class: 'm', text: `${who} · ${dateTime(m.created_at)}` }),
        m.send_error && el('div', { class: 'send-error', text: `Not delivered: ${m.send_error}` }));
    }));

  box.replaceChildren(head,
    el('div', { class: 'detail-body' },
      takeover,
      renderSummary(c),
      el('div', { class: 'section-title', text: 'Notes' }),
      el('div', { class: 'notes' }, notes, el('div', { class: 'row' }, saveNotes)),
      el('div', { class: 'section-title', text: `Conversation (${messages.length} messages)` }),
      transcript,
      renderReplyBox(c)));
  box.scrollTop = same ? keepScroll : box.scrollHeight;
}

function renderReplyBox(c) {
  const lastClient = c.last_client_message_at ? Date.parse(c.last_client_message_at) : 0;
  const expired = c.channel !== 'web' && (!lastClient || Date.now() - lastClient > REPLY_WINDOW_MS);
  const text = el('textarea', { id: 'replyText', rows: 2, dir: 'auto', placeholder: `Reply as a human on ${CHANNEL[c.channel].label}… (pauses the bot for this client)`, disabled: expired });
  const send = el('button', {
    class: 'btn primary sm', text: 'Send reply', disabled: expired,
    onclick: async () => {
      const value = text.value.trim();
      if (!value) return;
      send.disabled = true;
      try {
        await api(`/api/bots/${bot.id}/conversations/${c.id}/reply`, { body: { text: value } });
        text.value = '';
        toast(c.channel === 'web' ? 'Sent — the visitor sees it in the chat' : `Sent on ${CHANNEL[c.channel].label}`);
        await openConversation(c.id, true);
      } catch (e) {
        toast(e.message, true);
      } finally {
        send.disabled = expired;
      }
    },
  });
  return el('div', { class: 'reply-box' },
    text,
    el('div', { class: 'row' },
      el('span', { class: 'hint', text: expired ? "Meta only allows replies within 24 hours of the client's last message." : c.channel === 'web' ? 'Shown in the visitor’s open chat.' : '' }),
      el('span', { class: 'spacer' }),
      send));
}

function renderSummary(c) {
  const s = c.summary;
  const button = el('button', {
    class: `btn sm${s ? '' : ' primary'}`,
    text: c.summarizing ? 'Summarizing…' : s ? '↻ Re-summarize' : '✨ Summarize now',
    disabled: c.summarizing,
    onclick: (e) => summarize(c.id, e.currentTarget),
  });
  const error = c.summary_error && el('div', { class: 'summary-error', text: `Last summary attempt failed: ${c.summary_error}` });
  if (!s) {
    return el('div', { class: 'summary' },
      el('div', { class: 'summary-top' },
        el('div', {}, el('h3', { text: 'No summary yet' }), el('p', { class: 'hint', text: 'Made automatically when the client goes quiet, or click the button.' })),
        button),
      error);
  }
  const block = (title, content, full = false) => {
    if (!content || (Array.isArray(content) && !content.length)) return null;
    return el('div', { class: `s-block${full ? ' full' : ''}` }, el('h4', { text: title }),
      Array.isArray(content) ? el('ul', {}, content.map((x) => el('li', { dir: 'auto', text: x }))) : el('div', { dir: 'auto', text: content }));
  };
  const likely = s.deal_likelihood;
  const color = likely >= 70 ? 'var(--green)' : likely >= 40 ? 'var(--amber)' : '#9aa0b4';
  const outdated = c.summary_at && Date.parse(c.updated_at) > Date.parse(c.summary_at);
  return el('div', { class: 'summary' },
    el('div', { class: 'summary-top' },
      el('div', { style: 'flex:1;min-width:220px' },
        el('h3', { dir: 'auto', text: s.headline || 'Summary' }),
        el('div', { class: 'row', style: 'margin-bottom:8px' },
          el('span', { class: `badge stage-${s.stage}`, text: STAGE_LABELS[s.stage] || s.stage }),
          el('span', { class: 'badge', text: `Mood: ${s.sentiment}` }),
          [s.client?.company, s.client?.role].filter(Boolean).length > 0 && el('span', { class: 'badge', dir: 'auto', text: [s.client.company, s.client.role].filter(Boolean).join(' · ') }))),
      likely != null && el('div', { class: 'meter' },
        el('div', { class: 'label' }, el('span', { text: 'Deal likelihood' }), el('b', { text: `${likely}%` })),
        el('div', { class: 'bar' }, el('div', { style: `width:${likely}%;background:${color}` })))),
    el('p', { dir: 'auto', text: s.summary }),
    el('div', { class: 'summary-grid' },
      block('Needs', s.needs),
      block('Objections / concerns', s.objections),
      block("Client's idea (clarified)", s.idea, true),
      block('Budget', s.budget),
      block('Timeline', s.timeline),
      block('Pricing discussed', s.pricing_discussed, true),
      s.goals?.length > 0 && el('div', { class: 's-block full' }, el('h4', { text: 'Goal progress' }),
        s.goals.map((g) => el('div', { class: 'goal-row' },
          el('span', { class: 'g', text: g.goal }),
          el('span', { class: `gs ${g.status}`, text: GOAL_STATUS_LABELS[g.status] || g.status }),
          el('span', { class: 'n', dir: 'auto', text: g.note })))),
      block('Recommended next steps', s.next_steps, true),
      s.follow_up_message && el('div', { class: 's-block full' },
        el('h4', {}, 'Suggested follow-up message ', el('button', { class: 'icon-btn', title: 'Copy', text: '⧉', onclick: () => DP.copy(s.follow_up_message) })),
        el('div', { class: 'followup', dir: 'auto', text: s.follow_up_message }))),
    el('div', { class: 'summary-foot' },
      el('span', {}, `Covers messages up to ${dateTime(c.summary_at)}`, outdated && el('span', { class: 'outdated', text: ' · new messages since' })),
      button),
    error);
}

async function summarize(id, button) {
  button.disabled = true;
  button.textContent = 'Summarizing…';
  try {
    await api(`/api/bots/${bot.id}/conversations/${id}/summarize`, { body: {} });
    toast('Summary ready');
  } catch (e) {
    toast(e.message, true);
  }
  if (selectedId === id) await openConversation(id, true);
  loadConversations(true);
}

async function patchConversation(id, body) {
  try {
    await api(`/api/bots/${bot.id}/conversations/${id}`, { method: 'PATCH', body });
    await openConversation(id, true);
    loadConversations(true);
  } catch (e) {
    toast(e.message, true);
  }
}

function editClient(c) {
  const name = prompt('Client name', c.client_name || '');
  if (name === null) return;
  const contact = prompt('Phone or email', c.client_contact || '');
  if (contact === null) return;
  patchConversation(c.id, { client_name: name, client_contact: contact });
}

async function deleteConversation(id) {
  if (!confirm('Delete this conversation and all its messages? This cannot be undone.')) return;
  try {
    await api(`/api/bots/${bot.id}/conversations/${id}`, { method: 'DELETE' });
    selectedId = null;
    delete $('#convDetail').dataset.id;
    $('#convDetail').replaceChildren(emptyDetail('Conversation deleted.'));
    loadConversations(true);
  } catch (e) {
    toast(e.message, true);
  }
}

// ============================================================ channels
const CHANNEL_CARDS = [
  { id: 'web', title: 'Website chat', icon: '💬', desc: 'Your chat link and the website bubble. Always on.' },
  { id: 'messenger', title: 'Facebook Messenger', icon: '📘', desc: 'Answers messages sent to your Facebook Page.' },
  { id: 'instagram', title: 'Instagram DMs', icon: '📸', desc: 'Answers direct messages on your Instagram professional account.' },
  { id: 'whatsapp', title: 'WhatsApp', icon: '🟢', desc: 'Answers on your WhatsApp Business number.' },
];

const MANUAL_STEPS = {
  whatsapp: {
    title: 'Connect WhatsApp manually',
    idLabel: 'Phone number ID',
    steps: [
      'In developers.facebook.com open your app → WhatsApp → API Setup.',
      'Copy the “Phone number ID” (not the phone number itself) and, optionally, the WhatsApp Business Account ID.',
      'Create a permanent token: business.facebook.com → Settings → System users → Generate token (whatsapp_business_messaging + whatsapp_business_management).',
      'Temporary tokens stop working after 24 hours.',
    ],
  },
  messenger: {
    title: 'Connect a Facebook Page manually',
    idLabel: 'Facebook Page ID',
    steps: [
      'Page ID: open your Page → About → Page transparency (or Page settings).',
      'Page access token: in your Meta app → Messenger → Messenger API Settings → Generate token for the Page.',
      'Tokens from your own app need its app secret below so we can verify webhooks.',
    ],
  },
  instagram: {
    title: 'Connect Instagram manually',
    idLabel: 'Instagram account ID',
    steps: [
      'Your Instagram must be a professional (business or creator) account.',
      'With a Page token: link Instagram to your Facebook Page, then use the Page access token and the Instagram account ID.',
      'With Instagram Login: use the IGAA… token from your app → Instagram → API setup, and the Instagram account ID shown there.',
    ],
  },
};

let manualChannel = null;
let pagesSelection = null;

function initChannels() {
  $('#manualClose').addEventListener('click', () => $('#manualDialog').close());
  $('#manualConnectForm').addEventListener('submit', submitManualConnect);
  $('#pagesClose').addEventListener('click', () => $('#pagesDialog').close());
  $('#pagesConnect').addEventListener('click', submitPages);
}

async function loadChannels() {
  if (!bot) return;
  const botId = bot.id;
  try {
    const [data, cfg] = await Promise.all([api(`/api/bots/${botId}/channels`), metaConfig ? Promise.resolve(metaConfig) : api('/api/meta/config')]);
    metaConfig = cfg;
    if (bot?.id === botId) renderChannels(data);
  } catch (e) {
    toast(e.message, true);
  }
}

function renderChannels(data) {
  $('#channelsBody').replaceChildren(...CHANNEL_CARDS.map((card) => channelCard(card, data)));
}

function channelCard(card, data) {
  const connections = data.connections.filter((c) => c.channel === card.id);
  const allowed = card.id === 'web' || data.allowed.includes(card.id);
  const pill = card.id === 'web'
    ? el('span', { class: 'pill green', text: 'On' })
    : !allowed
      ? el('span', { class: 'pill gray', text: `${data.requiredPlan[card.id]} plan` })
      : connections.length
        ? el('span', { class: `pill ${connections.some((c) => c.status === 'error') ? 'red' : 'green'}`, text: `${connections.length} connected` })
        : el('span', { class: 'pill gray', text: 'Not connected' });

  const body = [];
  if (card.id === 'web') {
    body.push(el('div', { class: 'row' }, el('button', { class: 'btn sm', text: 'Get the link & website code', onclick: () => switchTab('channels') })));
  } else if (!allowed) {
    body.push(el('div', { class: 'locked' },
      el('span', { text: `${card.title} is included from the ${data.requiredPlan[card.id]} plan.` }),
      el('button', { class: 'btn sm primary', text: 'Upgrade', onclick: () => switchTab('billing') })));
  } else {
    if (connections.length) body.push(el('div', { class: 'conn-list' }, connections.map(connectionRow)));
    const actions = el('div', { class: 'row' });
    if (card.id === 'whatsapp') {
      if (metaConfig?.embeddedReady) actions.append(el('button', { class: 'btn primary sm', text: 'Connect WhatsApp', onclick: () => runSafely(connectWhatsApp) }));
    } else if (metaConfig?.oauthReady) {
      actions.append(el('button', { class: 'btn primary sm', text: 'Continue with Facebook', onclick: () => runSafely(connectWithFacebook) }));
    }
    actions.append(el('button', { class: 'btn sm', text: 'Connect manually', onclick: () => openManual(card.id) }));
    body.push(actions);
    const ready = card.id === 'whatsapp' ? metaConfig?.embeddedReady : metaConfig?.oauthReady;
    if (!ready) body.push(el('p', { class: 'hint', style: 'margin-top:8px', text: 'One-click connection is coming soon. For now, connect with your IDs and access token.' }));
  }

  return el('div', { class: 'card channel-card' },
    el('div', { class: 'card-head' },
      el('div', {}, el('h2', {}, el('span', { text: card.icon }), card.title), el('p', { class: 'hint', text: card.desc })),
      pill),
    ...body);
}

function connectionRow(c) {
  const d = c.details;
  const avatar = el('div', { class: 'conn-avatar' }, d.picture ? el('img', { src: d.picture, alt: '' }) : CHANNEL[c.channel].icon);
  const sub = [
    c.channel === 'whatsapp' ? d.verified_name : c.channel === 'instagram' ? d.page_name && `via ${d.page_name}` : null,
    `ID ${c.external_id}`,
    c.mode === 'own_app' ? 'your own Meta app' : null,
    c.last_event_at ? `last message ${timeAgo(c.last_event_at)}` : 'no messages yet',
  ].filter(Boolean).join(' · ');

  const auto = el('input', { type: 'checkbox', checked: c.auto_reply });
  auto.addEventListener('change', async () => {
    try {
      await api(`/api/bots/${bot.id}/channels/${c.id}`, { method: 'PATCH', body: { auto_reply: auto.checked } });
      toast(auto.checked ? 'Auto-replies on' : 'Auto-replies off — messages are still saved');
    } catch (e) {
      auto.checked = !auto.checked;
      toast(e.message, true);
    }
  });

  return el('div', { class: `conn-row${c.status === 'error' ? ' is-error' : ''}` },
    avatar,
    el('div', { class: 'conn-main' },
      el('b', { dir: 'auto', text: c.name }),
      el('div', { class: 'hint', dir: 'auto', text: sub }),
      c.last_error && el('div', { class: 'summary-error', text: `${c.status === 'error' ? 'Needs attention' : 'Last error'}: ${c.last_error}` }),
      c.webhook && el('div', { class: 'webhook-box' },
        el('b', { text: 'Your Meta app webhook' }),
        el('div', { class: 'hint', text: `Subscribe to: ${c.channel === 'whatsapp' ? 'messages' : 'messages, messaging_postbacks, message_echoes'}` }),
        el('div', { class: 'copy-row' }, el('input', { readonly: true, value: c.webhook.url }), el('button', { class: 'btn sm', text: 'Copy URL', onclick: () => DP.copy(c.webhook.url) })),
        el('div', { class: 'copy-row' }, el('input', { readonly: true, value: c.webhook.verifyToken }), el('button', { class: 'btn sm', text: 'Copy token', onclick: () => DP.copy(c.webhook.verifyToken) })))),
    el('div', { class: 'conn-actions' },
      el('label', { class: 'switch' }, auto, el('span', { text: 'Auto-reply' })),
      el('button', {
        class: 'btn sm danger', text: 'Disconnect',
        onclick: async () => {
          if (!confirm(`Disconnect ${c.name}? The bot stops answering there. Past conversations stay.`)) return;
          try {
            await api(`/api/bots/${bot.id}/channels/${c.id}`, { method: 'DELETE' });
            toast('Disconnected');
            loadChannels();
          } catch (e) { toast(e.message, true); }
        },
      })));
}

async function runSafely(fn) {
  try {
    await fn();
  } catch (e) {
    toast(e.message, true);
  }
}

function openManual(channel) {
  manualChannel = channel;
  const cfg = MANUAL_STEPS[channel];
  $('#manualTitle').textContent = cfg.title;
  $('#manualIdLabel').textContent = cfg.idLabel;
  $('#manualSteps').replaceChildren(el('ol', { style: 'margin:0;padding-left:18px' }, cfg.steps.map((s) => el('li', { text: s }))));
  $('#manualWabaField').hidden = channel !== 'whatsapp';
  $('#manualApiField').hidden = channel !== 'instagram';
  ['#manualExternalId', '#manualWabaId', '#manualToken', '#manualSecret'].forEach((s) => ($(s).value = ''));
  $('#manualApi').value = 'facebook';
  $('#manualDialog').showModal();
}

async function submitManualConnect(e) {
  e.preventDefault();
  $('#manualSubmit').disabled = true;
  try {
    const { connection } = await api(`/api/bots/${bot.id}/channels/manual`, {
      body: {
        channel: manualChannel,
        externalId: $('#manualExternalId').value.trim(),
        accessToken: $('#manualToken').value.trim(),
        appSecret: $('#manualSecret').value.trim(),
        wabaId: $('#manualWabaId').value.trim(),
        api: $('#manualApi').value,
      },
    });
    $('#manualDialog').close();
    toast(connection.webhook ? 'Connected — now paste the webhook URL and token into your Meta app' : `${connection.name} connected`);
    loadChannels();
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('#manualSubmit').disabled = false;
  }
}

let facebookSdk = null;
function loadFacebookSdk() {
  if (!metaConfig?.appId) return Promise.reject(new Error('Facebook is not configured yet.'));
  if (facebookSdk) return facebookSdk;
  facebookSdk = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      FB.init({ appId: metaConfig.appId, autoLogAppEvents: true, xfbml: false, version: metaConfig.graphVersion });
      resolve(FB);
    };
    const s = el('script', { src: 'https://connect.facebook.net/en_US/sdk.js', async: true, defer: true, crossorigin: 'anonymous' });
    s.onerror = () => {
      facebookSdk = null;
      reject(new Error('Could not load Facebook. Check your connection or ad blocker.'));
    };
    document.head.append(s);
  });
  return facebookSdk;
}

function facebookLogin(options) {
  return new Promise((resolve, reject) => {
    FB.login((response) => {
      if (response.authResponse?.code) resolve(response.authResponse.code);
      else reject(new Error('Facebook login was cancelled.'));
    }, options);
  });
}

async function connectWithFacebook() {
  await loadFacebookSdk();
  const code = await facebookLogin({ config_id: metaConfig.loginConfigId, response_type: 'code', override_default_response_type: true });
  const data = await api(`/api/bots/${bot.id}/channels/facebook/pages`, { body: { code } });
  pagesSelection = data.selection;
  renderPagesDialog(data);
  $('#pagesDialog').showModal();
}

function renderPagesDialog(data) {
  const box = $('#pagesList');
  if (!data.pages.length) {
    box.replaceChildren(el('div', { class: 'empty-list', text: 'No Facebook Pages were shared. Log in again and select your Page.' }));
    return;
  }
  const option = (channel, id, label, connectedTo) => {
    const blocked = connectedTo && connectedTo !== 'this bot';
    const allowed = data.allowed.includes(channel);
    const cb = el('input', { type: 'checkbox', 'data-channel': channel, value: id, checked: connectedTo === 'this bot', disabled: blocked || !allowed });
    return el('label', { class: 'check' }, cb, el('span', {
      text: `${label}${!allowed ? ' — upgrade needed' : blocked ? ` — already used by ${connectedTo}` : connectedTo === 'this bot' ? ' — connected' : ''}`,
    }));
  };
  box.replaceChildren(...data.pages.map((p) =>
    el('div', { class: 'page-choice' },
      el('div', { class: 'conn-avatar' }, p.picture ? el('img', { src: p.picture, alt: '' }) : '📘'),
      el('div', { class: 'conn-main' },
        el('b', { dir: 'auto', text: p.name }),
        option('messenger', p.id, 'Answer Messenger for this Page', p.connectedTo),
        p.instagram
          ? option('instagram', p.instagram.id, `Answer Instagram @${p.instagram.username}`, p.instagram.connectedTo)
          : el('div', { class: 'hint', text: 'No Instagram professional account linked to this Page.' })))));
}

async function submitPages() {
  const picked = (channel) => $$(`#pagesList input[data-channel="${channel}"]`).filter((i) => i.checked && !i.disabled).map((i) => i.value);
  const pageIds = picked('messenger');
  const instagramIds = picked('instagram');
  if (!pageIds.length && !instagramIds.length) return toast('Choose at least one option', true);
  $('#pagesConnect').disabled = true;
  try {
    const r = await api(`/api/bots/${bot.id}/channels/facebook/connect`, { body: { selection: pagesSelection, pageIds, instagramIds } });
    $('#pagesDialog').close();
    if (r.errors.length) toast(r.errors.join(' · '), true);
    else toast(`${r.connected.length} connected`);
    loadChannels();
  } catch (e) {
    toast(e.message, true);
  } finally {
    $('#pagesConnect').disabled = false;
  }
}

async function connectWhatsApp() {
  await loadFacebookSdk();
  let signup = null;
  const onMessage = (event) => {
    let host = '';
    try { host = new URL(event.origin).hostname; } catch {}
    if (!host.endsWith('facebook.com')) return;
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (/^FINISH/.test(data.event)) signup = data.data;
      else if (data.event === 'CANCEL') signup = { cancelled: true, step: data.data?.current_step };
    } catch {}
  };
  window.addEventListener('message', onMessage);
  try {
    const code = await facebookLogin({
      config_id: metaConfig.whatsappConfigId,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
    });
    for (let i = 0; i < 30 && !signup; i++) await new Promise((r) => setTimeout(r, 150)); // the details arrive right after the login callback
    if (!signup?.phone_number_id || !signup?.waba_id) throw new Error(signup?.cancelled ? 'WhatsApp signup was cancelled.' : 'WhatsApp signup did not finish.');
    const { connection } = await api(`/api/bots/${bot.id}/channels/whatsapp/embedded`, { body: { code, phoneNumberId: signup.phone_number_id, wabaId: signup.waba_id } });
    toast(`WhatsApp ${connection.name} connected`);
    loadChannels();
  } finally {
    window.removeEventListener('message', onMessage);
  }
}

// ============================================================ test
function initTest() {
  $('#testForm').addEventListener('submit', sendTest);
  $('#testInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('#testForm').requestSubmit();
    }
  });
  $('#resetTest').addEventListener('click', () => {
    testHistory = [];
    renderTest();
  });
  $('#showPrompt').addEventListener('click', async () => {
    try {
      const { prompt: text } = await api(`/api/bots/${bot.id}/prompt-preview`, { body: { settings } });
      $('#promptText').textContent = text;
      $('#promptDialog').showModal();
    } catch (e) {
      toast(e.message, true);
    }
  });
  $('#closePrompt').addEventListener('click', () => $('#promptDialog').close());
}

function renderTest(pending = false) {
  if (!settings) return;
  $('#testNote').textContent = `${fmt(me.usage.replies)} / ${fmt(me.usage.limit)} AI replies used this month${isDirty() ? ' · testing unsaved changes' : ''}`;
  const box = $('#testMessages');
  box.replaceChildren(
    el('div', { class: 't-msg assistant' }, el('div', { class: 'b', dir: 'auto', text: settings.welcomeMessage }), el('div', { class: 'm', text: 'Welcome message' })),
    ...testHistory.map((m) => el('div', { class: `t-msg ${m.role}` }, el('div', { class: 'b', dir: 'auto', text: m.content }), m.meta && el('div', { class: 'm', text: m.meta }))),
    ...(pending ? [el('div', { class: 't-msg assistant' }, el('div', { class: 'b' }, el('span', { class: 'typing' }, el('i'), el('i'), el('i'))))] : [])
  );
  box.scrollTop = box.scrollHeight;
}

async function sendTest(e) {
  e.preventDefault();
  const input = $('#testInput');
  const text = input.value.trim();
  if (!text || $('#testSend').disabled) return;
  input.value = '';
  testHistory.push({ role: 'user', content: text });
  renderTest(true);
  $('#testSend').disabled = true;
  try {
    const messages = testHistory.filter((m) => m.role !== 'error').map(({ role, content }) => ({ role, content }));
    const r = await api(`/api/bots/${bot.id}/test`, { body: { settings, messages } });
    testHistory.push({ role: 'assistant', content: r.reply, meta: `${(r.ms / 1000).toFixed(1)}s` });
    me.usage.replies += 1;
    renderSidebar();
  } catch (err) {
    testHistory.push({ role: 'error', content: err.message });
  } finally {
    $('#testSend').disabled = false;
    renderTest();
    input.focus();
  }
}

// ============================================================ install
function initInstall() {
  $('#linkName').addEventListener('input', renderInstall);
  $('#linkRef').addEventListener('input', renderInstall);
  $$('[data-copy]').forEach((b) => b.addEventListener('click', () => DP.copy($(`#${b.dataset.copy}`).value)));
  $('#exportBtn').addEventListener('click', async () => {
    try {
      const data = await api(`/api/bots/${bot.id}/export`);
      DP.download(`conversations_${bot.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function renderInstall() {
  if (!bot) return;
  const link = `${location.origin}/c/${bot.public_id}`;
  $('#chatLink').value = link;
  $('#openChat').href = link;
  const p = new URLSearchParams();
  if ($('#linkName').value.trim()) p.set('name', $('#linkName').value.trim());
  if ($('#linkRef').value.trim()) p.set('ref', $('#linkRef').value.trim());
  $('#personalLink').value = p.toString() ? `${link}?${p}` : link;
  $('#embedCode').value = `<script src="${location.origin}/widget.js" data-bot="${bot.public_id}" data-color="${settings.accentColor}" async></script>`;
}

// ============================================================ billing
function initBilling() {
  ['#mPlan', '#mMonths', '#mExtraBots', '#mPacks'].forEach((s) => $(s).addEventListener('input', updateManualAmount));
  $('#manualForm').addEventListener('submit', submitManualPayment);
}

async function loadBilling() {
  try {
    billing = await api('/api/billing');
    renderBilling();
  } catch (e) {
    toast(e.message, true);
  }
}

function planStatus(acc, limits) {
  if (limits.plan === 'expired') return acc.plan === 'trial' ? 'Your free trial is over. Choose a plan to continue.' : `Your ${PLAN_NAMES[acc.plan]} plan expired.`;
  if (limits.trial) return `Free trial until ${date(limits.expiresAt)}.`;
  if (!limits.expiresAt) return 'Active — no expiry.';
  if (acc.billing_provider === 'dodo') return `${acc.dodo_status === 'cancelled' ? 'Cancelled — active until' : 'Renews around'} ${date(limits.expiresAt)} (card).`;
  return `Paid until ${date(limits.expiresAt)}.`;
}

function renderBilling() {
  const b = billing;
  const L = b.limits;
  const pct = Math.min(100, Math.round((b.usage.replies / Math.max(1, b.usage.limit)) * 100));
  const cs = (label, value, barPct) =>
    el('div', { class: 'cs' }, el('span', { class: 'hint', text: label }), el('b', { text: value }),
      barPct != null && el('div', { class: 'bar' }, el('div', { style: `width:${barPct}%`, class: barPct >= 100 ? 'danger' : barPct >= 80 ? 'warn' : '' })));

  $('#billingCurrent').replaceChildren(
    el('div', { class: 'current-plan' },
      el('div', {},
        el('div', { class: 'eyebrow', text: 'Current plan' }),
        el('div', { class: 'current-name', text: L.planName }),
        el('p', { class: 'hint', text: planStatus(b.account, L) }),
        b.cardPayments && b.account.hasCardCustomer && el('button', { class: 'btn sm', style: 'margin-top:10px', text: 'Manage card subscription', onclick: openPortal })),
      el('div', { class: 'current-stats' },
        cs('AI replies this month', `${fmt(b.usage.replies)} / ${fmt(b.usage.limit)}`, pct),
        cs('Bots', `${fmt(me.bots.length)} / ${fmt(L.bots)}`),
        cs('Channels', L.channels.map((ch) => CHANNEL[ch].label).join(', '))))
  );

  const extraBot = b.pricing.addons.extraBot;
  const pack = b.pricing.addons.replyPack;
  const names = b.pricing.channelNames || {};
  $('#plansGrid').replaceChildren(
    ...b.pricing.plans.map((plan) => {
      const current = L.plan === plan.id;
      return el('div', { class: `plan-card${plan.id === 'pro' ? ' featured' : ''}${current ? ' current' : ''}` },
        el('div', { class: 'row' }, el('h3', { text: plan.name }), current && el('span', { class: 'pill green', text: 'Current' }), plan.id === 'pro' && !current && el('span', { class: 'pill', text: 'Best value' })),
        el('div', { class: 'plan-price' }, `${plan.priceTND} DT`, el('small', { text: ' / month' })),
        el('div', { class: 'plan-alt', text: `or $${plan.priceUSD}/month by card` }),
        el('ul', {},
          el('li', { text: plan.channels.map((ch) => names[ch] || ch).join(' · ') }),
          el('li', { text: `${plan.bots} bot${plan.bots > 1 ? 's' : ''} (+${extraBot.priceTND} DT per extra bot)` }),
          el('li', { text: `${fmt(plan.replies)} AI replies / month` }),
          el('li', { text: `${fmt(plan.dataChars)} characters of business data per bot` }),
          el('li', { text: 'AI summaries, lead scores & human takeover' }),
          el('li', { class: plan.badge ? 'off' : '', text: plan.badge ? '“Powered by DigiPlus AI” on the website chat' : 'No DigiPlus AI branding' })),
        el('div', { class: 'row' },
          el('button', { class: 'btn primary sm', text: 'Pay in dinars', onclick: () => chooseManualPlan(plan.id) }),
          b.cardPayments && el('button', { class: 'btn sm', text: `Pay $${plan.priceUSD} by card`, onclick: () => cardCheckout(plan.id) })));
    })
  );

  const m = b.manual;
  const lines = [];
  if (m.d17) lines.push(el('div', {}, 'D17: ', el('b', { text: m.d17 })));
  if (m.bankRib) lines.push(el('div', {}, `${m.bankName || 'Bank'} RIB: `, el('b', { text: m.bankRib })));
  if (m.whatsapp) lines.push(el('div', {}, 'Questions? WhatsApp: ', el('b', { text: m.whatsapp })));
  if (m.instructions) lines.push(el('div', { text: m.instructions }));
  $('#manualInstructions').replaceChildren(...(lines.length ? lines : [el('span', { text: 'Payment details will appear here soon. Contact us to pay in dinars.' })]));
  $('#mExtraBots').value = b.account.extra_bots || 0;
  updateManualAmount();

  $('#cardBody').replaceChildren(
    ...(b.cardPayments
      ? [
          el('p', { class: 'hint', text: 'Monthly subscription charged automatically. Cancel anytime from the card portal.' }),
          el('div', { class: 'grid-2', style: 'margin-top:12px' },
            el('label', { class: 'field' }, el('span', { text: 'Plan' }),
              el('select', { id: 'cPlan' }, ...b.pricing.plans.map((p) => el('option', { value: p.id, text: `${p.name} — $${p.priceUSD}/mo` })))),
            el('label', { class: 'field' }, el('span', { text: `Extra bots ($${extraBot.priceUSD}/mo each)` }), el('input', { id: 'cExtraBots', type: 'number', min: '0', max: '20', value: String(b.account.extra_bots || 0) }))),
          el('button', { class: 'btn primary', text: b.account.hasCardSubscription ? 'Change my subscription' : 'Continue to card payment', onclick: () => cardCheckout($('#cPlan').value, Number($('#cExtraBots').value) || 0) }),
          el('div', { class: 'section-title', text: 'Need more replies this month?' }),
          el('div', { class: 'row' },
            el('input', { id: 'cPacks', type: 'number', min: '1', max: '20', value: '1', style: 'width:90px' }),
            el('span', { class: 'hint', text: `× ${fmt(pack.replies)} replies — $${pack.priceUSD} each` }),
            el('button', { class: 'btn', text: 'Buy by card', onclick: buyPacksByCard })),
        ]
      : [el('p', { class: 'hint', text: 'Card payments are coming soon. For now, pay in dinars with D17 or a bank transfer.' })])
  );

  $('#paymentHistory').replaceChildren(
    b.requests.length
      ? el('table', { class: 'data' },
          el('thead', {}, el('tr', {}, ...['Date', 'What', 'Amount', 'Method', 'Reference', 'Status'].map((h) => el('th', { text: h })))),
          el('tbody', {}, ...b.requests.map((r) =>
            el('tr', {},
              el('td', { text: date(r.created_at) }),
              el('td', { text: [r.plan && `${PLAN_NAMES[r.plan]} × ${r.months} mo`, r.extra_bots && `+${r.extra_bots} bot${r.extra_bots > 1 ? 's' : ''}`, r.reply_packs && `${r.reply_packs} reply pack${r.reply_packs > 1 ? 's' : ''}`].filter(Boolean).join(', ') }),
              el('td', { class: 'num', text: `${fmt(r.amount)} ${r.currency === 'TND' ? 'DT' : r.currency}` }),
              el('td', { text: METHOD_LABELS[r.method] || r.method }),
              el('td', { dir: 'auto', text: r.reference || '—' }),
              el('td', {}, el('span', { class: `pill ${r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}`, text: r.status }), r.admin_note ? el('div', { class: 'hint', text: r.admin_note }) : null)))))
      : el('p', { class: 'hint', text: 'No payments yet.' })
  );
}

function updateManualAmount() {
  if (!billing) return;
  const { plans, addons } = billing.pricing;
  const plan = plans.find((p) => p.id === $('#mPlan').value);
  const months = Number($('#mMonths').value) || 1;
  const extraBots = plan ? Math.max(0, Number($('#mExtraBots').value) || 0) : 0;
  const packs = Math.max(0, Number($('#mPacks').value) || 0);
  $('#mExtraBots').disabled = !plan;
  const total = ((plan ? plan.priceTND : 0) + extraBots * addons.extraBot.priceTND) * months + packs * addons.replyPack.priceTND;
  $('#mAmount').textContent = `${fmt(total)} DT`;
}

function chooseManualPlan(planId) {
  $('#mPlan').value = planId;
  updateManualAmount();
  $('#manualCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#mReference').focus({ preventScroll: true });
}

async function submitManualPayment(e) {
  e.preventDefault();
  try {
    await api('/api/billing/manual', {
      body: {
        plan: $('#mPlan').value || null,
        months: Number($('#mMonths').value),
        extraBots: Number($('#mExtraBots').value) || 0,
        replyPacks: Number($('#mPacks').value) || 0,
        method: $('#mMethod').value,
        reference: $('#mReference').value,
      },
    });
    $('#mReference').value = '';
    $('#mPacks').value = '0';
    toast("Thanks! We'll confirm your payment and activate your plan soon.");
    loadBilling();
  } catch (err) {
    toast(err.message, true);
  }
}

async function cardCheckout(plan, extraBots = billing?.account.extra_bots || 0) {
  try {
    const r = await api('/api/billing/checkout', { body: { plan, extraBots } });
    if (r.url) location.href = r.url;
    else {
      toast('Subscription updated');
      await loadMe();
      loadBilling();
    }
  } catch (e) {
    toast(e.message, true);
  }
}

async function buyPacksByCard() {
  try {
    const { url } = await api('/api/billing/reply-packs', { body: { packs: Number($('#cPacks').value) || 1 } });
    location.href = url;
  } catch (e) {
    toast(e.message, true);
  }
}

async function openPortal() {
  try {
    const { url } = await api('/api/billing/portal', { body: {} });
    location.href = url;
  } catch (e) {
    toast(e.message, true);
  }
}

// ============================================================ account
function initAccount() {
  $('#accountNameSave').addEventListener('click', async () => {
    try {
      await api('/api/account', { method: 'PATCH', body: { name: $('#accountName').value } });
      await loadMe();
      toast('Saved');
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function renderAccount() {
  $('#accountName').value = me.account.name;
  $('#accountEmail').textContent = me.user.email;
}
