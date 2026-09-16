// Local development server: `npm run dev` → http://localhost:3000
// (On Vercel, api/index.js + vercel.json are used instead of this file.)
require('dotenv').config({ quiet: true });

const express = require('express');
const path = require('path');
const app = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));

const server = express();
server.disable('x-powered-by');
server.get('/', page('index.html'));
server.get(['/en', '/en/'], page('en.html'));
server.get(['/login', '/signup', '/reset-password'], page('auth.html'));
server.get('/app', page('app.html'));
server.get('/super', page('super.html'));
server.get('/c/:publicId', page('chat.html'));
server.get('/privacy', page('privacy.html'));
server.get('/terms', page('terms.html'));
server.use(express.static(PUBLIC_DIR, { index: false }));
server.use(app);

server.listen(PORT, () => {
  console.log(`\n  Website:      http://localhost:${PORT}`);
  console.log(`  Dashboard:    http://localhost:${PORT}/app`);
  console.log(`  Super admin:  http://localhost:${PORT}/super\n`);
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'OPENAI_API_KEY', 'SUPER_ADMIN_EMAILS'].filter((k) => !process.env[k]);
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) console.warn(`  ⚠ Missing in .env: ${missing.join(', ')}\n`);
});

// Locally there's no Vercel Cron, so summarize idle conversations every minute.
setInterval(() => app.autoSummarizeIdle(3).catch((e) => console.error(`[summary] ${e.message}`)), 60_000).unref();
