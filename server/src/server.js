'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const gw = require('./gateway');
const { routes } = require('./routes');
const { HttpError, send, parseCookies, isHttps, hashPassword } = require('./util');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC = path.join(__dirname, '..', 'public');
const COOKIE = 'sid';

const PAGES = {
  '/': 'index.html',
  '/login': 'auth.html',
  '/register': 'auth.html',
  '/app': 'app.html',
  '/pair': 'pair.html',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp', '.json': 'application/json',
};
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'x-frame-options': 'DENY',
};

function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': cache ? 'public, max-age=3600' : 'no-cache',
      ...SECURITY_HEADERS,
    });
    fs.createReadStream(file).pipe(res);
  });
}

const API_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-api-key,authorization',
  'access-control-max-age': '86400',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const isApi = p.startsWith('/api/');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, isApi ? API_CORS : {});
    return res.end();
  }

  // pages and static assets
  if (req.method === 'GET' && PAGES[p]) return serveFile(res, path.join(PUBLIC, PAGES[p]), false);
  if (req.method === 'GET' && p.startsWith('/assets/')) {
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(path.join(PUBLIC, 'assets'))) return send(res, 404, { error: 'not_found' });
    return serveFile(res, file, true);
  }
  if (req.method === 'GET' && p === '/health') return send(res, 200, { ok: true });

  const extraHeaders = isApi ? { 'access-control-allow-origin': '*' } : {};
  const cookies = parseCookies(req);
  const sessionToken = cookies[COOKIE] || '';
  const setCookies = [];
  const cookieFlags = `Path=/; HttpOnly; SameSite=Lax${isHttps(req) ? '; Secure' : ''}`;
  const ctx = {
    req, res, query: url.searchParams, sessionToken,
    setSession: (t) => setCookies.push(`${COOKIE}=${t}; ${cookieFlags}; Max-Age=${30 * 86400}`),
    clearSession: () => setCookies.push(`${COOKIE}=; ${cookieFlags}; Max-Age=0`),
  };

  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = p.match(r.re);
      if (!m) continue;
      ctx.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));

      if (r.auth === 'api') {
        const h = req.headers.authorization || '';
        const key = req.headers['x-api-key'] || (h.startsWith('Bearer ') ? h.slice(7).trim() : '');
        const apiKey = db.findApiKey(key);
        if (!apiKey) throw new HttpError(401, 'invalid_api_key', 'Missing or invalid API key (send it in the x-api-key header)');
        ctx.apiKey = apiKey;
        ctx.user = db.getUser(apiKey.user_id);
      } else if (r.auth === 'session' || r.auth === 'admin') {
        ctx.user = db.sessionUser(sessionToken);
        if (!ctx.user) throw new HttpError(401, 'not_logged_in', 'Please log in');
        if (ctx.user.status !== 'active' && ctx.user.role !== 'admin') throw new HttpError(403, 'account_suspended', 'Your account is suspended');
        if (r.auth === 'admin' && ctx.user.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admins only');
      }
      // Browsers can't add custom headers cross-site without CORS, so this blocks CSRF on cookie-authenticated writes.
      if (r.auth !== 'api' && req.method !== 'GET' && req.headers['x-app'] !== '1') {
        throw new HttpError(403, 'csrf', 'Missing x-app header');
      }

      const data = await r.handler(ctx);
      if (data === undefined) return; // handler streamed its own response
      const headers = { ...extraHeaders };
      if (setCookies.length) headers['set-cookie'] = setCookies;
      return send(res, 200, data, headers);
    }
    throw new HttpError(404, 'not_found', 'Not found');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    const status = e instanceof HttpError ? e.status : 500;
    const headers = { ...extraHeaders };
    if (setCookies.length) headers['set-cookie'] = setCookies;
    if (!res.headersSent) send(res, status, { error: e.code || 'internal_error', message: e instanceof HttpError ? e.message : 'Internal error' }, headers);
  }
});

gw.attach(server);

/** Optional: create the admin account from env vars on first start. */
async function bootstrapAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || password.length < 8) return;
  const existing = db.getUserByEmail(email);
  if (!existing) {
    db.createUser({ email, name: 'Admin', passwordHash: await hashPassword(password), role: 'admin' });
    console.log(`Admin account created: ${email}`);
  } else if (existing.role !== 'admin') {
    db.updateUser(existing.id, { role: 'admin' });
  }
}

if (require.main === module) {
  bootstrapAdmin().then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`SMS gateway running on http://${HOST}:${PORT}`);
      if (db.userCount() === 0) console.log('No accounts yet: the first account you register becomes the admin.');
    });
  });
}

module.exports = { server, bootstrapAdmin };
