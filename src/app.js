// The API. Runs as a Vercel serverless function (api/index.js) and locally (server.js).
require('dotenv').config({ quiet: true });

const express = require('express');
const publicRoutes = require('./routes/public');
const dashboardRoutes = require('./routes/dashboard');
const channelRoutes = require('./routes/channels');
const billingRoutes = require('./routes/billing');
const superRoutes = require('./routes/super');
const metaAdminRoutes = require('./routes/meta-admin');
const assistant = require('./services/assistant');
const { HttpError, route, safeEqual } = require('./lib/http');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use('/api', (req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('Cache-Control', 'no-store');
  next();
});

// Webhooks must come before express.json(): signatures are checked against the raw bytes.
const raw = express.raw({ type: '*/*', limit: '2mb' });
app.post('/api/webhooks/dodo', raw, billingRoutes.dodoWebhook);
app.post('/api/webhooks/meta', raw, channelRoutes.platformWebhook);
app.post('/api/webhooks/meta/c/:hookId', raw, channelRoutes.ownAppWebhook);

app.use(express.json({ limit: '2mb' }));
app.use(publicRoutes);
app.use(dashboardRoutes);
app.use(channelRoutes);
app.use(billingRoutes);
app.use(superRoutes);
app.use(metaAdminRoutes);

// Vercel Cron sends "Authorization: Bearer CRON_SECRET".
app.get('/api/cron/summarize', route(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.get('authorization') || '', `Bearer ${secret}`)) throw new HttpError(401, 'Unauthorized');
  res.json({ summarized: await assistant.autoSummarizeIdle(10) });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 && !err.status ? 'Server error' : err.message,
    ...(err.extra || {}),
  });
});

module.exports = app;
module.exports.autoSummarizeIdle = assistant.autoSummarizeIdle;
