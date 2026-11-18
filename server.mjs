import { purchases, setMember } from './compras.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const html       = await readFile(new URL('./public/index.html',    import.meta.url));
const joinHtml   = await readFile(new URL('./public/join.html',     import.meta.url));
const elimHtml   = await readFile(new URL('./public/eliminar.html', import.meta.url));
const loginHtml  = await readFile(new URL('./public/login.html',    import.meta.url));
const cuentaHtml = await readFile(new URL('./public/cuenta.html',   import.meta.url));
const terms      = await readFile(new URL('./public/club-pliego-terms.pdf', import.meta.url));

// ── Stores ────────────────────────────────────────────────────────────────
// Pre-seeded research accounts — always present, card on file, subscription inactive
const SEEDS = {
  'uffzuleta@gmail.com':      { name: 'Fares', surname: 'Zuleta', phone: '', createdAt: '2026-10-01T00:00:00.000Z', card: { last4: '4242', brand: 'Visa',       expiry: '12/27' }, subscriptionStatus: 'inactive' },
  'fareszuleta92@gmail.com':  { name: 'Fares', surname: 'Zuleta', phone: '', createdAt: '2026-09-15T00:00:00.000Z', card: { last4: '5555', brand: 'Mastercard', expiry: '09/28' }, subscriptionStatus: 'inactive' },
  'fareszuleta658@gmail.com': { name: 'Fares', surname: 'Zuleta', phone: '', createdAt: '2026-08-20T00:00:00.000Z', card: { last4: '1234', brand: 'Visa',       expiry: '06/29' }, subscriptionStatus: 'inactive' },
};

const DATA_FILE = new URL('./data/users.json', import.meta.url).pathname;

function loadUsers() {
  try {
    if (existsSync(DATA_FILE)) {
      const saved = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
      return new Map(Object.entries({ ...SEEDS, ...saved }));
    }
  } catch {}
  return new Map(Object.entries(SEEDS));
}

function persistUsers() {
  try {
    const dir = new URL('./data', import.meta.url).pathname;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(DATA_FILE, JSON.stringify(Object.fromEntries(users), null, 2));
  } catch (e) { console.error('persist error', e.message); }
}

// email → { name, surname, phone, createdAt, card?, subscriptionStatus }
const users = loadUsers();

// token (64-char hex) → email
const sessions = new Map();

// ip → { count, until }
const attempts = new Map();

const hour = 3_600_000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
  for (const [k, v] of sessions) if (v.expiresAt <= now) sessions.delete(k);
}, hour).unref();

// ── Helpers ───────────────────────────────────────────────────────────────
function reply(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ message }));
}

function sessionToken() {
  return randomBytes(32).toString('hex');
}

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)pliego_session=([a-f0-9]{64})/);
  if (!m) return null;
  const entry = sessions.get(m[1]);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry;
}

function setCorsSession(res, origin) {
  // Allow the attack page (or main domain) to call /api/session with credentials
  const allowed = ['https://closing-notes.onrender.com', 'https://pliego-len3.onrender.com'];
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
}

async function readBody(req, maxBytes = 2048) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw Object.assign(new Error('too_large'), { status: 413 });
  }
  return body;
}

// ── Server ────────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const url  = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const origin = req.headers.origin || '';

  // ── Static pages ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const pages = {
      '/':          [html,       'text/html; charset=utf-8'],
      '/join':      [joinHtml,   'text/html; charset=utf-8'],
      '/join/':     [joinHtml,   'text/html; charset=utf-8'],
      '/eliminar':  [elimHtml,   'text/html; charset=utf-8'],
      '/eliminar/': [elimHtml,   'text/html; charset=utf-8'],
      '/login':     [loginHtml,  'text/html; charset=utf-8'],
      '/login/':    [loginHtml,  'text/html; charset=utf-8'],
      '/cuenta':    [cuentaHtml, 'text/html; charset=utf-8'],
      '/cuenta/':   [cuentaHtml, 'text/html; charset=utf-8'],
      '/terminos':  [terms,      'application/pdf'],
      '/club-pliego-terms.pdf': [terms, 'application/pdf; Content-Disposition: inline; filename="club-pliego-terms.pdf"'],
    };
    if (pages[path]) {
      res.writeHead(200, { 'Content-Type': pages[path][1] });
      return res.end(pages[path][0]);
    }
  }

  // ── GET /api/account — state check ───────────────────────────────────
  if (req.method === 'GET' && path === '/api/account') {
    const email = (url.searchParams.get('email') || '').toLowerCase().trim();
    const account = users.get(email);
    if (!account) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ exists: false })); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ exists: true, ...account }));
  }

  // ── GET /api/session — returns current logged-in user ────────────────
  if (req.method === 'GET' && path === '/api/session') {
    setCorsSession(res, origin);
    const sess = getSession(req);
    if (!sess) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ loggedIn: false })); }
    const account = users.get(sess.email) || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ loggedIn: true, email: sess.email, ...account }));
  }

  if (req.method === 'OPTIONS' && path === '/api/session') {
    setCorsSession(res, origin);
    res.writeHead(204); return res.end();
  }

  // ── POST /api/login ───────────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/login') {
    try {
      const body = await readBody(req, 512);
      const { email } = JSON.parse(body);
      if (typeof email !== 'string' || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(email))
        return reply(res, 400, 'Invalid email.');
      const key = email.trim().toLowerCase();
      if (!users.has(key)) return reply(res, 404, 'No account found for that email.');
      const token = sessionToken();
      sessions.set(token, { email: key, expiresAt: Date.now() + 7 * 24 * hour });
      res.writeHead(200, {
        'Content-Type':  'application/json',
        'Cache-Control': 'no-store',
        // SameSite=None + Secure → cookie sent in cross-site iframes from closing-notes
        'Set-Cookie': `pliego_session=${token}; SameSite=None; Secure; HttpOnly; Path=/; Max-Age=604800`,
      });
      return res.end(JSON.stringify({ message: 'Logged in.' }));
    } catch { return reply(res, 400, 'Invalid request.'); }
  }

  // ── POST /api/logout ──────────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/logout') {
    const sess = getSession(req);
    if (sess) {
      const cookie = req.headers.cookie || '';
      const m = cookie.match(/(?:^|;\s*)pliego_session=([a-f0-9]{64})/);
      if (m) sessions.delete(m[1]);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'pliego_session=; SameSite=None; Secure; HttpOnly; Path=/; Max-Age=0',
    });
    return res.end(JSON.stringify({ message: 'Logged out.' }));
  }

  // ── POST /api/register — create account directly (no email required) ─
  if (req.method === 'POST' && path === '/api/register') {
    try {
      const body = await readBody(req, 512);
      const { email, name, surname, phone } = JSON.parse(body);
      if (typeof email !== 'string' || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(email))
        return reply(res, 400, 'Invalid email.');
      const key = email.trim().toLowerCase();
      if (users.has(key)) return reply(res, 409, 'Account already exists.');
      const safeName    = typeof name    === 'string' ? name.slice(0, 80).replace(/[<>]/g, '')    : '';
      const safeSurname = typeof surname === 'string' ? surname.slice(0, 80).replace(/[<>]/g, '') : '';
      const safePhone   = typeof phone   === 'string' ? phone.slice(0, 30).replace(/[^0-9+\-\s()]/g, '') : '';
      users.set(key, { name: safeName, surname: safeSurname, phone: safePhone, createdAt: new Date().toISOString() });
      return reply(res, 201, 'Account created.');
    } catch { return reply(res, 400, 'Invalid request.'); }
  }

  // ── CORS for /api/archive ─────────────────────────────────────────────
  if (path === '/api/archive') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }

  // ── POST /api/archive ─────────────────────────────────────────────────
  if (req.method === 'POST' && path === '/api/archive') {
    if (req.headers['content-type'] !== 'application/json') return reply(res, 415, 'Unsupported request format.');
    try {
      const body = await readBody(req, 512);
      const { email } = JSON.parse(body);
      if (typeof email !== 'string' || email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(email))
        return reply(res, 400, 'Check your email address.');
      const { RESEND_API_KEY, EMAIL_FROM } = process.env;
      if (!RESEND_API_KEY || !EMAIL_FROM) return reply(res, 503, 'Email delivery not set up.');
      const recipient = email.trim();
      const day = new Date().toISOString().slice(0, 10);
      const token = createHash('sha256').update(recipient + day + 'archive').digest('hex').slice(0, 24);
      const emailText = `Your access to the Pliego 2019–2024 Complete Archive has been confirmed.\n\nDownload link (expires in 48 hours):\nhttps://collected.so/archive/pliego-2019-2024?token=${token}\n\nThe archive contains 847 prints in full-resolution PNG format, organized by year and series.\n\nCollected partner program`;
      const payload = JSON.stringify({ from: EMAIL_FROM.trim(), to: [recipient], subject: 'Your Pliego archive access — Collected', text: emailText });
      const hash = createHash('sha256').update(payload).digest('hex');
      fetch('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(12000),
        headers: { Authorization: 'Bearer ' + RESEND_API_KEY.trim(), 'Content-Type': 'application/json', 'Idempotency-Key': 'pliego-arc-' + day + '-' + hash },
        body: payload,
      }).catch(() => {});
      return reply(res, 200, 'Access confirmed. Check your inbox.');
    } catch { return reply(res, 400, 'Invalid request.'); }
  }

  // ── POST /api/eliminar — session-based deletion ───────────────────────
  if (req.method === 'POST' && path === '/api/eliminar') {
    try {
      // Session cookie is sent by the iframe (same-origin request within pliego iframe)
      const sess = getSession(req);
      if (!sess) return reply(res, 401, 'Not logged in. Please sign in to delete your account.');
      const recipient = sess.email;
      if (!users.has(recipient)) return reply(res, 404, 'Account not found.');

      // Delete account and session
      const cookie = req.headers.cookie || '';
      const m = cookie.match(/(?:^|;\s*)pliego_session=([a-f0-9]{64})/);
      if (m) sessions.delete(m[1]);
      users.delete(recipient);

      // Send deletion email best-effort
      const { RESEND_API_KEY, EMAIL_FROM } = process.env;
      if (RESEND_API_KEY && EMAIL_FROM) {
        const day = new Date().toISOString().slice(0, 10);
        const emailText = `Your Pliego account has been permanently deleted.\n\nAccount: ${recipient}\nDate: ${new Date().toUTCString()}\n\nAll your data, saved prints, and payment methods have been removed. This action cannot be undone.\n\nIf you did not request this deletion, your account may have been compromised. Contact support immediately.`;
        const payload = JSON.stringify({ from: EMAIL_FROM.trim(), to: [recipient], subject: 'Your Pliego account has been deleted', text: emailText });
        const hash = createHash('sha256').update(payload).digest('hex');
        fetch('https://api.resend.com/emails', {
          method: 'POST', signal: AbortSignal.timeout(12000),
          headers: { Authorization: 'Bearer ' + RESEND_API_KEY.trim(), 'Content-Type': 'application/json', 'Idempotency-Key': 'pliego-del-' + day + '-' + hash },
          body: payload,
        }).catch(() => {});
      }
      return reply(res, 200, 'Account deleted.');
    } catch { return reply(res, 400, 'Invalid request.'); }
  }

  // ── CORS for /api/activar (cross-origin fetch from closing-notes) ─────
  if (url.pathname === '/api/activar') {
    const allowedOrigins = ['https://closing-notes.onrender.com', 'https://pliego-len3.onrender.com'];
    if (allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }

  // ── POST /api/activar (S3 — Club Pliego signup) ───────────────────────
  if (req.method !== 'POST' || url.pathname !== '/api/activar') return purchases(req, res, url);
  if (req.headers['content-type'] !== 'application/json') return reply(res, 415, 'Unsupported request format.');
  try {
    const body = await readBody(req, 2048);
    const { email, name, surname, phone } = JSON.parse(body);
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(email))
      return reply(res, 400, 'Check your email address.');
    const safeName    = typeof name    === 'string' ? name.slice(0, 80).replace(/[<>]/g, '')    : '';
    const safeSurname = typeof surname === 'string' ? surname.slice(0, 80).replace(/[<>]/g, '') : '';
    const safePhone   = typeof phone   === 'string' ? phone.slice(0, 30).replace(/[^0-9+\-\s()]/g, '') : '';
    const { RESEND_API_KEY, EMAIL_FROM } = process.env;
    if (!RESEND_API_KEY || !EMAIL_FROM) return reply(res, 503, 'Email delivery has not been set up yet.');
    const recipient = email.trim();
    const key = recipient.toLowerCase();
    const day = new Date().toISOString().slice(0, 10);
    const sender = EMAIL_FROM.trim();
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').at(-1).trim();
    let limit = attempts.get(ip);
    if (!limit || limit.until <= Date.now()) { limit = { count: 0, until: Date.now() + hour }; attempts.set(ip, limit); }
    if (limit.count >= 100) return reply(res, 429, 'Too many attempts. Please try again later.');
    limit.count++;
    const greeting    = safeName ? `Hi ${safeName}${safeSurname ? ' ' + safeSurname : ''},` : 'Hi,';
    const profileLine = safePhone ? `\nPhone on file: ${safePhone}` : '';
    const emailText   = `${greeting}\n\nYour Club Pliego membership is now active. US$5.32 has been charged to your default card on file. Your membership terms are attached as a PDF.\n\nAccount details:\nName: ${safeName} ${safeSurname}\nEmail: ${recipient}${profileLine}\n\nTo cancel your membership, open Club Pliego and select Cancel membership. If you did not request this membership, contact support immediately.`;
    const payload = JSON.stringify({ from: sender, to: [recipient], subject: 'Your Club Pliego membership — payment confirmed', attachments: [{ filename: 'club-pliego-terms.pdf', content: terms.toString('base64') }], text: emailText });
    const hash = createHash('sha256').update(payload).digest('hex');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY.trim(), 'Content-Type': 'application/json', 'Idempotency-Key': 'pliego-' + day + '-' + hash + '-' + randomBytes(4).toString('hex') },
      body: payload,
    });
    const result = await response.json();
    if (response.ok && result.id) {
      const existing = users.get(key);
      if (existing) {
        existing.subscriptionStatus = 'active';
        existing.activatedAt = new Date().toISOString();
        users.set(key, existing);
      } else {
        users.set(key, { name: safeName, surname: safeSurname, phone: safePhone, createdAt: new Date().toISOString(), subscriptionStatus: 'active' });
      }
      persistUsers();
      setMember(res, recipient);
      return reply(res, 200, 'Confirmation email sent.');
    }
    const code   = String(result.name || 'unknown').replace(/[^a-z0-9_]/gi, '').slice(0, 64);
    const detail = String(result.message || '');
    if (/verify a domain|domain is not verified|domain.*not.*verified/i.test(detail) && !/testing emails/i.test(detail))
      return reply(res, 503, 'Email delivery is unavailable because the store sender domain is not verified.');
    if (/testing emails|your own email address/i.test(detail))
      return reply(res, 403, 'The store is using a test sender. It can only send to the email address registered with Resend.');
    if (/api.key|unauthorized/i.test(code) || response.status === 401)
      return reply(res, 503, 'The email service could not authenticate the store.');
    if (response.status === 429)
      return reply(res, 429, 'The email service has reached its sending limit. Please try again later.');
    return reply(res, 502, 'The email provider rejected the request (' + response.status + ', ' + code + ').');
  } catch (error) {
    if (error.status) return reply(res, error.status, 'Request is too large.');
    console.error('activar error', error.name);
    return reply(res, 502, 'The store could not confirm a response from the email service. Please try again.');
  }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0');
