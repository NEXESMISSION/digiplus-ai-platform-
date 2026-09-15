/*
  DigiPlus AI chat bubble. Paste on any website:
  <script src="https://YOUR-APP.vercel.app/widget.js" data-bot="BOT_ID" data-color="#4f46e5" async></script>
*/
(function () {
  if (window.__digiplusWidget) return;
  window.__digiplusWidget = true;

  var script = document.currentScript || document.querySelector('script[src*="widget.js"][data-bot]');
  if (!script) return;
  var botId = String(script.getAttribute('data-bot') || '').toLowerCase();
  if (!/^[a-z0-9]{6,32}$/.test(botId)) return console.warn('[DigiPlus AI] Missing or invalid data-bot attribute');

  var origin = new URL(script.src).origin;
  var color = /^#[0-9a-f]{6}$/i.test(script.getAttribute('data-color') || '') ? script.getAttribute('data-color') : '#4f46e5';
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right';

  var style = document.createElement('style');
  style.textContent =
    '.dpai-btn{position:fixed;bottom:20px;' + side + ':20px;width:60px;height:60px;border-radius:50%;border:0;cursor:pointer;' +
    'background:' + color + ';color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:2147483000;display:grid;place-items:center;transition:transform .15s}' +
    '.dpai-btn:hover{transform:scale(1.06)}' +
    '.dpai-frame{position:fixed;bottom:92px;' + side + ':20px;width:380px;height:600px;max-height:calc(100vh - 112px);max-width:calc(100vw - 40px);' +
    'border:0;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.22);z-index:2147483000;background:#fff;display:none}' +
    '.dpai-frame.open{display:block}' +
    '@media (max-width:480px){.dpai-frame{bottom:0;' + side + ':0;width:100vw;height:100dvh;max-height:none;max-width:none;border-radius:0}' +
    '.dpai-btn.open{bottom:auto;top:12px;width:44px;height:44px}}';
  document.head.appendChild(style);

  var chatIcon = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  var closeIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  var frame = document.createElement('iframe');
  frame.className = 'dpai-frame';
  frame.title = 'Chat';

  var btn = document.createElement('button');
  btn.className = 'dpai-btn';
  btn.setAttribute('aria-label', 'Open chat');
  btn.innerHTML = chatIcon;

  var loaded = false;
  btn.addEventListener('click', function () {
    var open = !frame.classList.contains('open');
    if (open && !loaded) {
      frame.src = origin + '/c/' + botId + '?embed=1&ref=' + encodeURIComponent(location.hostname);
      loaded = true;
    }
    frame.classList.toggle('open', open);
    btn.classList.toggle('open', open);
    btn.innerHTML = open ? closeIcon : chatIcon;
    btn.setAttribute('aria-label', open ? 'Close chat' : 'Open chat');
  });

  document.body.appendChild(frame);
  document.body.appendChild(btn);
})();
