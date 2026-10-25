/* Customer dashboard + admin panel. */
(function () {
  const { t, esc, api, toast, setLang, getLang, fmtDate, fmtNum, fmtMoney, LOGO } = SG;
  const $ = (s, r = document) => r.querySelector(s);
  const main = $('#main');
  $('#logo').innerHTML = LOGO;

  let me = null;          // /me response
  let config = null;      // /public/config
  let view = 'overview';
  let timer = null;
  let flash = {};         // one-time secrets to keep showing across auto-refresh (pair token, new key)
  let adminPlans = null;

  // ---------- small UI helpers ----------
  const ICON = {
    overview: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z"/>',
    devices: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17h2"/>',
    keys: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l2 2"/>',
    messages: '<path d="M4 5h16v11H9l-5 4z"/>',
    send: '<path d="M4 12l16-8-6 16-2-7z"/>',
    billing: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>',
    docs: '<path d="M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    'a-overview': '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    'a-users': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    'a-requests': '<path d="M12 3v18M17 7.5C17 5.6 14.8 4.5 12 4.5S7 5.6 7 7.5s2.2 3 5 3.5 5 1.6 5 3.5-2.2 3-5 3-5-1.1-5-3"/>',
    'a-plans': '<path d="M4 6h16M4 12h16M4 18h10"/>',
    'a-settings': '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  };
  const NAV = ['overview', 'devices', 'keys', 'messages', 'send', 'billing', 'docs', 'settings'];
  const ADMIN_NAV = ['a-overview', 'a-users', 'a-requests', 'a-plans', 'a-settings'];
  const label = (v) => t(v.startsWith('a-') ? `tab.a.${v.slice(2)}` : `tab.${v}`);
  const icon = (v) => `<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[v]}</svg>`;

  const pillFor = (s) => {
    const cls = ['sent', 'delivered', 'received'].includes(s) ? 'ok' : s === 'failed' ? 'bad' : 'warn';
    return `<span class="pill ${cls}">${esc(t('st.' + s))}</span>`;
  };
  const planName = (p) => p ? (getLang() === 'ar' ? p.nameAr : p.nameEn) : '—';

  function modal(title, bodyHtml, { confirm = t('a.confirm'), danger = false, cancel = true } = {}) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = `<form class="modal" role="dialog" aria-modal="true" novalidate>
        <h3>${esc(title)}</h3>${bodyHtml}
        <div class="actions">
          ${cancel ? `<button type="button" class="btn ghost" data-x>${esc(t('cancel'))}</button>` : ''}
          <button class="btn ${danger ? 'danger' : ''}">${esc(confirm)}</button>
        </div></form>`;
      document.body.appendChild(back);
      const form = back.querySelector('form');
      const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      form.onsubmit = (e) => { e.preventDefault(); close(form); };
      back.querySelector('[data-x]')?.addEventListener('click', () => close(null));
      back.addEventListener('mousedown', (e) => { if (e.target === back) close(null); });
      (form.querySelector('input, select, textarea') || form.querySelector('button:last-child')).focus();
    });
  }
  const confirmBox = (text, danger = true) => modal(t('a.confirm'), `<p>${esc(text)}</p>`, { danger }).then((f) => !!f);
  const askText = (title, value = '') =>
    modal(title, `<label class="field"><input name="v" value="${esc(value)}" maxlength="60"></label>`).then((f) => f ? f.v.value.trim() : null);

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast(t('copied')); }
    catch { toast(text); }
  }

  const busy = async (btn, fn) => {
    btn.disabled = true;
    try { await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; }
  };

  // ---------- frame ----------
  function renderNav() {
    const isAdmin = me.user.role === 'admin';
    $('#side').innerHTML = NAV.map((v) => `<a href="#/${v}" class="${view === v ? 'active' : ''}">${icon(v)}<span>${esc(label(v))}</span></a>`).join('')
      + (isAdmin ? `<div class="sep">${esc(t('tab.admin'))}</div>` + ADMIN_NAV.map((v) => `<a href="#/${v}" class="${view === v ? 'active' : ''}">${icon(v)}<span>${esc(label(v))}</span></a>`).join('') : '');
    $('#who').textContent = me.user.email;
    const name = config ? (getLang() === 'ar' ? config.siteNameAr : config.siteNameEn) : 'SMS Gateway';
    document.querySelectorAll('.site-name').forEach((el) => { el.textContent = name; });
    document.title = `${label(view)} · ${name}`;
  }

  async function loadMe() {
    try { me = await api('GET', '/me'); }
    catch (e) {
      if (e.status === 401) { location.href = '/login'; return false; }
      if (e.code === 'account_suspended') {
        main.innerHTML = `<div class="alert bad">${esc(t('ov.suspended'))}</div>`;
        return false;
      }
      throw e;
    }
    return true;
  }

  const VIEWS = {};
  async function render(quiet) {
    if (!quiet && !(await loadMe())) return;
    renderNav();
    const fn = VIEWS[view];
    if (!fn || (view.startsWith('a-') && me.user.role !== 'admin')) { location.hash = '#/overview'; return; }
    try { await fn(quiet); }
    catch (e) { if (!quiet) main.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`; }
  }

  function route() {
    const v = (location.hash.replace(/^#\/?/, '') || 'overview');
    if (v !== view) flash = {};
    view = v;
    clearInterval(timer);
    if (['overview', 'devices', 'messages', 'a-overview'].includes(view)) {
      timer = setInterval(() => {
        if (document.hidden || document.querySelector('.modal-back') || main.contains(document.activeElement)) return;
        render(true);
      }, 10_000);
    }
    window.scrollTo(0, 0);
    render(false);
  }

  // ================= customer views =================

  VIEWS.overview = async () => {
    const [stats, devs, keys] = await Promise.all([api('GET', '/me/stats'), api('GET', '/me/devices'), api('GET', '/me/keys')]);
    const a = me.account;
    const by = Object.fromEntries(stats.last30Days.map((r) => [r.status, r.n]));
    const sent = (by.sent || 0) + (by.delivered || 0);
    const online = devs.devices.filter((d) => d.online).length;
    const pct = a.limit ? Math.min(100, Math.round((a.usage / a.limit) * 100)) : 0;
    const full = a.limit !== null && a.usage >= a.limit;

    const alerts = [];
    if (me.user.status !== 'active') alerts.push(['bad', t('ov.suspended')]);
    if (a.planExpired) alerts.push(['warn', t('ov.expired')]);
    if (full) alerts.push(['bad', t('ov.quotaFull')]);
    if (me.pendingRequest) alerts.push(['ok', t('ov.pending')]);

    const steps = [
      [devs.devices.length > 0, t('ov.s1'), me.apkAvailable ? `<a class="btn sm ghost" href="/download/app.apk">${esc(t('dev.download'))}</a>` : ''],
      [devs.devices.some((d) => d.lastSeen), t('ov.s2'), '<a class="btn sm ghost" href="#/devices">→</a>'],
      [keys.keys.length > 0, t('ov.s3'), '<a class="btn sm ghost" href="#/keys">→</a>'],
      [sent > 0 || (by.queued || 0) > 0, t('ov.s4'), '<a class="btn sm ghost" href="#/send">→</a>'],
    ];
    const allDone = steps.every((s) => s[0]);

    main.innerHTML = `
      <h1>${esc(t('ov.hello', { name: me.user.name }))}</h1>
      ${alerts.map(([c, m]) => `<div class="alert ${c}">${esc(m)}</div>`).join('')}
      <div class="grid-2">
        <div class="card">
          <div class="row between"><strong>${esc(t('ov.usage'))}</strong>
            <span class="muted small">${a.limit === null ? esc(t('ov.unlimited')) : esc(t('ov.of', { n: fmtNum(a.limit) }))}</span></div>
          <div class="stat" style="padding:6px 0 0"><div class="v">${fmtNum(a.usage)}</div></div>
          ${a.limit !== null ? `<div class="meter ${full ? 'full' : ''}"><i style="width:${pct}%"></i></div>` : ''}
        </div>
        <div class="card">
          <div class="row between"><strong>${esc(t('ov.plan'))}</strong><a class="btn sm" href="#/billing">${esc(t('ov.upgrade'))}</a></div>
          <div class="stat" style="padding:6px 0 0"><div class="v">${esc(planName(a.plan))}</div>
            <div class="l">${me.user.planExpiresAt && !a.planExpired ? esc(t('ov.expires', { d: fmtDate(me.user.planExpiresAt, false) })) : esc(t('ov.never'))}</div></div>
        </div>
      </div>
      <div class="grid-4" style="margin-top:16px">
        <div class="card stat"><div class="v"><span class="ltr">${fmtNum(online)}<span class="muted" style="font-size:16px"> / ${fmtNum(devs.devices.length)}</span></span></div><div class="l">${esc(t('ov.devices'))}</div></div>
        <div class="card stat"><div class="v">${fmtNum(sent)}</div><div class="l">${esc(t('ov.sent30'))}</div></div>
        <div class="card stat"><div class="v">${fmtNum(by.delivered || 0)}</div><div class="l">${esc(t('ov.delivered30'))}</div></div>
        <div class="card stat"><div class="v">${fmtNum(by.failed || 0)}</div><div class="l">${esc(t('ov.failed30'))}</div></div>
      </div>
      ${allDone ? '' : `<div class="card" style="margin-top:16px"><h2>${esc(t('ov.start'))}</h2>
        <ul class="list checklist">${steps.map(([done, text, act]) => `
          <li class="${done ? 'done' : ''}"><div class="row"><span class="ck">${done ? '✓' : ''}</span><span class="t">${esc(text)}</span></div>${done ? '' : act}</li>`).join('')}
        </ul></div>`}`;
  };

  VIEWS.devices = async () => {
    const { devices } = await api('GET', '/me/devices');
    const a = me.account;
    main.innerHTML = `
      <div class="row between" style="margin-bottom:18px"><h1 style="margin:0">${esc(t('tab.devices'))}</h1>
        <button class="btn" id="addDev">${esc(t('dev.add'))}</button></div>
      <div id="pairBox"></div>
      <div class="card">
        <div class="row between" style="margin-bottom:10px"><span class="muted small">${esc(t('dev.limit', { used: fmtNum(devices.length), max: fmtNum(a.maxDevices) }))}</span></div>
        <ul class="list">${devices.length ? devices.map((d) => `
          <li>
            <div class="row" style="gap:12px"><span class="dot ${d.online ? 'on' : ''}"></span>
              <div><strong>${esc(d.name)}</strong>
                <div class="muted small">${d.online ? esc(t('dev.online')) : d.lastSeen ? esc(t('dev.lastSeen', { d: fmtDate(d.lastSeen) })) : esc(t('dev.never'))}
                ${d.info?.model ? ' · ' + esc(d.info.model) : ''}${d.info?.sims ? ' · ' + esc(t('dev.sims', { n: d.info.sims })) : ''}
                · <code class="ltr">${esc(d.id)}</code></div></div></div>
            <div class="row"><button class="btn sm ghost" data-relink="${esc(d.id)}">${esc(t('dev.relink'))}</button>
              <button class="btn sm danger" data-del="${esc(d.id)}">${esc(t('dev.delete'))}</button></div>
          </li>`).join('') : `<li class="empty">${esc(t('dev.empty'))}</li>`}</ul>
      </div>
      <div class="card"><div class="row between">
        <div><strong>${esc(t('dev.download'))}</strong><div class="muted small">Android 8+</div></div>
        ${me.apkAvailable ? `<a class="btn ghost" href="/download/app.apk">⬇ APK</a>` : `<span class="muted small">${esc(t('dev.apkMissing'))}</span>`}
      </div></div>`;

    if (flash.pair) showPair(flash.pair);

    $('#addDev').onclick = async () => {
      const name = await askText(t('dev.namePrompt'), t('dev.defaultName'));
      if (name === null) return;
      try { const d = await api('POST', '/me/devices', { name }); flash.pair = d.token; await render(false); }
      catch (e) { toast(e.message); if (e.code === 'device_limit') location.hash = '#/billing'; }
    };
    main.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => {
      if (!(await confirmBox(t('dev.confirmDelete')))) return;
      await busy(b, async () => { await api('DELETE', '/me/devices/' + b.dataset.del); await render(false); });
    }; });
    main.querySelectorAll('[data-relink]').forEach((b) => { b.onclick = async () => {
      if (!(await confirmBox(t('dev.confirmRelink'), false))) return;
      await busy(b, async () => { const r = await api('POST', `/me/devices/${b.dataset.relink}/token`); flash.pair = r.token; await render(false); });
    }; });
  };

  function showPair(token) {
    const link = `${location.origin}/pair#${token}`;
    $('#pairBox').innerHTML = `<div class="card secret" style="margin-bottom:16px">
      <h2 style="margin-bottom:6px">${esc(t('dev.pairTitle'))}</h2>
      <p class="small" style="margin:0 0 6px">${esc(t('dev.pairHelp'))}</p>
      <div id="qr"></div><code class="ltr">${esc(link)}</code>
      <button class="btn sm ghost" id="copyPair">${esc(t('dev.copy'))}</button></div>`;
    const draw = () => {
      const box = $('#qr');
      if (!box) return;
      if (!window.qrcode) { box.remove(); return; }
      const qr = window.qrcode(0, 'M');
      qr.addData(link);
      qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: false });
    };
    if (window.qrcode) draw(); else window.addEventListener('load', draw, { once: true });
    $('#copyPair').onclick = () => copy(link);
  }

  VIEWS.keys = async () => {
    const { keys } = await api('GET', '/me/keys');
    main.innerHTML = `
      <div class="row between" style="margin-bottom:18px"><h1 style="margin:0">${esc(t('tab.keys'))}</h1>
        <button class="btn" id="addKey">${esc(t('key.create'))}</button></div>
      ${flash.key ? `<div class="card secret" style="margin-bottom:16px"><strong>${esc(t('key.newTitle'))}</strong>
        <p class="small" style="margin:4px 0 0">${esc(t('key.newHelp'))}</p><code class="ltr">${esc(flash.key)}</code>
        <button class="btn sm ghost" id="copyKey">${esc(t('copy'))}</button></div>` : ''}
      <div class="card"><ul class="list">${keys.length ? keys.map((k) => `
        <li><div><strong>${esc(k.name)}</strong>
          <div class="muted small"><code class="ltr">${esc(k.prefix)}…</code> · ${k.last_used ? esc(t('key.lastUsed', { d: fmtDate(k.last_used) })) : esc(t('key.never'))}</div></div>
          <button class="btn sm danger" data-del="${esc(k.id)}">${esc(t('dev.delete'))}</button></li>`).join('')
        : `<li class="empty">${esc(t('key.empty'))}</li>`}</ul></div>`;
    if (flash.key) $('#copyKey').onclick = () => copy(flash.key);
    $('#addKey').onclick = async () => {
      const name = await askText(t('key.namePrompt'), 'my-app');
      if (name === null) return;
      try { const k = await api('POST', '/me/keys', { name }); flash.key = k.key; await render(false); }
      catch (e) { toast(e.message); }
    };
    main.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => {
      if (!(await confirmBox(t('key.confirmDelete')))) return;
      await busy(b, async () => { await api('DELETE', '/me/keys/' + b.dataset.del); flash.key = null; await render(false); });
    }; });
  };

  let msgDir = '';
  VIEWS.messages = async (quiet) => {
    if (quiet && main.dataset.loadedMore) return;
    const { messages } = await api('GET', '/me/messages?limit=50' + (msgDir ? '&direction=' + msgDir : ''));
    delete main.dataset.loadedMore;
    const row = (m) => `<tr>
      <td>${m.direction === 'in' ? '⬇' : '⬆'}</td>
      <td><code class="ltr">${esc(m.phone)}</code></td>
      <td class="wrap">${esc(m.message)}${m.error ? `<div class="small" style="color:var(--danger)">${esc(m.error)}</div>` : ''}</td>
      <td>${pillFor(m.status)}</td>
      <td class="muted small" style="white-space:nowrap">${esc(fmtDate(m.createdAt))}</td></tr>`;
    main.innerHTML = `
      <div class="row between" style="margin-bottom:18px"><h1 style="margin:0">${esc(t('tab.messages'))}</h1>
        <select id="dir" style="width:auto">
          <option value="">${esc(t('msg.all'))}</option><option value="out">${esc(t('msg.out'))}</option><option value="in">${esc(t('msg.in'))}</option>
        </select></div>
      <div class="card"><div class="tablewrap"><table>
        <thead><tr><th></th><th>${esc(t('msg.phone'))}</th><th>${esc(t('msg.text'))}</th><th>${esc(t('msg.status'))}</th><th>${esc(t('msg.time'))}</th></tr></thead>
        <tbody id="rows">${messages.length ? messages.map(row).join('') : `<tr><td colspan="5" class="empty">${esc(t('msg.empty'))}</td></tr>`}</tbody>
      </table></div>
      ${messages.length === 50 ? `<div style="text-align:center;margin-top:12px"><button class="btn ghost sm" id="more">${esc(t('msg.more'))}</button></div>` : ''}</div>`;
    $('#dir').value = msgDir;
    $('#dir').onchange = (e) => { msgDir = e.target.value; render(true); };
    let last = messages.at(-1)?.createdAt;
    const more = $('#more');
    if (more) more.onclick = () => busy(more, async () => {
      const r = await api('GET', `/me/messages?limit=50&before=${last}` + (msgDir ? '&direction=' + msgDir : ''));
      $('#rows').insertAdjacentHTML('beforeend', r.messages.map(row).join(''));
      main.dataset.loadedMore = '1';
      last = r.messages.at(-1)?.createdAt;
      if (r.messages.length < 50) more.remove();
    });
  };

  function smsParts(s) {
    const gsm = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(s);
    const n = [...s].length;
    if (!n) return 0;
    const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
    return n <= single ? 1 : Math.ceil(n / multi);
  }

  VIEWS.send = async () => {
    const { devices } = await api('GET', '/me/devices');
    main.innerHTML = `<h1>${esc(t('tab.send'))}</h1>
      <form class="card" id="sendForm" novalidate>
        <div class="grid-2">
          <div>
            <label class="field"><span>${esc(t('send.to'))}</span><textarea name="to" class="ltr" rows="3" style="min-height:0" placeholder="+970599000000"></textarea>
              <small class="muted">${esc(t('send.toHelp'))}</small></label>
            <div class="grid-2">
              <label class="field"><span>${esc(t('send.device'))}</span><select name="deviceId">
                <option value="">${esc(t('send.auto'))}</option>
                ${devices.map((d) => `<option value="${esc(d.id)}">${esc(d.name)}${d.online ? '' : ' ⏸'}</option>`).join('')}</select></label>
              <label class="field"><span>${esc(t('send.sim'))}</span><select name="simSlot">
                <option value="">${esc(t('send.simDefault'))}</option><option value="0">${esc(t('send.sim1'))}</option><option value="1">${esc(t('send.sim2'))}</option></select></label>
            </div>
          </div>
          <label class="field"><span>${esc(t('send.body'))}</span><textarea name="message" rows="6"></textarea>
            <small class="muted" id="chars"></small></label>
        </div>
        <div class="row"><button class="btn" id="sendBtn">${esc(t('send.btn'))}</button><span id="sendInfo" class="small"></span></div>
      </form>`;
    const f = $('#sendForm');
    const count = () => { const s = f.message.value; $('#chars').textContent = t('send.chars', { n: fmtNum([...s].length), p: fmtNum(smsParts(s)) }); };
    f.message.oninput = count; count();
    f.onsubmit = (e) => {
      e.preventDefault();
      busy($('#sendBtn'), async () => {
        const body = { to: f.to.value.split(/[,،;\n]/).map((s) => s.trim()).filter(Boolean), message: f.message.value };
        if (f.deviceId.value) body.deviceId = f.deviceId.value;
        if (f.simSlot.value !== '') body.simSlot = Number(f.simSlot.value);
        const r = await api('POST', '/me/send', body);
        $('#sendInfo').textContent = r.deviceOnline ? t('send.ok', { n: fmtNum(r.messages.length) }) : t('send.offline');
        f.message.value = ''; count();
      });
    };
  };

  let selPlan = null;
  VIEWS.billing = async () => {
    const b = await api('GET', '/me/billing');
    const ar = getLang() === 'ar';
    const a = me.account;
    const paid = b.plans.filter((p) => p.price > 0);
    const sel = paid.find((p) => p.id === selPlan);
    const statusPill = (s) => `<span class="pill ${s === 'approved' ? 'ok' : s === 'rejected' ? 'bad' : 'warn'}">${esc(t('bill.' + s))}</span>`;
    main.innerHTML = `<h1>${esc(t('tab.billing'))}</h1>
      ${me.pendingRequest ? `<div class="alert ok">${esc(t('ov.pending'))}</div>` : ''}
      <div class="card"><div class="row between">
        <div><div class="muted small">${esc(t('bill.current'))}</div><div style="font-size:22px;font-weight:700">${esc(planName(a.plan))}</div>
          <div class="muted small">${a.limit === null ? esc(t('pricing.unlimited')) : esc(t('pricing.msgs', { n: fmtNum(a.limit) }))} ·
          ${esc(a.maxDevices === 1 ? t('pricing.devices1') : t('pricing.devicesN', { n: fmtNum(a.maxDevices) }))}</div></div>
        <div class="muted small">${me.user.planExpiresAt && !a.planExpired ? esc(t('ov.expires', { d: fmtDate(me.user.planExpiresAt, false) })) : ''}</div>
      </div></div>

      ${me.pendingRequest ? '' : `<div class="card"><h2>${esc(t('bill.choose'))}</h2>
        <div class="grid-3">${paid.map((p) => `
          <button type="button" class="plan-tile ${p.id === selPlan ? 'sel' : ''}" data-plan="${esc(p.id)}">
            <div class="row between"><strong>${esc(planName(p))}</strong>${p.id === a.plan.id ? `<span class="pill ok">${esc(t('bill.current_badge'))}</span>` : ''}</div>
            <div class="p">${esc(fmtMoney(p.price, p.currency))} <small class="muted" style="font-size:13px;font-weight:500">${esc(t('pricing.month'))}</small></div>
            <div class="muted small">${p.monthlyLimit === null ? esc(t('pricing.unlimited')) : esc(t('pricing.msgs', { n: fmtNum(p.monthlyLimit) }))}<br>
            ${esc(p.maxDevices === 1 ? t('pricing.devices1') : t('pricing.devicesN', { n: fmtNum(p.maxDevices) }))}</div>
          </button>`).join('')}</div>
        ${sel ? `<form id="payForm" style="margin-top:20px" novalidate>
          <div class="grid-2">
            <div>
              <label class="field"><span>${esc(t('bill.months'))}</span><select name="months">
                ${[1, 3, 6, 12].map((n) => `<option value="${n}">${esc(t('bill.monthN', { n: fmtNum(n) }))}</option>`).join('')}</select></label>
              <p><span class="muted">${esc(t('bill.total'))}:</span> <strong id="total" style="font-size:20px"></strong></p>
              <label class="field"><span>${esc(t('bill.reference'))}</span><input name="reference" maxlength="120" required></label>
              <label class="field"><span>${esc(t('bill.note'))}</span><input name="note" maxlength="500"></label>
              <button class="btn" id="payBtn">${esc(t('bill.submit'))}</button>
            </div>
            <div class="secret" style="margin:0"><strong>${esc(t('bill.howToPay'))}</strong>
              <p class="pre small" style="margin:8px 0 0">${esc(ar ? b.paymentAr : b.paymentEn)}</p>
              ${b.contactWhatsapp ? `<p style="margin:12px 0 0"><a href="https://wa.me/${esc(b.contactWhatsapp.replace(/[^0-9]/g, ''))}" target="_blank" rel="noopener">${esc(t('bill.contact'))}</a></p>` : ''}
            </div>
          </div></form>` : ''}
      </div>`}

      <div class="card"><h2>${esc(t('bill.history'))}</h2>
        ${b.requests.length ? `<div class="tablewrap"><table><tbody>${b.requests.map((r) => `<tr>
          <td>${esc(planName(b.plans.find((p) => p.id === r.planId) || { nameAr: r.planId, nameEn: r.planId }))} · ${esc(t('bill.monthN', { n: fmtNum(r.months) }))}</td>
          <td>${esc(fmtMoney(r.amount, r.currency))}</td><td>${statusPill(r.status)}${r.adminNote ? `<div class="muted small">${esc(r.adminNote)}</div>` : ''}</td>
          <td class="muted small">${esc(fmtDate(r.createdAt))}</td></tr>`).join('')}</tbody></table></div>`
        : `<p class="muted" style="margin:0">${esc(t('bill.none'))}</p>`}</div>`;

    main.querySelectorAll('[data-plan]').forEach((el) => { el.onclick = () => { selPlan = el.dataset.plan; render(true); }; });
    const f = $('#payForm');
    if (f && sel) {
      const total = () => { $('#total').textContent = fmtMoney(sel.price * Number(f.months.value), sel.currency); };
      f.months.onchange = total; total();
      f.onsubmit = (e) => {
        e.preventDefault();
        if (!f.reference.value.trim()) { f.reference.focus(); return; }
        busy($('#payBtn'), async () => {
          await api('POST', '/me/billing/request', { planId: sel.id, months: Number(f.months.value), reference: f.reference.value, note: f.note.value });
          selPlan = null;
          toast(t('bill.sent'));
          await render(false);
        });
      };
    }
  };

  VIEWS.docs = async () => {
    const base = location.origin;
    const block = (title, help, code) => `<div class="card"><h2>${esc(title)}</h2>${help ? `<p class="muted small" style="margin:0">${esc(help)}</p>` : ''}<pre class="code">${esc(code)}</pre></div>`;
    main.innerHTML = `<h1>${esc(t('docs.title'))}</h1>
      <div class="alert ok">${esc(t('docs.intro'))}</div>
      ${block(t('docs.send') + ' · POST /api/v1/sms/send', t('docs.sendHelp'),
`curl -X POST ${base}/api/v1/sms/send \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"to": "+970599000000", "message": "Hello"}'

# Response
{"deviceId": "Ab12Cd34Ef", "deviceOnline": true,
 "messages": [{"id": "q8Xh2...", "phone": "+970599000000", "status": "dispatched", ...}]}`)}
      ${block('JavaScript (Node / browser)', '',
`await fetch("${base}/api/v1/sms/send", {
  method: "POST",
  headers: { "x-api-key": "YOUR_API_KEY", "content-type": "application/json" },
  body: JSON.stringify({ to: ["0599000001", "0599000002"], message: "Hello" }),
});`)}
      ${block('PHP', '',
`$ch = curl_init("${base}/api/v1/sms/send");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => ["x-api-key: YOUR_API_KEY", "content-type: application/json"],
  CURLOPT_POSTFIELDS => json_encode(["to" => "+970599000000", "message" => "Hello"]),
]);
$result = json_decode(curl_exec($ch), true);`)}
      ${block(t('docs.status') + ' · GET /api/v1/sms/:id', t('docs.statusHelp'), `curl ${base}/api/v1/sms/MESSAGE_ID -H "x-api-key: YOUR_API_KEY"`)}
      ${block(t('docs.list') + ' · GET /api/v1/sms', 'direction=in|out · status · limit (≤500) · before', `curl "${base}/api/v1/sms?direction=in&limit=20" -H "x-api-key: YOUR_API_KEY"`)}
      ${block(t('docs.account') + ' · GET /api/v1/account', '', `curl ${base}/api/v1/account -H "x-api-key: YOUR_API_KEY"`)}
      ${block(t('docs.webhook'), t('docs.webhookHelp'),
`POST https://your-site.com/webhook
{"event": "sms.status",   "data": {"id": "...", "status": "delivered", ...}, "ts": 1761379200000}
{"event": "sms.received", "data": {"phone": "+970599...", "message": "...", ...}, "ts": 1761379200000}`)}
      ${block(t('docs.errors'), t('docs.errorsHelp'), `HTTP 402\n{"error": "quota_exceeded", "message": "Monthly limit reached (1000/1000)..."}`)}`;
  };

  VIEWS.settings = async () => {
    const u = me.user;
    main.innerHTML = `<h1>${esc(t('tab.settings'))}</h1>
      <form class="card" id="profile" novalidate><h2>${esc(t('set.profile'))}</h2>
        <div class="grid-2">
          <label class="field"><span>${esc(t('f.name'))}</span><input name="name" value="${esc(u.name)}" maxlength="80"></label>
          <label class="field"><span>${esc(t('f.phone'))}</span><input name="phone" class="ltr" value="${esc(u.phone)}" maxlength="30"></label>
        </div>
        <label class="field"><span>${esc(t('f.email'))}</span><input class="ltr" value="${esc(u.email)}" disabled></label>
        <label class="field"><span>${esc(t('set.webhook'))}</span><input name="webhookUrl" class="ltr" value="${esc(u.webhookUrl)}" placeholder="https://your-site.com/webhook">
          <small class="muted">${esc(t('set.webhookHelp'))}</small></label>
        <button class="btn" id="saveProfile">${esc(t('set.save'))}</button>
      </form>
      <form class="card" id="pw" novalidate><h2>${esc(t('set.password'))}</h2>
        <div class="grid-2">
          <label class="field"><span>${esc(t('set.current'))}</span><input name="current" type="password" autocomplete="current-password"></label>
          <label class="field"><span>${esc(t('set.new'))}</span><input name="next" type="password" autocomplete="new-password" minlength="8"></label>
        </div>
        <button class="btn" id="savePw">${esc(t('set.change'))}</button>
      </form>`;
    const p = $('#profile');
    p.onsubmit = (e) => { e.preventDefault(); busy($('#saveProfile'), async () => {
      const r = await api('PUT', '/me/profile', { name: p.name.value, phone: p.phone.value, webhookUrl: p.webhookUrl.value });
      me.user = r.user; toast(t('set.saved'));
    }); };
    const w = $('#pw');
    w.onsubmit = (e) => { e.preventDefault(); busy($('#savePw'), async () => {
      await api('POST', '/me/password', { current: w.current.value, next: w.next.value });
      w.reset(); toast(t('set.saved'));
    }); };
  };

  // ================= admin views =================

  async function getAdminPlans(force) {
    if (!adminPlans || force) adminPlans = (await api('GET', '/admin/plans')).plans;
    return adminPlans;
  }

  VIEWS['a-overview'] = async () => {
    const { stats: s, apkAvailable } = await api('GET', '/admin/stats');
    const cards = [
      [fmtNum(s.users), t('a.users')], [fmtNum(s.paidUsers), t('a.paid')], [fmtNum(s.devices), t('a.devices')],
      [fmtMoney(s.revenueMonth, 'USD'), t('a.revenue')], [fmtNum(s.messagesMonth), t('a.msgMonth')], [fmtNum(s.messages24h), t('a.msg24')],
      [fmtNum(s.pendingRequests), t('a.pending'), '#/a-requests'],
    ];
    main.innerHTML = `<h1>${esc(t('tab.a.overview'))}</h1>
      <div class="grid-4">${cards.map(([v, l, href]) => `<div class="card stat">${href ? `<a href="${href}" style="color:inherit">` : ''}<div class="v">${esc(v)}</div><div class="l">${esc(l)}</div>${href ? '</a>' : ''}</div>`).join('')}</div>
      <div class="card" style="margin-top:16px"><h2>${esc(t('a.apk'))}</h2>
        <p class="muted small" style="margin-top:0">${esc(t('a.apkHelp'))} ${esc(apkAvailable ? t('a.apkPresent') : t('a.apkNone'))}</p>
        <div class="row"><input type="file" id="apkFile" accept=".apk,application/vnd.android.package-archive" style="max-width:320px">
          <button class="btn" id="apkBtn">${esc(t('a.apkUpload'))}</button>
          ${apkAvailable ? '<a class="btn ghost" href="/download/app.apk">⬇</a>' : ''}</div></div>`;
    $('#apkBtn').onclick = () => {
      const file = $('#apkFile').files[0];
      if (!file) { $('#apkFile').click(); return; }
      busy($('#apkBtn'), async () => { await api('POST', '/admin/apk', file, true); toast(t('a.apkOk')); await render(false); });
    };
  };

  let userQuery = '';
  VIEWS['a-users'] = async () => {
    const [plans, { users }] = await Promise.all([getAdminPlans(), api('GET', '/admin/users?q=' + encodeURIComponent(userQuery))]);
    const pName = (id) => planName(plans.find((p) => p.id === id) || { nameAr: id, nameEn: id });
    const expired = (u) => u.planExpiresAt && u.planExpiresAt < Date.now();
    main.innerHTML = `<h1>${esc(t('tab.a.users'))}</h1>
      <div class="card">
        <input id="q" placeholder="${esc(t('a.search'))}" value="${esc(userQuery)}" style="margin-bottom:12px">
        <div class="tablewrap"><table>
          <thead><tr><th>${esc(t('a.user'))}</th><th>${esc(t('a.plan'))}</th><th>${esc(t('a.usage'))}</th><th>${esc(t('a.joined'))}</th><th></th></tr></thead>
          <tbody>${users.map((u) => `<tr>
            <td><strong>${esc(u.name)}</strong> ${u.role === 'admin' ? `<span class="pill ok">${esc(t('a.admin'))}</span>` : ''} ${u.status !== 'active' ? `<span class="pill bad">${esc(t('a.suspended'))}</span>` : ''}
              <div class="muted small ltr">${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</div></td>
            <td>${esc(pName(u.planId))}<div class="muted small">${u.planExpiresAt ? (expired(u) ? '⚠ ' : '') + esc(fmtDate(u.planExpiresAt, false)) : ''}</div></td>
            <td>${fmtNum(u.usage)}<div class="muted small">${esc(t('tab.devices'))}: ${fmtNum(u.devices)}</div></td>
            <td class="muted small">${esc(fmtDate(u.createdAt, false))}</td>
            <td><div class="row" style="gap:6px;flex-wrap:nowrap">
              <button class="btn sm" data-act="activate" data-id="${esc(u.id)}">${esc(t('a.activate'))}</button>
              <select class="btn sm ghost" data-more="${esc(u.id)}" style="width:auto;padding-inline:8px">
                <option value="">⋯</option>
                <option value="status">${esc(u.status === 'active' ? t('a.suspend') : t('a.unsuspend'))}</option>
                <option value="password">${esc(t('a.resetPw'))}</option>
                <option value="role">${esc(u.role === 'admin' ? t('a.removeAdmin') : t('a.makeAdmin'))}</option>
              </select></div></td>
          </tr>`).join('')}</tbody></table></div></div>`;

    let qt;
    $('#q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { userQuery = e.target.value; render(true).then(() => { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 300); };
    const byId = (id) => users.find((u) => u.id === id);

    main.querySelectorAll('[data-act="activate"]').forEach((b) => { b.onclick = async () => {
      const u = byId(b.dataset.id);
      const f = await modal(t('a.activateTitle', { email: u.email }), `
        <label class="field"><span>${esc(t('a.plan'))}</span><select name="planId">${plans.map((p) => `<option value="${esc(p.id)}" ${p.id === u.planId ? 'selected' : ''}>${esc(planName(p))}</option>`).join('')}</select></label>
        <label class="field"><span>${esc(t('a.months'))}</span><input name="months" type="number" min="1" max="36" value="1"></label>`);
      if (!f) return;
      try { await api('POST', `/admin/users/${u.id}/activate`, { planId: f.planId.value, months: Number(f.months.value) }); toast('✓'); await render(true); }
      catch (e) { toast(e.message); }
    }; });

    main.querySelectorAll('[data-more]').forEach((sel) => { sel.onchange = async () => {
      const u = byId(sel.dataset.more);
      const act = sel.value; sel.value = '';
      try {
        if (act === 'status') {
          if (u.status === 'active' && !(await confirmBox(t('a.confirmSuspend')))) return;
          await api('PUT', `/admin/users/${u.id}`, { status: u.status === 'active' ? 'suspended' : 'active' });
        } else if (act === 'password') {
          const r = await api('POST', `/admin/users/${u.id}/password`);
          await modal(t('a.resetPw'), `<p>${esc(t('a.tempPw', { email: u.email }))}</p><code class="ltr" style="font-size:18px">${esc(r.password)}</code>`, { confirm: 'OK', cancel: false });
        } else if (act === 'role') {
          await api('PUT', `/admin/users/${u.id}`, { role: u.role === 'admin' ? 'user' : 'admin' });
        }
        await render(true);
      } catch (e) { toast(e.message); }
    }; });
  };

  let reqFilter = 'pending';
  VIEWS['a-requests'] = async () => {
    const [plans, { requests }] = await Promise.all([getAdminPlans(), api('GET', '/admin/requests' + (reqFilter ? '?status=' + reqFilter : ''))]);
    const pName = (id) => planName(plans.find((p) => p.id === id) || { nameAr: id, nameEn: id });
    main.innerHTML = `<div class="row between" style="margin-bottom:18px"><h1 style="margin:0">${esc(t('tab.a.requests'))}</h1>
        <select id="rf" style="width:auto"><option value="pending">${esc(t('a.req.pending'))}</option><option value="">${esc(t('a.req.all'))}</option></select></div>
      ${requests.length ? requests.map((r) => `<div class="card">
        <div class="row between">
          <div><strong>${esc(r.user.name)}</strong> <span class="muted small ltr">${esc(r.user.email)}${r.user.phone ? ' · ' + esc(r.user.phone) : ''}</span>
            <div style="margin-top:4px">${esc(pName(r.planId))} · ${esc(t('bill.monthN', { n: fmtNum(r.months) }))} · <strong>${esc(fmtMoney(r.amount, r.currency))}</strong></div>
            <div class="muted small">${esc(t('a.ref'))}: <span class="ltr">${esc(r.reference || '—')}</span>${r.note ? ' · ' + esc(r.note) : ''} · ${esc(fmtDate(r.createdAt))}</div>
            ${r.adminNote ? `<div class="muted small">${esc(r.adminNote)}</div>` : ''}</div>
          ${r.status === 'pending' ? `<div class="row"><button class="btn" data-ok="${esc(r.id)}">${esc(t('a.approve'))}</button>
            <button class="btn danger" data-no="${esc(r.id)}">${esc(t('a.reject'))}</button></div>`
            : `<span class="pill ${r.status === 'approved' ? 'ok' : 'bad'}">${esc(t('bill.' + r.status))}</span>`}
        </div></div>`).join('') : `<div class="card empty">${esc(t('a.noRequests'))}</div>`}`;
    $('#rf').value = reqFilter;
    $('#rf').onchange = (e) => { reqFilter = e.target.value; render(true); };
    main.querySelectorAll('[data-ok]').forEach((b) => { b.onclick = () => busy(b, async () => { await api('POST', `/admin/requests/${b.dataset.ok}/approve`, {}); await render(false); }); });
    main.querySelectorAll('[data-no]').forEach((b) => { b.onclick = async () => {
      const f = await modal(t('a.reject'), `<label class="field"><span>${esc(t('a.rejectNote'))}</span><input name="note" maxlength="300"></label>`, { danger: true, confirm: t('a.reject') });
      if (!f) return;
      await busy(b, async () => { await api('POST', `/admin/requests/${b.dataset.no}/reject`, { note: f.note.value }); await render(false); });
    }; });
  };

  VIEWS['a-plans'] = async () => {
    const plans = await getAdminPlans(true);
    main.innerHTML = `<div class="row between" style="margin-bottom:18px"><h1 style="margin:0">${esc(t('tab.a.plans'))}</h1>
        <button class="btn" id="newPlan">${esc(t('a.plan.new'))}</button></div>
      <div class="card"><div class="tablewrap"><table>
        <thead><tr><th>${esc(t('a.plan'))}</th><th>${esc(t('a.plan.price'))}</th><th>${esc(t('a.usage'))}</th><th>${esc(t('tab.devices'))}</th><th></th></tr></thead>
        <tbody>${plans.map((p) => `<tr>
          <td><strong>${esc(planName(p))}</strong> <code class="muted small">${esc(p.id)}</code>
            ${p.isDefault ? `<span class="pill ok">${esc(t('a.plan.defaultBadge'))}</span>` : ''} ${p.active ? '' : `<span class="pill">${esc(t('a.plan.hidden'))}</span>`}</td>
          <td>${p.price > 0 ? esc(fmtMoney(p.price, p.currency)) : esc(t('pricing.free'))}</td>
          <td>${p.monthlyLimit === null ? '∞' : fmtNum(p.monthlyLimit)}</td>
          <td>${fmtNum(p.maxDevices)}</td>
          <td><button class="btn sm ghost" data-edit="${esc(p.id)}">${esc(t('a.plan.edit'))}</button></td></tr>`).join('')}</tbody></table></div></div>`;
    const edit = async (p) => {
      const isNew = !p;
      p = p || { id: '', nameAr: '', nameEn: '', price: 0, currency: 'USD', monthlyLimit: 1000, maxDevices: 1, featuresAr: '', featuresEn: '', isDefault: false, active: true, sort: plans.length };
      const f = await modal(isNew ? t('a.plan.new') : `${t('a.plan.edit')} · ${planName(p)}`, `
        ${isNew ? `<label class="field"><span>${esc(t('a.plan.id'))}</span><input name="id" class="ltr" pattern="[a-z0-9-]{2,30}" required></label>` : ''}
        <div class="grid-2">
          <label class="field"><span>${esc(t('a.plan.nameAr'))}</span><input name="nameAr" value="${esc(p.nameAr)}" required></label>
          <label class="field"><span>${esc(t('a.plan.nameEn'))}</span><input name="nameEn" value="${esc(p.nameEn)}" required></label>
          <label class="field"><span>${esc(t('a.plan.price'))}</span><input name="price" type="number" min="0" step="0.01" value="${esc(p.price)}"></label>
          <label class="field"><span>${esc(t('a.plan.currency'))}</span><input name="currency" class="ltr" value="${esc(p.currency)}" maxlength="8"></label>
          <label class="field"><span>${esc(t('a.plan.limit'))}</span><input name="monthlyLimit" type="number" min="0" value="${p.monthlyLimit === null ? '' : esc(p.monthlyLimit)}"></label>
          <label class="field"><span>${esc(t('a.plan.devices'))}</span><input name="maxDevices" type="number" min="1" value="${esc(p.maxDevices)}"></label>
        </div>
        <label class="field"><span>${esc(t('a.plan.featAr'))}</span><textarea name="featuresAr" rows="3">${esc(p.featuresAr)}</textarea></label>
        <label class="field"><span>${esc(t('a.plan.featEn'))}</span><textarea name="featuresEn" rows="3" class="ltr">${esc(p.featuresEn)}</textarea></label>
        <label class="field"><span>${esc(t('a.plan.sort'))}</span><input name="sort" type="number" value="${esc(p.sort)}"></label>
        <label class="row" style="margin-bottom:8px"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> ${esc(t('a.plan.active'))}</label>
        <label class="row" style="margin-bottom:8px"><input type="checkbox" name="isDefault" ${p.isDefault ? 'checked' : ''}> ${esc(t('a.plan.default'))}</label>`);
      if (!f) return;
      try {
        await api('PUT', '/admin/plans/' + encodeURIComponent(isNew ? f.id.value.trim().toLowerCase() : p.id), {
          nameAr: f.nameAr.value, nameEn: f.nameEn.value, price: Number(f.price.value), currency: f.currency.value,
          monthlyLimit: f.monthlyLimit.value === '' ? null : Number(f.monthlyLimit.value), maxDevices: Number(f.maxDevices.value),
          featuresAr: f.featuresAr.value, featuresEn: f.featuresEn.value, sort: Number(f.sort.value),
          active: f.active.checked, isDefault: f.isDefault.checked,
        });
        await render(true);
      } catch (e) { toast(e.message); }
    };
    $('#newPlan').onclick = () => edit(null);
    main.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => edit(plans.find((p) => p.id === b.dataset.edit)); });
  };

  VIEWS['a-settings'] = async () => {
    const { settings: s } = await api('GET', '/admin/settings');
    main.innerHTML = `<h1>${esc(t('tab.a.settings'))}</h1>
      <form class="card" id="siteForm" novalidate>
        <div class="grid-2">
          <label class="field"><span>${esc(t('a.s.siteAr'))}</span><input name="site_name_ar" value="${esc(s.site_name_ar)}"></label>
          <label class="field"><span>${esc(t('a.s.siteEn'))}</span><input name="site_name_en" value="${esc(s.site_name_en)}"></label>
        </div>
        <label class="field"><span>${esc(t('a.s.payAr'))}</span><textarea name="payment_ar" rows="4">${esc(s.payment_ar)}</textarea></label>
        <label class="field"><span>${esc(t('a.s.payEn'))}</span><textarea name="payment_en" rows="4" class="ltr">${esc(s.payment_en)}</textarea></label>
        <label class="field"><span>${esc(t('a.s.whatsapp'))}</span><input name="contact_whatsapp" class="ltr" value="${esc(s.contact_whatsapp)}" placeholder="+970599000000"></label>
        <label class="row" style="margin-bottom:16px"><input type="checkbox" name="allow_signup" ${s.allow_signup === '1' ? 'checked' : ''}> ${esc(t('a.s.signup'))}</label>
        <button class="btn" id="saveSite">${esc(t('set.save'))}</button>
      </form>`;
    const f = $('#siteForm');
    f.onsubmit = (e) => { e.preventDefault(); busy($('#saveSite'), async () => {
      await api('PUT', '/admin/settings', {
        site_name_ar: f.site_name_ar.value, site_name_en: f.site_name_en.value, payment_ar: f.payment_ar.value,
        payment_en: f.payment_en.value, contact_whatsapp: f.contact_whatsapp.value, allow_signup: f.allow_signup.checked,
      });
      config = await api('GET', '/public/config');
      renderNav(); toast(t('set.saved'));
    }); };
  };

  // ---------- boot ----------
  $('#langBtn').onclick = () => setLang(getLang() === 'ar' ? 'en' : 'ar');
  document.addEventListener('langchange', () => render(true));
  $('#logoutBtn').onclick = async () => { try { await api('POST', '/auth/logout', {}); } catch {} location.href = '/'; };
  window.addEventListener('hashchange', route);
  api('GET', '/public/config').then((c) => { config = c; if (me) renderNav(); }).catch(() => {});
  route();
})();
