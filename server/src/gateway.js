'use strict';
// Device connections: each customer's Android phone keeps a WebSocket open here.
const { WebSocketServer } = require('ws');
const db = require('./db');

/** @type {Map<string, import('ws').WebSocket>} deviceId -> socket */
const sockets = new Map();
const isOnline = (deviceId) => sockets.has(deviceId);

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

function closeDevice(deviceId, code, reason) {
  const ws = sockets.get(deviceId);
  if (ws) ws.close(code, reason);
}

function closeUserDevices(userId, code, reason) {
  for (const d of db.listDevices(userId)) closeDevice(d.id, code, reason);
}

function webhook(userId, event, data) {
  const user = db.getUser(userId);
  if (!user || !user.webhook_url) return;
  fetch(user.webhook_url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'sms-gateway-webhook/1.0' },
    body: JSON.stringify({ event, data, ts: Date.now() }),
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/ws/device') { socket.destroy(); return; }
    const device = db.findDeviceByToken(bearer(req) || url.searchParams.get('token'));
    const user = device && db.getUser(device.user_id);
    if (!device || !user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (user.status !== 'active') {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onDevice(ws, device));
  });

  const heartbeat = setInterval(() => {
    for (const ws of sockets.values()) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  server.on('close', () => clearInterval(heartbeat));
}

function onDevice(ws, device) {
  const old = sockets.get(device.id);
  if (old && old !== ws) old.close(4000, 'replaced by a new connection');
  sockets.set(device.id, ws);
  db.touchDevice(device.id);

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
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
      case 'accepted':
      case 'status': {
        const status = msg.type === 'accepted' ? 'accepted' : msg.status;
        const current = db.getMessage(String(msg.id || ''));
        if (!current || current.device_id !== device.id) break;
        const updated = db.updateStatus(current.id, status, msg.error ? String(msg.error).slice(0, 300) : null);
        if (updated && updated.status !== current.status && ['sent', 'delivered', 'failed'].includes(updated.status)) {
          webhook(device.user_id, 'sms.status', publicMessage(updated));
        }
        break;
      }
      case 'incoming': {
        const phone = String(msg.from || '').slice(0, 64);
        if (!phone) break;
        const m = db.createIncoming({
          userId: device.user_id,
          deviceId: device.id,
          phone,
          body: String(msg.body || '').slice(0, 10_000),
          simSlot: Number.isInteger(msg.simSlot) ? msg.simSlot : null,
          receivedAt: Number(msg.timestamp) || undefined,
        });
        webhook(device.user_id, 'sms.received', publicMessage(m));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (sockets.get(device.id) === ws) sockets.delete(device.id);
    db.touchDevice(device.id);
  });
  ws.on('error', () => {});
}

module.exports = { attach, dispatch, isOnline, closeDevice, closeUserDevices, publicMessage, bearer };
