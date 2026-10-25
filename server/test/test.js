'use strict';
// End-to-end test: accounts, plans, quotas, tenant isolation, billing approval, devices over WebSocket.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smsgw-test-'));
const WebSocket = require('ws');
const { server } = require('../src/server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let base;

/** A tiny browser: keeps its session cookie and sends the x-app header. */
function client() {
  let cookie = '';
  return async (method, p, body, extra = {}) => {
    const headers = { 'x-app': '1', ...extra };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined && !(body instanceof Buffer)) headers['content-type'] = 'application/json';
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, data: await r.json().catch(() => null) };
  };
}

async function api(method, p, key, body) {
  const headers = { 'x-api-key': key };
  if (body) headers['content-type'] = 'application/json';
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}

function fakeDevice(token, { reply = true } = {}) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws/device', { headers: { authorization: `Bearer ${token}` } });
  const received = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    received.push(m);
    if (m.type === 'send' && reply) {
      ws.send(JSON.stringify({ type: 'accepted', id: m.id }));
      ws.send(JSON.stringify({ type: 'status', id: m.id, status: 'sent' }));
      ws.send(JSON.stringify({ type: 'status', id: m.id, status: 'delivered' }));
    }
  });
  const opened = new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('unexpected-response', (_q, r) => rej(Object.assign(new Error('HTTP ' + r.statusCode), { code: r.statusCode })));
    ws.on('error', rej);
  });
  return { ws, received, opened };
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // --- pages ---
  for (const p of ['/', '/login', '/register', '/app', '/pair', '/assets/app.js', '/assets/i18n.js', '/assets/style.css']) {
    assert.equal((await fetch(base + p)).status, 200, `page ${p}`);
  }
  assert.equal((await fetch(base + '/assets/../src/db.js')).status, 404);

  // --- public config + seeded plans ---
  let r = await (client())('GET', '/public/config');
  assert.equal(r.data.plans.length, 4);
  assert.equal(r.data.allowSignup, true);

  // --- first user becomes admin ---
  const admin = client();
  r = await admin('POST', '/auth/register', { name: 'Ahed', email: 'Admin@Example.com', password: 'secret123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'admin');
  assert.equal(r.data.user.email, 'admin@example.com');

  // --- CSRF: writes without x-app are refused ---
  r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);

  // --- customer signs up on the free plan ---
  const alice = client();
  r = await alice('POST', '/auth/register', { name: 'Alice', email: 'alice@shop.ps', password: 'short' });
  assert.equal(r.data.error, 'weak_password');
  r = await alice('POST', '/auth/register', { name: 'Alice', email: 'alice@shop.ps', password: 'alicepass1', phone: '0599111111' });
  assert.equal(r.data.user.role, 'user');
  r = await alice('POST', '/auth/register', { name: 'Alice', email: 'ALICE@shop.ps', password: 'alicepass1' });
  assert.equal(r.status, 409);
  r = await alice('GET', '/me');
  assert.equal(r.data.account.plan.id, 'free');
  assert.equal(r.data.account.limit, 50);

  // non-admin can't reach admin routes
  assert.equal((await alice('GET', '/admin/stats')).status, 403);

  // --- login / logout ---
  const alice2 = client();
  assert.equal((await alice2('POST', '/auth/login', { email: 'alice@shop.ps', password: 'wrong' })).status, 401);
  assert.equal((await alice2('POST', '/auth/login', { email: 'alice@shop.ps', password: 'alicepass1' })).status, 200);
  assert.equal((await alice2('GET', '/me')).status, 200);
  await alice2('POST', '/auth/logout');
  assert.equal((await alice2('GET', '/me')).status, 401);

  // --- device + key ---
  r = await alice('POST', '/me/devices', { name: 'Shop phone' });
  const aDev = r.data;
  assert.match(aDev.token, /^dev_/);
  r = await alice('POST', '/me/devices', { name: 'Second' });
  assert.equal(r.status, 402);
  assert.equal(r.data.error, 'device_limit');
  r = await alice('POST', '/me/keys', { name: 'website' });
  const aKey = r.data.key;

  // --- sending: queued, then delivered when phone connects ---
  r = await api('POST', '/api/v1/sms/send', aKey, { to: '0599 000 001', message: 'طلبك جاهز' });
  assert.equal(r.status, 200);
  assert.equal(r.data.messages[0].status, 'queued');
  const firstId = r.data.messages[0].id;
  const d1 = fakeDevice(aDev.token);
  await d1.opened;
  d1.ws.send(JSON.stringify({ type: 'hello', info: { model: 'Xiaomi Test', android: 33 } }));
  await sleep(200);
  r = await api('GET', `/api/v1/sms/${firstId}`, aKey);
  assert.equal(r.data.status, 'delivered');
  r = await api('GET', '/api/v1/devices', aKey);
  assert.equal(r.data.devices[0].online, true);
  assert.equal(r.data.devices[0].info.model, 'Xiaomi Test');

  // --- tenant isolation ---
  const bob = client();
  await bob('POST', '/auth/register', { name: 'Bob', email: 'bob@x.ps', password: 'bobpass123' });
  const bKey = (await bob('POST', '/me/keys', { name: 'k' })).data.key;
  assert.equal((await api('GET', `/api/v1/sms/${firstId}`, bKey)).status, 404);
  assert.equal((await api('GET', '/api/v1/sms', bKey)).data.messages.length, 0);
  assert.equal((await bob('DELETE', `/me/devices/${aDev.id}`)).status, 404);
  assert.equal((await bob('POST', `/me/devices/${aDev.id}/token`)).status, 404);
  await sleep(100);
  assert.equal(d1.ws.readyState, WebSocket.OPEN, "another user's request must not disconnect this device");
  r = await api('POST', '/api/v1/sms/send', bKey, { to: '0599000001', message: 'x', deviceId: aDev.id });
  assert.equal(r.data.error, 'device_not_found');
  r = await api('POST', '/api/v1/sms/send', bKey, { to: '0599000001', message: 'x' });
  assert.equal(r.data.error, 'no_devices');

  // --- quota on the free plan (50/month) ---
  const many = Array.from({ length: 49 }, (_, i) => `05990${String(i).padStart(5, '0')}`);
  r = await api('POST', '/api/v1/sms/send', aKey, { to: many, message: 'bulk' });
  assert.equal(r.status, 200);
  assert.equal(r.data.messages.length, 49);
  r = await api('POST', '/api/v1/sms/send', aKey, { to: '0599999999', message: 'one too many' });
  assert.equal(r.status, 402);
  assert.equal(r.data.error, 'quota_exceeded');
  r = await api('GET', '/api/v1/account', aKey);
  assert.equal(r.data.usage, 50);

  // --- billing: request an upgrade, admin approves ---
  r = await alice('POST', '/me/billing/request', { planId: 'free', months: 1 });
  assert.equal(r.data.error, 'invalid_plan');
  r = await alice('POST', '/me/billing/request', { planId: 'pro', months: 2, reference: 'TX-123' });
  assert.equal(r.status, 200);
  assert.equal(r.data.request.amount, 24);
  assert.equal((await alice('POST', '/me/billing/request', { planId: 'basic', months: 1 })).data.error, 'request_pending');
  r = await admin('GET', '/admin/requests?status=pending');
  assert.equal(r.data.requests.length, 1);
  assert.equal(r.data.requests[0].user.email, 'alice@shop.ps');
  r = await admin('POST', `/admin/requests/${r.data.requests[0].id}/approve`, { note: 'thanks' });
  assert.equal(r.data.request.status, 'approved');
  r = await alice('GET', '/me');
  assert.equal(r.data.account.plan.id, 'pro');
  assert.ok(r.data.user.planExpiresAt > Date.now() + 59 * 86400000);
  r = await api('POST', '/api/v1/sms/send', aKey, { to: '0599999999', message: 'now allowed' });
  assert.equal(r.status, 200);
  assert.equal((await alice('POST', '/me/devices', { name: 'Second' })).status, 200);

  // --- expired paid plan falls back to free ---
  await admin('PUT', `/admin/users/${(await alice('GET', '/me')).data.user.id}`, { planExpiresAt: Date.now() - 1000 });
  r = await alice('GET', '/me');
  assert.equal(r.data.account.plan.id, 'free');
  assert.equal(r.data.account.planExpired, true);

  // --- admin activates a plan directly ---
  const aliceId = r.data.user.id;
  r = await admin('POST', `/admin/users/${aliceId}/activate`, { planId: 'business', months: 1 });
  assert.equal(r.data.user.planId, 'business');
  assert.equal((await alice('GET', '/me')).data.account.limit, null);

  // --- incoming SMS + webhook validation ---
  d1.ws.send(JSON.stringify({ type: 'incoming', from: '+970599222333', body: 'رد الزبون' }));
  await sleep(150);
  r = await api('GET', '/api/v1/sms?direction=in', aKey);
  assert.equal(r.data.messages[0].message, 'رد الزبون');
  assert.equal((await alice('PUT', '/me/profile', { webhookUrl: 'http://127.0.0.1:9/x' })).data.error, 'invalid_webhook');
  assert.equal((await alice('PUT', '/me/profile', { webhookUrl: 'https://hooks.example.com/sms' })).status, 200);

  // --- status reports from another user's device are ignored ---
  const bDev = (await bob('POST', '/me/devices', { name: 'Bob phone' })).data;
  const d2 = fakeDevice(bDev.token, { reply: false });
  await d2.opened;
  d2.ws.send(JSON.stringify({ type: 'status', id: firstId, status: 'failed', error: 'hijack' }));
  await sleep(150);
  assert.equal((await api('GET', `/api/v1/sms/${firstId}`, aKey)).data.status, 'delivered');
  d2.ws.close();

  // --- suspension kicks devices, blocks API, and blocks reconnect ---
  await admin('PUT', `/admin/users/${aliceId}`, { status: 'suspended' });
  await sleep(150);
  assert.equal(d1.ws.readyState, WebSocket.CLOSED);
  assert.equal((await api('POST', '/api/v1/sms/send', aKey, { to: '0599000001', message: 'x' })).data.error, 'account_suspended');
  await assert.rejects(fakeDevice(aDev.token).opened, (e) => e.code === 403);
  assert.equal((await alice('GET', '/me')).status, 401); // sessions were cleared
  await admin('PUT', `/admin/users/${aliceId}`, { status: 'active' });
  await fakeDevice(aDev.token).opened.then((ev) => ev);

  // admin can't suspend themselves
  const adminId = (await admin('GET', '/me')).data.user.id;
  assert.equal((await admin('PUT', `/admin/users/${adminId}`, { status: 'suspended' })).data.error, 'self_action');

  // --- password reset by admin ---
  r = await admin('POST', `/admin/users/${aliceId}/password`);
  const temp = r.data.password;
  assert.equal((await client()('POST', '/auth/login', { email: 'alice@shop.ps', password: temp })).status, 200);

  // --- plans + settings ---
  r = await admin('PUT', '/admin/plans/starter', { nameAr: 'مبتدئ', nameEn: 'Starter', price: 3, monthlyLimit: 300, maxDevices: 1, sort: 1 });
  assert.equal(r.data.plan.monthlyLimit, 300);
  r = await admin('PUT', '/admin/settings', { site_name_en: 'TextHub', allow_signup: false, contact_whatsapp: '+970599000000' });
  assert.equal(r.data.settings.allow_signup, '0');
  assert.equal((await client()('POST', '/auth/register', { name: 'Eve', email: 'eve@x.ps', password: 'evepass123' })).data.error, 'signup_disabled');
  r = await client()('GET', '/public/config');
  assert.equal(r.data.siteNameEn, 'TextHub');
  assert.equal(r.data.plans.length, 5);

  // --- APK upload / download ---
  assert.equal((await fetch(base + '/download/app.apk')).status, 404);
  assert.equal((await admin('POST', '/admin/apk', Buffer.from('not an apk'))).data.error, 'invalid_apk');
  const fakeApk = Buffer.concat([Buffer.from('PK'), Buffer.alloc(5000, 1)]);
  assert.equal((await admin('POST', '/admin/apk', fakeApk, { 'content-type': 'application/octet-stream' })).status, 200);
  const dl = await fetch(base + '/download/app.apk');
  assert.equal(dl.status, 200);
  assert.equal((await dl.arrayBuffer()).byteLength, fakeApk.length);

  // --- admin stats ---
  r = await admin('GET', '/admin/stats');
  assert.equal(r.data.stats.users, 3);
  assert.equal(r.data.stats.revenueMonth, 24);

  console.log('All tests passed ✓');
  server.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
