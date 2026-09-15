// Shared browser helpers: Supabase login session, authenticated API calls, small DOM utils.
(function () {
  let configPromise = null;
  let client = null;

  function config() {
    if (!configPromise) {
      configPromise = fetch('/api/public/config').then((r) => {
        if (!r.ok) throw new Error('Could not load the site configuration');
        return r.json();
      });
    }
    return configPromise;
  }

  async function auth() {
    if (client) return client;
    const c = await config();
    if (!c.supabaseUrl || !c.supabaseAnonKey) throw new Error('Login is not configured on the server (SUPABASE_ANON_KEY).');
    client = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return client;
  }

  async function session() {
    const { data } = await (await auth()).auth.getSession();
    return data.session;
  }

  function toLogin() {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`;
  }

  async function api(url, { method, body } = {}) {
    const s = await session();
    if (!s) {
      toLogin();
      throw new Error('Please log in');
    }
    const hasBody = body !== undefined;
    const res = await fetch(url, {
      method: method || (hasBody ? 'POST' : 'GET'),
      headers: { Authorization: `Bearer ${s.access_token}`, ...(hasBody ? { 'Content-Type': 'application/json' } : {}) },
      body: hasBody ? JSON.stringify(body) : undefined,
    });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json().catch(() => null) : await res.text();
    if (res.status === 401) {
      toLogin();
      throw new Error('Your session expired — please log in again');
    }
    if (!res.ok) {
      const error = new Error((data && data.error) || `Request failed (${res.status})`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== 'string') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : String(c));
    return node;
  }

  let toastTimer;
  function toast(message, isError = false) {
    let t = document.getElementById('toast');
    if (!t) {
      t = el('div', { id: 'toast', class: 'toast', role: 'status' });
      document.body.append(t);
    }
    t.textContent = message;
    t.className = `toast${isError ? ' error' : ''}`;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 2600);
  }

  async function logout() {
    try {
      await (await auth()).auth.signOut();
    } catch {}
    location.href = '/login';
  }

  function download(filename, content, type = 'text/plain;charset=utf-8') {
    const a = el('a', { href: URL.createObjectURL(new Blob([content], { type })), download: filename });
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied');
    } catch {
      toast('Could not copy — select the text and copy it manually', true);
    }
  }

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const dateTime = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  function timeAgo(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
    return date(iso);
  }

  window.DP = { config, auth, session, api, el, toast, logout, download, copy, fmt, date, dateTime, timeAgo };
})();
