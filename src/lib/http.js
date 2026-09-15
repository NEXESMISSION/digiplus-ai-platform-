// Small shared helpers for the Express routes.
const crypto = require('crypto');
const { waitUntil } = require('@vercel/functions');

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Lets async route handlers throw; Express 4 does not catch rejected promises itself.
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const intIn = (v, min, max, fallback = min) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// Runs work after the response; on Vercel it keeps the function alive until it finishes.
function background(promise, label) {
  const p = promise.catch((e) => console.error(`[${label}] ${e.message}`));
  try {
    waitUntil(p);
  } catch {}
}

// Best-effort, per-instance rate limiting (serverless instances don't share memory).
const hits = new Map();
function rateLimit(name, max, windowMs, keyFn = (req) => req.ip) {
  return (req, res, next) => {
    const key = `${name}:${keyFn(req)}`;
    const t = Date.now();
    const recent = (hits.get(key) || []).filter((x) => t - x < windowMs);
    if (recent.length >= max) return res.status(429).json({ error: 'Too many requests — please slow down a little.' });
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => t - x < 3600_000)) hits.delete(k);
    next();
  };
}

// Public base URL used in links (checkout return URLs, chat links).
function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = { HttpError, route, clean, intIn, safeEqual, background, rateLimit, appUrl };
