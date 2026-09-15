'use strict';
/* global DP */
const { el, api, toast, fmt, date, dateTime } = DP;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const PLAN_NAMES = { trial: 'Free trial', expired: 'No plan', starter: 'Starter', pro: 'Pro', business: 'Business' };
const METHOD_LABELS = { d17: 'D17', bank: 'Bank transfer', cash: 'Cash', other: 'Other' };
const TABS = ['overview', 'accounts', 'payments', 'meta', 'settings'];

let overview = null;
let editing = null;

boot();

async function boot() {
  try {
    if (!(await DP.session())) return (location.href = '/login?next=/super');
    await loadOverview();
    $('#boot').hidden = true;
    $('#app').hidden = false;
    init();
    const wanted = location.hash.slice(1);
    switchTab(TABS.includes(wanted) ? wanted : 'overview');
  } catch (e) {
    $('#bootText').textContent = e.status === 403 ? 'This page is only for the platform owner.' : e.message;
  }
}

function init() {
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#logout').addEventListener('click', DP.logout);
  $('#accountSearch').addEventListener('input', renderAccounts);
  $('#paymentStatus').addEventListener('change', loadPayments);
  $('#platformForm').addEventListener('submit', savePlatform);
  $('#accountForm').addEventListener('submit', saveAccount);
  $('#accountDialogClose').addEventListener('click', () => $('#accountDialog').close());
  $('#metaRefresh').addEventListener('click', loadMeta);
  $('#metaRegister').addEventListener('click', registerWebhooks);
  $('#privacyUrl').textContent = `${location.origin}/privacy`;
  $('#termsUrl').textContent = `${location.origin}/terms`;
}

function switchTab(tab) {
  $$('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.panel').forEach((p) => (p.hidden = p.dataset.panel !== tab));
  history.replaceState(null, '', `#${tab}`);
  $('#sidebar').classList.remove('open');
  if (tab === 'overview') renderOverview();
  if (tab === 'accounts') renderAccounts();
  if (tab === 'payments') loadPayments();
  if (tab === 'meta') loadMeta();
  if (tab === 'settings') loadPlatform();
}

async function loadOverview() {
  overview = await api('/api/super/overview');
  const n = overview.totals.pendingPayments;
  $('#pendingPill').hidden = !n;
  $('#pendingPill').textContent = n;
}

function renderOverview() {
  const t = overview.totals;
  const rate = overview.usdToTnd;
  const aiTND = t.aiCostUSD * rate;
  const revenueTND = t.monthlyTND + t.monthlyUSD * rate;
  $('#periodText').textContent = `Month ${overview.period} · 1 USD = ${rate} TND`;
  const stat = (v, l) => el('div', { class: 'stat' }, el('div', { class: 'v', text: v }), el('div', { class: 'l', text: l }));
  $('#totals').replaceChildren(
    stat(fmt(t.accounts), 'Accounts'),
    stat(fmt(t.paying), 'Paying accounts'),
    stat(`${fmt(revenueTND.toFixed(0))} DT`, 'Monthly revenue'),
    stat(`${aiTND.toFixed(2)} DT`, `AI cost this month ($${t.aiCostUSD.toFixed(2)})`),
    stat(fmt(t.replies), 'AI replies this month'),
    stat(fmt(t.pendingPayments), 'Payments to review')
  );
  const rows = [
    ['Revenue — dinar plans (D17 / bank)', `${fmt(t.monthlyTND)} DT`],
    ['Revenue — card plans (Dodo, before fees)', `$${fmt(t.monthlyUSD)} ≈ ${fmt((t.monthlyUSD * rate).toFixed(0))} DT`],
    ['AI cost (OpenAI)', `$${t.aiCostUSD.toFixed(4)} ≈ ${aiTND.toFixed(2)} DT`],
    ['Gross margin before hosting & payment fees', `${fmt((revenueTND - aiTND).toFixed(0))} DT${revenueTND ? ` (${Math.round(((revenueTND - aiTND) / revenueTND) * 100)}%)` : ''}`],
  ];
  $('#economics').replaceChildren(el('table', { class: 'data' }, el('tbody', {}, ...rows.map(([k, v]) => el('tr', {}, el('td', { text: k }), el('td', { class: 'num', text: v }))))));
}

function renderAccounts() {
  const q = $('#accountSearch').value.trim().toLowerCase();
  const rows = overview.accounts.filter((a) => !q || `${a.name} ${a.owner_email || ''} ${a.claim_email || ''}`.toLowerCase().includes(q));
  const rate = overview.usdToTnd;
  $('#accountsTable').replaceChildren(
    el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, ...['Account', 'Plan', 'Paid until', 'Bots', 'Chats', 'Replies (month)', 'AI cost', 'Revenue / mo', ''].map((h) => el('th', { text: h })))),
      el('tbody', {}, ...rows.map((a) => {
        const limit = a.limits.replies + a.bonus_replies;
        const revenue = a.monthlyTND + a.monthlyUSD * rate;
        return el('tr', {},
          el('td', {}, el('b', { dir: 'auto', text: a.name }), el('div', { class: 'hint', text: a.owner_email || (a.claim_email ? `waiting for ${a.claim_email}` : '—') }), el('div', { class: 'hint', text: `since ${date(a.created_at)}` })),
          el('td', {}, el('span', { class: `pill ${a.paid ? 'green' : 'gray'}`, text: a.limits.planName }), a.plan !== a.limits.plan && el('div', { class: 'hint', text: `${PLAN_NAMES[a.plan]} expired` }), a.billing_provider !== 'none' && el('div', { class: 'hint', text: a.billing_provider })),
          el('td', { text: a.paid ? (a.plan_expires_at ? date(a.plan_expires_at) : 'no expiry') : '—' }),
          el('td', { class: 'num', text: `${a.bots} / ${a.limits.bots}` }),
          el('td', { class: 'num', text: fmt(a.conversations) }),
          el('td', { class: 'num' }, `${fmt(a.replies)} / ${fmt(limit)}`, a.limit_hit_at && el('div', {}, el('span', { class: 'pill red', text: 'limit hit' }))),
          el('td', { class: 'num', text: `$${a.cost_usd.toFixed(3)}` }),
          el('td', { class: 'num', text: revenue ? `${fmt(revenue.toFixed(0))} DT` : '—' }),
          el('td', {}, el('button', { class: 'btn sm', text: 'Edit', onclick: () => openAccount(a) })));
      })))
  );
}

function openAccount(a) {
  editing = a;
  const form = $('#accountForm');
  $('#accountDialogTitle').textContent = a.name;
  form.plan.value = a.plan;
  form.plan_expires_at.value = a.plan_expires_at ? a.plan_expires_at.slice(0, 10) : '';
  form.extra_bots.value = a.extra_bots;
  form.add_bonus_replies.value = 0;
  $('#accountDialogInfo').textContent = `Billing: ${a.billing_provider}. Changing a card (Dodo) customer here does not change their subscription.`;
  $('#accountDialog').showModal();
}

async function saveAccount(e) {
  e.preventDefault();
  const form = e.target;
  try {
    await api(`/api/super/accounts/${editing.id}`, {
      method: 'PATCH',
      body: {
        plan: form.plan.value,
        plan_expires_at: form.plan_expires_at.value ? `${form.plan_expires_at.value}T23:59:59Z` : null,
        extra_bots: Number(form.extra_bots.value) || 0,
        add_bonus_replies: Number(form.add_bonus_replies.value) || 0,
      },
    });
    $('#accountDialog').close();
    toast('Account updated');
    await loadOverview();
    renderAccounts();
  } catch (err) {
    toast(err.message, true);
  }
}

async function loadPayments() {
  const status = $('#paymentStatus').value;
  try {
    const { requests } = await api(`/api/super/payments${status ? `?status=${status}` : ''}`);
    $('#paymentsTable').replaceChildren(
      requests.length
        ? el('table', { class: 'data' },
            el('thead', {}, el('tr', {}, ...['Date', 'Account', 'What', 'Amount', 'Method', 'Reference', 'Status', ''].map((h) => el('th', { text: h })))),
            el('tbody', {}, ...requests.map((r) =>
              el('tr', {},
                el('td', { text: dateTime(r.created_at) }),
                el('td', {}, el('b', { dir: 'auto', text: r.accounts?.name || '—' }), el('div', { class: 'hint', text: r.accounts?.owner_email || '' })),
                el('td', { text: [r.plan && `${PLAN_NAMES[r.plan]} × ${r.months} mo`, r.extra_bots && `+${r.extra_bots} bots`, r.reply_packs && `${r.reply_packs} reply packs`].filter(Boolean).join(', ') }),
                el('td', { class: 'num', text: `${fmt(r.amount)} DT` }),
                el('td', { text: METHOD_LABELS[r.method] || r.method }),
                el('td', { dir: 'auto', text: r.reference || '—' }),
                el('td', {}, el('span', { class: `pill ${r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}`, text: r.status }), r.admin_note && el('div', { class: 'hint', text: r.admin_note })),
                el('td', {}, r.status === 'pending' && el('div', { class: 'row' },
                  el('button', { class: 'btn sm green', text: 'Approve', onclick: () => review(r, 'approve') }),
                  el('button', { class: 'btn sm danger', text: 'Reject', onclick: () => review(r, 'reject') })))))))
        : el('p', { class: 'hint', text: 'Nothing here.' })
    );
  } catch (e) {
    toast(e.message, true);
  }
}

async function review(r, action) {
  const what = `${fmt(r.amount)} DT from ${r.accounts?.name || 'this account'} (ref ${r.reference || '—'})`;
  const note = prompt(action === 'approve' ? `Approve ${what}?\nOptional note:` : `Reject ${what}?\nReason (shown to the customer):`, '');
  if (note === null) return;
  try {
    await api(`/api/super/payments/${r.id}/${action}`, { body: { note } });
    toast(action === 'approve' ? 'Approved — plan activated' : 'Rejected');
    await loadOverview();
    loadPayments();
  } catch (e) {
    toast(e.message, true);
  }
}

// ---------------------------------------------------------------- Meta & channels
async function loadMeta() {
  try {
    renderMeta(await api('/api/super/meta'));
  } catch (e) {
    toast(e.message, true);
  }
}

function renderMeta(m) {
  $('#metaApp').textContent = m.appId ? `App ID ${m.appId} · Graph API ${m.graphVersion}` : 'No Meta app configured';
  const env = [
    ['META_APP_ID', 'Meta app ID', true],
    ['META_APP_SECRET', 'App secret (webhook signatures, token exchange)', true],
    ['META_VERIFY_TOKEN', 'Webhook verify token', true],
    ['ENCRYPTION_KEY', 'Encryption key for stored tokens', true],
    ['META_LOGIN_CONFIG_ID', '“Continue with Facebook” (Pages + Instagram)', false],
    ['META_WHATSAPP_CONFIG_ID', '“Connect WhatsApp” (Embedded Signup)', false],
  ];
  $('#metaEnv').replaceChildren(el('table', { class: 'data' }, el('tbody', {}, ...env.map(([key, label, required]) =>
    el('tr', {},
      el('td', {}, el('code', { text: key })),
      el('td', { text: label }),
      el('td', {}, el('span', { class: `pill ${m.env[key] ? 'green' : required ? 'red' : 'amber'}`, text: m.env[key] ? 'set' : required ? 'missing' : 'not set — manual connect only' })))))));

  $('#metaWebhookUrl').textContent = `${m.webhookUrl}${m.httpsReady ? '' : '  (needs https — deploy or set WEBHOOK_BASE_URL to a tunnel)'}`;
  $('#metaRegister').disabled = !m.httpsReady || !m.env.META_APP_ID || !m.env.META_APP_SECRET;
  const objects = ['page', 'instagram', 'whatsapp_business_account'];
  $('#metaSubscriptions').replaceChildren(
    m.error
      ? el('p', { class: 'summary-error', text: m.error })
      : el('table', { class: 'data' },
          el('thead', {}, el('tr', {}, ...['Object', 'Status', 'Callback URL', 'Fields'].map((h) => el('th', { text: h })))),
          el('tbody', {}, ...objects.map((object) => {
            const s = m.subscriptions.find((x) => x.object === object);
            const matches = s && s.callback_url === m.webhookUrl;
            return el('tr', {},
              el('td', {}, el('code', { text: object })),
              el('td', {}, el('span', { class: `pill ${!s ? 'gray' : matches && s.active ? 'green' : 'amber'}`, text: !s ? 'not registered' : matches ? (s.active ? 'active' : 'inactive') : 'other URL' })),
              el('td', { style: 'overflow-wrap:anywhere', text: s?.callback_url || '—' }),
              el('td', { text: s ? s.fields.join(', ') : '—' }));
          })))
  );

  const stat = (v, l) => el('div', { class: 'stat' }, el('div', { class: 'v', text: v }), el('div', { class: 'l', text: l }));
  $('#metaConnections').replaceChildren(
    stat(fmt(m.connections.messenger), 'Facebook Pages'),
    stat(fmt(m.connections.instagram), 'Instagram accounts'),
    stat(fmt(m.connections.whatsapp), 'WhatsApp numbers')
  );
}

async function registerWebhooks() {
  $('#metaRegister').disabled = true;
  try {
    const r = await api('/api/super/meta/webhooks', { body: {} });
    const failed = Object.entries(r.results).filter(([, v]) => v !== 'ok');
    toast(failed.length ? `Some failed: ${failed.map(([k, v]) => `${k}: ${v}`).join(' · ')}` : 'Webhooks registered for Pages, Instagram and WhatsApp', failed.length > 0);
    await loadMeta();
  } catch (e) {
    toast(e.message, true);
    $('#metaRegister').disabled = false;
  }
}

// ---------------------------------------------------------------- platform settings
async function loadPlatform() {
  try {
    const data = await api('/api/super/settings');
    const form = $('#platformForm');
    for (const input of form.elements) if (input.name) input.value = data[input.name] || '';
  } catch (e) {
    toast(e.message, true);
  }
}

async function savePlatform(e) {
  e.preventDefault();
  const body = Object.fromEntries([...e.target.elements].filter((i) => i.name).map((i) => [i.name, i.value]));
  try {
    await api('/api/super/settings', { method: 'PUT', body });
    toast('Saved');
  } catch (err) {
    toast(err.message, true);
  }
}
