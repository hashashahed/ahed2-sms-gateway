'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { newId, sha256, newSecret } = require('./util');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'saas.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE IF NOT EXISTS plans (
    id             TEXT PRIMARY KEY,
    name_ar        TEXT NOT NULL,
    name_en        TEXT NOT NULL,
    price          REAL NOT NULL DEFAULT 0,
    currency       TEXT NOT NULL DEFAULT 'USD',
    monthly_limit  INTEGER,                -- NULL = unlimited
    max_devices    INTEGER NOT NULL DEFAULT 1,
    features_ar    TEXT NOT NULL DEFAULT '',
    features_en    TEXT NOT NULL DEFAULT '',
    is_default     INTEGER NOT NULL DEFAULT 0,
    active         INTEGER NOT NULL DEFAULT 1,
    sort           INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS users (
    id               TEXT PRIMARY KEY,
    email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name             TEXT NOT NULL,
    phone            TEXT NOT NULL DEFAULT '',
    password_hash    TEXT NOT NULL,
    role             TEXT NOT NULL DEFAULT 'user',     -- user | admin
    status           TEXT NOT NULL DEFAULT 'active',   -- active | suspended
    plan_id          TEXT REFERENCES plans(id),
    plan_expires_at  INTEGER,                          -- NULL = never expires
    webhook_url      TEXT NOT NULL DEFAULT '',
    created_at       INTEGER NOT NULL,
    last_login       INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    info        TEXT,
    created_at  INTEGER NOT NULL,
    last_seen   INTEGER
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,
    prefix      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    last_used   INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    direction     TEXT NOT NULL,             -- out | in
    device_id     TEXT REFERENCES devices(id) ON DELETE SET NULL,
    phone         TEXT NOT NULL,
    body          TEXT NOT NULL,
    status        TEXT NOT NULL,             -- out: queued|dispatched|accepted|sent|delivered|failed ; in: received
    error         TEXT,
    sim_slot      INTEGER,
    api_key_id    TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    sent_at       INTEGER,
    delivered_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_msg_user_created ON messages(user_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_msg_device_status ON messages(device_id, status);

  CREATE TABLE IF NOT EXISTS payment_requests (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id     TEXT NOT NULL REFERENCES plans(id),
    months      INTEGER NOT NULL,
    amount      REAL NOT NULL,
    currency    TEXT NOT NULL,
    reference   TEXT NOT NULL DEFAULT '',
    note        TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
    admin_note  TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    decided_at  INTEGER
  );
`);

const now = () => Date.now();
const DAY = 86_400_000;

// ---------- seed default plans ----------
if (!db.prepare('SELECT COUNT(*) AS n FROM plans').get().n) {
  const ins = db.prepare(`INSERT INTO plans(id, name_ar, name_en, price, currency, monthly_limit, max_devices, features_ar, features_en, is_default, sort)
                          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run('free', 'مجانية', 'Free', 0, 'USD', 50, 1, 'جهاز واحد\nللتجربة', '1 device\nFor testing', 1, 0);
  ins.run('basic', 'أساسية', 'Basic', 5, 'USD', 1000, 1, 'جهاز واحد\nWebhooks\nدعم عبر واتساب', '1 device\nWebhooks\nWhatsApp support', 0, 1);
  ins.run('pro', 'احترافية', 'Pro', 12, 'USD', 5000, 3, '3 أجهزة\nWebhooks\nأولوية بالدعم', '3 devices\nWebhooks\nPriority support', 0, 2);
  ins.run('business', 'أعمال', 'Business', 25, 'USD', null, 10, '10 أجهزة\nرسائل بلا حد\nدعم مباشر', '10 devices\nUnlimited messages\nDirect support', 0, 3);
}

// ---------- settings ----------
const DEFAULT_SETTINGS = {
  site_name_ar: 'بوابة الرسائل',
  site_name_en: 'SMS Gateway',
  payment_ar: 'حوّل المبلغ على المحفظة أو الحساب البنكي، واكتب رقم العملية بالطلب. بنفعّل الباقة خلال ساعات.',
  payment_en: 'Transfer the amount to our wallet or bank account and enter the transaction reference in your request. We activate plans within hours.',
  contact_whatsapp: '',
  allow_signup: '1',
};
function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}
function setSettings(obj) {
  const st = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(obj)) if (k in DEFAULT_SETTINGS) st.run(k, String(v ?? ''));
}

// ---------- plans ----------
const listPlans = (all = false) =>
  db.prepare(`SELECT * FROM plans ${all ? '' : 'WHERE active = 1'} ORDER BY sort, price`).all();
const getPlan = (id) => db.prepare('SELECT * FROM plans WHERE id = ?').get(id) || null;
const defaultPlan = () =>
  db.prepare('SELECT * FROM plans WHERE is_default = 1 ORDER BY sort LIMIT 1').get()
  || db.prepare('SELECT * FROM plans ORDER BY price, sort LIMIT 1').get();

function upsertPlan(p) {
  const exists = getPlan(p.id);
  if (p.is_default) db.prepare('UPDATE plans SET is_default = 0').run();
  if (exists) {
    db.prepare(`UPDATE plans SET name_ar=?, name_en=?, price=?, currency=?, monthly_limit=?, max_devices=?,
                features_ar=?, features_en=?, is_default=?, active=?, sort=? WHERE id=?`)
      .run(p.name_ar, p.name_en, p.price, p.currency, p.monthly_limit, p.max_devices,
           p.features_ar, p.features_en, p.is_default ? 1 : 0, p.active ? 1 : 0, p.sort, p.id);
  } else {
    db.prepare(`INSERT INTO plans(id, name_ar, name_en, price, currency, monthly_limit, max_devices, features_ar, features_en, is_default, active, sort)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(p.id, p.name_ar, p.name_en, p.price, p.currency, p.monthly_limit, p.max_devices,
           p.features_ar, p.features_en, p.is_default ? 1 : 0, p.active ? 1 : 0, p.sort);
  }
  return getPlan(p.id);
}

// ---------- users ----------
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
const getUserByEmail = (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim()) || null;
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

function createUser({ email, name, phone, passwordHash, role }) {
  const id = newId(12);
  db.prepare(`INSERT INTO users(id, email, name, phone, password_hash, role, plan_id, created_at)
              VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, email.trim().toLowerCase(), name, phone || '', passwordHash, role || 'user', defaultPlan().id, now());
  return getUser(id);
}

function updateUser(id, fields) {
  const allowed = ['name', 'phone', 'password_hash', 'role', 'status', 'plan_id', 'plan_expires_at', 'webhook_url', 'last_login'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (!keys.length) return getUser(id);
  db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => fields[k] ?? null), id);
  return getUser(id);
}

/** The plan a user is on right now: paid plans fall back to the default plan once they expire. */
function effectivePlan(user) {
  if (user.plan_expires_at && user.plan_expires_at < now()) return defaultPlan();
  return getPlan(user.plan_id) || defaultPlan();
}

const monthStart = (t = now()) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

/** Messages that count against the monthly limit: every outgoing message except failed ones. */
function monthlyUsage(userId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE user_id = ? AND direction = 'out'
                     AND status != 'failed' AND created_at >= ?`).get(userId, monthStart()).n;
}

function listUsers(q) {
  const like = `%${q || ''}%`;
  return db.prepare(`
    SELECT u.id, u.email, u.name, u.phone, u.role, u.status, u.plan_id, u.plan_expires_at, u.created_at, u.last_login,
      (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS devices,
      (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id AND m.direction = 'out' AND m.status != 'failed' AND m.created_at >= ?) AS usage
    FROM users u WHERE u.email LIKE ? OR u.name LIKE ? OR u.phone LIKE ?
    ORDER BY u.created_at DESC LIMIT 500`).all(monthStart(), like, like, like);
}

// ---------- sessions ----------
const SESSION_DAYS = 30;
function createSession(userId) {
  const token = newSecret('s');
  db.prepare('INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES(?, ?, ?, ?)')
    .run(sha256(token), userId, now(), now() + SESSION_DAYS * DAY);
  return token;
}
function sessionUser(token) {
  if (!token) return null;
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!row || row.expires_at < now()) return null;
  return getUser(row.user_id);
}
const deleteSession = (token) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
const deleteUserSessions = (userId) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()), 3_600_000).unref();

// ---------- devices ----------
function createDevice(userId, name) {
  const id = newId(10);
  const token = newSecret('dev');
  db.prepare('INSERT INTO devices(id, user_id, name, token_hash, created_at) VALUES(?, ?, ?, ?, ?)')
    .run(id, userId, name, sha256(token), now());
  return { id, name, token };
}
function rotateDeviceToken(userId, id) {
  const token = newSecret('dev');
  const r = db.prepare('UPDATE devices SET token_hash = ? WHERE id = ? AND user_id = ?').run(sha256(token), id, userId);
  return r.changes ? token : null;
}
const findDeviceByToken = (token) =>
  token ? db.prepare('SELECT * FROM devices WHERE token_hash = ?').get(sha256(token)) || null : null;
const getDevice = (userId, id) => db.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').get(id, userId) || null;
const listDevices = (userId) =>
  db.prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY created_at').all(userId)
    .map((d) => ({ ...d, info: d.info ? JSON.parse(d.info) : null }));
const deviceCount = (userId) => db.prepare('SELECT COUNT(*) AS n FROM devices WHERE user_id = ?').get(userId).n;
function touchDevice(id, info) {
  if (info !== undefined) db.prepare('UPDATE devices SET last_seen = ?, info = ? WHERE id = ?').run(now(), JSON.stringify(info), id);
  else db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(now(), id);
}
const deleteDevice = (userId, id) => db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;

// ---------- api keys ----------
function createApiKey(userId, name) {
  const id = newId(10);
  const key = newSecret('sk');
  db.prepare('INSERT INTO api_keys(id, user_id, name, key_hash, prefix, created_at) VALUES(?, ?, ?, ?, ?, ?)')
    .run(id, userId, name, sha256(key), key.slice(0, 8), now());
  return { id, name, key };
}
function findApiKey(key) {
  if (!key) return null;
  const row = db.prepare('SELECT id, user_id, name FROM api_keys WHERE key_hash = ?').get(sha256(key));
  if (row) db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(now(), row.id);
  return row || null;
}
const listApiKeys = (userId) =>
  db.prepare('SELECT id, name, prefix, created_at, last_used FROM api_keys WHERE user_id = ? ORDER BY created_at').all(userId);
const deleteApiKey = (userId, id) => db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;

// ---------- messages ----------
const getMessage = (id) => db.prepare('SELECT * FROM messages WHERE id = ?').get(id) || null;

function createOutgoing({ userId, deviceId, phone, body, simSlot, apiKeyId }) {
  const id = newId(16);
  const t = now();
  db.prepare(`INSERT INTO messages(id, user_id, direction, device_id, phone, body, status, sim_slot, api_key_id, created_at, updated_at)
              VALUES(?, ?, 'out', ?, ?, ?, 'queued', ?, ?, ?, ?)`)
    .run(id, userId, deviceId, phone, body, simSlot ?? null, apiKeyId ?? null, t, t);
  return getMessage(id);
}
function createIncoming({ userId, deviceId, phone, body, simSlot, receivedAt }) {
  const id = newId(16);
  db.prepare(`INSERT INTO messages(id, user_id, direction, device_id, phone, body, status, sim_slot, created_at, updated_at)
              VALUES(?, ?, 'in', ?, ?, ?, 'received', ?, ?, ?)`)
    .run(id, userId, deviceId, phone, body, simSlot ?? null, receivedAt || now(), now());
  return getMessage(id);
}
const pendingForDevice = (deviceId) =>
  db.prepare(`SELECT * FROM messages WHERE direction = 'out' AND device_id = ? AND status IN ('queued', 'dispatched')
              ORDER BY created_at`).all(deviceId);

// Status only moves forward, so late or duplicate reports never downgrade a message.
const RANK = { queued: 0, dispatched: 1, accepted: 2, sent: 3, failed: 3, delivered: 4 };
function updateStatus(id, status, error) {
  const msg = getMessage(id);
  if (!msg || msg.direction !== 'out' || RANK[status] === undefined) return null;
  if (RANK[status] < RANK[msg.status]) return msg;
  if (msg.status === 'failed' && status !== 'delivered') return msg;
  if (msg.status === status) return msg;
  const t = now();
  db.prepare(`UPDATE messages SET status = ?, error = ?, updated_at = ?,
              sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END,
              delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END WHERE id = ?`)
    .run(status, error || null, t, status, t, status, t, id);
  return getMessage(id);
}

function listMessages(userId, { direction, deviceId, status, limit = 50, before }) {
  const where = ['user_id = ?'];
  const args = [userId];
  if (direction) { where.push('direction = ?'); args.push(direction); }
  if (deviceId) { where.push('device_id = ?'); args.push(deviceId); }
  if (status) { where.push('status = ?'); args.push(status); }
  if (before) { where.push('created_at < ?'); args.push(Number(before)); }
  args.push(Math.min(Math.max(Number(limit) || 50, 1), 500));
  return db.prepare(`SELECT * FROM messages WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).all(...args);
}

function userStats(userId) {
  const since = now() - 30 * DAY;
  return db.prepare(`SELECT status, COUNT(*) AS n FROM messages WHERE user_id = ? AND direction = 'out' AND created_at >= ?
                     GROUP BY status`).all(userId, since);
}

// ---------- payment requests ----------
function createPaymentRequest({ userId, plan, months, reference, note }) {
  const id = newId(12);
  db.prepare(`INSERT INTO payment_requests(id, user_id, plan_id, months, amount, currency, reference, note, created_at)
              VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, plan.id, months, Math.round(plan.price * months * 100) / 100, plan.currency, reference, note, now());
  return db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(id);
}
const getPaymentRequest = (id) => db.prepare('SELECT * FROM payment_requests WHERE id = ?').get(id) || null;
const userPaymentRequests = (userId) =>
  db.prepare('SELECT * FROM payment_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
const listPaymentRequests = (status) =>
  db.prepare(`SELECT r.*, u.email, u.name, u.phone FROM payment_requests r JOIN users u ON u.id = r.user_id
              ${status ? 'WHERE r.status = ?' : ''} ORDER BY r.created_at DESC LIMIT 300`).all(...(status ? [status] : []));
const pendingRequestFor = (userId) =>
  db.prepare(`SELECT * FROM payment_requests WHERE user_id = ? AND status = 'pending'`).get(userId) || null;

/** Activates a plan: extends the current expiry when renewing the same plan, otherwise starts from now. */
function activatePlan(userId, planId, months) {
  const u = getUser(userId);
  const base = u.plan_id === planId && u.plan_expires_at && u.plan_expires_at > now() ? u.plan_expires_at : now();
  return updateUser(userId, { plan_id: planId, plan_expires_at: base + months * 30 * DAY });
}

function decidePaymentRequest(id, approve, adminNote) {
  const r = getPaymentRequest(id);
  if (!r || r.status !== 'pending') return null;
  db.prepare('UPDATE payment_requests SET status = ?, admin_note = ?, decided_at = ? WHERE id = ?')
    .run(approve ? 'approved' : 'rejected', adminNote || '', now(), id);
  if (approve) activatePlan(r.user_id, r.plan_id, r.months);
  return getPaymentRequest(id);
}

// ---------- admin stats ----------
function adminStats() {
  const ms = monthStart();
  const today = now() - DAY;
  const one = (sql, ...a) => db.prepare(sql).get(...a).n;
  return {
    users: one('SELECT COUNT(*) AS n FROM users'),
    paidUsers: one('SELECT COUNT(*) AS n FROM users u JOIN plans p ON p.id = u.plan_id WHERE p.price > 0 AND (u.plan_expires_at IS NULL OR u.plan_expires_at > ?)', now()),
    devices: one('SELECT COUNT(*) AS n FROM devices'),
    messagesMonth: one(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'out' AND created_at >= ?`, ms),
    messages24h: one(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'out' AND created_at >= ?`, today),
    pendingRequests: one(`SELECT COUNT(*) AS n FROM payment_requests WHERE status = 'pending'`),
    revenueMonth: db.prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM payment_requests WHERE status = 'approved' AND decided_at >= ?`).get(ms).n,
  };
}

module.exports = {
  DATA_DIR, DAY, now, monthStart,
  getSettings, setSettings,
  listPlans, getPlan, defaultPlan, upsertPlan,
  getUser, getUserByEmail, userCount, createUser, updateUser, effectivePlan, monthlyUsage, listUsers,
  createSession, sessionUser, deleteSession, deleteUserSessions,
  createDevice, rotateDeviceToken, findDeviceByToken, getDevice, listDevices, deviceCount, touchDevice, deleteDevice,
  createApiKey, findApiKey, listApiKeys, deleteApiKey,
  getMessage, createOutgoing, createIncoming, pendingForDevice, updateStatus, listMessages, userStats,
  createPaymentRequest, getPaymentRequest, userPaymentRequests, listPaymentRequests, pendingRequestFor,
  activatePlan, decidePaymentRequest, adminStats,
};
