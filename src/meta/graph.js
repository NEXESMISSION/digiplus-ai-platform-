// Minimal Meta Graph API client (plain fetch). META_GRAPH_BASE lets tests point it at a mock server.
const crypto = require('crypto');

const version = () => process.env.META_GRAPH_VERSION || 'v25.0';
const facebookBase = () => (process.env.META_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/+$/, '');
const instagramBase = () => (process.env.META_IG_GRAPH_BASE || 'https://graph.instagram.com').replace(/\/+$/, '');

const appId = () => process.env.META_APP_ID || '';
const appSecret = () => process.env.META_APP_SECRET || '';
const appAccessToken = () => `${appId()}|${appSecret()}`;
const isAppConfigured = () => Boolean(appId() && appSecret());

class MetaError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function graph(method, path, { token, query, body, host = 'facebook', timeoutMs = 20_000 } = {}) {
  const base = host === 'instagram' ? instagramBase() : facebookBase();
  const url = new URL(`${base}/${version()}/${String(path).replace(/^\/+/, '')}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok || data.error) {
    const message = data.error?.error_user_msg || data.error?.message || res.statusText || 'Meta request failed';
    throw new MetaError(`Meta: ${message}`, res.status, data.error || null);
  }
  return data;
}

// X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, app secret)
function validSignature(rawBody, header, secret) {
  if (!secret || !rawBody || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

module.exports = { graph, MetaError, version, appId, appSecret, appAccessToken, isAppConfigured, validSignature };
