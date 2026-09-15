// Super admin: Meta app status and one-click webhook registration.
const express = require('express');
const store = require('../meta/store');
const meta = require('../meta/graph');
const { requireUser, requireSuper } = require('../auth');
const { HttpError, route, appUrl } = require('../lib/http');

const router = express.Router();
router.use('/api/super/meta', requireUser, requireSuper);

const WEBHOOK_FIELDS = {
  page: 'messages,messaging_postbacks,message_echoes',
  instagram: 'messages,messaging_postbacks',
  whatsapp_business_account: 'messages',
};

const webhookUrl = (req) => `${(process.env.WEBHOOK_BASE_URL || appUrl(req)).replace(/\/+$/, '')}/api/webhooks/meta`;

async function subscriptions() {
  const r = await meta.graph('GET', `${meta.appId()}/subscriptions`, { query: { access_token: meta.appAccessToken() } });
  return (r.data || []).map((s) => ({ object: s.object, active: s.active, callback_url: s.callback_url, fields: (s.fields || []).map((f) => f.name) }));
}

router.get('/api/super/meta', route(async (req, res) => {
  const env = {
    META_APP_ID: Boolean(meta.appId()),
    META_APP_SECRET: Boolean(meta.appSecret()),
    META_VERIFY_TOKEN: Boolean(process.env.META_VERIFY_TOKEN),
    ENCRYPTION_KEY: Boolean(process.env.ENCRYPTION_KEY),
    META_LOGIN_CONFIG_ID: Boolean(process.env.META_LOGIN_CONFIG_ID),
    META_WHATSAPP_CONFIG_ID: Boolean(process.env.META_WHATSAPP_CONFIG_ID),
  };
  let subs = [];
  let error = null;
  if (meta.isAppConfigured()) {
    try {
      subs = await subscriptions();
    } catch (e) {
      error = e.message;
    }
  }
  const url = webhookUrl(req);
  res.json({
    env,
    appId: meta.appId(),
    graphVersion: meta.version(),
    webhookUrl: url,
    httpsReady: url.startsWith('https://'),
    subscriptions: subs,
    error,
    connections: await store.countConnectionsByChannel(),
  });
}));

router.post('/api/super/meta/webhooks', route(async (req, res) => {
  if (!meta.isAppConfigured() || !process.env.META_VERIFY_TOKEN) {
    throw new HttpError(400, 'Set META_APP_ID, META_APP_SECRET and META_VERIFY_TOKEN first.');
  }
  const callback = webhookUrl(req);
  if (!callback.startsWith('https://')) {
    throw new HttpError(400, 'Meta needs a public https URL. Deploy the app, or set WEBHOOK_BASE_URL to a tunnel URL.');
  }
  const results = {};
  for (const [object, fields] of Object.entries(WEBHOOK_FIELDS)) {
    try {
      await meta.graph('POST', `${meta.appId()}/subscriptions`, {
        query: { object, callback_url: callback, verify_token: process.env.META_VERIFY_TOKEN, fields, include_values: 'true', access_token: meta.appAccessToken() },
      });
      results[object] = 'ok';
    } catch (e) {
      results[object] = e.message;
    }
  }
  res.json({ results, subscriptions: await subscriptions().catch(() => []) });
}));

module.exports = router;
