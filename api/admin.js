// The owner inbox (/admin).
//   POST {action: 'login', email}          → email a sign-in link (admins only)
//   POST {action: 'refresh', refreshToken} → a new access token
//   GET  ?action=me | inbox | conversation&id=<uuid> | analytics&days=7   (signed in)
//   POST {action: 'seen' | 'delete', id}                (signed in)
const auth = require('../lib/auth');
const inbox = require('../lib/inbox');
const analytics = require('../lib/analytics');
const bots = require('../lib/bots');
const { HttpError, json, readBody, UUID } = require('../lib/http');

// `npm run dev` on this machine skips the sign-in, so the inbox can be checked locally.
const localDev = (req) =>
  process.env.DIGIPLUS_DEV_ADMIN === '1' &&
  !process.env.VERCEL &&
  ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);

async function signedIn(req) {
  if (localDev(req)) return { email: 'local', dev: true };
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return auth.adminFromToken(token);
}

function origin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

const idOrThrow = (id) => {
  if (!UUID.test(String(id || ''))) throw new HttpError(400, 'bad_id');
  return String(id);
};

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const body = req.method === 'POST' ? await readBody(req) : {};

    if (req.method === 'POST' && body.action === 'login') {
      try {
        await auth.sendLink(body.email, `${origin(req)}/admin`);
      } catch (e) {
        console.error(`[api/admin] login link failed: ${e.message}`);
        return json(res, e.status === 429 ? 429 : 502, { error: e.status === 429 ? 'too_many' : 'email_failed' });
      }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && body.action === 'refresh') {
      const session = await auth.refresh(String(body.refreshToken || ''));
      return session ? json(res, 200, session) : json(res, 401, { error: 'signed_out' });
    }

    const admin = await signedIn(req);
    if (!admin) return json(res, 401, { error: 'signed_out' });

    if (req.method === 'GET') {
      const action = url.searchParams.get('action');
      if (action === 'me') return json(res, 200, { email: admin.email, dev: Boolean(admin.dev) });
      if (action === 'inbox') return json(res, 200, { bots: bots.all(), conversations: await inbox.list() });
      if (action === 'conversation') {
        const data = await inbox.get(idOrThrow(url.searchParams.get('id')));
        return data ? json(res, 200, data) : json(res, 404, { error: 'not_found' });
      }
      if (action === 'analytics') {
        const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
        return json(res, 200, await analytics.summary(days));
      }
    }
    if (req.method === 'POST' && body.action === 'seen') {
      await inbox.markSeen(idOrThrow(body.id));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && body.action === 'delete') {
      await inbox.remove(idOrThrow(body.id));
      return json(res, 200, { ok: true });
    }
    return json(res, 400, { error: 'unknown_action' });
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.code });
    console.error(`[api/admin] ${req.method} failed: ${e.stack || e.message}`);
    return json(res, 500, { error: 'server_error' });
  }
};
