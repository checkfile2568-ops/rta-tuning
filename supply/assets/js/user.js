/* ระบบบริหารวัสดุสำนักงาน · user.js — หน้าแรก · เบิกวัสดุ + ตะกร้า · คำขอของฉัน · อนุมัติ · โปรไฟล์ */
'use strict';
const ST_TH = { PENDING_APPROVAL: 'รออนุมัติ', PENDING_PREP: 'รอจัดเตรียม', READY: 'พร้อมรับ', ISSUED: 'จ่ายแล้ว', CANCELLED: 'ยกเลิก', REJECTED: 'ไม่อนุมัติ', RETURNED: 'ส่งกลับแก้ไข',
                queued: 'รอส่ง', sending: 'กำลังส่ง', failed: 'ส่งไม่สำเร็จ', needs_login: 'รอเข้าสู่ระบบ', rejected: 'ส่งไม่สำเร็จ' };
function stBadge(st) { return '<span class="badge st-' + st + '">' + U.esc(ST_TH[st] || st) + '</span>'; }

const Req = (function () {
  const S = App.S;
  const $ = U.$;
  function cartCount() { return Object.keys(S.cart).length; }
  function maxFor(m) {
    if (!m) return 0;
    if (m.lvl === 'out') return 0;
    let mx = 999;
    if (m.max_per_request > 0) mx = Math.min(mx, m.max_per_request);
    if (typeof m.available === 'number') mx = Math.min(mx, Math.max(0, m.available));
    return mx;
  }
  function setQty(id, q) {
    const m = S.idx[id];
    q = Math.max(0, Math.floor(Number(q) || 0));
    const mx = maxFor(m);
    if (q > mx) { q = mx; U.toast(m.name + ' เบิกได้ไม่เกิน ' + mx + ' ' + m.unit_name + ' ต่อครั้ง', 'warn'); }
    if (q > 0) S.cart[id] = q; else delete S.cart[id];
    App.saveCart();
    return q;
  }
  function stepper(id, q, disabled) {
    return '<div class="stepper" data-id="' + U.esc(id) + '"' + (disabled ? ' aria-disabled="true"' : '') + '>' +
      '<button type="button" class="minus" data-d="-1" aria-label="ลดจำนวน">−</button>' +
      '<input type="number" inputmode="numeric" min="0" value="' + (q || 0) + '" aria-label="จำนวน">' +
      '<button type="button" class="plus" data-d="1" aria-label="เพิ่มจำนวน">+</button></div>';
  }
  function bindSteppers(root, onChange) {
    root.addEventListener('click', function (e) {
      const b = e.target.closest('.stepper button');
      if (!b) return;
      const st = b.closest('.stepper');
      const inp = st.querySelector('input');
      inp.value = setQty(st.dataset.id, Number(inp.value || 0) + Number(b.dataset.d));
      if (onChange) onChange(st.dataset.id);
    });
    root.addEventListener('change', function (e) {
      const inp = e.target.closest('.stepper input');
      if (!inp) return;
      const st = inp.closest('.stepper');
      inp.value = setQty(st.dataset.id, inp.value);
      if (onChange) onChange(st.dataset.id);
    });
  }
  function renderCart() {
    const n = cartCount();
    const bar = $('#cartbar-t');
    if (bar) bar.textContent = n ? 'ตรวจตะกร้า · ' + n + ' รายการ' : 'ตะกร้าว่าง';
    const p = $('#cartpanel');
    if (!p) return;
    const ids = Object.keys(S.cart);
    p.innerHTML = '<div class="cart-h">' + ICON('cart') + '<div><h2>ตะกร้า</h2><span class="muted">จำนวน ' + n + ' รายการ</span></div></div>' +
      (ids.length ? '<ul class="cart-list">' + ids.map(function (id) {
        const m = S.idx[id] || { name: '(วัสดุนี้ปิดใช้งานแล้ว)', unit_name: '' };
        return '<li><div><b>' + U.esc(m.name) + '</b><small>' + U.esc(m.unit_name) + '</small></div><span class="q">' + S.cart[id] + '</span>' +
          '<button class="iconbtn" data-rm="' + U.esc(id) + '" aria-label="นำออก">' + ICON('x') + '</button></li>';
      }).join('') + '</ul>' : '<p class="cart-empty">ยังไม่มีรายการ<br><small>แตะ + ที่วัสดุเพื่อเพิ่มลงตะกร้า</small></p>') +
      '<button class="btn primary block lg" data-act="gocart"' + (n ? '' : ' disabled') + '>ตรวจตะกร้า ' + ICON('arrow') + '</button>' +
      (n ? '<p class="small muted" style="text-align:center;margin-top:10px">บันทึกเป็นร่างอัตโนมัติ — ยังไม่จองของจนกว่าจะส่งคำขอ</p>' : '');
    p.onclick = function (e) {
      const b = e.target.closest('[data-rm]');
      if (!b) return;
      delete S.cart[b.dataset.rm]; App.saveCart();
      const st = document.querySelector('.stepper[data-id="' + b.dataset.rm + '"] input');
      if (st) st.value = 0;
    };
  }
  document.addEventListener('cart', renderCart);
  return { stepper: stepper, bindSteppers: bindSteppers, renderCart: renderCart, setQty: setQty, maxFor: maxFor, cartCount: cartCount };
})();

/* ---------------------------------------------------------------- หน้าแรก */
App.view('home', {
  title: 'หน้าแรก',
  render: async function (el) {
    const S = App.S, u = S.user, c = S.me.counts || {};
    if (u.role === 'OFFICER' || u.role === 'SUPPLY_HEAD') return Officer.home(el);
    if (u.role === 'ADMIN') return Admin.home(el);
    el.classList.add('bento-surface');
    const nDraft = Req.cartCount();
    const freq = (S.me.frequent || []).map(function (id) { return S.idx[id]; }).filter(Boolean);
    const pending = (c.myPending || 0) + (c.myReady || 0) + (c.myReturned || 0);
    const favs = (S.me.favorites || []).map(function (id) { return S.idx[id]; }).filter(Boolean);
    el.innerHTML = '<section class="bento-welcome"><div class="welcome-copy"><span class="bento-eyebrow">พื้นที่ทำงานของคุณ</span>' + U.greetingHtml() + '<h2>' + U.nameHtml(u) + '</h2><p>' + U.esc(u.dept_name || '') + ' · ' + U.esc(App.ROLE_TH[u.role]) + '</p></div><div class="welcome-side">' + U.periodArt() +
      '<a class="btn gold lg" href="#/req">' + ICON('box') + 'เบิกวัสดุ</a></div></section>' + RW.banner('home') +
      '<nav class="bento-grid bento-menu bento-user-menu" aria-label="งานของฉัน"><a class="card" href="#/my">' + ICON('doc', 'ic') + (pending ? '<span class="task-count" aria-label="มีคำขอค้าง ' + pending + ' ใบ">' + U.n(pending) + '</span>' : '') + '<h3>คำขอของฉัน</h3><p>ติดตามการจัดเตรียมและการส่งมอบ</p></a><a class="card" href="#/dash">' + ICON('chart', 'ic') + '<h3>ประวัติการเบิก</h3><p>ตรวจรายการและสถิติตามสิทธิ์</p></a><a class="card" href="#/profile">' + ICON('user', 'ic') + '<h3>ข้อมูลของฉัน</h3><p>ตรวจส่วนงาน ตำแหน่ง และ PIN</p></a></nav>' +
      (c.myReturned ? '<div class="notice warn returned-notice">' + ICON('alert') + '<div><b>มีใบที่ส่งกลับแก้ไข ' + c.myReturned + ' ใบ</b>แก้ไขตามหมายเหตุแล้วยื่นใบเดิมอีกครั้ง <a href="#/my">แก้ไขใบเบิก</a></div></div>' : '') +
      (c.myReady ? '<div class="notice info">' + ICON('truck') + '<div><b>มีของพร้อมรับ ' + c.myReady + ' ใบ</b>ติดต่อรับที่งานพัสดุ <a href="#/my">ดูรายการ</a></div></div>' : '') +
      (nDraft ? '<div class="notice ok">' + ICON('cart') + '<div><b>มีร่างคำขอ ' + nDraft + ' รายการ</b>ยังไม่ได้ส่ง <a href="#/cart">ทำต่อ</a></div></div>' : '') +
      (favs.length ? '<div class="card"><div class="row"><h3 style="margin:0">รายการโปรด</h3><span class="spacer"></span><a class="small" href="#/req" data-fav-tab>ดูทั้งหมด</a></div><div class="chips quick-add" id="favs">' + favs.map(function (m) {
        return '<button class="chip fav" data-id="' + U.esc(m.mat_id) + '">★ ' + U.esc(m.name) + '</button>';
      }).join('') + '</div></div>' : '') +
      (freq.length ? '<div class="card"><h3>ใช้บ่อย</h3><div class="chips quick-add" id="freq">' + freq.map(function (m) {
        return '<button class="chip" data-id="' + U.esc(m.mat_id) + '">+ ' + U.esc(m.name) + '</button>';
      }).join('') + '</div></div>' : '') +
      '<div id="active"></div><div class="card"><div class="row"><h3 style="margin:0">คำขอล่าสุด</h3><span class="spacer"></span><button class="btn sm" id="again">' + ICON('copy') + 'เบิกเหมือนครั้งก่อน</button></div><div id="latest"><div class="skel"></div><div class="skel"></div></div></div>';
    const fv = U.$('[data-fav-tab]');
    if (fv) fv.onclick = function () { S.forms.req = { q: '', cat: 'fav' }; };
    const quickAdd = function (e) {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      const m = S.idx[b.dataset.id];
      if (Req.maxFor(m) < 1) { U.toast(m.name + ' หมดคลัง', 'warn'); return; }
      Req.setQty(m.mat_id, (S.cart[m.mat_id] || 0) + 1);
      U.toast('เพิ่ม ' + m.name + ' ลงตะกร้า', 'ok', 1500);
    };
    U.$$('.quick-add', el).forEach(function (x) { x.onclick = quickAdd; });
    let mine = [];
    try { mine = await API.call('myRequests', { limit: 5 }); } catch (e) { U.$('#latest').innerHTML = App.errorBox(e); return; }
    const active = mine.filter(function (r) { return ['PENDING_APPROVAL', 'PENDING_PREP', 'READY', 'RETURNED'].indexOf(r.status) >= 0; });
    if (active.length && U.$('#active')) U.$('#active').innerHTML = active.map(function (r) {
      return '<div class="card flow-card"><div class="row"><h3 style="margin:0">สถานะคำขอ ' + U.esc(r.req_no) + '</h3><span class="spacer"></span><a class="small" href="#/my">รายละเอียด</a></div>' +
        (r.status === 'RETURNED' ? My.returnedBox(r) : My.timeline(r) + (r.status !== 'READY' ? Track.permitHtml() : '')) + '</div>';
    }).join('');
    const ab = U.$('#active');
    if (ab) ab.addEventListener('click', function (e) {
      const b = e.target.closest('[data-fix]');
      if (b) My.fix(mine.find(function (x) { return x.req_id === b.dataset.fix; }));
    });
    U.$('#latest').innerHTML = mine.length ? mine.slice(0, 3).map(function (r) {
      return '<div class="row" style="padding:10px 0;border-bottom:1px solid var(--line-2)"><div><b>' + U.esc(r.req_no) + '</b>' + RW.urgentBadge(r) + ' <span class="muted small">' + U.thShort(r.created_at) + ' · ' + r.items.length + ' รายการ</span></div><span class="spacer"></span>' + stBadge(r.status) + '</div>';
    }).join('') + '<p><a href="#/my">ดูคำขอทั้งหมด</a></p>' : '<p class="muted">ยังไม่มีคำขอ</p>';
    U.$('#again').onclick = function () {
      const last = mine.find(function (r) { return r.status === 'ISSUED'; }) || mine.find(function (r) { return r.status !== 'RETURNED'; });
      if (last) My.reorder(last); else U.toast('ยังไม่มีใบเบิกเดิม', 'warn');
    };
  }
});

/* ---------------------------------------------------------------- เลือกวัสดุ */
App.view('req', {
  title: 'เบิกวัสดุ', cart: true,
  render: async function (el) {
    const S = App.S;
    const F = S.forms.req = S.forms.req || { q: '', cat: (S.me.favorites || []).length ? 'fav' : (S.me.frequent || []).length ? 'freq' : 'all' };
    const isFav = function (id) { return (S.me.favorites || []).indexOf(id) >= 0; };
    if (S.cfg.requests_paused) {
      el.innerHTML = '<h1>เบิกวัสดุ</h1><div class="notice warn"><div><b>ปิดรับคำขอชั่วคราว</b>กรุณาลองใหม่ภายหลัง</div></div>';
      return;
    }
    el.innerHTML = '<div class="page-h"><h1>เบิกวัสดุ</h1><p>เลือกวัสดุที่ต้องการและระบุจำนวน จากนั้นตรวจสอบรายการในตะกร้าก่อนส่งคำขอเบิก</p></div>' + RW.banner('req') +
      '<div class="search">' + ICON('search') + '<input id="mq" type="search" placeholder="ค้นหาชื่อหรือรหัสวัสดุ" autocomplete="off" value="' + U.esc(F.q) + '" aria-label="ค้นหาวัสดุ"></div>' +
      '<div class="tabs" id="cats" role="tablist"></div><p class="stale" id="stale"></p><ul class="mlist boxed" id="mlist"></ul>';
    if (!S.catalog) { U.$('#mlist').innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>'; await App.loadCatalog(true); }
    const cats = function () {
      const used = {};
      S.catalog.materials.forEach(function (m) { used[m.cat_id] = 1; });
      const t = [['fav', '★ รายการโปรด']];
      if ((S.me.frequent || []).length) t.push(['freq', 'ใช้บ่อย']);
      t.push(['all', 'ทั้งหมด']);
      (S.catalog.categories || []).forEach(function (c) { if (used[c.cat_id]) t.push([c.cat_id, c.name]); });
      U.$('#cats').innerHTML = t.map(function (x) { return '<button role="tab" data-c="' + U.esc(x[0]) + '" class="' + (F.cat === x[0] ? 'on' : '') + '">' + U.esc(x[1]) + '</button>'; }).join('');
    };
    const list = function () {
      const q = F.q.trim();
      let rows = S.catalog.materials;
      if (q) rows = rows.filter(function (m) { return U.match(m._s, q); });
      else if (F.cat === 'freq') rows = (S.me.frequent || []).map(function (id) { return S.idx[id]; }).filter(Boolean);
      else if (F.cat === 'fav') rows = (S.me.favorites || []).map(function (id) { return S.idx[id]; }).filter(Boolean);
      else if (F.cat !== 'all') rows = rows.filter(function (m) { return m.cat_id === F.cat; });
      const more = rows.length > 150;
      rows = rows.slice(0, 150);
      U.$('#mlist').innerHTML = rows.length ? rows.map(function (m) {
        const mx = Req.maxFor(m);
        const avail = '<small class="left">' + (typeof m.available === 'number' ? 'เหลือ ' + U.n(Math.max(0, m.available)) + ' ' : 'หน่วย ') + U.esc(m.unit_name) + '</small>';
        const fv = isFav(m.mat_id);
        return '<li class="mrow has-fav' + (m.lvl === 'out' ? ' out' : '') + '"><button class="fav-btn' + (fv ? ' on' : '') + '" data-fav="' + U.esc(m.mat_id) + '" aria-pressed="' + fv + '" aria-label="' + (fv ? 'นำออกจากรายการโปรด ' : 'เพิ่มในรายการโปรด ') + U.esc(m.name) + '" title="' + (fv ? 'นำออกจากรายการโปรด' : 'เพิ่มในรายการโปรด') + '">' + (fv ? '★' : '☆') + '</button><div class="nm"><b>' + U.esc(m.name) + '</b><small>' + U.esc(m.spec || '') + (m.spec ? ' · ' : '') + 'รหัส ' + U.esc(m.code) + '</small>' +
          (m.max_per_request ? '<span class="hint">เบิกได้ไม่เกิน ' + m.max_per_request + ' ' + U.esc(m.unit_name) + '/ครั้ง</span>' : '') +
          (RW.blocked(m) ? '<span class="hint rw-hint">' + ICON('clock') + 'นอกรอบการเบิก · ใส่ตะกร้าเป็นร่างได้</span>' : '') + '</div>' +
          '<div class="un"><small>หน่วย </small><b>' + U.esc(m.unit_name) + '</b></div><div class="st">' + U.badge(m.lvl) + avail + '</div>' +
          '<div class="qty">' + Req.stepper(m.mat_id, S.cart[m.mat_id] || 0, mx < 1) + '</div></li>';
      }).join('') + (more ? '<li class="muted small" style="padding:12px">แสดง 150 รายการแรก — พิมพ์ค้นหาเพื่อกรองให้แคบลง</li>' : '')
        : F.cat === 'fav' && !q ? '<li class="empty"><p class="fav-empty-star">☆</p><p>ยังไม่มีรายการโปรด<br><small>แตะ ☆ หน้าชื่อวัสดุที่เบิกประจำ เพื่อเก็บไว้เลือกเร็วครั้งหน้า</small></p></li>'
        : '<li class="empty">' + ICON('search') + '<p>ไม่พบวัสดุ' + (q ? 'ที่ตรงกับ "' + U.esc(q) + '"' : 'ในหมวดนี้') + '</p></li>';
      U.$('#stale').textContent = S.catAt ? 'ข้อมูลวัสดุ ณ ' + U.thDateTime(S.catAt) + ' · ยืนยันยอดอีกครั้งตอนส่งคำขอ' : '';
    };
    cats(); list();
    U.$('#mq').addEventListener('input', function () { F.q = this.value; list(); });
    U.$('#cats').addEventListener('click', function (e) {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      F.cat = b.dataset.c; F.q = ''; U.$('#mq').value = '';
      cats(); list();
    });
    Req.bindSteppers(U.$('#mlist'));
    U.$('#mlist').addEventListener('click', async function (e) {
      const b = e.target.closest('[data-fav]');
      if (!b || b.disabled) return;
      const id = b.dataset.fav, on = !isFav(id), before = (S.me.favorites || []).slice();
      S.me.favorites = on ? before.concat([id]) : before.filter(function (x) { return x !== id; });
      b.disabled = true; list();
      try {
        const r = await API.write('favoriteSet', { mat_id: id, on: on });
        S.me.favorites = r.favorites;
        U.toast(on ? 'เพิ่มในรายการโปรดแล้ว' : 'นำออกจากรายการโปรดแล้ว', 'ok', 1500);
      } catch (er) { S.me.favorites = before; U.toast(er.message, 'err'); }
      if (document.body.contains(U.$('#mlist'))) list();
    });
    const onCat = function () { if (document.body.contains(U.$('#mlist'))) list(); else document.removeEventListener('catalog', onCat); };
    document.addEventListener('catalog', onCat);
  }
});

/* ---------------------------------------------------------------- ตรวจตะกร้า + ส่งคำขอ */
App.view('cart', {
  title: 'ตรวจตะกร้า',
  render: async function (el) {
    const S = App.S, u = S.user;
    if (!S.catalog) await App.loadCatalog();
    const errs = S.forms.cartErrors || {};
    const ids = Object.keys(S.cart);
    if (!ids.length) {
      el.innerHTML = '<h1>ตรวจตะกร้า</h1><div class="empty">' + ICON('cart') + '<p>ตะกร้าว่าง</p><a class="btn primary" href="#/req">เลือกวัสดุ</a></div>';
      return;
    }
    const ed = S.editReq;
    const rw = RW.state();
    const outIds = ed ? [] : RW.blockedIds(S.cart);
    const sendLabel = function () { return (outIds.length && S.urgent ? 'ส่งคำขอเร่งด่วน (' : 'ส่งคำขอ (') + ids.length + ' รายการ)'; };
    el.innerHTML = (ed ? '<div class="page-h"><h1>แก้ไขใบ ' + U.esc(ed.req_no) + '</h1><p>ปรับรายการตามหมายเหตุ แล้วกด "ยื่นใบเดิมอีกครั้ง" — เลขที่ใบเบิกคงเดิม</p></div>' +
        '<div class="notice warn returned-notice">' + ICON('alert') + '<div><b>ส่งกลับแก้ไข' + (ed.by ? ' โดย ' + U.esc(ed.by) : '') + '</b>' + U.esc(ed.note || '-') + '</div></div>'
      : '<div class="page-h"><h1>ตรวจตะกร้า</h1><p>ตรวจจำนวนแล้วกด "ส่งคำขอ" — ระบบเติมชื่อ ส่วนงาน และวันที่ให้</p></div>' + RW.banner('cart')) +
      (S.forms.cartMsg ? '<div class="notice err"><div><b>ส่งคำขอไม่สำเร็จ</b>' + U.esc(S.forms.cartMsg) + '</div></div>' : '') +
      '<div class="card flat"><div class="grid3"><div><span class="muted small">ผู้ขอเบิก</span><br><b>' + U.esc(u.name) + '</b></div>' +
      '<div><span class="muted small">ส่วนงาน</span><br><b>' + U.esc(u.dept_name || '-') + '</b></div><div><span class="muted small">วันที่</span><br><b>' + U.thDate(new Date()) + '</b></div></div></div>' +
      '<ul class="mlist boxed" id="clist">' + ids.map(function (id) {
        const m = S.idx[id];
        if (!m) return '<li class="mrow out"><div class="nm"><b>(วัสดุปิดใช้งานแล้ว)</b><small>จะถูกนำออก</small></div></li>';
        const e = errs[id] || (!ed && RW.blocked(m) ? 'นอกรอบการเบิก' : '');
        return '<li class="mrow"><div class="nm"><b>' + U.esc(m.name) + '</b><small>รหัส ' + U.esc(m.code) + '</small>' + (e ? '<span class="hint" style="color:var(--out)">' + U.esc(e) + '</span>' : '') + '</div>' +
          '<div class="un"><small>หน่วย </small><b>' + U.esc(m.unit_name) + '</b></div><div class="st"><button class="btn sm ghost" data-rm="' + U.esc(id) + '">' + ICON('x') + 'นำออก</button></div>' +
          '<div class="qty">' + Req.stepper(id, S.cart[id], false) + '</div></li>';
      }).join('') + '</ul>' +
      '<label class="field" style="margin-top:16px"><span>วัตถุประสงค์ (ถ้ามี)</span><textarea class="input" id="purpose" maxlength="300" placeholder="เช่น ใช้ในงานสารบรรณ">' + U.esc(S.purpose || '') + '</textarea></label>' +
      (outIds.length ? (rw.w.urgent_enabled
        ? '<div class="card urgent-box"><label class="check"><input type="checkbox" id="urg"' + (S.urgent ? ' checked' : '') + '> <span><b>ขอเบิกวัสดุเร่งด่วน</b><br><small class="muted">มี ' + outIds.length + ' รายการอยู่นอกรอบการเบิก — ระบุเหตุผลให้หัวหน้าเจ้าหน้าที่พัสดุพิจารณา</small></span></label>' +
          '<label class="field" id="urg-f"' + (S.urgent ? '' : ' hidden') + '><span>เหตุผลที่ต้องใช้เร่งด่วน (จำเป็น)</span><textarea class="input" id="urg-r" maxlength="300" placeholder="เช่น หมึกพิมพ์หมด ต้องพิมพ์สำนวนส่งศาลอุทธรณ์ภายในวันนี้">' + U.esc(S.urgentReason || '') + '</textarea></label></div>'
        : '<div class="notice warn"><div><b>ยังส่งไม่ได้: มี ' + outIds.length + ' รายการอยู่นอกรอบการเบิก</b>นำรายการที่มีป้าย “นอกรอบการเบิก” ออกเพื่อส่งส่วนที่เหลือ หรือเก็บไว้ในตะกร้าแล้วส่งเมื่อเปิดรอบ</div></div>') : '') +
      '<div class="row"><a class="btn" href="#/req">' + ICON('plus') + 'เลือกวัสดุเพิ่ม</a>' + (ed ? '<button class="btn ghost" id="stopedit">เลิกแก้ไข</button>' : '') + '<span class="spacer"></span>' +
      '<button class="btn primary lg" id="send"' + (outIds.length && !rw.w.urgent_enabled ? ' disabled' : '') + '>' + (ed ? 'ยื่นใบเดิมอีกครั้ง (' + ids.length + ' รายการ)' : sendLabel()) + '</button></div>';
    if (ed) U.$('#stopedit').onclick = async function () {
      if (!(await U.confirm('เลิกแก้ไขใบ ' + ed.req_no, 'ล้างรายการในตะกร้าที่ดึงมาจากใบนี้ ใบเดิมยังอยู่ในสถานะส่งกลับแก้ไข แก้ไขต่อได้ภายหลัง', 'เลิกแก้ไข'))) return;
      S.cart = {}; S.purpose = ''; S.editReq = null; App.saveCart(); location.hash = '#/my';
    };
    ids.forEach(function (id) { if (!S.idx[id]) delete S.cart[id]; });
    Req.bindSteppers(U.$('#clist'), function () { if (!Object.keys(S.cart).length) App.render(); });
    U.$('#clist').addEventListener('click', function (e) {
      const b = e.target.closest('[data-rm]');
      if (!b) return;
      delete S.cart[b.dataset.rm]; App.saveCart(); App.render();
    });
    U.$('#purpose').addEventListener('input', function () { S.purpose = this.value; App.saveCart(); });
    if (U.$('#urg')) {
      U.$('#urg').onchange = function () { S.urgent = this.checked; U.$('#urg-f').hidden = !this.checked; U.$('#send').textContent = sendLabel(); if (this.checked) U.$('#urg-r').focus(); };
      U.$('#urg-r').addEventListener('input', function () { S.urgentReason = this.value; });
    }
    U.$('#send').onclick = async function () {
      const btn = this;
      const items = Object.keys(S.cart).map(function (id) { return { mat_id: id, qty: S.cart[id] }; });
      if (!items.length) return;
      btn.classList.add('busy'); btn.textContent = 'กำลังส่ง…';
      if (ed) {
        try {
          const r = await API.write('resubmitRequest', { req_id: ed.req_id, items: items, purpose: S.purpose || '' });
          S.cart = {}; S.purpose = ''; S.editReq = null; S.forms.cartErrors = {}; S.forms.cartMsg = '';
          App.saveCart(); App.refreshMe(); App.refreshCatalog().catch(function () {});
          el.innerHTML = '<div class="card" style="text-align:center;padding:36px 18px"><div style="color:var(--ok)">' + ICON('check').replace('<svg', '<svg style="width:64px;height:64px"') + '</div>' +
            '<h2>ยื่นใบเดิมอีกครั้งเรียบร้อย</h2><p class="muted">เลขที่ <b style="color:var(--ink)">' + U.esc(r.req_no) + '</b> · สถานะ ' + stBadge(r.status) + '</p>' +
            '<p class="muted small">ระบบจองของตามรายการใหม่แล้ว รอหัวหน้าเจ้าหน้าที่พัสดุพิจารณาอีกครั้ง</p>' +
            '<div class="row" style="justify-content:center;margin-top:16px"><a class="btn primary" href="#/my">ดูคำขอของฉัน</a></div></div>';
        } catch (er) {
          S.forms.cartMsg = er.message; S.forms.cartErrors = {};
          if (er.details && er.details.items) er.details.items.forEach(function (x) { S.forms.cartErrors[x.mat_id] = x.message || x.reason; });
          App.render();
        }
        return;
      }
      const data = { items: items, purpose: S.purpose || '' };
      if (outIds.length) {
        if (!rw.w.urgent_enabled) { btn.classList.remove('busy'); btn.textContent = sendLabel(); return; }
        if (!S.urgent) { btn.classList.remove('busy'); btn.textContent = sendLabel(); U.toast('มีรายการนอกรอบการเบิก — ติ๊ก "ขอเบิกวัสดุเร่งด่วน" พร้อมเหตุผล หรือนำรายการนั้นออก', 'warn', 5000); return; }
        if (!String(S.urgentReason || '').trim()) { btn.classList.remove('busy'); btn.textContent = sendLabel(); U.toast('กรุณาระบุเหตุผลที่ขอเบิกวัสดุเร่งด่วน', 'err'); U.$('#urg-r').focus(); return; }
        data.urgent = true; data.urgent_reason = String(S.urgentReason).trim();
      }
      const it = Outbox.add(data);
      try {
        const r = await Outbox.send(it);
        Outbox.remove(it.uuid);
        S.cart = {}; S.purpose = ''; S.urgent = false; S.urgentReason = ''; S.forms.cartErrors = {}; S.forms.cartMsg = '';
        App.saveCart();
        App.refreshMe(); App.refreshCatalog().catch(function () {});
        el.innerHTML = '<div class="card" style="text-align:center;padding:36px 18px"><div style="color:var(--ok)">' + ICON('check').replace('<svg', '<svg style="width:64px;height:64px"') + '</div>' +
          '<h2>ส่งคำขอเรียบร้อย</h2><p class="muted">เลขที่ <b style="color:var(--ink)">' + U.esc(r.req_no) + '</b> · สถานะ ' + stBadge(r.status) + '</p>' +
          (r.urgent ? '<p><span class="badge urgent">เร่งด่วน</span></p><p class="muted small">ส่งเป็นคำขอเบิกวัสดุเร่งด่วนแล้ว รอหัวหน้าเจ้าหน้าที่พัสดุพิจารณา</p>' : '<p class="muted small">ระบบจองของไว้ให้แล้ว เจ้าหน้าที่พัสดุจะจัดเตรียมและแจ้งเมื่อพร้อมรับ</p>') +
          '<div class="row" style="justify-content:center;margin-top:16px"><a class="btn" href="#/print/' + U.esc(r.req_id) + '">' + ICON('print') + 'พิมพ์ใบเบิก</a>' +
          '<a class="btn primary" href="#/my">ดูคำขอของฉัน</a></div></div>';
      } catch (e) {
        if (it.status === 'rejected') {
          Outbox.remove(it.uuid);
          if (/^(WINDOW_CLOSED|URGENT_OFF|NEED_URGENT_REASON)$/.test(e.code || '')) await App.refreshMe();
          S.forms.cartMsg = e.message;
          S.forms.cartErrors = {};
          if (e.details && e.details.items) e.details.items.forEach(function (x) { S.forms.cartErrors[x.mat_id] = x.message || x.reason; });
          App.render();
        } else {
          S.cart = {}; S.purpose = ''; App.saveCart();
          U.toast(it.status === 'needs_login' ? 'ต้องเข้าสู่ระบบใหม่ ระบบจะส่งคำขอนี้ให้อัตโนมัติ' : 'ส่งไม่สำเร็จ — คำขอถูกเก็บไว้ในเครื่อง กด "ส่งอีกครั้ง" ได้', 'warn', 5000);
          location.hash = '#/my';
        }
      }
    };
  }
});

/* ---------------------------------------------------------------- คำขอของฉัน */
const My = (function () {
  /** โฟลสถานะคำขอ — คำนวณจากสถานะและเวลาที่ระบบบันทึกอยู่แล้ว (เจ้าหน้าที่ไม่ต้องกดอะไรเพิ่ม)
   *  ส่งคำขอ → (อนุมัติ) → กำลังดำเนินการ → พร้อมรับ → ส่งมอบเสร็จสิ้น */
  /** แถบสถานะแบบติดตามพัสดุ: ยื่นแล้ว → อนุมัติ → เตรียมของ → รับแล้ว พร้อมเวลาของแต่ละขั้น */
  function timeline(r) {
    const st = r.status;
    const appr = App.S.cfg.approval_enabled || r.approved_at || st === 'PENDING_APPROVAL';
    const steps = [{ k: 'sent', t: r.resubmitted_at ? 'ยื่นใหม่แล้ว' : 'ยื่นแล้ว', at: r.resubmitted_at || r.created_at, done: true }];
    if (appr) steps.push({ k: 'appr', t: 'อนุมัติ', at: r.approved_at, done: st !== 'PENDING_APPROVAL' });
    steps.push({ k: 'prep', t: 'เตรียมของ', at: r.ready_at, done: !!r.ready_at || st === 'ISSUED' },
               { k: 'recv', t: 'รับแล้ว', at: r.issued_at, done: st === 'ISSUED' });
    const nowKey = { PENDING_APPROVAL: 'appr', PENDING_PREP: 'prep', READY: 'recv' }[st] || '';
    const hint = {
      PENDING_APPROVAL: 'รอหัวหน้าเจ้าหน้าที่พัสดุพิจารณาอนุมัติ',
      PENDING_PREP: 'อนุมัติแล้ว · เจ้าหน้าที่พัสดุกำลังเตรียมของ ระบบจะแจ้งเมื่อพร้อมรับ',
      READY: 'ของพร้อมแล้ว ติดต่อรับที่งานพัสดุ',
      ISSUED: 'รับของแล้ว' + (r.issued_at ? ' ' + U.thDateTime(r.issued_at) : '') + (r.receiver_name ? ' · ผู้รับ ' + r.receiver_name : '')
    }[st] || '';
    const label = { appr: 'รออนุมัติ', prep: 'กำลังเตรียม', recv: 'พร้อมรับ' };
    return '<ol class="tl flow track">' + steps.map(function (s) {
      const now = s.k === nowKey;
      return '<li class="' + (s.done && !now ? 'done' : '') + (now ? ' now' : '') + '"' + (now ? ' aria-current="step"' : '') + '><b>' + s.t + '</b>' +
        '<span class="tl-at">' + (now ? label[s.k] : s.done && s.at ? U.thDateTime(s.at) : s.done ? '✓' : '') + '</span></li>';
    }).join('') + '</ol>' + (hint ? '<p class="flow-hint st-' + st + '">' + U.esc(hint) + '</p>' : '');
  }
  const EV_TH = { SUBMIT: 'ยื่นคำขอ', RETURN: 'ส่งกลับแก้ไข', RESUBMIT: 'แก้ไขแล้วยื่นใหม่', APPROVE: 'อนุมัติ', REJECT: 'ไม่อนุมัติ',
                  READY: 'เตรียมของเสร็จ พร้อมรับ', ISSUE: 'ส่งมอบแล้ว', CANCEL: 'ยกเลิก' };
  function lines(list) { return (list || []).map(function (x) { return U.esc(x.name) + ' ' + U.n(x.qty) + ' ' + U.esc(x.unit || ''); }).join(', '); }
  /** ประวัติใบนี้ — ทุกครั้งที่ส่งกลับ/ยื่นใหม่อยู่ในใบเดียว */
  function history(r, open) {
    const ev = r.events || [];
    if (!ev.length) return '';
    return '<details class="req-history"' + (open ? ' open' : '') + '><summary>ประวัติใบนี้ (' + ev.length + ')</summary><ol>' + ev.map(function (e) {
      const d = e.detail || {};
      return '<li class="ev-' + U.esc(e.action) + '"><b>' + U.esc(EV_TH[e.action] || e.action) + '</b> <span class="muted small">' + U.thDateTime(e.ts) + (e.by ? ' · ' + U.esc(e.by) : '') + '</span>' +
        (e.note ? '<div class="ev-note">' + U.esc(e.note) + '</div>' : '') +
        (e.action === 'RESUBMIT' && d.before ? '<div class="small muted">เดิม: ' + lines(d.before) + '<br>ใหม่: ' + lines(d.after) + '</div>' : '') + '</li>';
    }).join('') + '</ol></details>';
  }
  function returnedBox(r) {
    return '<div class="notice warn returned-notice">' + ICON('alert') + '<div><b>ส่งกลับแก้ไข' + (r.returned_name ? ' โดย ' + U.esc(r.returned_name) : '') + (r.returned_at ? ' · ' + U.thDateTime(r.returned_at) : '') + '</b>' +
      U.esc(r.return_note || '-') + '<div class="acts" style="margin-top:8px"><button class="btn sm primary" data-fix="' + U.esc(r.req_id) + '">' + ICON('edit') + 'แก้ไขและยื่นใหม่</button></div></div></div>';
  }
  async function fix(r) {
    const S = App.S;
    if (!r) return;
    if (!S.catalog) await App.loadCatalog();
    if (Object.keys(S.cart).length && !(S.editReq && S.editReq.req_id === r.req_id) && !(await U.confirm('แก้ไขใบ ' + r.req_no, 'ตะกร้ามีรายการอยู่แล้ว ต้องการแทนที่ด้วยรายการจากใบนี้หรือไม่ (ร่างเดิมจะหายไป)', 'แทนที่'))) return;
    if (!(S.editReq && S.editReq.req_id === r.req_id && Object.keys(S.cart).length)) {
      S.cart = {};
      const skip = [];
      r.items.forEach(function (i) {
        const m = S.idx[i.mat_id];
        if (!m) { skip.push(i.name); return; }
        S.cart[i.mat_id] = i.qty_req;
      });
      S.purpose = r.purpose || '';
      if (skip.length) U.toast('วัสดุปิดใช้งานแล้ว: ' + skip.join(', '), 'warn', 5000);
    }
    S.editReq = { req_id: r.req_id, req_no: r.req_no, note: r.return_note || '', by: r.returned_name || '' };
    S.forms.cartErrors = {}; S.forms.cartMsg = '';
    App.saveCart();
    location.hash = '#/cart';
  }
  function card(r) {
    const open = ['PENDING_APPROVAL', 'PENDING_PREP', 'READY', 'RETURNED'].indexOf(r.status) >= 0;
    return '<div class="card req-card"><div class="top"><div><h3>' + U.esc(r.req_no) + RW.urgentBadge(r) + '</h3><span class="muted small">' + U.thDateTime(r.created_at) + '</span></div><span class="spacer"></span>' + stBadge(r.status) + '</div>' + RW.urgentReason(r) +
      '<ul class="items">' + r.items.map(function (i) {
        const got = i.qty_issued !== null && i.qty_issued !== undefined;
        return '<li><span>' + U.esc(i.name) + '</span><span class="muted">ขอ ' + U.n(i.qty_req) + (i.qty_approved !== null && i.qty_approved !== i.qty_req ? ' · อนุมัติ ' + U.n(i.qty_approved) : '') +
          (got ? ' · <b style="color:var(--ink)">ได้รับ ' + U.n(i.qty_issued - (i.qty_returned || 0)) + '</b>' : '') + ' ' + U.esc(i.unit_name) + '</span></li>';
      }).join('') + '</ul>' +
      (r.status === 'CANCELLED' || r.status === 'REJECTED' ? '<p class="muted small">เหตุผล: ' + U.esc(r.reason || '-') + '</p>' : r.status === 'RETURNED' ? returnedBox(r) : timeline(r)) +
      (r.receiver_name ? '<p class="muted small">ผู้รับของ: ' + U.esc(r.receiver_name) + '</p>' : '') +
      (r.edit_count ? '<p class="muted small">เจ้าหน้าที่พัสดุแก้ไขจำนวนที่ส่งมอบ ' + U.thDateTime(r.edited_at) + ' · ' + U.esc(r.edit_reason) + '</p>' : '') +
      '<div class="acts">' + (open ? '<button class="btn sm" data-cancel="' + U.esc(r.req_id) + '">' + ICON('x') + 'ยกเลิก</button>' : '') +
      '<a class="btn sm" href="#/print/' + U.esc(r.req_id) + '">' + ICON('print') + 'พิมพ์ใบเบิก</a>' +
      (r.status !== 'RETURNED' ? '<button class="btn sm" data-again="' + U.esc(r.req_id) + '">' + ICON('copy') + 'เบิกเหมือนครั้งก่อน</button>' : '') + '</div>' + history(r, r.status === 'RETURNED') + '</div>';
  }
  function outCard(it) {
    const S = App.S;
    return '<div class="card req-card"><div class="top"><div><h3>คำขอใหม่ (' + it.data.items.length + ' รายการ)</h3><span class="muted small">สร้าง ' + U.thDateTime(it.created) + '</span></div><span class="spacer"></span>' + stBadge(it.status) + '</div>' +
      '<ul class="items">' + it.data.items.map(function (x) { const m = S.idx[x.mat_id] || {}; return '<li><span>' + U.esc(m.name || x.mat_id) + '</span><span class="muted">' + x.qty + ' ' + U.esc(m.unit_name || '') + '</span></li>'; }).join('') + '</ul>' +
      (it.error ? '<p class="small" style="color:var(--out)">' + U.esc(it.error.message) + '</p>' : '<p class="small muted">รอยืนยันจากระบบ — ยังไม่ได้เลขที่ใบเบิก</p>') +
      '<div class="acts">' + (it.status === 'rejected' ? '<button class="btn sm primary" data-edit="' + it.uuid + '">แก้ไขในตะกร้า</button>' : '<button class="btn sm primary" data-retry="' + it.uuid + '">' + ICON('refresh') + 'ส่งอีกครั้ง</button>') +
      '<button class="btn sm" data-drop="' + it.uuid + '">ลบ</button></div></div>';
  }
  async function reorder(r) {
    const S = App.S;
    if (!S.catalog) await App.loadCatalog();
    if (Object.keys(S.cart).length && !(await U.confirm('เบิกเหมือนครั้งก่อน', 'ตะกร้ามีรายการอยู่แล้ว ต้องการแทนที่ด้วยรายการจากใบ ' + U.esc(r.req_no) + ' หรือไม่', 'แทนที่'))) return;
    S.cart = {}; S.editReq = null;
    const skip = [];
    r.items.forEach(function (i) {
      const m = S.idx[i.mat_id];
      const q = i.qty_issued !== null && i.qty_issued !== undefined ? i.qty_issued - (i.qty_returned || 0) : i.qty_req;
      if (!m || Req.maxFor(m) < 1 || q < 1) { skip.push(i.name); return; }
      S.cart[i.mat_id] = Math.min(q, Req.maxFor(m));
    });
    App.saveCart();
    if (skip.length) U.toast('ไม่ได้ใส่: ' + skip.join(', ') + ' (หมดหรือปิดใช้งาน)', 'warn', 5000);
    U.toast('ใส่รายการจากใบ ' + r.req_no + ' ลงตะกร้าแล้ว กรุณาตรวจจำนวนก่อนส่ง', 'ok');
    location.hash = '#/cart';
  }
  return { card: card, outCard: outCard, reorder: reorder, timeline: timeline, returnedBox: returnedBox, fix: fix, history: history };
})();

/* ---------------------------------------------------------------- ติดตามสถานะคำขออัตโนมัติ (ผู้ขอ/หัวหน้าส่วน)
 *  ระหว่างเปิดระบบไว้ ตรวจทุก 90 วินาที (เฉพาะตอนหน้าจอแสดงอยู่) เมื่อมีของพร้อมรับเพิ่ม → แจ้งบนจอ + แจ้งเตือนเครื่อง (ถ้าอนุญาต) */
const Track = (function () {
  let timer = null, last = null;
  function notify(n) {
    U.toast('มีของพร้อมรับ ' + n + ' ใบ — ติดต่อรับที่งานพัสดุ', 'ok', 8000);
    try { if (window.Notification && Notification.permission === 'granted') new Notification(U.APP_NAME, { body: 'ของที่ขอเบิกพร้อมรับแล้ว ติดต่อรับที่งานพัสดุ' }); } catch (e) { /**/ }
  }
  async function tick() {
    if (document.visibilityState !== 'visible' || document.querySelector('.modal-wrap')) return;
    const me = await App.refreshMe();
    if (!me) return;
    const n = (me.counts || {}).myReady || 0;
    if (last !== null && n > last) {
      notify(n);
      if (/^(home|my)$/.test(App.S.route)) App.render();
    }
    last = n;
  }
  function watch() {
    if (timer) return;
    last = ((App.S.me || {}).counts || {}).myReady || 0;
    timer = setInterval(tick, 90000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && timer) tick(); });
  }
  /** ปุ่มขออนุญาตแจ้งเตือนบนเครื่อง (แสดงเมื่อยังไม่เคยตอบ) */
  function permitHtml() {
    return window.Notification && Notification.permission === 'default'
      ? '<p class="small muted" style="margin:8px 0 0"><button class="btn sm" data-act="notify-permit">' + ICON('alert') + 'เปิดการแจ้งเตือนเมื่อของพร้อมรับ</button></p>' : '';
  }
  document.addEventListener('click', function (e) {
    const b = e.target.closest('[data-act="notify-permit"]');
    if (!b) return;
    Notification.requestPermission().then(function () { b.parentNode.remove(); });
  });
  return { watch: watch, permitHtml: permitHtml };
})();

/* ---------------------------------------------------------------- เปิดจาก QR บนใบเบิก (#/scan/<req_id>)
 *  เจ้าหน้าที่พัสดุ/ผู้ดูแล → เปิดใบนั้นในคิวจ่าย · ผู้ขอ/หัวหน้าส่วน → ดูสถานะใบนั้น */
App.view('scan', {
  title: 'เปิดใบเบิก',
  render: async function (el, params) {
    const id = params && params[0] ? decodeURIComponent(params[0]) : '';
    if (!id) { location.replace('#/home'); return; }
    if (App.S.user.role === 'OFFICER' || App.S.user.role === 'SUPPLY_HEAD' || App.S.user.role === 'ADMIN') { location.replace('#/queue/' + encodeURIComponent(id)); return; }
    el.innerHTML = '<div class="page-h"><h1>ใบเบิก</h1><p>สถานะล่าสุดของใบที่สแกน</p></div><div id="one"><div class="skel"></div></div>';
    try {
      const r = await API.call('getRequest', { req_id: id });
      U.$('#one').innerHTML = My.card(r) + '<p><a href="#/my">ดูคำขอทั้งหมดของฉัน</a></p>';
      U.$('#one').onclick = function (e) {
        const a = e.target.closest('[data-again]');
        if (a) My.reorder(r);
        if (e.target.closest('[data-fix]')) My.fix(r);
        const c = e.target.closest('[data-cancel]');
        if (c) location.hash = '#/my';
      };
    } catch (e) { U.$('#one').innerHTML = App.errorBox(e); }
  }
});

App.view('my', {
  title: 'คำขอของฉัน',
  render: async function (el) {
    const S = App.S;
    const F = S.forms.my = S.forms.my || { tab: 'open' };
    el.innerHTML = '<div class="page-h"><h1>คำขอของฉัน</h1><p>ติดตามสถานะ ยกเลิกก่อนจ่าย และพิมพ์ใบเบิก</p></div>' +
      '<div class="seg" id="tab"><button data-t="open">กำลังดำเนินการ</button><button data-t="done">ส่งมอบเสร็จสิ้น</button><button data-t="closed">ยกเลิก/ไม่อนุมัติ</button></div><div id="list" style="margin-top:16px"><div class="skel"></div><div class="skel"></div></div>';
    let rows = [];
    const draw = function () {
      U.$$('#tab button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === F.tab); });
      const want = { open: ['RETURNED', 'PENDING_APPROVAL', 'PENDING_PREP', 'READY'], done: ['ISSUED'], closed: ['CANCELLED', 'REJECTED'] }[F.tab];
      const out = F.tab === 'open' ? Outbox.pending() : [];
      const list = rows.filter(function (r) { return want.indexOf(r.status) >= 0; })
        .sort(function (a, b) { return (a.status === 'RETURNED' ? 0 : 1) - (b.status === 'RETURNED' ? 0 : 1); });
      U.$('#list').innerHTML = out.map(My.outCard).join('') + list.map(My.card).join('') ||
        '<div class="empty">' + ICON('doc') + '<p>ไม่มีคำขอในหมวดนี้</p>' + (F.tab === 'open' ? '<a class="btn primary" href="#/req">เบิกวัสดุ</a>' : '') + '</div>';
    };
    U.$('#tab').onclick = function (e) { const b = e.target.closest('[data-t]'); if (b) { F.tab = b.dataset.t; draw(); } };
    U.$('#list').onclick = async function (e) {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.cancel) {
        const r = rows.find(function (x) { return x.req_id === t.dataset.cancel; });
        if (!(await U.confirm('ยกเลิกคำขอ ' + r.req_no, r.status === 'READY' ? 'เจ้าหน้าที่เตรียมของไว้แล้ว — ยกเลิกแล้วระบบจะแจ้งให้นำของกลับเข้าคลัง' : 'ยืนยันยกเลิกคำขอนี้', 'ยกเลิกคำขอ', true))) return;
        try {
          await API.write('cancelRequest', { req_id: r.req_id });
          if (App.S.editReq && App.S.editReq.req_id === r.req_id) { App.S.editReq = null; App.S.cart = {}; App.S.purpose = ''; App.saveCart(); }
          U.toast('ยกเลิกแล้ว', 'ok'); App.refreshMe(); App.render();
        } catch (er) { U.toast(er.message, 'err'); }
      } else if (t.dataset.fix) My.fix(rows.find(function (x) { return x.req_id === t.dataset.fix; }));
      else if (t.dataset.again) My.reorder(rows.find(function (x) { return x.req_id === t.dataset.again; }));
      else if (t.dataset.retry) {
        t.classList.add('busy');
        try { const r = await Outbox.retry(t.dataset.retry); Outbox.remove(t.dataset.retry); U.toast('ส่งคำขอแล้ว เลขที่ ' + r.req_no, 'ok'); App.render(); }
        catch (er) { U.toast(er.message, 'err'); draw(); }
      } else if (t.dataset.drop) {
        if (await U.confirm('ลบคำขอที่ยังไม่ได้ส่ง', 'รายการนี้ยังไม่ถึงระบบ ลบแล้วกู้คืนไม่ได้', 'ลบ', true)) { Outbox.remove(t.dataset.drop); draw(); }
      } else if (t.dataset.edit) {
        const it = Outbox.list().find(function (x) { return x.uuid === t.dataset.edit; });
        App.S.cart = {}; it.data.items.forEach(function (x) { App.S.cart[x.mat_id] = x.qty; }); App.S.purpose = it.data.purpose || '';
        App.saveCart(); Outbox.remove(it.uuid); location.hash = '#/cart';
      }
    };
    draw();
    try { rows = await API.call('myRequests', { limit: 100 }); } catch (e) { U.$('#list').innerHTML = App.errorBox(e); return; }
    draw();
  }
});

/* ---------------------------------------------------------------- อนุมัติคำขอ (เมื่อเปิดขั้นอนุมัติ) */
App.view('approve', {
  title: 'อนุมัติเบิกจ่ายวัสดุ', roles: ['SUPPLY_HEAD'],
  render: async function (el) {
    el.innerHTML = '<div class="page-h"><h1>อนุมัติเบิกจ่ายวัสดุ</h1><p>จำนวนอนุมัติตั้งไว้เท่าที่ขอ (ไม่เกินยอดพร้อมอนุมัติ) — แก้เฉพาะบรรทัดที่ต้องลด แล้วกด "อนุมัติทั้งใบ"</p></div><div class="approval-stock-tools"><span class="small muted" id="approval-checked" role="status"></span><button class="btn sm" id="approval-refresh">อัปเดตยอดวัสดุ</button></div><div id="approval-recovery"></div><div id="approval-list"><div class="skel"></div></div>';
    const $ = function (selector) { return el.querySelector(selector); };
    const listBox = $('#approval-list');
    const active = function () { return el.isConnected && el.contains(listBox); };
    const recover = function () {
      if (!active()) return false;
      const actions = ['approveRequest', 'rejectRequest', 'returnRequest'].filter(function (a) { return API.pendingWrite && API.pendingWrite(a); });
      $('#approval-recovery').innerHTML = actions.map(function (a) { return '<div class="notice warn approval-recovery"><div>รายการเดิมยังไม่ทราบผลบันทึก กรุณาตรวจสอบด้วยรหัสเดิมก่อนทำรายการต่อ <button class="btn" data-recover="' + a + '">ตรวจสอบผลรายการเดิม</button></div></div>'; }).join('');
      return actions.length > 0;
    };
    recover();
    $('#approval-recovery').onclick = async function (e) {
      const b = e.target.closest('[data-recover]'); if (!b || b.disabled) return;
      const pending = API.pendingWrite(b.dataset.recover); if (!pending) return;
      b.disabled = true;
      try { await API.write(b.dataset.recover, pending.data); await App.refreshMe(); App.render(); }
      catch (er) { b.disabled = false; U.toast(er.message, 'err'); }
    };
    if (!App.S.cfg.approval_enabled) { $('#approval-list').innerHTML = '<div class="notice info"><div>ยังไม่เปิดขั้นอนุมัติในพื้นที่นี้</div></div>'; return; }
    let busy = false, refreshing = false, stockFresh = true;
    const rows = await API.call('approvals');
    if (!active()) return;
    const monthLabel = (rows[0] && rows[0].month_label) || '';
    const knownStock = function (i) { const s = i.stock; return !!s && s.valid === true && typeof s.balance === 'number' && Number.isFinite(s.balance) && typeof s.reserved_other === 'number' && Number.isFinite(s.reserved_other) && typeof s.available_for_request === 'number' && Number.isFinite(s.available_for_request) && s.available_for_request >= 0; };
    const maximum = function (i) { return knownStock(i) ? Math.max(0, Math.min(i.qty_req, i.stock.available_for_request)) : 0; };
    const stockHtml = function (i) {
      if (!knownStock(i)) return '<p class="approval-stock-error">ยังตรวจสอบยอดวัสดุไม่ได้ กรุณาอัปเดตยอดก่อนอนุมัติ</p>';
      const s = i.stock;
      return '<dl class="approval-stock"><div><dt>คงคลัง</dt><dd>' + U.n(s.balance) + '</dd></div><div><dt>กันให้ใบอื่น</dt><dd>' + U.n(s.reserved_other) + '</dd></div><div class="approval-stock-ready"><dt>พร้อมอนุมัติ</dt><dd>' + U.n(s.available_for_request) + '</dd></div>' +
        '<div class="approval-dept"><dt>ส่วนงานนี้เบิก' + (monthLabel ? 'เดือน' + U.esc(monthLabel.split(' ')[0]) : 'เดือนนี้') + '</dt><dd>' + U.n(i.dept_month || 0) + '</dd></div></dl>';
    };
    $('#approval-list').innerHTML = rows.length ? rows.map(function (r) {
      return '<div class="card req-card approval-card" data-id="' + U.esc(r.req_id) + '"><div class="top"><div><h3>' + U.esc(r.req_no) + RW.urgentBadge(r) + (r.return_count ? ' <span class="badge st-RETURNED">ยื่นใหม่ครั้งที่ ' + r.return_count + '</span>' : '') + '</h3><span class="muted small">' + U.esc(r.requester_name) + ' · ' + U.esc(r.dept_name) + ' · ' + U.thDateTime(r.resubmitted_at || r.created_at) + '</span></div></div>' +
        RW.urgentReason(r) + (r.purpose ? '<p class="small">วัตถุประสงค์: ' + U.esc(r.purpose) + '</p>' : '') +
        (r.events && r.events.length ? My.history(r, true) : '') +
        '<div class="tablewrap"><table class="t approval-items"><thead><tr><th>วัสดุและยอดคงเหลือ</th><th class="num">จำนวนที่ขอ</th><th class="num">อนุมัติจ่าย</th><th class="num">จ่ายจริง</th></tr></thead><tbody>' + r.items.map(function (i) {
          return '<tr><td><b>' + U.esc(i.name) + '</b><small class="muted"> ' + U.esc(i.unit_name) + '</small><div data-stock-item="' + U.esc(i.item_id) + '">' + stockHtml(i) + '</div><small class="approval-after" data-after-item="' + U.esc(i.item_id) + '"></small></td><td class="num" data-label="จำนวนที่ขอ">' + U.n(i.qty_req) + '</td><td class="num" data-label="อนุมัติจ่าย"><input class="input num" type="number" inputmode="numeric" min="0" max="' + maximum(i) + '" value="' + maximum(i) + '" data-item="' + U.esc(i.item_id) + '" aria-label="อนุมัติ ' + U.esc(i.name) + '"></td><td class="num issued-value" data-label="จ่ายจริง">' + (i.qty_issued === null || i.qty_issued === undefined ? 'ยังไม่จ่าย' : U.n(i.qty_issued - (i.qty_returned || 0))) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="approval-total" data-total></p><p class="approval-footnote">ตัดคงคลังจริงเมื่อเจ้าหน้าที่ส่งมอบ · ส่งกลับแก้ไขแล้ว ผู้ขอแก้และยื่นในเลขเดิม</p><p class="approval-stock-error" data-request-state role="status"></p><div class="acts approval-acts"><button class="btn primary lg" data-ok>' + ICON('check') + 'อนุมัติทั้งใบ</button><button class="btn" data-back>' + ICON('edit') + 'ส่งกลับแก้ไข</button><button class="btn ghost danger-text" data-no>ไม่อนุมัติ</button></div></div>';
    }).join('') : '<div class="empty">' + ICON('check') + '<p>ไม่มีคำขอรออนุมัติ</p></div>';
    const totals = function (card) {
      const request = rows.find(function (r) { return r.req_id === card.dataset.id; });
      const quantities = {}; let valid = stockFresh && !request.stock_stale;
      U.$$('input[data-item]', card).forEach(function (input) {
        const item = request.items.find(function (i) { return i.item_id === input.dataset.item; });
        const qty = Number(input.value), max = maximum(item);
        quantities[item.item_id] = qty; input.max = max;
        const ok = input.value !== '' && Number.isInteger(qty) && qty >= 0 && qty <= max && knownStock(item);
        input.setAttribute('aria-invalid', ok ? 'false' : 'true'); valid = valid && ok;
        const after = card.querySelector('[data-after-item="' + item.item_id + '"]');
        after.textContent = !knownStock(item) ? '' : ok ? 'เมื่ออนุมัติใบนี้ จะเหลือพร้อมใช้สำหรับคำขอใหม่ ' + U.n(item.stock.available_for_request - qty) + ' ' + item.unit_name : 'อนุมัติได้ไม่เกิน ' + U.n(max) + ' ' + item.unit_name;
      });
      card.querySelector('[data-total]').innerHTML = 'รวมจำนวนอนุมัติตามหน่วย ' + U.quantityTotals(request.items.map(function (i) { return Object.assign({}, i, { qty_approved: quantities[i.item_id] }); }), 'qty_approved');
      card.querySelector('[data-ok]').disabled = busy || !valid || !Object.keys(quantities).some(function (id) { return quantities[id] > 0; });
      card.querySelector('[data-no]').disabled = busy || !!request.stock_stale;
      card.querySelector('[data-back]').disabled = busy || !!request.stock_stale;
    };
    const checked = function () { $('#approval-checked').textContent = 'ยอดล่าสุด ' + new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date()) + ' · อัปเดตอัตโนมัติทุก 30 วินาที'; };
    checked(); U.$$('.approval-card', el).forEach(totals);
    const refreshStock = async function () {
      if (busy || refreshing || !active()) return;
      refreshing = true; const button = el.querySelector('#approval-refresh'); button.disabled = true;
      try {
        const latest = await API.call('approvals');
        if (!active()) return;
        stockFresh = true;
        U.$$('.approval-card', el).forEach(function (card) {
          const request = rows.find(function (r) { return r.req_id === card.dataset.id; });
          const fresh = latest.find(function (r) { return r.req_id === request.req_id; });
          request.stock_stale = !fresh || fresh.updated_at !== request.updated_at;
          card.querySelector('[data-request-state]').textContent = request.stock_stale ? 'คำขอนี้เปลี่ยนแล้ว กรุณาโหลดรายการล่าสุดก่อนดำเนินการ' : '';
          request.items.forEach(function (item) {
            const next = fresh && fresh.items.find(function (i) { return i.item_id === item.item_id; });
            item.stock = next ? next.stock : null;
            card.querySelector('[data-stock-item="' + item.item_id + '"]').innerHTML = stockHtml(item);
          });
          totals(card);
        });
        checked();
      } catch (er) {
        if (!active()) return;
        stockFresh = false;
        el.querySelector('#approval-checked').textContent = 'อัปเดตยอดไม่สำเร็จ กรุณากดอัปเดตยอดวัสดุก่อนอนุมัติ';
        U.$$('.approval-card', el).forEach(totals);
      } finally { refreshing = false; button.disabled = false; }
    };
    $('#approval-refresh').onclick = refreshStock;
    $('#approval-list').oninput = function (e) { const card = e.target.closest('.approval-card'); if (card) totals(card); };
    $('#approval-list').onclick = async function (e) {
      if (busy || refreshing || recover()) return;
      const c = e.target.closest('.card'); if (!c) return;
      const id = c.dataset.id;
      const request = rows.find(function (r) { return r.req_id === id; });
      if (e.target.closest('[data-ok]')) {
        const inputs = U.$$('input[data-item]', c);
        const items = inputs.map(function (i) { return { item_id: i.dataset.item, qty_approved: Number(i.value) }; });
        const bad = inputs.some(function (input) { const item = request.items.find(function (x) { return x.item_id === input.dataset.item; }); return input.value === '' || !knownStock(item) || !Number.isInteger(Number(input.value)) || Number(input.value) < 0 || Number(input.value) > maximum(item); });
        if (request.stock_stale || !stockFresh || bad) { U.toast('กรุณาอัปเดตยอดและระบุจำนวนอนุมัติไม่เกินยอดพร้อมอนุมัติและจำนวนที่ขอ', 'err'); return; }
        if (!items.some(function (i) { return i.qty_approved > 0; })) { U.toast('ถ้าไม่จ่ายทุกรายการ ให้กดไม่อนุมัติพร้อมเหตุผล', 'err'); return; }
        busy = true; U.$$('button,input', c).forEach(function (x) { x.disabled = true; });
        try { await API.write('approveRequest', { req_id: id, items: items, expected_updated_at: request.updated_at }); U.toast('อนุมัติ กันจำนวนวัสดุ และบันทึกผู้ลงนามแล้ว', 'ok'); await App.refreshMe(); App.render(); }
        catch (er) { busy = false; U.$$('button,input', c).forEach(function (x) { x.disabled = false; }); recover(); U.toast(er.message, 'err'); await refreshStock(); }
      } else if (e.target.closest('[data-back]')) {
        if (request.stock_stale) return;
        const v = await U.modal({ title: 'ส่งกลับแก้ไข ' + U.esc(request.req_no), html: '<p class="small muted">ผู้ขอจะเห็นหมายเหตุนี้ แก้รายการ แล้วยื่นในเลขเดิม · ระบบคืนยอดจองระหว่างรอแก้</p><label class="field"><span>ให้แก้ไขอะไร</span><textarea class="input" name="note" required maxlength="300" placeholder="เช่น ลดกระดาษเหลือ 5 รีม / ระบุวัตถุประสงค์ให้ชัดเจน"></textarea></label>', ok: 'ส่งกลับแก้ไข' });
        if (!v || busy) return;
        if (!String(v.note || '').trim()) { U.toast('กรุณาระบุสิ่งที่ต้องการให้แก้ไข', 'err'); return; }
        busy = true;
        try { await API.write('returnRequest', { req_id: id, note: v.note, expected_updated_at: request.updated_at }); U.toast('ส่งกลับให้ผู้ขอแก้ไขแล้ว', 'ok'); await App.refreshMe(); App.render(); }
        catch (er) { busy = false; recover(); U.toast(er.message, 'err'); await refreshStock(); }
      } else if (e.target.closest('[data-no]')) {
        if (request.stock_stale) return;
        const v = await U.modal({ title: 'ไม่อนุมัติคำขอ', html: '<label class="field"><span>เหตุผล</span><textarea class="input" name="reason" required></textarea></label>', ok: 'ไม่อนุมัติ', danger: true });
        if (!v || busy) return;
        busy = true;
        try { await API.write('rejectRequest', { req_id: id, reason: v.reason, expected_updated_at: request.updated_at }); U.toast('บันทึกแล้ว', 'ok'); await App.refreshMe(); App.render(); }
        catch (er) { busy = false; recover(); U.toast(er.message, 'err'); await refreshStock(); }
      }
    };
    const timer = setInterval(function () {
      if (!active() || !App.S.user || App.S.user.role !== 'SUPPLY_HEAD' || (App.S.route && App.S.route !== 'approve')) { clearInterval(timer); return; }
      if (!document.hidden && !document.querySelector('.modal-wrap')) refreshStock();
    }, 30000);
  }
});

/* ---------------------------------------------------------------- โปรไฟล์ */
App.view('profile', {
  title: 'โปรไฟล์',
  render: async function (el) {
    const u = App.S.user;
    let positions = [];
    try { positions = (await API.call('masters')).positions || []; } catch (e) { /**/ }
    el.innerHTML = '<div class="page-h"><h1>โปรไฟล์และ PIN</h1><p>ชื่อ-สกุลและส่วนงานแก้ไขโดยผู้ดูแลระบบ</p></div>' +
      '<div class="card"><div class="grid3"><div><span class="muted small">ชื่อ-สกุล</span><br><b>' + U.esc(u.name) + '</b></div><div><span class="muted small">ส่วนงาน</span><br><b>' + U.esc(u.dept_name || '-') + '</b></div>' +
      '<div><span class="muted small">สิทธิ์</span><br><b>' + U.roleHtml(App.ROLE_TH[u.role]) + '</b></div></div>' +
      '<form id="pf" style="margin-top:14px"><label class="field"><span>ตำแหน่ง (พิมพ์บนใบเบิก)</span><input class="input" name="position" list="pl" value="' + U.esc(u.position || '') + '"><datalist id="pl">' +
      positions.map(function (p) { return '<option value="' + U.esc(p) + '">'; }).join('') + '</datalist></label><button class="btn primary">บันทึกตำแหน่ง</button></form></div>' +
      '<div class="card"><h3>PIN</h3><p>ระบบนี้ใช้บัญชีและ PIN เดียวกับบัญชีกลางของศาล — เปลี่ยน PIN ให้ทำที่หน้าตั้ง PIN แล้วใช้ PIN ใหม่เข้าระบบนี้ได้ทันที · ลืม PIN ติดต่อผู้ดูแลระบบ</p>' +
      (window.APP_CONFIG && APP_CONFIG.PIN_URL ? '<a class="btn" href="' + U.esc(APP_CONFIG.PIN_URL) + '" target="_blank" rel="noopener">เปิดหน้าตั้ง PIN</a>' : '') + '</div>' +
      '<button class="btn danger" id="lo">' + ICON('logout') + 'ออกจากระบบ</button>';
    U.$('#pf').onsubmit = async function (e) {
      e.preventDefault();
      try { const r = await API.write('saveProfile', { position: this.position.value }); App.S.user = r.user; U.toast('บันทึกแล้ว', 'ok'); } catch (er) { U.toast(er.message, 'err'); }
    };
    U.$('#lo').onclick = function () { App.logout(); };
  }
});
