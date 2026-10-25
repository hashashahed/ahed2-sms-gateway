'use strict';
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const gw = require('./gateway');
const {
  HttpError, readJson, readRaw, hashPassword, verifyPassword, rateLimit, clientIp,
  normalizePhone, isEmail, str, newSecret,
} = require('./util');

const MAX_RECIPIENTS = 100;
const MAX_BODY = 1600;
const APK_PATH = path.join(db.DATA_DIR, 'app.apk');

// ---------- shapes sent to the browser ----------
const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, status: u.status,
  planId: u.plan_id, planExpiresAt: u.plan_expires_at, webhookUrl: u.webhook_url,
  createdAt: u.created_at, lastLogin: u.last_login,
});

const publicPlan = (p) => p && ({
  id: p.id, nameAr: p.name_ar, nameEn: p.name_en, price: p.price, currency: p.currency,
  monthlyLimit: p.monthly_limit, maxDevices: p.max_devices,
  featuresAr: p.features_ar, featuresEn: p.features_en,
  isDefault: !!p.is_default, active: !!p.active, sort: p.sort,
});

const publicDevice = (d) => ({
  id: d.id, name: d.name, online: gw.isOnline(d.id), lastSeen: d.last_seen, createdAt: d.created_at, info: d.info,
});

const publicRequest = (r) => ({
  id: r.id, planId: r.plan_id, months: r.months, amount: r.amount, currency: r.currency,
  reference: r.reference, note: r.note, status: r.status, adminNote: r.admin_note,
  createdAt: r.created_at, decidedAt: r.decided_at,
  ...(r.email ? { user: { id: r.user_id, email: r.email, name: r.name, phone: r.phone } } : {}),
});

function account(user) {
  const plan = db.effectivePlan(user);
  return {
    plan: publicPlan(plan),
    planExpired: !!(user.plan_expires_at && user.plan_expires_at < db.now()),
    usage: db.monthlyUsage(user.id),
    limit: plan.monthly_limit,
    devices: db.deviceCount(user.id),
    maxDevices: plan.max_devices,
    periodStart: db.monthStart(),
  };
}

// ---------- shared send logic ----------
function sendMessages(user, body, apiKeyId) {
  if (user.status !== 'active') throw new HttpError(403, 'account_suspended', 'Your account is suspended');

  const text = typeof body.message === 'string' ? body.message : body.body;
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'message_required', '`message` is required');
  if (text.length > MAX_BODY) throw new HttpError(400, 'message_too_long', `message is longer than ${MAX_BODY} characters`);

  const raw = Array.isArray(body.to) ? body.to : [body.to];
  if (!raw.length || raw[0] === undefined || raw[0] === '') throw new HttpError(400, 'to_required', '`to` is required');
  if (raw.length > MAX_RECIPIENTS) throw new HttpError(400, 'too_many_recipients', `at most ${MAX_RECIPIENTS} recipients per request`);
  const phones = raw.map((p) => {
    const n = normalizePhone(p);
    if (!n) throw new HttpError(400, 'invalid_phone', `invalid phone number: ${p}`);
    return n;
  });

  let simSlot = null;
  if (body.simSlot !== undefined && body.simSlot !== null && body.simSlot !== '') {
    simSlot = Number(body.simSlot);
    if (![0, 1].includes(simSlot)) throw new HttpError(400, 'invalid_sim', '`simSlot` must be 0 or 1');
  }

  const plan = db.effectivePlan(user);
  if (plan.monthly_limit !== null && plan.monthly_limit !== undefined) {
    const used = db.monthlyUsage(user.id);
    if (used + phones.length > plan.monthly_limit) {
      throw new HttpError(402, 'quota_exceeded',
        `Monthly limit reached (${used}/${plan.monthly_limit}). Upgrade your plan to send more.`);
    }
  }

  let device;
  if (body.deviceId) {
    device = db.getDevice(user.id, String(body.deviceId));
    if (!device) throw new HttpError(404, 'device_not_found', 'device not found');
  } else {
    const all = db.listDevices(user.id);
    if (!all.length) throw new HttpError(400, 'no_devices', 'no devices connected to your account yet');
    device = all.find((d) => gw.isOnline(d.id)) || all[0];
  }

  const messages = phones.map((phone) => {
    const m = db.createOutgoing({ userId: user.id, deviceId: device.id, phone, body: text, simSlot, apiKeyId });
    gw.dispatch(m);
    return gw.publicMessage(db.getMessage(m.id));
  });
  return { deviceId: device.id, deviceOnline: gw.isOnline(device.id), messages };
}

function listMessagesFor(user, query) {
  return db.listMessages(user.id, {
    direction: query.get('direction') || undefined,
    deviceId: query.get('deviceId') || undefined,
    status: query.get('status') || undefined,
    limit: query.get('limit') || 50,
    before: query.get('before') || undefined,
  }).map(gw.publicMessage);
}

// Blocks webhooks pointed at the server itself or the private network.
function validWebhook(u) {
  if (!u) return '';
  let url;
  try { url = new URL(u); } catch { throw new HttpError(400, 'invalid_webhook', 'Invalid webhook URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'invalid_webhook', 'Webhook must be http(s)');
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const priv = h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1' || h === '0.0.0.0'
    || /^(127|10)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    || /^f[cd]/.test(h) || /^fe80/.test(h);
  if (priv) throw new HttpError(400, 'invalid_webhook', 'Webhook cannot point to a private address');
  return url.toString().slice(0, 500);
}

// ---------- router ----------
const routes = [];
/** auth: 'public' | 'session' | 'admin' | 'api' */
const route = (method, pattern, auth, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, auth, handler });
};

// ===== public =====
route('GET', '/public/config', 'public', async () => {
  const s = db.getSettings();
  return {
    siteNameAr: s.site_name_ar, siteNameEn: s.site_name_en,
    contactWhatsapp: s.contact_whatsapp, allowSignup: s.allow_signup === '1' || db.userCount() === 0,
    plans: db.listPlans().map(publicPlan), apkAvailable: fs.existsSync(APK_PATH),
  };
});

route('POST', '/auth/register', 'public', async ({ req, setSession }) => {
  rateLimit(`reg:${clientIp(req)}`, 10, 3_600_000);
  const b = await readJson(req);
  const firstUser = db.userCount() === 0;
  if (!firstUser && db.getSettings().allow_signup !== '1') throw new HttpError(403, 'signup_disabled', 'Sign-ups are closed');
  const name = str(b.name, 80);
  const email = str(b.email, 200).toLowerCase();
  const phone = str(b.phone, 30);
  const password = typeof b.password === 'string' ? b.password : '';
  if (name.length < 2) throw new HttpError(400, 'name_required', 'Name is required');
  if (!isEmail(email)) throw new HttpError(400, 'invalid_email', 'Invalid email');
  if (password.length < 8) throw new HttpError(400, 'weak_password', 'Password must be at least 8 characters');
  if (db.getUserByEmail(email)) throw new HttpError(409, 'email_taken', 'This email is already registered');
  const user = db.createUser({ email, name, phone, passwordHash: await hashPassword(password), role: firstUser ? 'admin' : 'user' });
  setSession(db.createSession(user.id));
  return { user: publicUser(user) };
});

route('POST', '/auth/login', 'public', async ({ req, setSession }) => {
  const b = await readJson(req);
  const email = str(b.email, 200).toLowerCase();
  rateLimit(`login:${clientIp(req)}`, 30, 900_000);
  rateLimit(`login:${email}`, 10, 900_000);
  const user = db.getUserByEmail(email);
  if (!user || !(await verifyPassword(b.password || '', user.password_hash))) {
    throw new HttpError(401, 'bad_credentials', 'Wrong email or password');
  }
  db.updateUser(user.id, { last_login: db.now() });
  setSession(db.createSession(user.id));
  return { user: publicUser(user) };
});

route('POST', '/auth/logout', 'public', async ({ sessionToken, clearSession }) => {
  if (sessionToken) db.deleteSession(sessionToken);
  clearSession();
  return { ok: true };
});

route('GET', '/download/app.apk', 'public', async ({ res }) => {
  if (!fs.existsSync(APK_PATH)) throw new HttpError(404, 'apk_missing', 'The app is not uploaded yet');
  const { size } = fs.statSync(APK_PATH);
  res.writeHead(200, {
    'content-type': 'application/vnd.android.package-archive',
    'content-length': size,
    'content-disposition': 'attachment; filename="sms-gateway.apk"',
  });
  fs.createReadStream(APK_PATH).pipe(res);
  return undefined;
});

// ===== customer dashboard (session) =====
route('GET', '/me', 'session', async ({ user }) => {
  const pending = db.pendingRequestFor(user.id);
  return {
    user: publicUser(user), account: account(user),
    pendingRequest: pending ? publicRequest(pending) : null,
    apkAvailable: fs.existsSync(APK_PATH),
  };
});

route('GET', '/me/stats', 'session', async ({ user }) => ({ last30Days: db.userStats(user.id) }));

route('GET', '/me/devices', 'session', async ({ user }) => ({ devices: db.listDevices(user.id).map(publicDevice) }));

route('POST', '/me/devices', 'session', async ({ req, user }) => {
  const b = await readJson(req);
  const plan = db.effectivePlan(user);
  if (db.deviceCount(user.id) >= plan.max_devices) {
    throw new HttpError(402, 'device_limit', `Your plan allows ${plan.max_devices} device(s). Upgrade to add more.`);
  }
  const d = db.createDevice(user.id, str(b.name, 60) || 'My phone');
  return { id: d.id, name: d.name, token: d.token };
});

route('POST', '/me/devices/:id/token', 'session', async ({ user, params }) => {
  const token = db.rotateDeviceToken(user.id, params.id);
  if (!token) throw new HttpError(404, 'device_not_found', 'device not found');
  gw.closeDevice(params.id, 4001, 'token rotated');
  return { id: params.id, token };
});

route('DELETE', '/me/devices/:id', 'session', async ({ user, params }) => {
  if (!db.deleteDevice(user.id, params.id)) throw new HttpError(404, 'device_not_found', 'device not found');
  gw.closeDevice(params.id, 4003, 'device removed');
  return { ok: true };
});

route('GET', '/me/keys', 'session', async ({ user }) => ({ keys: db.listApiKeys(user.id) }));

route('POST', '/me/keys', 'session', async ({ req, user }) => {
  const b = await readJson(req);
  if (db.listApiKeys(user.id).length >= 20) throw new HttpError(400, 'key_limit', 'At most 20 keys');
  return db.createApiKey(user.id, str(b.name, 60) || 'default');
});

route('DELETE', '/me/keys/:id', 'session', async ({ user, params }) => {
  if (!db.deleteApiKey(user.id, params.id)) throw new HttpError(404, 'key_not_found', 'key not found');
  return { ok: true };
});

route('GET', '/me/messages', 'session', async ({ user, query }) => ({ messages: listMessagesFor(user, query) }));

route('POST', '/me/send', 'session', async ({ req, user }) => {
  rateLimit(`send:${user.id}`, 120, 60_000);
  return sendMessages(user, await readJson(req), null);
});

route('PUT', '/me/profile', 'session', async ({ req, user }) => {
  const b = await readJson(req);
  const fields = {};
  if (b.name !== undefined) { fields.name = str(b.name, 80); if (fields.name.length < 2) throw new HttpError(400, 'name_required', 'Name is required'); }
  if (b.phone !== undefined) fields.phone = str(b.phone, 30);
  if (b.webhookUrl !== undefined) fields.webhook_url = validWebhook(str(b.webhookUrl, 500));
  return { user: publicUser(db.updateUser(user.id, fields)) };
});

route('POST', '/me/password', 'session', async ({ req, user, sessionToken, setSession }) => {
  const b = await readJson(req);
  if (!(await verifyPassword(b.current || '', user.password_hash))) throw new HttpError(400, 'bad_current_password', 'Current password is wrong');
  if (typeof b.next !== 'string' || b.next.length < 8) throw new HttpError(400, 'weak_password', 'Password must be at least 8 characters');
  db.updateUser(user.id, { password_hash: await hashPassword(b.next) });
  db.deleteUserSessions(user.id);
  if (sessionToken) setSession(db.createSession(user.id));
  return { ok: true };
});

route('GET', '/me/billing', 'session', async ({ user }) => {
  const s = db.getSettings();
  return {
    plans: db.listPlans().map(publicPlan),
    requests: db.userPaymentRequests(user.id).map(publicRequest),
    paymentAr: s.payment_ar, paymentEn: s.payment_en, contactWhatsapp: s.contact_whatsapp,
  };
});

route('POST', '/me/billing/request', 'session', async ({ req, user }) => {
  rateLimit(`billing:${user.id}`, 10, 3_600_000);
  const b = await readJson(req);
  const plan = db.getPlan(str(b.planId, 40));
  if (!plan || !plan.active || plan.price <= 0) throw new HttpError(400, 'invalid_plan', 'Choose a paid plan');
  const months = Math.floor(Number(b.months) || 1);
  if (months < 1 || months > 12) throw new HttpError(400, 'invalid_months', 'Months must be 1 to 12');
  if (db.pendingRequestFor(user.id)) throw new HttpError(409, 'request_pending', 'You already have a pending request');
  const r = db.createPaymentRequest({ userId: user.id, plan, months, reference: str(b.reference, 120), note: str(b.note, 500) });
  return { request: publicRequest(r) };
});

// ===== admin =====
route('GET', '/admin/stats', 'admin', async () => ({ stats: db.adminStats(), apkAvailable: fs.existsSync(APK_PATH) }));

route('GET', '/admin/users', 'admin', async ({ query }) => ({
  users: db.listUsers(query.get('q') || '').map((u) => ({
    id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, status: u.status,
    planId: u.plan_id, planExpiresAt: u.plan_expires_at, createdAt: u.created_at, lastLogin: u.last_login,
    devices: u.devices, usage: u.usage,
  })),
}));

route('PUT', '/admin/users/:id', 'admin', async ({ req, user: admin, params }) => {
  const b = await readJson(req);
  const target = db.getUser(params.id);
  if (!target) throw new HttpError(404, 'user_not_found', 'user not found');
  const fields = {};
  if (b.planId !== undefined) {
    if (!db.getPlan(b.planId)) throw new HttpError(400, 'invalid_plan', 'Unknown plan');
    fields.plan_id = b.planId;
  }
  if (b.planExpiresAt !== undefined) fields.plan_expires_at = b.planExpiresAt === null ? null : Number(b.planExpiresAt) || null;
  if (b.status !== undefined) {
    if (!['active', 'suspended'].includes(b.status)) throw new HttpError(400, 'invalid_status', 'bad status');
    if (target.id === admin.id && b.status !== 'active') throw new HttpError(400, 'self_action', 'You cannot suspend yourself');
    fields.status = b.status;
  }
  if (b.role !== undefined) {
    if (!['user', 'admin'].includes(b.role)) throw new HttpError(400, 'invalid_role', 'bad role');
    if (target.id === admin.id && b.role !== 'admin') throw new HttpError(400, 'self_action', 'You cannot remove your own admin role');
    fields.role = b.role;
  }
  const updated = db.updateUser(target.id, fields);
  if (fields.status === 'suspended') { gw.closeUserDevices(target.id, 4003, 'account suspended'); db.deleteUserSessions(target.id); }
  return { user: publicUser(updated) };
});

route('POST', '/admin/users/:id/activate', 'admin', async ({ req, params }) => {
  const b = await readJson(req);
  if (!db.getUser(params.id)) throw new HttpError(404, 'user_not_found', 'user not found');
  const plan = db.getPlan(str(b.planId, 40));
  if (!plan) throw new HttpError(400, 'invalid_plan', 'Unknown plan');
  const months = Math.floor(Number(b.months) || 1);
  if (months < 1 || months > 36) throw new HttpError(400, 'invalid_months', 'Months must be 1 to 36');
  return { user: publicUser(db.activatePlan(params.id, plan.id, months)) };
});

route('POST', '/admin/users/:id/password', 'admin', async ({ params }) => {
  if (!db.getUser(params.id)) throw new HttpError(404, 'user_not_found', 'user not found');
  const temp = newSecret('p').slice(2, 14);
  db.updateUser(params.id, { password_hash: await hashPassword(temp) });
  db.deleteUserSessions(params.id);
  return { password: temp };
});

route('GET', '/admin/requests', 'admin', async ({ query }) => ({
  requests: db.listPaymentRequests(query.get('status') || '').map(publicRequest),
}));

route('POST', '/admin/requests/:id/approve', 'admin', async ({ req, params }) => {
  const b = await readJson(req);
  const r = db.decidePaymentRequest(params.id, true, str(b.note, 300));
  if (!r) throw new HttpError(404, 'request_not_found', 'request not found or already decided');
  return { request: publicRequest(r) };
});

route('POST', '/admin/requests/:id/reject', 'admin', async ({ req, params }) => {
  const b = await readJson(req);
  const r = db.decidePaymentRequest(params.id, false, str(b.note, 300));
  if (!r) throw new HttpError(404, 'request_not_found', 'request not found or already decided');
  return { request: publicRequest(r) };
});

route('GET', '/admin/plans', 'admin', async () => ({ plans: db.listPlans(true).map(publicPlan) }));

route('PUT', '/admin/plans/:id', 'admin', async ({ req, params }) => {
  const b = await readJson(req);
  const id = params.id.toLowerCase();
  if (!/^[a-z0-9-]{2,30}$/.test(id)) throw new HttpError(400, 'invalid_plan_id', 'Plan id: 2-30 letters, numbers or dashes');
  const limit = b.monthlyLimit === null || b.monthlyLimit === '' || b.monthlyLimit === undefined ? null : Math.floor(Number(b.monthlyLimit));
  if (limit !== null && (!Number.isFinite(limit) || limit < 0)) throw new HttpError(400, 'invalid_limit', 'Invalid monthly limit');
  const price = Number(b.price);
  if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'invalid_price', 'Invalid price');
  const maxDevices = Math.floor(Number(b.maxDevices));
  if (!Number.isFinite(maxDevices) || maxDevices < 1 || maxDevices > 1000) throw new HttpError(400, 'invalid_devices', 'Invalid device limit');
  const nameAr = str(b.nameAr, 60); const nameEn = str(b.nameEn, 60);
  if (!nameAr || !nameEn) throw new HttpError(400, 'name_required', 'Both names are required');
  const p = db.upsertPlan({
    id, name_ar: nameAr, name_en: nameEn, price, currency: str(b.currency, 8).toUpperCase() || 'USD',
    monthly_limit: limit, max_devices: maxDevices,
    features_ar: str(b.featuresAr, 1000), features_en: str(b.featuresEn, 1000),
    is_default: !!b.isDefault, active: b.active !== false, sort: Math.floor(Number(b.sort) || 0),
  });
  return { plan: publicPlan(p) };
});

route('GET', '/admin/settings', 'admin', async () => ({ settings: db.getSettings() }));

route('PUT', '/admin/settings', 'admin', async ({ req }) => {
  const b = await readJson(req);
  const clean = {};
  for (const k of ['site_name_ar', 'site_name_en', 'payment_ar', 'payment_en', 'contact_whatsapp']) {
    if (b[k] !== undefined) clean[k] = str(b[k], k.startsWith('payment') ? 2000 : 120);
  }
  if (b.allow_signup !== undefined) clean.allow_signup = b.allow_signup ? '1' : '0';
  db.setSettings(clean);
  return { settings: db.getSettings() };
});

route('POST', '/admin/apk', 'admin', async ({ req }) => {
  const buf = await readRaw(req, 150 * 1024 * 1024);
  if (buf.length < 1000 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new HttpError(400, 'invalid_apk', 'That is not an APK file');
  fs.writeFileSync(APK_PATH + '.tmp', buf);
  fs.renameSync(APK_PATH + '.tmp', APK_PATH);
  return { ok: true, size: buf.length };
});

// ===== public API (x-api-key) =====
route('POST', '/api/v1/sms/send', 'api', async ({ req, user, apiKey }) => {
  rateLimit(`api:${user.id}`, 120, 60_000);
  return sendMessages(user, await readJson(req), apiKey.id);
});

route('GET', '/api/v1/sms/:id', 'api', async ({ user, params }) => {
  const m = db.getMessage(params.id);
  if (!m || m.user_id !== user.id) throw new HttpError(404, 'message_not_found', 'message not found');
  return gw.publicMessage(m);
});

route('GET', '/api/v1/sms', 'api', async ({ user, query }) => ({ messages: listMessagesFor(user, query) }));

route('GET', '/api/v1/devices', 'api', async ({ user }) => ({ devices: db.listDevices(user.id).map(publicDevice) }));

route('GET', '/api/v1/account', 'api', async ({ user }) => ({ email: user.email, ...account(user) }));

module.exports = { routes };
