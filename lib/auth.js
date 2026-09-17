// Owner sign-in with an email link (Supabase Auth). Only the addresses in SUPER_ADMIN_EMAILS
// get a link, and only they can read the inbox.

const admins = () =>
  (process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const isAdminEmail = (email) => admins().includes(String(email || '').trim().toLowerCase());

const authUrl = (path) => `${process.env.SUPABASE_URL}/auth/v1${path}`;
const headers = (extra = {}) => ({ apikey: process.env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...extra });

// Sends the sign-in link. Addresses that aren't admins get nothing, and the page shows the same message.
async function sendLink(email, redirectTo) {
  if (!isAdminEmail(email)) return;
  const res = await fetch(`${authUrl('/otp')}?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email: String(email).trim().toLowerCase(), create_user: true }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = new Error(`Supabase Auth ${res.status}: ${data.msg || data.error_description || data.message || res.statusText}`);
    error.status = res.status;
    throw error;
  }
}

// The signed-in admin for an access token, or null.
async function adminFromToken(token) {
  if (!token) return null;
  const res = await fetch(authUrl('/user'), { headers: headers({ Authorization: `Bearer ${token}` }), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return user && isAdminEmail(user.email) ? { email: user.email } : null;
}

// A fresh access token when the old one expired (they last an hour).
async function refresh(refreshToken) {
  if (!refreshToken) return null;
  const res = await fetch(authUrl('/token?grant_type=refresh_token'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) return null;
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

module.exports = { sendLink, adminFromToken, refresh };
