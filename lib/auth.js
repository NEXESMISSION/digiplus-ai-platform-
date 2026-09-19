// Owner sign-in with an e-mail and a password (ADMIN_EMAIL, ADMIN_PASSWORD).
// Nothing is sent by e-mail: the address is only the second half of the sign-in.
// A correct pair gives a signed token that the browser keeps for 30 days.
const crypto = require('crypto');

const DAYS = 30;
const MAX_TRIES = 8; // per minute, per address — enough for a typo, too slow to guess

const password = () => String(process.env.ADMIN_PASSWORD || '');
// One address, or several separated by commas — they all use the same password.
const admins = () =>
  String(process.env.ADMIN_EMAIL || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const clean = (email) => String(email || '').trim().toLowerCase();
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

// The token the browser keeps: when it expires, who signed in, and the signature of both.
function signIn(email, given, address = '') {
  if (!password()) throw Object.assign(new Error('ADMIN_PASSWORD is not set'), { status: 500 });
  if (!admins().length) throw Object.assign(new Error('ADMIN_EMAIL is not set'), { status: 500 });
  if (tooManyTries(address)) throw Object.assign(new Error('too_many'), { status: 429 });

  const who = clean(email);
  // Both halves are checked every time, so a wrong address costs a try like a wrong password.
  const known = admins().some((one) => same(one, who));
  const right = same(given, password());
  if (!known || !right) return null;

  const expires = String(Date.now() + DAYS * 24 * 60 * 60 * 1000);
  const owner = Buffer.from(who).toString('base64url');
  return { token: `${expires}.${owner}.${sign(`${expires}.${owner}`)}`, email: who, days: DAYS };
}

// The signed-in owner for a token, or null.
function adminFromToken(token) {
  const [expires, owner, signature] = String(token || '').split('.');
  if (!expires || !owner || !signature || !password()) return null;
  if (!same(signature, sign(`${expires}.${owner}`))) return null;
  if (Number(expires) < Date.now()) return null;
  const email = Buffer.from(owner, 'base64url').toString();
  // An address taken out of ADMIN_EMAIL loses its token right away.
  if (!admins().some((one) => same(one, email))) return null;
  return { email };
}

module.exports = { signIn, adminFromToken };
