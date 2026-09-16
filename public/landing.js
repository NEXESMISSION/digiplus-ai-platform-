// Shared behaviour for the landing pages (/, /en, /ar).
// Each page defines window.DP before loading this: the few strings that go
// inside generated markup, so the logic lives in one file instead of three.
(() => {
  const L = window.DP || {};
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Number(n).toLocaleString(L.locale || 'fr-FR');

  // ---------------------------------------------------------------- year
  const year = $('#year');
  if (year) year.textContent = new Date().getFullYear();

  // ---------------------------------------------------------------- menu
  const nav = $('#nav');
  const burger = $('#burger');
  if (nav && burger) {
    burger.addEventListener('click', () => nav.classList.toggle('open'));
    nav.addEventListener('click', (e) => { if (e.target.tagName === 'A') nav.classList.remove('open'); });
  }

  // ---------------------------------------------------------------- reveal
  const reveal = document.querySelectorAll('[data-reveal]');
  if (reveal.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('seen');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
    reveal.forEach((el) => {
      // anything already on screen shows immediately, no fade on load
      if (el.getBoundingClientRect().top < innerHeight * 0.94) el.classList.add('seen');
      else io.observe(el);
    });
  }

  // ---------------------------------------------------------------- sticky bar
  const mbar = $('#mbar');
  if (mbar) {
    addEventListener('scroll', () => mbar.classList.toggle('up', scrollY > 480), { passive: true });
  }

  // ---------------------------------------------------------------- pricing
  let pricing = null;
  let currency = 'TND';

  // A number of replies means nothing to a shop owner; conversations do.
  // A sales conversation runs about 8 replies.
  const conversations = (replies) => Math.round(replies / 8);
  // Same for characters: express it as pages of services and prices.
  const pages = (chars) => Math.max(1, Math.round(chars / 3000));

  function render() {
    if (!pricing) return;
    const box = $('#plans');
    if (!box) return;
    const names = pricing.channelNames || {};

    box.replaceChildren(...pricing.plans.map((plan) => {
      const top = plan.id === 'pro';
      const card = document.createElement('div');
      card.className = `plan${top ? ' top' : ''}`;

      const head = document.createElement('div');
      head.className = 'plan-head';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = plan.name;
      head.append(name);
      if (top && L.mostChosen) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = L.mostChosen;
        head.append(badge);
      }

      const price = document.createElement('p');
      price.className = 'price';
      price.textContent = currency === 'TND' ? `${plan.priceTND} DT` : `$${plan.priceUSD}`;

      const per = document.createElement('span');
      per.className = 'per';
      per.textContent = L.perMonth || '';

      const forWho = document.createElement('p');
      forWho.className = 'for';
      forWho.textContent = (L.for && L.for[plan.id]) || '';

      const ul = document.createElement('ul');
      // the API names the channels in English; each page can translate them
      const channel = (ch) => (L.channels && L.channels[ch]) || names[ch] || ch;
      const items = [
        plan.channels.map(channel).join(', '),
        L.assistants ? L.assistants(plan.bots) : `${plan.bots}`,
        L.replies ? L.replies(fmt(plan.replies), fmt(conversations(plan.replies))) : `${fmt(plan.replies)}`,
        L.data ? L.data(pages(plan.dataChars)) : '',
        plan.badge ? (L.withBadge || '') : (L.noBadge || ''),
      ].filter(Boolean);
      for (const text of items) {
        const li = document.createElement('li');
        li.textContent = text;
        ul.append(li);
      }

      const go = document.createElement('div');
      go.className = 'go';
      const a = document.createElement('a');
      a.className = 'btn';
      a.href = L.signup || '/signup';
      a.textContent = L.choose ? L.choose(plan.name) : plan.name;
      go.append(a);

      card.append(head, price, per, forWho, ul, go);
      return card;
    }));

    const addons = $('#addons');
    if (addons && pricing.addons) {
      const a = pricing.addons;
      addons.textContent = currency === 'TND'
        ? (L.addons ? L.addons(`${a.extraBot.priceTND} DT`, fmt(a.replyPack.replies), `${a.replyPack.priceTND} DT`) : '')
        : (L.addons ? L.addons(`$${a.extraBot.priceUSD}`, fmt(a.replyPack.replies), `$${a.replyPack.priceUSD}`) : '');
    }
  }

  document.querySelectorAll('.cur button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.cur button').forEach((x) => x.classList.toggle('on', x === b));
      currency = b.dataset.cur;
      render();
    });
  });

  fetch('/api/public/config')
    .then((r) => r.json())
    .then((c) => { pricing = c.pricing; render(); })
    .catch(() => {});
})();
