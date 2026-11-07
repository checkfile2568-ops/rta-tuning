/* ระบบเบิกวัสดุ · app.js — โครงหน้า เมนูตามบทบาท router เข้าสู่ระบบ และแคชรายการวัสดุ */
'use strict';
const ICON = (function () {
  const p = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
    box: '<path d="M12 3 20 7.5v9L12 21 4 16.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    doc: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    cart: '<path d="M3 4h2.2l2.3 11h10.2l2.1-7.5H6.4"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.3 7.5-5.3s6.3 1.7 7.5 5.3"/>',
    truck: '<path d="M3 6.5h11v9H3zM14 9.5h3.8l3.2 3.2v2.8h-7"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="17.5" cy="17.5" r="1.7"/>',
    inbox: '<path d="M4 13.5 6.5 5h11l2.5 8.5V19H4z"/><path d="M4 13.5h4.5l1.2 2h4.6l1.2-2H20"/>',
    clip: '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9.5 4.5h5v2.5h-5zM9 12l2 2 4-4"/>',
    alert: '<path d="M12 4 21 19.5H3Z"/><path d="M12 10v4.5M12 17.2v.3"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
    users: '<circle cx="9" cy="9" r="3.3"/><path d="M3 19c.9-3 3.2-4.5 6-4.5s5.1 1.5 6 4.5"/><circle cx="17" cy="8" r="2.6"/><path d="M16 13.6c2.3 0 4.2 1.3 5 3.9"/>',
    building: '<path d="M5 20.5V5l7-2v17.5M12 8h7v12.5M3 20.5h18M8 8v.5M8 12v.5M8 16v.5M15.5 12v.5M15.5 16v.5"/>',
    tag: '<path d="M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5z"/><circle cx="8" cy="8.5" r="1.4"/>',
    db: '<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8"/>',
    wrench: '<path d="M14.5 5.5a4 4 0 0 0 4.9 4.9L11 18.8a2.1 2.1 0 0 1-3-3l8.4-8.4"/><path d="M14.5 5.5 17 3l1.5 3.5L22 8l-2.6 2.4"/>',
    log: '<path d="M6 4h9l3 3v13H6z"/><path d="M9 10h6M9 13.5h6M9 17h3"/>',
    store: '<path d="M4 9.5 5.5 4h13L20 9.5M4 9.5h16M5 9.5V20h14V9.5"/><path d="M9.5 20v-5h5v5"/>',
    upload: '<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5M4.5 15v4.5h15V15"/>',
    download: '<path d="M12 4v11.5M7.5 11 12 15.5l4.5-4.5M4.5 15v4.5h15V15"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    print: '<path d="M7 9V4h10v5M7 17H4.5v-7h15v7H17M7 14h10v6H7z"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
    logout: '<path d="M14 4.5H6v15h8M10.5 12H21M17.5 8.5 21 12l-3.5 3.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    arrow: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>',
    chev: '<path d="m7 10 5 5 5-5"/>',
    scale: '<path d="M12 4v16M6 20h12M4 9h16M7 9l-3 6h6zM17 9l-3 6h6z"/>',
    copy: '<rect x="8" y="8" width="11.5" height="12" rx="2"/><path d="M5 15.5V5.5A1.5 1.5 0 0 1 6.5 4h9"/>',
    edit: '<path d="M4 20h4.5L19.5 9 15 4.5 4 15.5z"/>'
  };
  return function (n, cls) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (cls ? ' class="' + cls + '"' : '') + '>' + (p[n] || '') + '</svg>'; };
})();

/** พื้นที่หน้าหลัก — หน้าต่างซ้อน (modal, ล็อกอินซ้ำ, toast) อยู่นอกพื้นที่นี้ จึงไม่หายเมื่อเปลี่ยนหน้า */
function ROOT() { return document.getElementById('root') || document.body; }

const App = (function () {
  const S = { user: null, me: null, cfg: {}, catalog: null, idx: {}, cart: {}, purpose: '', views: {}, forms: {}, depts: [], catAt: null };
  const views = S.views;
  const $ = U.$;
  const ROLE_TH = { USER: 'ผู้ขอเบิก', HEAD: 'หัวหน้าส่วน', OFFICER: 'เจ้าหน้าที่พัสดุ', ADMIN: 'ผู้ดูแลระบบ' };

  /* ---------------------------------------------------------- เมนูตามบทบาท */
  function navFor(u) {
    const c = (S.me && S.me.counts) || {};
    const appr = S.cfg.approval_enabled;
    const mine = [['req', 'เบิกวัสดุ', 'box'], ['my', 'คำขอของฉัน', 'doc', c.myReady]];
    if (u.role === 'OFFICER') {
      return [['home', 'หน้าแรก', 'home'], ['queue', 'คิวจ่ายวัสดุ', 'truck', (c.queuePrep || 0) + (c.queueReady || 0)],
        ['stock', 'คลังวัสดุ', 'box'], ['receive', 'รับเข้า', 'inbox'], ['count', 'ตรวจนับ/ปรับยอด', 'clip'],
        ['reorder', 'จุดสั่งซื้อ', 'alert', c.reorder], ['dash', 'สถิติ/ประวัติ', 'chart']]
        .concat(appr ? [['approve', 'อนุมัติคำขอ', 'check', c.approvals]] : [])
        .concat([['-', 'งานของฉัน']]).concat(mine)
        .concat([['-', 'ข้อมูล'], ['suppliers', 'ผู้จำหน่าย', 'store'], ['opening', 'ยอดยกมา', 'upload'],
          ['reconcile', 'กระทบยอด', 'scale'], ['audit', 'ประวัติการใช้งาน', 'log'], ['training', 'ทดลองใช้งาน', 'clip']]);
    }
    if (u.role === 'ADMIN') {
      return [['home', 'ภาพรวม', 'home'], ['dash', 'สถิติ/ประวัติ', 'chart'], ['users', 'ผู้ใช้และสิทธิ์', 'users'],
        ['depts', 'ส่วนงาน', 'building'], ['master', 'หมวด/หน่วย/วันหยุด', 'tag'], ['settings', 'ตั้งค่าระบบ', 'gear'],
        ['training', 'ทดลองใช้งาน', 'clip'], ['backup', 'สำรองข้อมูล', 'db'], ['reconcile', 'กระทบยอด/ตรวจซ่อม', 'wrench', c.repairs], ['audit', 'Audit log', 'log'],
        ['-', 'คลัง'], ['stock', 'คลังวัสดุ (ดู)', 'box'], ['opening', 'ยอดยกมา', 'upload'],
        ['-', 'งานของฉัน']].concat(mine);
    }
    const base = [['home', 'หน้าแรก', 'home']].concat(mine).concat([['dash', 'ประวัติ', 'clock']]);
    if (u.role === 'HEAD' && appr) base.splice(1, 0, ['approve', 'อนุมัติคำขอ', 'check', c.approvals]);
    return base;
  }
  function bottomFor(u) {
    const n = navFor(u).filter(function (x) { return x[0] !== '-'; });
    if (u.role === 'OFFICER') return [n[0], n[1], n[2], ['more', 'เมนู', 'menu']];
    if (u.role === 'ADMIN') return [n[0], n[1], n[2], ['more', 'เมนู', 'menu']];
    const four = ['home', 'req', 'my', 'dash'];
    return four.map(function (k) { return n.find(function (x) { return x[0] === k; }); });
  }
  function navHtml(items, cur) {
    return items.map(function (x) {
      if (x[0] === '-') return '<div class="sep">' + U.esc(x[1]) + '</div>';
      const cnt = x[3] ? '<span class="cnt">' + x[3] + '</span>' : '';
      return '<a href="#/' + x[0] + '" class="' + (cur === x[0] ? 'on' : '') + '">' + ICON(x[2]) + '<span>' + U.esc(x[1]) + '</span>' + cnt + '</a>';
    }).join('');
  }

  /* ---------------------------------------------------------- โครงหน้า */
  function shell(route) {
    const u = S.user;
    const v = views[route] || views.home;
    const init = (u.name || '?').trim().charAt(0);
    const today = U.thDate(new Date()) + '<span class="sepv"></span>ปีงบประมาณ ' + U.fy();
    const cartCls = v.cart ? ' show-cartbar' : '';
    ROOT().innerHTML =
      (API.scope() ? Training.banner() : '') +
      '<div class="shell' + cartCls + '">' +
      '<aside class="side" aria-label="เมนูหลัก"><div class="brand"><b>' + U.esc(S.cfg.app_name || 'ระบบเบิกวัสดุ') + '</b><span>' + U.esc(S.cfg.org_name || 'ศาลจังหวัดลพบุรี') + '</span><i></i></div>' +
      '<nav class="nav" id="nav">' + navHtml(navFor(u), route) + '</nav>' +
      '<div class="side-foot"><b>' + U.esc(u.name) + '</b>' + U.esc(ROLE_TH[u.role] || '') + (u.dept_name ? ' · ' + U.esc(u.dept_name) : '') + '</div></aside>' +
      '<div class="main"><header class="mhead"><i class="bar"></i><div><b>' + U.esc(S.cfg.app_name || 'ระบบเบิกวัสดุ') + '</b><span>' + U.esc(S.cfg.org_name || 'ศาลจังหวัดลพบุรี') + '</span></div>' +
      '<button class="userbtn" data-act="usermenu" aria-label="เมนูผู้ใช้">' + ICON('user') + ICON('chev') + '</button></header>' +
      '<div class="topbar"><span>' + today + '</span><button class="userbtn" data-act="usermenu"><span class="avatar">' + U.esc(init) + '</span>' + U.esc(u.name) + '</button></div>' +
      (v.cart ? '<div class="with-cart"><main class="content" id="view"></main><aside class="cart-panel" id="cartpanel" aria-label="ตะกร้า"></aside></div>'
              : '<main class="content" id="view"></main>') +
      '</div>' +
      '<nav class="bnav" aria-label="เมนูล่าง">' + bottomFor(u).map(function (x) {
        const dot = x[3] ? '<span class="dot">' + x[3] + '</span>' : '';
        return '<a href="' + (x[0] === 'more' ? '#' : '#/' + x[0]) + '" data-act="' + (x[0] === 'more' ? 'more' : '') + '" class="' + (route === x[0] ? 'on' : '') + '">' + ICON(x[2]) + '<span>' + U.esc(x[1]) + '</span>' + dot + '</a>';
      }).join('') + '</nav>' +
      (v.cart ? '<div class="cartbar"><button class="btn primary" data-act="gocart">' + ICON('cart') + '<span id="cartbar-t">ตรวจตะกร้า</span></button></div>' : '') +
      '</div>';
  }

  async function render() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
    let route = parts[0] || 'home';
    if (!views[route] || (views[route].roles && views[route].roles.indexOf(S.user.role) < 0)) route = 'home';
    S.route = route;
    shell(route);
    const v = views[route];
    document.title = (v.title || '') + ' · ' + (S.cfg.app_name || 'ระบบเบิกวัสดุ');
    const el = $('#view');
    try { await v.render(el, parts.slice(1)); }
    catch (e) { el.innerHTML = errorBox(e); }
    if (v.cart && window.Req) Req.renderCart();
    window.scrollTo(0, 0);
  }
  function errorBox(e) {
    if (API.scope() && /^TRAINING_/.test(e && e.code || '')) return '<div class="notice warn"><div><b>พื้นที่ฝึกไม่พร้อมใช้งาน</b>' + U.esc(e.message) + '</div></div><a class="btn" href="#/training">เปิดเมนูทดลองใช้งาน</a> <button class="btn" data-act="training-leave">กลับคลังจริง</button>';
    return '<div class="notice err"><div><b>ทำรายการไม่สำเร็จ</b>' + U.esc(e && e.message || e) + '</div></div>' +
      '<button class="btn" onclick="App.render()">' + ICON('refresh') + 'ลองใหม่</button>';
  }

  /* ---------------------------------------------------------- เมนูผู้ใช้ */
  async function userMenu() {
    const u = S.user;
    const more = window.matchMedia('(max-width: 760px), (max-height: 520px) and (orientation: landscape)').matches;
    const items = navFor(u);
    const html = '<div class="who"><span class="avatar">' + U.esc(u.name.charAt(0)) + '</span><div><b>' + U.esc(u.name) + '</b><span class="muted small">' +
      U.esc(ROLE_TH[u.role]) + (u.dept_name ? ' · ' + U.esc(u.dept_name) : '') + '</span></div></div>' +
      '<div class="menu-sheet"><nav class="nav">' + (more ? navHtml(items, S.route) : '') +
      (API.scope() ? '' : '<a href="#/profile">' + ICON('user') + '<span>โปรไฟล์และ PIN</span></a>') +
      '<a href="#" data-act="logout">' + ICON('logout') + '<span>ออกจากระบบ</span></a></nav></div>';
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = '<div class="modal" role="dialog" aria-label="เมนูผู้ใช้">' + html + '<div class="modal-actions"><button class="btn" data-x>ปิด</button></div></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      const a = e.target.closest('a,[data-x]');
      if (e.target === wrap || (a && a.hasAttribute('data-x'))) { wrap.remove(); return; }
      if (a && a.dataset.act === 'logout') { e.preventDefault(); wrap.remove(); logout(); return; }
      if (a) wrap.remove();
    });
  }

  async function logout() {
    const n = Object.keys(S.cart).length;
    const pend = Outbox.pending().length;
    if (n || pend) {
      const ok = await U.confirm('ออกจากระบบ', (n ? 'ร่างคำขอ ' + n + ' รายการ' : '') + (n && pend ? ' และ' : '') +
        (pend ? 'คำขอที่ยังส่งไม่สำเร็จ ' + pend + ' ใบ' : '') + ' จะถูกลบจากเครื่องนี้ ต้องการออกจากระบบหรือไม่', 'ออกจากระบบ', true);
      if (!ok) return;
    }
    try { await API.call('logout'); } catch (e) { /* หมดเวลาอยู่แล้ว */ }
    await Store.clearUser(S.user.code);
    API.setToken('');
    location.hash = '';
    location.reload();
  }

  /* ---------------------------------------------------------- รายการวัสดุ (แคช IndexedDB) */
  function index(cat) {
    S.catalog = cat;
    S.idx = {};
    S.units = {};
    (cat.units || []).forEach(function (u) { S.units[u.unit_id] = u; });
    S.cats = {};
    (cat.categories || []).forEach(function (c) { S.cats[c.cat_id] = c; });
    cat.materials.forEach(function (m) {
      m._s = [m.code, m.name, m.spec, m.keywords, m.unit_name, (S.cats[m.cat_id] || {}).name].join(' ');
      S.idx[m.mat_id] = m;
    });
  }
  async function loadCatalog(force) {
    const key = 'catalog:' + S.user.code;
    if (!S.catalog) {
      const cached = await Store.get(key);
      if (cached && cached.data && cached.role === S.user.role) { index(cached.data); S.catAt = cached.at; API.setCatalogVersion(cached.data.version); }
    }
    if (S.catalog && !force) { refreshCatalog(); return S.catalog; }
    return refreshCatalog();
  }
  let catBusy = null;
  function refreshCatalog() {
    if (catBusy) return catBusy;
    const key = 'catalog:' + S.user.code;
    catBusy = API.call('catalog').then(function (cat) {
      index(cat);
      S.catAt = new Date().toISOString();
      API.setCatalogVersion(cat.version);
      Store.set(key, { data: cat, at: S.catAt, role: S.user.role });
      document.dispatchEvent(new CustomEvent('catalog'));
      return cat;
    }).finally(function () { catBusy = null; });
    return catBusy;
  }

  /* ---------------------------------------------------------- ตะกร้า (ร่างอัตโนมัติแยกตามบัญชี) */
  function loadCart() {
    S.cart = Store.ls.get('cart:' + S.user.code, {}) || {};
    S.purpose = Store.ls.get('purpose:' + S.user.code, '') || '';
  }
  function saveCart() {
    Store.ls.set('cart:' + S.user.code, S.cart);
    Store.ls.set('purpose:' + S.user.code, S.purpose || '');
    document.dispatchEvent(new CustomEvent('cart'));
  }

  /* ---------------------------------------------------------- เริ่มระบบ */
  async function boot() {
    if (!API.token()) { Store.clearCatalogs(''); return Login.show(); }
    try {
      const me = await API.call('me');
      await afterLogin(me);
    } catch (e) {
      if (/^SESSION_|PIN_CHANGE/.test(e.code)) return Login.show();
      ROOT().innerHTML = '<div class="content">' + errorBox(e) + '</div>';
    }
  }
  async function afterLogin(me, initialCatalog) {
    S.me = me; S.user = me.user; S.cfg = me.cfg; S.depts = me.departments;
    Store.clearCatalogs('catalog:' + S.user.code);
    loadCart();
    Outbox.load(S.user.code);
    if (me.needDept) return Login.pickDept(me);
    if (!API.scope() && me.needPosition && !Login.positionSkipped(S.user.code)) return Login.pickDept(me, true);
    if (initialCatalog) {
      index(initialCatalog); S.catAt = new Date().toISOString();
      API.setCatalogVersion(initialCatalog.version);
      Store.set('catalog:' + S.user.code, { data: initialCatalog, at: S.catAt, role: S.user.role });
    } else await loadCatalog().catch(function () { return null; });
    render();
    if (S.user.role === 'OFFICER' && window.Officer) Officer.watch();
    Outbox.resumeAll().then(function (r) {
      if (r.some(function (x) { return x; })) { U.toast('ส่งคำขอที่ค้างไว้เรียบร้อย', 'ok'); refreshMe(); }
    });
  }
  async function refreshMe() {
    try {
      const me = await API.call('me');
      S.me = me; S.user = me.user; S.cfg = me.cfg; S.depts = me.departments;
      const nav = $('#nav');
      if (nav) nav.innerHTML = navHtml(navFor(S.user), S.route);
      return me;
    } catch (e) { return null; }
  }

  /* หมดเวลา → ล็อกอินซ้ำทับหน้าเดิม ไม่ทิ้งร่าง */
  let reauthing = false;
  API.on('session', function (err) {
    if (reauthing || !S.user) return;
    reauthing = true;
    Login.overlay(S.user, err).then(function () {
      reauthing = false;
      Outbox.resumeAll();
      refreshMe();
      if ($('#view .notice.err')) render();          // หน้าที่โหลดไม่สำเร็จเพราะหมดเวลา → โหลดใหม่ (ฟอร์มอื่นคงไว้)
    });
  });
  API.on('catalog', function () { if (S.user) refreshCatalog().catch(function () {}); });

  document.addEventListener('click', function (e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const a = t.dataset.act;
    if (a === 'training-leave') { e.preventDefault(); Training.leave(); return; }
    if (a === 'usermenu' || a === 'more') { e.preventDefault(); userMenu(); }
    else if (a === 'gocart') { e.preventDefault(); location.hash = '#/cart'; }
  });
  window.addEventListener('hashchange', function () { if (S.user && S.me && !S.me.needDept && $('#view')) render(); });

  return {
    S: S, ROLE_TH: ROLE_TH, view: function (k, v) { views[k] = v; }, render: render, boot: boot, afterLogin: afterLogin,
    refreshMe: refreshMe, loadCatalog: loadCatalog, logout: logout, refreshCatalog: refreshCatalog, saveCart: saveCart, errorBox: errorBox,
    go: function (h) { if (location.hash === h) render(); else location.hash = h; }
  };
})();

/* ============================================================================
 *  เข้าสู่ระบบ: พิมพ์ชื่อ → แตะชื่อตัวเอง → PIN 4 หลัก (ไม่แสดงชื่อระบบอื่น)
 * ========================================================================== */
const Login = (function () {
  const $ = U.$;
  let acct = null, pin = '', busy = false, overlayResolve = null, overlayFor = null;

  function frame(inner) {
    const c = App.S.cfg || {};
    return '<div class="login login-glass"><section class="art"><b>' + U.esc(c.app_name || 'ระบบเบิกวัสดุ') + '</b><span>' + U.esc(c.org_name || 'ศาลจังหวัดลพบุรี') + '</span><i></i>' +
      '<p>เบิกวัสดุสิ้นเปลือง ติดตามคำขอ ประวัติการเบิก และสรุปสถิติ</p></section>' +
      '<section class="panel"><div class="box">' + inner + '</div></section></div>';
  }
  function show() {
    busy = false; waiting('');
    acct = Store.ls.get('last_acct', null);
    pin = '';
    if (acct) return pinStep();
    ROOT().innerHTML = frame('<h2>เข้าสู่ระบบ</h2><p class="muted">พิมพ์ชื่อหรือนามสกุลของคุณ แล้วแตะชื่อเพื่อใส่ PIN</p>' +
      '<div class="search"><span>' + ICON('search') + '</span><input id="q" autocomplete="off" placeholder="เช่น สมชาย" aria-label="ค้นหาชื่อ"></div>' +
      '<div class="row end"><button type="button" class="btn sm" id="acct-refresh">ค้นหารายชื่อใหม่</button></div>' +
      '<p class="err" id="err" role="alert"></p><ul class="acct-list hide" id="res" aria-live="polite"></ul>');
    const q = $('#q');
    q.focus();
    q.addEventListener('input', U.debounce(function () { search(false); }, 180));
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); search(true); } });
    $('#acct-refresh').onclick = function () { search(true); };
  }
  const memo = Object.create(null);
  let searchSeq = 0;
  function accountQuery(value) { return String(value || '').normalize('NFC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim(); }
  async function search(force) {
    const field = $('#q'), box = $('#res'), refresh = $('#acct-refresh');
    if (!field || !box) return;
    const q = accountQuery(field.value), seq = ++searchSeq;
    if (!q) { box.classList.add('hide'); if (refresh) refresh.disabled = false; return; }
    if (refresh) refresh.disabled = true;
    box.classList.remove('hide'); box.textContent = 'กำลังค้นหารายชื่อ…';
    $('#err').textContent = '';
    try {
      const cached = memo[q];
      const r = !force && cached && Date.now() - cached.at < 30000
        ? cached.rows : await API.call('searchAccounts', { q: q });
      if (!Array.isArray(r)) throw new Error('ไม่สามารถอ่านรายชื่อได้ กรุณากดค้นหารายชื่อใหม่');
      // Never retain an empty search. Newly added/activated users must be discoverable immediately.
      if (r.length) memo[q] = { at: Date.now(), rows: r }; else delete memo[q];
      if (seq !== searchSeq || !$('#res') || !$('#q') || accountQuery($('#q').value) !== q) return;
      box.innerHTML = r.length ? r.map(function (a, i) {
        return '<li><button data-i="' + i + '"><b>' + U.esc(a.name) + '</b><small>' + U.esc(a.dept || '—') + (a.ready ? '' : ' · ยังไม่ได้ตั้ง PIN') + '</small></button></li>';
      }).join('') : '<li class="empty small">ไม่พบชื่อที่ขึ้นต้นด้วย "' + U.esc(q) + '"<br>ลองพิมพ์ชื่ออีกครั้ง หรือกด “ค้นหารายชื่อใหม่”</li>';
      box.onclick = function (e) {
        const b = e.target.closest('button[data-i]');
        if (!b) return;
        acct = r[Number(b.dataset.i)];
        pinStep();
      };
    } catch (e) {
      if (seq === searchSeq && $('#res') && $('#q') && accountQuery($('#q').value) === q) {
        box.classList.add('hide'); $('#err').textContent = e.message;
      }
    } finally {
      if (seq === searchSeq && refresh && refresh.isConnected) refresh.disabled = false;
    }
  }
  function pinStep(msg) {
    pin = ''; busy = false;
    const html = '<h2>ใส่ PIN</h2><div class="who"><span class="avatar">' + U.esc(acct.name.charAt(0)) + '</span><div><b>' + U.esc(acct.name) + '</b>' +
      '<span class="muted small">' + U.esc(acct.dept || '') + '</span></div>' +
      (overlayFor ? '' : '<button class="btn sm ghost" id="chg" style="margin-left:auto">เปลี่ยนชื่อ</button>') + '</div>' +
      (msg ? '<div class="notice warn"><div>' + U.esc(msg) + '</div></div>' : '') +
      '<div class="pin-stage" id="pin-stage"><div class="pin-dots" id="dots"><i></i><i></i><i></i><i></i></div><p class="err" id="err" role="alert"></p>' +
      '<input id="pinin" class="pin-input" inputmode="numeric" autocomplete="one-time-code" maxlength="4" aria-label="PIN 4 หลัก">' +
      '<div class="keypad" id="kp">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button data-k="' + n + '">' + n + '</button>'; }).join('') +
      '<button class="fn" data-k="clr">ล้าง</button><button data-k="0">0</button><button class="fn" data-k="del">ลบ</button></div>' +
      '<div class="login-wait" id="login-wait" hidden role="status" aria-live="polite" aria-atomic="true"><div class="login-wait-card">' +
      '<div class="wait-dots" aria-hidden="true"><i></i><i></i><i></i></div>' +
      '<div class="wait-symbol" aria-hidden="true"><svg viewBox="0 0 64 64" fill="none"><path d="M12 22 20 10h24l8 12v30H12Z"/><path d="M12 22h40M27 10v22l5-3 5 3V10M36 41h9M36 46h9"/></svg></div>' +
      '<h3>กำลังเข้าสู่ระบบ</h3><p class="wait-phase" id="login-wait-phase">กำลังตรวจสอบ PIN</p><p class="wait-hint" id="login-wait-hint">กรุณารอสักครู่</p>' +
      '<div class="wait-shimmer" aria-hidden="true"><i></i></div></div></div></div>';
    if (overlayFor) { $('#reauth .box').innerHTML = html; }
    else ROOT().innerHTML = frame(html);
    const inp = $('#pinin');
    if (!('ontouchstart' in window)) inp.focus();
    inp.addEventListener('input', function () { if (busy) { inp.value = pin; return; } pin = inp.value.replace(/\D/g, '').slice(0, 4); dots(); if (pin.length === 4) submit(); });
    $('#kp').addEventListener('click', function (e) {
      const k = e.target.closest('[data-k]');
      if (!k || busy) return;
      flashKey(k.dataset.k);
      const v = k.dataset.k;
      if (v === 'del') pin = pin.slice(0, -1); else if (v === 'clr') pin = ''; else if (pin.length < 4) pin += v;
      inp.value = pin; dots();
      if (pin.length === 4) submit();
    });
    $('#kp').addEventListener('pointerdown', function(e) { const k = e.target.closest('[data-k]'); if (k && !busy) flashKey(k.dataset.k); });
    document.onkeydown = function (e) {
      if (busy) { if (/^\d$/.test(e.key) || e.key === 'Backspace') e.preventDefault(); return; }
      if (!$('#kp')) { document.onkeydown = null; return; }
      if (document.activeElement === inp) return;
      if (/^\d$/.test(e.key) && pin.length < 4) { flashKey(e.key); pin += e.key; inp.value = pin; dots(); if (pin.length === 4) submit(); }
      else if (e.key === 'Backspace') { pin = pin.slice(0, -1); inp.value = pin; dots(); }
    };
    const chg = $('#chg');
    if (chg) chg.onclick = function () { Store.ls.del('last_acct'); acct = null; show(); };
  }
  function dots() { U.$$('#dots i').forEach(function (d, i) { d.classList.toggle('on', i < pin.length); }); }
  let waitTimer = null;
  function flashKey(key) {
    if (!/^(?:[0-9]|clr|del)$/.test(String(key))) return;
    const btn = $('#kp [data-k="' + key + '"]'); if (!btn) return;
    btn.classList.remove('key-flash'); void btn.offsetWidth; btn.classList.add('key-flash');
    setTimeout(function() { btn.classList.remove('key-flash'); }, 380);
  }
  function waiting(phase) {
    clearTimeout(waitTimer);
    const stage = $('#pin-stage'), panel = $('#login-wait');
    if (!stage || !panel) return;
    stage.classList.toggle('is-waiting', !!phase); stage.setAttribute('aria-busy', phase ? 'true' : 'false');
    panel.hidden = !phase;
    U.$$('#kp button').forEach(function(b) { b.disabled = !!phase; });
    const inp = $('#pinin'), chg = $('#chg'); if (inp) inp.disabled = !!phase; if (chg) chg.disabled = !!phase;
    if (phase) {
      $('#login-wait-phase').textContent = phase;
      $('#login-wait-hint').textContent = 'กรุณารอสักครู่';
      waitTimer = setTimeout(function() { const hint = $('#login-wait-hint'); if (hint) hint.textContent = 'กำลังรอการตอบกลับจากเซิร์ฟเวอร์…'; }, 8000);
    }
  }
  async function submit() {
    if (busy) return;
    busy = true; waiting('กำลังตรวจสอบ PIN');
    const p = pin;
    try {
      const r = await API.call('login', { code: acct.code, pin: p });
      API.setToken(r.token);
      Store.ls.set('last_acct', { code: acct.code, name: r.user.name, dept: r.user.dept_name || acct.dept });
      if (r.mustChangePin) { busy = false; waiting(''); return newPin(); }
      if (overlayFor) { busy = false; waiting(''); return finishOverlay(r.user); }
    } catch (e) {
      busy = false; waiting('');
      pin = '';
      const inp = $('#pinin'); if (inp) inp.value = '';
      dots();
      const d = $('#dots'); if (d) { d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); }
      const er = $('#err'); if (er) er.textContent = e.message;
      if (e && e.code === 'PIN_CHANGE_AT_PRINTHUB' && er && window.APP_CONFIG && APP_CONFIG.PIN_URL) {
        er.insertAdjacentHTML('beforeend', ' <a href="' + U.esc(APP_CONFIG.PIN_URL) + '" target="_blank" rel="noopener">เปิดหน้าตั้ง PIN</a>');
      }
      return;
    }
    /* PIN ถูกต้องแล้ว — ถ้าโหลดหน้าแรกไม่สำเร็จ แสดงเป็นปัญหาการโหลด ไม่ใช่ PIN ผิด */
    waiting('กำลังโหลดข้อมูล');
    try {
      const results = await Promise.all([API.call('me'), API.call('catalog').catch(function () { return null; })]);
      await App.afterLogin(results[0], results[1]);
    } catch (e) {
      if (e && /^SESSION_|PIN_CHANGE/.test(e.code)) { show(); return; }
      ROOT().innerHTML = frame('<h2>เข้าสู่ระบบแล้ว แต่โหลดข้อมูลไม่สำเร็จ</h2>' + App.errorBox(e) +
        '<button class="btn primary block lg" id="retry">ลองโหลดอีกครั้ง</button>');
      $('#retry').onclick = function () { location.reload(); };
    } finally { busy = false; waiting(''); }
  }
  /** บัญชีที่ต้องเปลี่ยน PIN — ระบบนี้อ่านบัญชีกลาง (PrintHub) อย่างเดียว จึงให้ไปตั้งที่หน้าตั้ง PIN (ไม่แสดงชื่อระบบอื่น) */
  function newPin() {
    API.setToken('');
    const link = window.APP_CONFIG && APP_CONFIG.PIN_URL ? '<a class="btn primary block lg" href="' + U.esc(APP_CONFIG.PIN_URL) + '" target="_blank" rel="noopener">เปิดหน้าตั้ง PIN</a>' : '';
    const html = '<h2>ต้องตั้ง PIN ใหม่</h2><div class="notice warn"><div>บัญชีนี้ต้องตั้ง PIN ใหม่ที่หน้าตั้ง PIN ของบัญชีกลางก่อน แล้วจึงใช้ PIN ใหม่เข้าระบบนี้</div></div>' + link +
      '<button class="btn block" style="margin-top:8px" onclick="location.reload()">กลับ</button>';
    const target = overlayFor ? $('#reauth .box') : null;
    if (target) target.innerHTML = html; else ROOT().innerHTML = frame(html);
  }
  /** ผู้ใช้ใหม่: เลือกส่วนงาน (ครั้งเดียว) และตำแหน่งที่พิมพ์บนใบเบิก
   *  positionOnly = ส่วนงานตั้งไว้แล้ว (จับคู่อัตโนมัติ/ผู้ดูแลตั้งให้) แต่ยังไม่มีตำแหน่ง → ถามตำแหน่งอย่างเดียว ข้ามได้ */
  const SKIP_POS = 'sp:skippos:';
  function positionSkipped(code) { try { return sessionStorage.getItem(SKIP_POS + code) === '1'; } catch (e) { return false; } }
  async function pickDept(me, positionOnly) {
    let positions = [];
    try { positions = (await API.call('masters')).positions || []; } catch (e) { /**/ }
    const posField = '<label class="field"><span>ตำแหน่ง (พิมพ์บนใบเบิก)</span><input class="input" name="pos" list="poslist" value="' + U.esc(me.user.position || '') + '"' + (positionOnly ? ' required' : '') + '><datalist id="poslist">' +
      positions.map(function (p) { return '<option value="' + U.esc(p) + '">'; }).join('') + '</datalist></label>';
    if (positionOnly) {
      ROOT().innerHTML = frame('<h2>ตำแหน่งของคุณ</h2><p class="muted">ใช้พิมพ์ใต้ชื่อผู้ขอเบิกบนใบเบิก แก้ภายหลังได้ที่หน้า "โปรไฟล์และ PIN"</p>' +
        '<div class="who"><div><b>' + U.esc(me.user.name) + '</b><span class="muted small">' + U.esc(me.user.dept_name || '') + '</span></div></div>' +
        '<form id="dp">' + posField + '<p class="err" id="err"></p><button class="btn primary block lg">บันทึกและเริ่มใช้งาน</button>' +
        '<button type="button" class="btn ghost block" id="skip" style="margin-top:8px">ข้ามไปก่อน</button></form>');
      $('#skip').onclick = function () {
        try { sessionStorage.setItem(SKIP_POS + me.user.code, '1'); } catch (e) { /**/ }
        App.afterLogin(me);
      };
      $('#dp').onsubmit = async function (e) {
        e.preventDefault();
        if (!this.pos.value.trim()) { $('#err').textContent = 'กรุณากรอกตำแหน่ง หรือกด "ข้ามไปก่อน"'; return; }
        try {
          await API.write('saveProfile', { position: this.pos.value });
          App.afterLogin(await API.call('me'));
        } catch (er) { $('#err').textContent = er.message; }
      };
      return;
    }
    ROOT().innerHTML = frame('<h2>เลือกส่วนงานของคุณ</h2><p class="muted">ทำครั้งเดียว ใช้สำหรับใบเบิกและสถิติของส่วนงาน (เปลี่ยนภายหลังผ่านผู้ดูแลระบบ)</p>' +
      '<form id="dp"><label class="field"><span>ส่วนงาน</span><select class="input" name="dept" required><option value="">— เลือก —</option>' +
      me.departments.map(function (d) { return '<option value="' + U.esc(d.dept_id) + '">' + U.esc(d.name) + '</option>'; }).join('') + '</select></label>' +
      posField + '<p class="err" id="err"></p><button class="btn primary block lg">เริ่มใช้งาน</button></form>' +
      (me.departments.length ? '' : '<div class="notice warn"><div>ยังไม่มีรายชื่อส่วนงานในระบบ กรุณาติดต่อผู้ดูแลระบบ</div></div>'));
    $('#dp').onsubmit = async function (e) {
      e.preventDefault();
      try {
        await API.write('setMyDept', { dept_id: this.dept.value, position: this.pos.value });
        App.afterLogin(await API.call('me'));
      } catch (er) { $('#err').textContent = er.message; }
    };
  }
  /** ล็อกอินซ้ำทับหน้าเดิมเมื่อ session หมดอายุ (ร่าง/ตะกร้า/ฟอร์มยังอยู่) */
  function overlay(user, err) {
    return new Promise(function (resolve) {
      overlayResolve = resolve;
      overlayFor = user;
      acct = { code: user.code, name: user.name, dept: user.dept_name };
      const w = document.createElement('div');
      w.id = 'reauth';
      w.className = 'modal-wrap';
      w.innerHTML = '<div class="modal"><div class="box"></div></div>';
      document.body.appendChild(w);
      pinStep(err && err.code === 'SESSION_REVOKED' ? err.message : 'หมดเวลาการใช้งาน กรุณาใส่ PIN เพื่อทำต่อ — ร่างและตะกร้ายังอยู่ครบ');
    });
  }
  function finishOverlay(user) {
    const w = $('#reauth');
    if (user.code !== overlayFor.code) { location.reload(); return; }
    if (w) w.remove();
    overlayFor = null;
    U.toast('เข้าสู่ระบบแล้ว ทำรายการต่อได้', 'ok');
    if (overlayResolve) overlayResolve();
  }
  return { show: show, pickDept: pickDept, positionSkipped: positionSkipped, overlay: overlay };
})();



