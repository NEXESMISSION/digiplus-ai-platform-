// Owner sign-in with one password (ADMIN_PASSWORD). No e-mail, no outside service.
// A correct password gives a signed token that the browser keeps for 30 days.
const crypto = require('crypto');

const DAYS = 30;
const MAX_TRIES = 8; // per minute, per address — enough for a typo, too slow to guess

const password = () => String(process.env.ADMIN_PASSWORD || '');
// The token is signed with the password itself, so changing the password signs everyone out.
const secret = () => `digiplus:${password()}`;

const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

// Same length + same time whatever the answer, so the server never leaks the password by timing.
function same(a, b) {
  const one = Buffer.from(String(a));
  const two = Buffer.from(String(b));
  if (one.length !== two.length) return false;
  return crypto.timingSafeEqual(one, two);
}

const tries = new Map(); // address → {count, until}

function tooManyTries(address) {
  const now = Date.now();
  const seen = tries.get(address);
  if (!seen || seen.until < now) {
    tries.set(address, { count: 1, until: now + 60_000 });
    return false;
  }
  seen.count += 1;
  return seen.count > MAX_TRIES;
}

// The token the browser keeps: when it expires, plus the signature of that.
function signIn(given, address = '') {
  if (!password()) throw Object.assign(new Error('ADMIN_PASSWORD is not set'), { status: 500 });
  if (tooManyTries(address)) throw Object.assign(new Error('too_many'), { status: 429 });
  if (!same(given, password())) return null;
  const expires = String(Date.now() + DAYS * 24 * 60 * 60 * 1000);
  return { token: `${expires}.${sign(expires)}`, days: DAYS };
}

// The signed-in owner for a token, or null.
function adminFromToken(token) {
  const [expires, signature] = String(token || '').split('.');
  if (!expires || !signature || !password()) return null;
  if (!same(signature, sign(expires))) return null;
  if (Number(expires) < Date.now()) return null;
  return { email: 'owner' };
}

module.exports = { signIn, adminFromToken };
