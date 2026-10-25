'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const db = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const MAX_RECIPIENTS = 100;
const MAX_BODY = 1600;

// ---------- admin key (dashboard login) ----------
let ADMIN_KEY = process.env.ADMIN_KEY || db.getSetting('admin_key');
if (!ADMIN_KEY) {
  ADMIN_KEY = db.newSecret('admin');
  db.setSetting('admin_key', ADMIN_KEY);
}

// ---------- connected devices ----------
/** @type {Map<string, import('ws').WebSocket>} */
const sockets = new Map();
const isOnline = (id) => sockets.has(id);

function dispatch(msg) {
  const ws = sockets.get(msg.device_id);
  if (!ws || ws.readyState !== ws.OPEN) return false;
  ws.send(JSON.stringify({ type: 'send', id: msg.id, to: msg.phone, body: msg.body, simSlot: msg.sim_slot }));
  if (msg.status === 'queued') db.updateStatus(msg.id, 'dispatched');
  return true;
}

function flushPending(deviceId) {
  for (const msg of db.pendingForDevice(deviceId)) dispatch(msg);
}

// ---------- webhook ----------
function webhook(event, data) {
  if (!WEBHOOK_URL) return;
  fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event, data, ts: Date.now() }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => console.warn(`[webhook] ${event} failed: ${e.message}`));
}

// ---------- helpers ----------
const publicMessage = (m) => m && ({
  id: m.id,
  direction: m.direction,
  deviceId: m.device_id,
  phone: m.phone,
  message: m.body,
  status: m.status,
  error: m.error,
  simSlot: m.sim_slot,
  createdAt: m.created_at,
  sentAt: m.sent_at,
  deliveredAt: m.delivered_at,
});

const publicDevice = (d) => ({
  id: d.id,
  name: d.name,
  online: isOnline(d.id),
  lastSeen: d.last_seen,
  createdAt: d.created_at,
  info: d.info,
});

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  });
  res.end(body);
}

function readJson(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const isAdmin = (req) => {
  const k = req.headers['x-admin-key'] || bearer(req);
  return !!k && safeEqual(k, ADMIN_KEY);
};

/** Returns { admin: true } or { apiKey } or null */
function authApi(req) {
  if (isAdmin(req)) return { admin: true };
  const key = req.headers['x-api-key'] || bearer(req);
  const apiKey = db.findApiKey(key);
  return apiKey ? { apiKey } : null;
}

function normalizePhone(p) {
  if (typeof p !== 'string' && typeof p !== 'number') return null;
  const s = String(p).replace(/[\s\-().]/g, '');
  return /^\+?[0-9]{3,15}$/.test(s) ? s : null;
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler });
};

// Public API (x-api-key)
route('POST', '/api/v1/sms/send', async (req, res, { auth }) => {
  const body = await readJson(req);
  const text = typeof body.message === 'string' ? body.message : body.body;
  if (typeof text !== 'string' || !text.trim()) return send(res, 400, { error: '`message` is required' });
  if (text.length > MAX_BODY) return send(res, 400, { error: `message is longer than ${MAX_BODY} characters` });

  const raw = Array.isArray(body.to) ? body.to : [body.to];
  if (!raw.length || raw[0] === undefined) return send(res, 400, { error: '`to` is required (phone number or array of numbers)' });
  if (raw.length > MAX_RECIPIENTS) return send(res, 400, { error: `at most ${MAX_RECIPIENTS} recipients per request` });
  const phones = [];
  for (const p of raw) {
    const n = normalizePhone(p);
    if (!n) return send(res, 400, { error: `invalid phone number: ${p}` });
    phones.push(n);
  }

  let simSlot = null;
  if (body.simSlot !== undefined && body.simSlot !== null) {
    simSlot = Number(body.simSlot);
    if (![0, 1, 2].includes(simSlot)) return send(res, 400, { error: '`simSlot` must be 0 or 1' });
  }

  let device;
  if (body.deviceId) {
    device = db.getDevice(String(body.deviceId));
    if (!device) return send(res, 404, { error: 'device not found' });
  } else {
    const all = db.listDevices();
    if (!all.length) return send(res, 400, { error: 'no devices registered yet' });
    device = all.find((d) => isOnline(d.id)) || all[0];
  }

  const created = phones.map((phone) => {
    const m = db.createOutgoing({ deviceId: device.id, phone, body: text, simSlot, apiKeyId: auth.apiKey?.id });
    dispatch(m);
    return publicMessage(db.getMessage(m.id));
  });

  send(res, 202, { deviceId: device.id, deviceOnline: isOnline(device.id), messages: created });
});

route('GET', '/api/v1/sms/:id', async (req, res, { params }) => {
  const m = db.getMessage(params.id);
  if (!m) return send(res, 404, { error: 'message not found' });
  send(res, 200, publicMessage(m));
});

route('GET', '/api/v1/sms', async (req, res, { query }) => {
  const list = db.listMessages({
    direction: query.get('direction') || undefined,
    deviceId: query.get('deviceId') || undefined,
    status: query.get('status') || undefined,
    limit: query.get('limit') || 50,
    before: query.get('before') || undefined,
  });
  send(res, 200, { messages: list.map(publicMessage) });
});

route('GET', '/api/v1/devices', async (req, res) => {
  send(res, 200, { devices: db.listDevices().map(publicDevice) });
});

// Admin (x-admin-key)
route('GET', '/admin/overview', async (req, res) => {
  send(res, 200, {
    devices: db.listDevices().map(publicDevice),
    apiKeys: db.listApiKeys(),
    stats: db.stats(),
    webhook: !!WEBHOOK_URL,
  });
});

route('POST', '/admin/devices', async (req, res) => {
  const body = await readJson(req);
  const name = String(body.name || 'My phone').slice(0, 60);
  const d = db.createDevice(name);
  send(res, 201, { id: d.id, name: d.name, token: d.token });
});

route('POST', '/admin/devices/:id/token', async (req, res, { params }) => {
  const token = db.rotateDeviceToken(params.id);
  if (!token) return send(res, 404, { error: 'device not found' });
  const ws = sockets.get(params.id);
  if (ws) ws.close(4001, 'token rotated');
  send(res, 200, { id: params.id, token });
});

route('DELETE', '/admin/devices/:id', async (req, res, { params }) => {
  const ws = sockets.get(params.id);
  if (ws) ws.close(4003, 'device removed');
  if (!db.deleteDevice(params.id)) return send(res, 404, { error: 'device not found' });
  send(res, 200, { ok: true });
});

route('POST', '/admin/keys', async (req, res) => {
  const body = await readJson(req);
  const k = db.createApiKey(String(body.name || 'default').slice(0, 60));
  send(res, 201, k);
});

route('DELETE', '/admin/keys/:id', async (req, res, { params }) => {
  if (!db.deleteApiKey(params.id)) return send(res, 404, { error: 'key not found' });
  send(res, 200, { ok: true });
});

// ---------- http server ----------
const DASHBOARD = path.join(__dirname, '..', 'public', 'index.html');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,x-api-key,x-admin-key,authorization',
      'access-control-max-age': '86400',
    });
    return res.end();
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    return fs.createReadStream(DASHBOARD).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/pair') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    return fs.createReadStream(path.join(__dirname, '..', 'public', 'pair.html')).pipe(res);
  }
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = url.pathname.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));

    let auth = null;
    if (url.pathname.startsWith('/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'invalid admin key' });
      auth = { admin: true };
    } else {
      auth = authApi(req);
      if (!auth) return send(res, 401, { error: 'missing or invalid API key (send it in the x-api-key header)' });
    }

    try {
      return await r.handler(req, res, { params, query: url.searchParams, auth });
    } catch (e) {
      console.error(e);
      return send(res, e.status || 500, { error: e.status ? e.message : 'internal error' });
    }
  }

  send(res, 404, { error: 'not found' });
});

// ---------- device websocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/ws/device') { socket.destroy(); return; }
  const token = bearer(req) || url.searchParams.get('token');
  const device = db.findDeviceByToken(token);
  if (!device) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => onDevice(ws, device));
});

function onDevice(ws, device) {
  const old = sockets.get(device.id);
  if (old && old !== ws) old.close(4000, 'replaced by a new connection');
  sockets.set(device.id, ws);
  db.touchDevice(device.id);
  console.log(`[device] ${device.name} (${device.id}) connected`);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.send(JSON.stringify({ type: 'welcome', deviceId: device.id, name: device.name }));
  flushPending(device.id);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    ws.isAlive = true;
    db.touchDevice(device.id, msg.type === 'hello' ? (msg.info || null) : undefined);

    switch (msg.type) {
      case 'hello':
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'accepted':
      case 'status': {
        const status = msg.type === 'accepted' ? 'accepted' : msg.status;
        const current = db.getMessage(msg.id);
        if (!current || current.device_id !== device.id) break;
        const updated = db.updateStatus(msg.id, status, msg.error);
        if (updated && updated.status !== current.status && ['sent', 'delivered', 'failed'].includes(updated.status)) {
          webhook('sms.status', publicMessage(updated));
        }
        break;
      }
      case 'incoming': {
        const phone = String(msg.from || '').slice(0, 64);
        const body = String(msg.body || '').slice(0, 10_000);
        if (!phone) break;
        const m = db.createIncoming({
          deviceId: device.id, phone, body,
          simSlot: Number.isInteger(msg.simSlot) ? msg.simSlot : null,
          receivedAt: Number(msg.timestamp) || undefined,
        });
        webhook('sms.received', publicMessage(m));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (sockets.get(device.id) === ws) sockets.delete(device.id);
    db.touchDevice(device.id);
    console.log(`[device] ${device.name} (${device.id}) disconnected`);
  });
  ws.on('error', () => {});
}

// Drop dead connections so the device shows offline and messages wait for reconnect.
const heartbeat = setInterval(() => {
  for (const ws of sockets.values()) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
server.on('close', () => clearInterval(heartbeat));

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`SMS gateway listening on http://${HOST}:${PORT}`);
    console.log(`Dashboard admin key: ${ADMIN_KEY}`);
    if (!process.env.ADMIN_KEY) console.log('(set ADMIN_KEY env var to choose your own)');
  });
}

module.exports = { server, ADMIN_KEY };
