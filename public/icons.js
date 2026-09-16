// The DigiPlus AI icon set: one sprite, defined once, used by every page.
// Drawn on a 24px grid, 1.7 stroke, round caps. Inherits text colour, so an icon
// takes the colour of whatever it sits in.
//
// Use:  <svg class="ico"><use href="#i-chat"/></svg>
// Load this with a plain <script src="/icons.js"> as the FIRST thing inside <body>,
// so the symbols exist before any <use> is parsed.
(() => {
  const SPRITE = `
<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
  <symbol id="i-knowledge" viewBox="0 0 24 24"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 1 4 16V5.5Z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 0 20 16V5.5Z"/></symbol>
  <symbol id="i-chat" viewBox="0 0 24 24"><path d="M20 12a7.5 7.5 0 0 1-7.5 7.5c-1.2 0-2.4-.3-3.4-.8L4.5 20l1.3-4a7.5 7.5 0 1 1 14.2-4Z"/><path d="M9 11h6M9 14.5h3.5"/></symbol>
  <symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/></symbol>
  <symbol id="i-summary" viewBox="0 0 24 24"><path d="M6 3.5h7.5L19 9v11.5H6z"/><path d="M13 3.5V9h6"/><path d="M9 13h7M9 16.5h4.5"/></symbol>
  <symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13.5 3 6 13.5h4.5L10 21l7.5-10.5H13l.5-7.5Z"/></symbol>
  <symbol id="i-branches" viewBox="0 0 24 24"><path d="M4 20V8.5L10 5v15"/><path d="M10 11h9.5V20"/><path d="M13.5 14.5h.01M16.5 14.5h.01M13.5 17.5h.01M16.5 17.5h.01M6.5 11h.01M6.5 14.5h.01"/></symbol>
  <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5Z"/></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></symbol>
  <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3.5 19 6v6c0 4.2-2.9 7.3-7 8.5-4.1-1.2-7-4.3-7-8.5V6l7-2.5Z"/><path d="M9 12l2.2 2.2L15.5 10"/></symbol>
  <symbol id="i-handoff" viewBox="0 0 24 24"><path d="M3.5 9.5h11l-3-3M20.5 14.5h-11l3 3"/></symbol>
  <symbol id="i-link" viewBox="0 0 24 24"><path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/></symbol>
  <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M5 7.5h14M5 16.5h14"/><circle cx="10" cy="7.5" r="2.2"/><circle cx="15" cy="16.5" r="2.2"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/></symbol>
  <symbol id="i-chart" viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M4 15.5l4.5-5 3.5 3 5-7"/><path d="M15 6.5h2.5V9"/></symbol>
  <symbol id="i-money" viewBox="0 0 24 24"><rect x="3.5" y="6.5" width="17" height="11" rx="2.5"/><circle cx="12" cy="12" r="2.5"/><path d="M7 12h.01M17 12h.01"/></symbol>
  <symbol id="i-whatsapp" viewBox="0 0 24 24"><path d="M20 11.6a8 8 0 0 1-11.9 7L4 20l1.5-4A8 8 0 1 1 20 11.6Z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5 0 0 1-.4 1-1.3 0-.4-1.6-1.2-1.9-1-.3.2-.5.8-.9.7-.9-.3-2-1.4-2.3-2.3-.1-.4.5-.6.7-.9.2-.3-.6-1.9-1-1.9-.9 0-1.1 1.2-1.1 1.2Z"/></symbol>
  <symbol id="i-instagram" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><path d="M16.8 7.3h.01"/></symbol>
  <symbol id="i-messenger" viewBox="0 0 24 24"><path d="M12 3.5c4.7 0 8.5 3.5 8.5 8s-3.8 8-8.5 8c-.9 0-1.7-.1-2.5-.3L5.5 21l.8-3.4A7.8 7.8 0 0 1 3.5 11.5c0-4.5 3.8-8 8.5-8Z"/><path d="M7.5 13.5 10.3 10l2.3 2 2.4-3 2.5 4"/></symbol>
  <symbol id="i-monitor" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="12" rx="2.5"/><path d="M9 20h6M12 16.5V20"/></symbol>
  <symbol id="i-spark" viewBox="0 0 24 24"><path d="M12 3.5c.6 4 1.9 5.3 5.9 5.9-4 .6-5.3 1.9-5.9 5.9-.6-4-1.9-5.3-5.9-5.9 4-.6 5.3-1.9 5.9-5.9Z"/><path d="M18 16.5c.3 1.7.8 2.2 2.5 2.5-1.7.3-2.2.8-2.5 2.5-.3-1.7-.8-2.2-2.5-2.5 1.7-.3 2.2-.8 2.5-2.5Z"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></symbol>
  <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
  <symbol id="i-send" viewBox="0 0 24 24"><path d="M4.5 12 20 5l-7 15-2.5-6.5L4.5 12Z"/></symbol>
  <symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 4 21 19.5H3L12 4Z"/><path d="M12 10v4M12 16.5h.01"/></symbol>
  <symbol id="i-phone" viewBox="0 0 24 24"><path d="M8.5 4.5h-3A1.5 1.5 0 0 0 4 6.2c.4 5.6 5.2 10.4 10.8 10.8a1.5 1.5 0 0 0 1.7-1.5v-3l-3.2-1.2-1.4 1.8a12 12 0 0 1-3-3l1.8-1.4L8.5 4.5Z"/></symbol>
  <symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10Z"/><circle cx="12" cy="10.5" r="2.4"/></symbol>
  <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/></symbol>
  <symbol id="i-clip" viewBox="0 0 24 24"><path d="M19 11.5l-7.1 7.1a4.5 4.5 0 0 1-6.4-6.4l7.6-7.6a3 3 0 0 1 4.3 4.3l-7.6 7.6a1.5 1.5 0 0 1-2.2-2.2l6.6-6.6"/></symbol>
  <symbol id="i-chevron" viewBox="0 0 24 24"><path d="M9.5 5.5l6.5 6.5-6.5 6.5"/></symbol>
  <symbol id="i-box" viewBox="0 0 24 24"><path d="M12 3.5 20 7.5v9l-8 4-8-4v-9l8-4Z"/><path d="M4 7.5l8 4 8-4M12 11.5v9"/></symbol>
  <symbol id="i-heart" viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-9.2A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7 2.8C19 15.6 12 20 12 20Z"/></symbol>
  <symbol id="i-rocket" viewBox="0 0 24 24"><path d="M13.5 4.5c3.5-1.5 6-1 6-1s.5 2.5-1 6c-1.2 2.8-3.4 5-6 6.2L9.3 11.3C10.5 8.7 12.7 6.5 13.5 4.5Z"/><path d="M9.3 11.3 6.5 12l-2-2 3.5-1.5M12.7 15.7 12 18.5l2 2 1.5-3.5"/><path d="M6 18l-1.5 1.5"/></symbol>
  <symbol id="i-crown" viewBox="0 0 24 24"><path d="M3.5 7.5l3 10.5h11l3-10.5-5 3.5L12 5l-3.5 6z"/><path d="M6.5 18h11"/></symbol>
  <symbol id="i-diamond" viewBox="0 0 24 24"><path d="M7 4h10l4 5.5-9 10.5-9-10.5L7 4Z"/><path d="M3.5 9.5h17M9.5 4l2.5 5.5L14.5 4"/></symbol>
  <symbol id="i-question" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .9-1 1.6v.4"/><path d="M12 17h.01"/></symbol>
</svg>`;

  function mount() {
    const holder = document.createElement('div');
    holder.innerHTML = SPRITE.trim();
    const svg = holder.firstElementChild;
    if (svg) document.body.prepend(svg);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
})();
