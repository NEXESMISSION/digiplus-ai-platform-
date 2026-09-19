// Local preview: serves public/ the way Vercel does and runs api/chat.js.
//   npm run dev   →   http://localhost:3100
// Port 3100, not 3000: AGRIZED owns localhost:3000 (its sign-in e-mails point there,
// and it is installed as an app that swallows those links).
require('../lib/no-image-api');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });

// On this machine the owner inbox opens without the email sign-in (see api/admin.js).
process.env.DIGIPLUS_DEV_ADMIN ??= '1';

const chat = require('../api/chat');
const admin = require('../api/admin');
const track = require('../api/track');

const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3100;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

// Same routes as vercel.json: clean URLs and /chat/<assistant> → chat.html.
function fileFor(pathname) {
  if (/^\/chat\/[^/]+\/?$/.test(pathname)) return path.join(PUBLIC, 'chat.html');
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/\/+$/, '') || '/index';
  } catch {
    return null;
  }
  for (const candidate of [rel, `${rel}.html`, `${rel}/index.html`]) {
    const full = path.join(PUBLIC, candidate);
    if (!full.startsWith(PUBLIC + path.sep)) return null;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/api/chat') return chat(req, res);
    if (pathname === '/api/admin') return admin(req, res);
    if (pathname === '/api/track') return track(req, res);
    const file = fileFor(pathname);
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`DigiPlus AI → http://localhost:${PORT}`));
