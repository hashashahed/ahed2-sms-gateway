'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'gateway.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    info        TEXT,
    created_at  INTEGER NOT NULL,
    last_seen   INTEGER
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,
    prefix      TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    last_used   INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    direction     TEXT NOT NULL,             -- 'out' | 'in'
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

  CREATE INDEX IF NOT EXISTS idx_messages_device_status ON messages(device_id, status);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
`);

const now = () => Date.now();
const newId = (len = 16) => crypto.randomBytes(len).toString('base64url').slice(0, len);
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newSecret = (prefix) => `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;

// ---------- settings ----------
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// ---------- devices ----------
function createDevice(name) {
  const id = newId(10);
  const token = newSecret('dev');
  db.prepare('INSERT INTO devices(id, name, token_hash, created_at) VALUES(?, ?, ?, ?)')
    .run(id, name, sha256(token), now());
  return { id, name, token };
}
function rotateDeviceToken(id) {
  const token = newSecret('dev');
  const r = db.prepare('UPDATE devices SET token_hash = ? WHERE id = ?').run(sha256(token), id);
  return r.changes ? token : null;
}
function findDeviceByToken(token) {
  if (!token) return null;
  return db.prepare('SELECT * FROM devices WHERE token_hash = ?').get(sha256(token)) || null;
}
function getDevice(id) {
  return db.prepare('SELECT * FROM devices WHERE id = ?').get(id) || null;
}
function listDevices() {
  return db.prepare('SELECT id, name, info, created_at, last_seen FROM devices ORDER BY created_at').all()
    .map((d) => ({ ...d, info: d.info ? JSON.parse(d.info) : null }));
}
function touchDevice(id, info) {
  if (info !== undefined) {
    db.prepare('UPDATE devices SET last_seen = ?, info = ? WHERE id = ?').run(now(), JSON.stringify(info), id);
  } else {
    db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(now(), id);
  }
}
function deleteDevice(id) {
  return db.prepare('DELETE FROM devices WHERE id = ?').run(id).changes > 0;
}

// ---------- api keys ----------
function createApiKey(name) {
  const id = newId(10);
  const key = newSecret('sk');
  db.prepare('INSERT INTO api_keys(id, name, key_hash, prefix, created_at) VALUES(?, ?, ?, ?, ?)')
    .run(id, name, sha256(key), key.slice(0, 7), now());
  return { id, name, key };
}
function findApiKey(key) {
  if (!key) return null;
  const row = db.prepare('SELECT id, name FROM api_keys WHERE key_hash = ?').get(sha256(key));
  if (row) db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(now(), row.id);
  return row || null;
}
function listApiKeys() {
  return db.prepare('SELECT id, name, prefix, created_at, last_used FROM api_keys ORDER BY created_at').all();
}
function deleteApiKey(id) {
  return db.prepare('DELETE FROM api_keys WHERE id = ?').run(id).changes > 0;
}

// ---------- messages ----------
function createOutgoing({ deviceId, phone, body, simSlot, apiKeyId }) {
  const id = newId(16);
  const t = now();
  db.prepare(`INSERT INTO messages(id, direction, device_id, phone, body, status, sim_slot, api_key_id, created_at, updated_at)
              VALUES(?, 'out', ?, ?, ?, 'queued', ?, ?, ?, ?)`)
    .run(id, deviceId, phone, body, simSlot ?? null, apiKeyId ?? null, t, t);
  return getMessage(id);
}
function createIncoming({ deviceId, phone, body, simSlot, receivedAt }) {
  const id = newId(16);
  const t = receivedAt || now();
  db.prepare(`INSERT INTO messages(id, direction, device_id, phone, body, status, sim_slot, created_at, updated_at)
              VALUES(?, 'in', ?, ?, ?, 'received', ?, ?, ?)`)
    .run(id, deviceId, phone, body, simSlot ?? null, t, now());
  return getMessage(id);
}
function getMessage(id) {
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) || null;
}
function pendingForDevice(deviceId) {
  return db.prepare(`SELECT * FROM messages WHERE direction = 'out' AND device_id = ?
                     AND status IN ('queued', 'dispatched') ORDER BY created_at`).all(deviceId);
}

// Status can only move forward, so late or duplicate reports never downgrade a message.
const RANK = { queued: 0, dispatched: 1, accepted: 2, sent: 3, failed: 3, delivered: 4 };
function updateStatus(id, status, error) {
  const msg = getMessage(id);
  if (!msg || msg.direction !== 'out') return null;
  if (RANK[status] === undefined) return null;
  if (RANK[status] < RANK[msg.status]) return msg;
  if (msg.status === 'failed' && status !== 'delivered') return msg;
  if (msg.status === status) return msg;
  const t = now();
  db.prepare(`UPDATE messages SET status = ?, error = ?, updated_at = ?,
              sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END,
              delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END
              WHERE id = ?`)
    .run(status, error || null, t, status, t, status, t, id);
  return getMessage(id);
}
function listMessages({ direction, deviceId, status, limit = 50, before }) {
  const where = [];
  const args = [];
  if (direction) { where.push('direction = ?'); args.push(direction); }
  if (deviceId) { where.push('device_id = ?'); args.push(deviceId); }
  if (status) { where.push('status = ?'); args.push(status); }
  if (before) { where.push('created_at < ?'); args.push(Number(before)); }
  const sql = `SELECT * FROM messages ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(Math.max(Number(limit) || 50, 1), 500));
  return db.prepare(sql).all(...args);
}
function stats() {
  const rows = db.prepare(`SELECT direction, status, COUNT(*) AS n FROM messages GROUP BY direction, status`).all();
  return rows;
}

module.exports = {
  DATA_DIR, newSecret, sha256,
  getSetting, setSetting,
  createDevice, rotateDeviceToken, findDeviceByToken, getDevice, listDevices, touchDevice, deleteDevice,
  createApiKey, findApiKey, listApiKeys, deleteApiKey,
  createOutgoing, createIncoming, getMessage, pendingForDevice, updateStatus, listMessages, stats,
};
