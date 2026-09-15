// Login checks. The browser signs in with Supabase Auth and sends its access token
// as "Authorization: Bearer …"; the server asks Supabase who that token belongs to.
const crypto = require('crypto');
const db = require('./db');
const { HttpError } = require('./lib/http');

const CACHE_MS = 60_000;
const cache = new Map(); // sha256(token) -> { user, expires }

async function userFromToken(token) {
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.user;

  const { data, error } = await db.sb().auth.getUser(token);
  if (error || !data?.user) return null;

  cache.set(key, { user: data.user, expires: Date.now() + CACHE_MS });
  if (cache.size > 2000) {
    for (const [k, v] of cache) if (v.expires <= Date.now()) cache.delete(k);
  }
  return data.user;
}

async function requireUser(req, res, next) {
  if (req.user) return next(); // already checked by an earlier router
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new HttpError(401, 'Please log in');
    const user = await userFromToken(token);
    if (!user) throw new HttpError(401, 'Your session expired — please log in again');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

async function requireAccount(req, res, next) {
  try {
    req.account = await db.ensureAccountForUser(req.user);
    next();
  } catch (e) {
    next(e);
  }
}

function superAdminEmails() {
  return (process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function isSuperAdmin(user) {
  const email = String(user?.email || '').toLowerCase();
  return Boolean(email && user.email_confirmed_at && superAdminEmails().includes(email));
}

function requireSuper(req, res, next) {
  if (!isSuperAdmin(req.user)) return next(new HttpError(403, 'Not allowed'));
  next();
}

module.exports = { requireUser, requireAccount, requireSuper, isSuperAdmin };
