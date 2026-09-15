// Encrypts channel access tokens at rest (AES-256-GCM) and seals short-lived payloads.
const crypto = require('crypto');

function key() {
  const raw = process.env.ENCRYPTION_KEY || '';
  const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  return buf;
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

function decrypt(payload) {
  const [version, iv, tag, data] = String(payload || '').split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Invalid encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// Hands data to the browser and back without the browser being able to read or change it.
function seal(data, ttlMs) {
  return encrypt(JSON.stringify({ exp: Date.now() + ttlMs, data })).replace(/\./g, '~');
}

function unseal(token) {
  let parsed;
  try {
    parsed = JSON.parse(decrypt(String(token || '').replace(/~/g, '.')));
  } catch {
    return null;
  }
  return parsed && parsed.exp > Date.now() ? parsed.data : null;
}

const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

module.exports = { encrypt, decrypt, seal, unseal, randomToken };
