'use strict';
// End-to-end test: starts the server, pairs a fake device over WebSocket, sends SMS through the API.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smsgw-test-'));
const WebSocket = require('ws');
const { server, ADMIN_KEY } = require('../src/server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let base;

async function call(method, p, { key, admin, body } = {}) {
  const headers = {};
  if (key) headers['x-api-key'] = key;
  if (admin) headers['x-admin-key'] = ADMIN_KEY;
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}

function fakeDevice(token, { autoReply = true } = {}) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws/device', { headers: { authorization: `Bearer ${token}` } });
  const received = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    received.push(m);
    if (m.type === 'send' && autoReply) {
      ws.send(JSON.stringify({ type: 'accepted', id: m.id }));
      ws.send(JSON.stringify({ type: 'status', id: m.id, status: 'sent' }));
      ws.send(JSON.stringify({ type: 'status', id: m.id, status: 'delivered' }));
    }
  });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); ws.on('unexpected-response', (_q, r) => rej(new Error('HTTP ' + r.statusCode))); });
  return { ws, received, opened };
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // auth
  assert.equal((await call('GET', '/admin/overview')).status, 401);
  assert.equal((await call('GET', '/api/v1/devices', { key: 'sk_wrong' })).status, 401);

  // create key + device
  const { data: key } = await call('POST', '/admin/keys', { admin: true, body: { name: 'test' } });
  assert.match(key.key, /^sk_/);
  const { data: dev } = await call('POST', '/admin/devices', { admin: true, body: { name: 'Phone A' } });
  assert.match(dev.token, /^dev_/);

  // no device connected yet → message is queued
  let r = await call('POST', '/api/v1/sms/send', { key: key.key, body: { to: '+970 599-000-001', message: 'queued first' } });
  assert.equal(r.status, 202);
  assert.equal(r.data.deviceOnline, false);
  assert.equal(r.data.messages[0].status, 'queued');
  assert.equal(r.data.messages[0].phone, '+970599000001');
  const queuedId = r.data.messages[0].id;

  // bad token is rejected
  await assert.rejects(fakeDevice('dev_nope').opened);

  // device connects → queued message flushed and completed
  const d = fakeDevice(dev.token);
  await d.opened;
  d.ws.send(JSON.stringify({ type: 'hello', info: { model: 'Pixel Test', android: 34 } }));
  await sleep(200);
  assert.ok(d.received.some((m) => m.type === 'welcome'));
  assert.ok(d.received.some((m) => m.type === 'send' && m.id === queuedId));
  r = await call('GET', `/api/v1/sms/${queuedId}`, { key: key.key });
  assert.equal(r.data.status, 'delivered');
  assert.ok(r.data.sentAt && r.data.deliveredAt);

  // device shows online with info
  r = await call('GET', '/api/v1/devices', { key: key.key });
  assert.equal(r.data.devices[0].online, true);
  assert.equal(r.data.devices[0].info.model, 'Pixel Test');

  // bulk send while online, Arabic text, sim slot
  r = await call('POST', '/api/v1/sms/send', { key: key.key, body: { to: ['0599000002', '0599000003'], message: 'مرحبا 👋', simSlot: 1 } });
  assert.equal(r.status, 202);
  assert.equal(r.data.messages.length, 2);
  await sleep(200);
  const sends = d.received.filter((m) => m.type === 'send' && m.body === 'مرحبا 👋');
  assert.equal(sends.length, 2);
  assert.equal(sends[0].simSlot, 1);
  for (const m of r.data.messages) assert.equal((await call('GET', `/api/v1/sms/${m.id}`, { key: key.key })).data.status, 'delivered');

  // status never goes backwards
  d.ws.send(JSON.stringify({ type: 'status', id: queuedId, status: 'sent' }));
  await sleep(100);
  assert.equal((await call('GET', `/api/v1/sms/${queuedId}`, { key: key.key })).data.status, 'delivered');

  // failure is recorded with its error
  d.ws.removeAllListeners('message');
  d.ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'send') d.ws.send(JSON.stringify({ type: 'status', id: m.id, status: 'failed', error: 'RESULT_ERROR_NO_SERVICE' }));
  });
  r = await call('POST', '/api/v1/sms/send', { key: key.key, body: { to: '0599000004', message: 'will fail' } });
  await sleep(200);
  r = await call('GET', `/api/v1/sms/${r.data.messages[0].id}`, { key: key.key });
  assert.equal(r.data.status, 'failed');
  assert.equal(r.data.error, 'RESULT_ERROR_NO_SERVICE');

  // incoming sms
  d.ws.send(JSON.stringify({ type: 'incoming', from: '+970599111222', body: 'رد', timestamp: Date.now() }));
  await sleep(150);
  r = await call('GET', '/api/v1/sms?direction=in', { key: key.key });
  assert.equal(r.data.messages.length, 1);
  assert.equal(r.data.messages[0].message, 'رد');

  // validation
  assert.equal((await call('POST', '/api/v1/sms/send', { key: key.key, body: { to: 'abc', message: 'x' } })).status, 400);
  assert.equal((await call('POST', '/api/v1/sms/send', { key: key.key, body: { to: '0599000000' } })).status, 400);
  assert.equal((await call('POST', '/api/v1/sms/send', { key: key.key, body: { to: '0599000000', message: 'x', deviceId: 'nope' } })).status, 404);

  // dispatched-but-unacknowledged messages are re-sent after reconnect
  d.ws.removeAllListeners('message');
  r = await call('POST', '/api/v1/sms/send', { key: key.key, body: { to: '0599000005', message: 'retry me' } });
  const retryId = r.data.messages[0].id;
  await sleep(100);
  assert.equal((await call('GET', `/api/v1/sms/${retryId}`, { key: key.key })).data.status, 'dispatched');
  d.ws.close();
  await sleep(150);
  assert.equal((await call('GET', '/api/v1/devices', { key: key.key })).data.devices[0].online, false);
  const d2 = fakeDevice(dev.token);
  await d2.opened;
  await sleep(200);
  assert.ok(d2.received.some((m) => m.type === 'send' && m.id === retryId));
  assert.equal((await call('GET', `/api/v1/sms/${retryId}`, { key: key.key })).data.status, 'delivered');

  // token rotation kicks the old connection and invalidates the old token
  const { data: rot } = await call('POST', `/admin/devices/${dev.id}/token`, { admin: true });
  await sleep(150);
  assert.equal(d2.ws.readyState, WebSocket.CLOSED);
  await assert.rejects(fakeDevice(dev.token).opened);
  const d3 = fakeDevice(rot.token);
  await d3.opened;
  d3.ws.close();

  // deleting a key revokes it
  await call('DELETE', `/admin/keys/${key.id}`, { admin: true });
  assert.equal((await call('GET', '/api/v1/devices', { key: key.key })).status, 401);

  // dashboard + pair page are served
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/pair')).status, 200);

  console.log('All tests passed ✓');
  server.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
