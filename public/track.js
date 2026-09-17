// Counts pages, not people: a random id kept in this browser, the page, how long it stayed open,
// and a few taps (a demo opened, a message sent…). No text and no personal data ever leaves the page.
(() => {
  'use strict';
  const uuid = () =>
    crypto.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });

  const keep = (store, key) => {
    try {
      let value = store.getItem(key);
      if (!value) {
        value = uuid();
        store.setItem(key, value);
      }
      return value;
    } catch {
      return uuid();
    }
  };

  const id = uuid();
  const visitor = keep(localStorage, 'digiplus-ai-visitor');
  const session = keep(sessionStorage, 'digiplus-ai-session');
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const bot = path.startsWith('/chat/') ? path.split('/')[2] || null : null;
  const source = (() => {
    try {
      const host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : '';
      return !host || host === location.hostname ? 'direct' : host;
    } catch {
      return 'direct';
    }
  })();
  const device = matchMedia('(max-width: 720px)').matches ? 'phone' : 'desktop';

  const events = new Set();
  const started = Date.now();
  let sent = 0;

  function post(body, beacon) {
    const text = JSON.stringify(body);
    try {
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([text], { type: 'application/json' }));
        return;
      }
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text, keepalive: true }).catch(() => {});
    } catch {}
  }

  post({ id, visitor, session, page: path, bot, source, device });

  function leaving() {
    const seconds = Math.round((Date.now() - started) / 1000);
    if (seconds <= sent) return;
    sent = seconds;
    post({ id, seconds, events: [...events] }, true);
  }
  addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && leaving());
  addEventListener('pagehide', leaving);

  // Pages report a tap with digiTrack('demo'), and anything with data-t="demo" is counted on click.
  window.digiTrack = (name) => events.add(String(name || '').slice(0, 20));
  addEventListener('click', (event) => {
    const node = event.target.closest?.('[data-t]');
    if (node) window.digiTrack(node.dataset.t);
  });
})();
