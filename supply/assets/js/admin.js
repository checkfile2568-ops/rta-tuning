/* ระบบบริหารวัสดุสำนักงาน · admin.js — ภาพรวม · ผู้ใช้และสิทธิ์ · ส่วนงาน · หมวด/หน่วย/วันหยุด · ตั้งค่าระบบ · สำรองข้อมูล */
'use strict';
const Admin = (function () {
  async function home(el) {
    const c = App.S.me.counts || {};
    el.innerHTML = '<div class="page-h"><h1>ภาพรวมระบบ</h1><p>' + U.thDate(new Date()) + ' · ปีงบประมาณ ' + U.fy() + '</p></div>' +
      (c.repairs ? '<div class="notice err">' + ICON('wrench') + '<div><b>มีรายการบันทึกไม่ครบ ' + c.repairs + ' รายการ</b>วัสดุที่เกี่ยวข้องถูกระงับไว้ <a href="#/reconcile">ไปตรวจซ่อม</a></div></div>' : '') +
      (App.S.cfg.demo_accounts ? '<div class="notice warn"><div><b>ใช้บัญชีทดสอบอยู่</b>ยังไม่ได้ตั้ง PRINTHUB_DB_ID — ข้อมูลผู้ใช้เป็นข้อมูลสมมติ</div></div>' : '') +
      (!App.S.cfg.cost_method ? '<div class="notice warn"><div><b>ยังไม่ได้เลือกวิธีคิดมูลค่าวัสดุ</b><a href="#/settings">ตั้งค่า</a></div></div>' : '') +
      '<div class="kpis" id="k"><div class="skel"></div></div>' +
      '<div class="cards"><a class="card" href="#/real-trial" style="text-decoration:none"><h3>ทดสอบบนฐานข้อมูลจริง</h3><p class="muted small">เริ่มจากยอด 0 เติมตัวอย่าง เบิก–จ่ายจริง และล้างกลับจุดเริ่มต้นพร้อมสำเนากู้คืน</p></a><a class="card" href="#/training" style="text-decoration:none"><h3>ทดลองใช้งาน</h3><p class="muted small">สร้างหรือล้างชุดฝึกวัสดุ 10 รายการ แยกจากคลังจริง</p></a><a class="card" href="#/users" style="text-decoration:none">' + ICON('users', 'ic') + '<h3>ผู้ใช้และสิทธิ์</h3><p class="muted small">กำหนดผู้ขอเบิก หัวหน้าส่วน เจ้าหน้าที่พัสดุ ผู้ดูแลระบบ รายบัญชี</p></a>' +
      '<a class="card" href="#/settings" style="text-decoration:none"><h3>ตั้งค่าระบบ</h3><p class="muted small">วิธีคิดมูลค่า กฎกันคำขอซ้ำ การแสดงยอด เลขเอกสาร ระยะขอบพิมพ์</p></a>' +
      '<a class="card" href="#/backup" style="text-decoration:none"><h3>สำรองข้อมูล</h3><p class="muted small">สำรองทันที และตรวจสำเนาเทียบข้อมูลจริง</p></a>' +
      '<a class="card" href="#/reconcile" style="text-decoration:none"><h3>กระทบยอด</h3><p class="muted small">ตรวจยอดคงเหลือ ยอดจอง มูลค่า กับ ledger</p></a></div>';
    try {
      const d = await API.call('dashboard', { dept_id: 'ALL' });
      U.$('#k').innerHTML = kpi('ใบเบิกปีงบนี้', U.n(d.kpi.req_count), 'ใบ') + kpi('รายการที่จ่าย', U.n(d.kpi.lines_issued), 'รายการ') +
        (d.can_value ? kpi('มูลค่าเบิกจ่าย', U.money(d.kpi.value_issued), 'บาท') + kpi('มูลค่าคงคลัง', U.money(d.kpi.inventory_value), 'บาท · ' + U.n(d.kpi.inventory_items) + ' รายการ') : '') +
        kpi('คำขอค้างเกิน ' + d.kpi.lead_alert_days + ' วันทำการ', U.n(d.kpi.open_over_days), 'ใบ');
    } catch (e) { U.$('#k').innerHTML = App.errorBox(e); }
  }
  function kpi(t, v, s) { return '<div class="kpi"><small>' + U.esc(t) + '</small><b>' + v + '</b><span>' + U.esc(s || '') + '</span></div>'; }
  return { home: home, kpi: kpi };
})();

/* ---------------------------------------------------------------- ผู้ใช้และสิทธิ์ */
App.view('users', {
  title: 'ผู้ใช้และสิทธิ์', roles: ['ADMIN'],
  render: async function (el) {
    const F = App.S.forms.users = App.S.forms.users || { q: '' };
    el.innerHTML = '<div class="page-h"><h1>ผู้ใช้และสิทธิ์</h1><p>บัญชี (ชื่อ-สกุล PIN เปิด/ปิด) สร้างและแก้ที่ PrintHub — ระบบนี้อ่านอย่างเดียว · หน้านี้กำหนดสิทธิ์ ส่วนงาน และตำแหน่งสำหรับ' + U.esc(U.APP_NAME) + ' · บัญชีใหม่เป็น "ผู้ขอเบิก" อัตโนมัติ</p></div>' +
      '<div class="search">' + ICON('search') + '<input id="q" type="search" placeholder="ค้นหาชื่อหรือส่วนงาน" value="' + U.esc(F.q) + '"></div><div id="t"><div class="skel"></div></div>';
    const [acc, ms] = await Promise.all([API.call('accounts'), API.call('masters')]);
    const roles = [['USER', 'ผู้ขอเบิก'], ['HEAD', 'หัวหน้าส่วน'], ['OFFICER', 'เจ้าหน้าที่พัสดุ'], ['ADMIN', 'ผู้ดูแลระบบ'], ['NONE', 'ไม่ให้เข้า']];
    const depts = ms.departments.filter(function (d) { return d.active; });
    const draw = function () {
      const rows = acc.filter(function (a) { return !F.q || U.match(a.name + ' ' + a.account_dept + ' ' + a.dept_name + ' ' + a.role_th, F.q); });
      U.$('#t').innerHTML = '<div class="tablewrap"><table class="t access-table"><thead><tr><th>ชื่อ-สกุล</th><th>สิทธิ์ในระบบนี้</th><th>ส่วนงาน</th><th>ตำแหน่ง</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>' +
        rows.map(function (a) {
          return '<tr data-c="' + U.esc(a.code) + '"><td><b>' + U.esc(a.name) + '</b><br><small class="muted">' + U.esc(a.code) + (a.account_dept ? ' · บัญชีระบุ: ' + U.esc(a.account_dept) : '') + '</small>' +
            (!a.active ? '<br><span class="badge gray">ปิดบัญชี</span>' : '') + (a.locked ? '<br><span class="badge out">' + (a.lock_source === 'PRINTHUB' ? 'ถูกล็อกที่ PrintHub' : 'ล็อก (PIN ผิด)') + '</span>' : '') +
            (!a.has_pin ? '<br><span class="badge low">ยังไม่ตั้ง PIN</span>' : '') + (a.must_change ? '<br><span class="badge low">ต้องตั้ง PIN ใหม่ที่ PrintHub</span>' : '') +
            (a.head_of ? '<br><span class="badge gold nodot">หัวหน้า ' + U.esc(a.head_of) + '</span>' : '') + '</td>' +
            '<td><select class="input" name="role">' + roles.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === a.role ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select>' + (a.role_set ? '' : '<small class="muted">ค่าเริ่มต้น</small>') + '</td>' +
            '<td><select class="input" name="dept"><option value="">— ยังไม่ระบุ —</option>' + depts.map(function (d) { return '<option value="' + U.esc(d.dept_id) + '"' + (d.dept_id === a.dept_id ? ' selected' : '') + '>' + U.esc(d.name) + '</option>'; }).join('') + '</select></td>' +
            '<td><input class="input" name="pos" list="pl" value="' + U.esc(a.position) + '"></td><td class="small">' + (a.last_login ? U.thDateTime(a.last_login) : '—') + '</td>' +
            '<td><div class="row" style="flex-wrap:nowrap"><button class="btn sm primary" data-a="save">บันทึก</button><button class="btn sm" data-a="out" title="ให้ออกจากระบบทันที">ออกจากระบบ</button>' +
            (a.locked && a.lock_source === 'SUPPLY' ? '<button class="btn sm" data-a="unlock" title="ปลดล็อกการใส่ PIN ผิดในระบบนี้">ปลดล็อก</button>' : '') + '</div></td></tr>';
        }).join('') + '</tbody></table></div><datalist id="pl">' + (ms.positions || []).map(function (p) { return '<option value="' + U.esc(p) + '">'; }).join('') + '</datalist>' +
        '<p class="small muted">สิทธิ์ที่เปลี่ยนมีผลภายในไม่กี่นาที · "ออกจากระบบ" มีผลทันที (ใช้เมื่อถอนสิทธิ์เร่งด่วน) · ใส่ PIN ผิดในระบบนี้ล็อกเฉพาะระบบนี้ ไม่กระทบ PrintHub · ลืม PIN / ปิดบัญชี ทำที่ PrintHub</p>';
    };
    draw();
    U.$('#q').oninput = function () { F.q = this.value; draw(); };
    U.$('#t').onclick = async function (e) {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const tr = b.closest('tr');
      const a = acc.find(function (x) { return x.code === tr.dataset.c; });
      try {
        if (b.dataset.a === 'save') {
          const role = tr.querySelector('[name=role]').value;
          const r = await API.write('saveAccess', { user_code: a.code, role: role, dept_id: tr.querySelector('[name=dept]').value, position: tr.querySelector('[name=pos]').value });
          U.toast('บันทึกสิทธิ์ ' + a.name + ' เป็น ' + r.role_th + (r.replaced_head ? ' (แทนหัวหน้าเดิม: ' + r.replaced_head + ')' : ''), 'ok', 5000);
          App.render();
        } else if (b.dataset.a === 'unlock') {
          await API.call('unlockAccount', { user_code: a.code });
          U.toast('ปลดล็อก ' + a.name + ' แล้ว', 'ok');
          App.render();
        } else {
          if (!(await U.confirm('ให้ออกจากระบบ', U.esc(a.name) + ' จะต้องเข้าสู่ระบบใหม่ทุกอุปกรณ์', 'ยืนยัน', true))) return;
          await API.write('forceLogout', { user_code: a.code });
          U.toast('ให้ออกจากระบบแล้ว', 'ok');
        }
      } catch (er) { U.toast(er.message, 'err', 6000); }
    };
  }
});

/* ---------------------------------------------------------------- ส่วนงาน */
App.view('depts', {
  title: 'ส่วนงาน', roles: ['ADMIN'],
  render: async function (el) {
    const ms = await API.call('masters');
    el.innerHTML = '<div class="page-h row"><div><h1>ส่วนงาน</h1><p>"คำเรียกอื่น" ใช้จับคู่ข้อความส่วนงานในบัญชีผู้ใช้อัตโนมัติ · หัวหน้าส่วนตั้งที่หน้าผู้ใช้และสิทธิ์</p></div><span class="spacer"></span><button class="btn primary" id="add">' + ICON('plus') + 'เพิ่มส่วนงาน</button></div>' +
      '<div class="tablewrap"><table class="t"><thead><tr><th class="num">ลำดับ</th><th>ส่วนงาน</th><th>คำเรียกอื่น</th><th>หัวหน้าส่วน</th><th>สถานะ</th></tr></thead><tbody id="tb">' +
      ms.departments.map(function (d) { return '<tr class="click" data-id="' + U.esc(d.dept_id) + '"><td class="num">' + d.order + '</td><td><b>' + U.esc(d.name) + '</b></td><td>' + U.esc(d.aliases) + '</td><td>' + U.esc(d.head_name || '—') + '</td><td>' + (d.active ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge gray">ปิด</span>') + '</td></tr>'; }).join('') +
      '</tbody></table></div>';
    const edit = async function (d) {
      d = d || { name: '', aliases: '', order: ms.departments.length + 1, active: true };
      const v = await U.modal({ title: d.dept_id ? 'แก้ไขส่วนงาน' : 'เพิ่มส่วนงาน', ok: 'บันทึก',
        html: '<label class="field"><span>ชื่อส่วนงาน *</span><input class="input" name="name" required value="' + U.esc(d.name) + '"></label>' +
          '<label class="field"><span>คำเรียกอื่น (คั่นด้วย ,)</span><input class="input" name="aliases" value="' + U.esc(d.aliases) + '"><small>เช่น ข้อความส่วนงานที่ใช้ในบัญชีผู้ใช้</small></label>' +
          '<label class="field"><span>ลำดับ</span><input class="input" type="number" name="order" value="' + d.order + '"></label><label class="row"><input type="checkbox" name="active"' + (d.active ? ' checked' : '') + '> ใช้งาน</label>' });
      if (!v) return;
      try { await API.write('saveDepartment', { dept_id: d.dept_id, name: v.name, aliases: v.aliases, order: Number(v.order), active: v.active }); U.toast('บันทึกแล้ว', 'ok'); App.refreshMe(); App.render(); }
      catch (er) { U.toast(er.message, 'err'); }
    };
    U.$('#add').onclick = function () { edit(null); };
    U.$('#tb').onclick = function (e) { const tr = e.target.closest('tr[data-id]'); if (tr) edit(ms.departments.find(function (d) { return d.dept_id === tr.dataset.id; })); };
  }
});

/* ---------------------------------------------------------------- หมวด / หน่วยนับ / วันหยุด */
App.view('master', {
  title: 'ข้อมูลหลัก', roles: ['ADMIN'],
  render: async function (el) {
    await App.loadCatalog(true);
    const S = App.S;
    const ms = await API.call('masters');
    el.innerHTML = '<div class="page-h"><h1>หมวด · หน่วยนับ · วันหยุด</h1><p>หน่วยนับเป็นคำมาตรฐานให้เลือกจากดรอปดาวน์ ไม่ให้พิมพ์สะกดซ้ำ</p></div>' +
      '<div class="grid2"><div class="card"><div class="row"><h3 style="margin:0">หมวดหมู่วัสดุ</h3><span class="spacer"></span><button class="btn sm" id="addc">' + ICON('plus') + 'เพิ่ม</button></div><ul class="mlist" id="cl">' +
      S.catalog.categories.map(function (c) { return '<li class="row" style="padding:8px 0;border-bottom:1px solid var(--line-2)"><span>' + c.order + '. ' + U.esc(c.name) + (c.active ? '' : ' <span class="badge gray">ปิด</span>') + '</span><span class="spacer"></span><button class="btn sm ghost" data-c="' + U.esc(c.cat_id) + '">แก้ไข</button></li>'; }).join('') + '</ul></div>' +
      '<div class="card"><div class="row"><h3 style="margin:0">หน่วยนับมาตรฐาน</h3><span class="spacer"></span><button class="btn sm" id="addu">' + ICON('plus') + 'เพิ่ม</button></div><ul class="mlist" id="ul">' +
      S.catalog.units.map(function (u) { return '<li class="row" style="padding:8px 0;border-bottom:1px solid var(--line-2)"><span><b>' + U.esc(u.name) + '</b> <small class="muted">' + U.esc(u.aliases) + '</small>' + (u.active ? '' : ' <span class="badge gray">ปิด</span>') + '</span><span class="spacer"></span><button class="btn sm ghost" data-u="' + U.esc(u.unit_id) + '">แก้ไข</button></li>'; }).join('') + '</ul></div></div>' +
      '<div class="card"><div class="row"><h3 style="margin:0">วันหยุดราชการ (นับวันทำการ)</h3><span class="spacer"></span><button class="btn sm" id="addh">' + ICON('plus') + 'เพิ่ม</button></div><ul class="mlist" id="hl">' +
      (ms.holidays || []).map(function (h) { return '<li class="row" style="padding:8px 0;border-bottom:1px solid var(--line-2)"><span>' + U.thDate(h.date + 'T00:00:00') + ' — ' + U.esc(h.name) + '</span><span class="spacer"></span><button class="btn sm ghost" data-h="' + h.date + '">ลบ</button></li>'; }).join('') + '</ul></div>';
    const save = async function (action, d) { try { await API.write(action, d); U.toast('บันทึกแล้ว', 'ok'); await App.refreshCatalog(); App.render(); } catch (er) { U.toast(er.message, 'err'); } };
    const editCat = async function (c) {
      c = c || { name: '', order: S.catalog.categories.length + 1, active: true };
      const v = await U.modal({ title: c.cat_id ? 'แก้ไขหมวด' : 'เพิ่มหมวด', ok: 'บันทึก', html: '<label class="field"><span>ชื่อหมวด</span><input class="input" name="name" required value="' + U.esc(c.name) + '"></label><label class="field"><span>ลำดับ</span><input class="input" type="number" name="order" value="' + c.order + '"></label><label class="row"><input type="checkbox" name="active"' + (c.active ? ' checked' : '') + '> ใช้งาน</label>' });
      if (v) save('saveCategory', { cat_id: c.cat_id, name: v.name, order: Number(v.order), active: v.active });
    };
    const editUnit = async function (u) {
      u = u || { name: '', aliases: '', active: true };
      const v = await U.modal({ title: u.unit_id ? 'แก้ไขหน่วยนับ' : 'เพิ่มหน่วยนับ', ok: 'บันทึก', html: '<label class="field"><span>หน่วยนับ</span><input class="input" name="name" required value="' + U.esc(u.name) + '"></label><label class="field"><span>คำเรียกอื่น (คั่นด้วย ,)</span><input class="input" name="aliases" value="' + U.esc(u.aliases) + '"></label><label class="row"><input type="checkbox" name="active"' + (u.active ? ' checked' : '') + '> ใช้งาน</label>' });
      if (v) save('saveUnit', { unit_id: u.unit_id, name: v.name, aliases: v.aliases, active: v.active });
    };
    U.$('#addc').onclick = function () { editCat(null); };
    U.$('#addu').onclick = function () { editUnit(null); };
    U.$('#cl').onclick = function (e) { const b = e.target.closest('[data-c]'); if (b) editCat(S.catalog.categories.find(function (c) { return c.cat_id === b.dataset.c; })); };
    U.$('#ul').onclick = function (e) { const b = e.target.closest('[data-u]'); if (b) editUnit(S.catalog.units.find(function (u) { return u.unit_id === b.dataset.u; })); };
    U.$('#addh').onclick = async function () {
      const v = await U.modal({ title: 'เพิ่มวันหยุด', ok: 'บันทึก', html: '<label class="field"><span>วันที่</span><input class="input" type="date" name="date" required></label><label class="field"><span>ชื่อวันหยุด</span><input class="input" name="name"></label>' });
      if (v) save('saveHoliday', v);
    };
    U.$('#hl').onclick = function (e) { const b = e.target.closest('[data-h]'); if (b) save('saveHoliday', { date: b.dataset.h, remove: true }); };
  }
});

/* ---------------------------------------------------------------- ตั้งค่าระบบ */
App.view('settings', {
  title: 'ตั้งค่าระบบ', roles: ['ADMIN'],
  render: async function (el) {
    const r = await API.call('getConfig');
    const c = r.config;
    const lab = { ONE_PENDING: '1 ใบค้างต่อคน (ตามคู่มือ)', NO_DUP_MAT: 'ห้ามวัสดุซ้ำในคำขอค้าง', NONE: 'ไม่จำกัด', AVG: 'ถัวเฉลี่ยถ่วงน้ำหนัก', FIFO: 'เข้าก่อนออกก่อน (FIFO)' };
    const field = function (k) {
      const x = c[k];
      if (!x) return '';
      if (x.type === 'bool') return '<label class="row" style="margin-bottom:12px"><input type="checkbox" name="' + k + '"' + (x.value ? ' checked' : '') + '> ' + U.esc(x.label) + '</label>';
      if (x.type === 'enum') return '<label class="field"><span>' + U.esc(x.label) + '</span><select class="input" name="' + k + '"' + (k === 'cost_method' && r.cost_method_locked ? ' disabled' : '') + '>' +
        (x.value ? '' : '<option value="">— เลือก —</option>') + x.values.map(function (v) { return '<option value="' + v + '"' + (v === x.value ? ' selected' : '') + '>' + U.esc(lab[v] || v) + '</option>'; }).join('') + '</select></label>';
      return '<label class="field"><span>' + U.esc(x.label) + '</span><input class="input" name="' + k + '" ' + (x.type === 'num' ? 'type="number" step="any" min="' + x.min + '" max="' + x.max + '"' : '') + ' value="' + U.esc(x.value) + '"></label>';
    };
    el.innerHTML = '<div class="page-h"><h1>ตั้งค่าระบบ</h1><p>เวอร์ชัน API ' + U.esc(r.version) + (r.demo_accounts ? ' · <b>ใช้บัญชีทดสอบ</b>' : '') + '</p></div><form id="f">' +
      '<div class="card"><h3>วิธีคิดมูลค่าวัสดุ</h3>' + field('cost_method') +
      (r.cost_method_locked ? '<p class="small muted">ล็อกแล้ว — มีการบันทึกรับ-จ่าย ' + U.n(r.ledger_rows) + ' แถว</p>' : '<p class="small muted">เลือกให้ตรงกับบัญชีวัสดุที่งานพัสดุและงานการเงินใช้อยู่ ต้องเลือกก่อนนำเข้ายอดยกมา และเปลี่ยนไม่ได้หลังมีรายการแรก</p>') + '</div>' +
      '<div class="card"><h3>การเบิก</h3>' + field('request_rule') + field('show_qty_to_user') + field('approval_enabled') + field('requests_paused') + field('lead_alert_days') + field('default_lead_days') + '</div>' +
      '<div class="card"><h3>หน่วยงานและเอกสาร</h3><div class="grid2">' + field('org_name') + field('app_name') + '</div>' + field('print_margin_cm') +
      '<div class="grid3">' + ['prefix_REQ', 'prefix_RCV', 'prefix_ADJ', 'prefix_RET', 'prefix_OPN', 'prefix_PO'].map(field).join('') + '</div></div>' +
      '<div class="card"><h3>การเข้าใช้</h3><div class="grid2">' + field('pin_max_fail') + field('pin_lock_minutes') + field('session_minutes') + field('recheck_minutes') + '</div>' + field('allow_pin_change') + field('line_notify_enabled') + '</div>' +
      '<div class="row end"><button class="btn primary lg">บันทึกการตั้งค่า</button></div></form>';
    U.$('#f').onsubmit = async function (e) {
      e.preventDefault();
      const vals = {};
      Object.keys(c).forEach(function (k) {
        const f = this.elements[k];
        if (!f || f.disabled) return;
        let v = f.type === 'checkbox' ? f.checked : f.value;
        if (c[k].type === 'num') v = Number(v);
        if (c[k].type === 'enum' && !v) return;
        if (String(v) !== String(c[k].value)) vals[k] = v;
      }, this);
      if (!Object.keys(vals).length) { U.toast('ไม่มีการเปลี่ยนแปลง', 'info'); return; }
      if (vals.cost_method && !(await U.confirm('ยืนยันวิธีคิดมูลค่า', 'เลือก <b>' + lab[vals.cost_method] + '</b> — เมื่อมีรายการรับ-จ่ายแรกแล้วจะเปลี่ยนไม่ได้', 'ยืนยัน'))) return;
      try { const x = await API.write('saveConfig', { values: vals }); U.toast('บันทึกแล้ว ' + Object.keys(x.changed).length + ' ค่า', 'ok'); await App.refreshMe(); App.render(); }
      catch (er) { U.toast(er.message, 'err', 6000); }
    };
  }
});

/* ---------------------------------------------------------------- สำรองข้อมูล */
App.view('backup', {
  title: 'สำรองข้อมูล', roles: ['ADMIN'],
  render: async function (el) {
    el.innerHTML = '<div class="page-h row"><div><h1>สำรองข้อมูล</h1><p>สำรองอัตโนมัติทุกคืนวันอาทิตย์ (เก็บ 8 สัปดาห์) · กู้คืนจาก editor ด้วย restoreFromBackup(รหัสไฟล์)</p></div><span class="spacer"></span><button class="btn primary" id="now">' + ICON('db') + 'สำรองทันที</button></div><div id="t"><div class="skel"></div></div>';
    const load = async function () {
      const rows = await API.call('listBackups');
      U.$('#t').innerHTML = rows.length ? '<div class="tablewrap"><table class="t"><thead><tr><th>ชื่อสำเนา</th><th>เวลา</th><th>ประเภท</th><th></th></tr></thead><tbody>' +
        rows.map(function (b) { return '<tr><td>' + U.esc(b.name) + '<br><small class="muted">' + U.esc(b.id) + '</small></td><td>' + U.thDateTime(b.at) + '</td><td>' + (b.kind === 'AUTO' ? 'อัตโนมัติ' : 'สำรองทันที') + '</td><td><button class="btn sm" data-v="' + U.esc(b.id) + '">ตรวจสำเนา</button></td></tr>'; }).join('') +
        '</tbody></table></div>' : '<p class="muted">ยังไม่มีสำเนา</p>';
    };
    U.$('#now').onclick = async function () {
      this.classList.add('busy');
      try { const r = await API.call('backupNow'); U.toast('สำรองแล้ว: ' + r.name, 'ok'); await load(); } catch (er) { U.toast(er.message, 'err'); }
      this.classList.remove('busy');
    };
    U.$('#t').onclick = async function (e) {
      const b = e.target.closest('[data-v]'); if (!b) return;
      b.classList.add('busy');
      try {
        const r = await API.call('verifyBackup', { id: b.dataset.v });
        const keys = [['ledger_rows', 'แถว ledger'], ['requests', 'ใบเบิก'], ['receipts', 'ใบรับเข้า'], ['op_log', 'OP_LOG'], ['materials', 'วัสดุ'], ['last_req_no', 'เลขใบเบิกล่าสุด'],
          ['ledger_balance_sum', 'ผลรวมคงเหลือจาก ledger'], ['materials_balance_sum', 'ผลรวมคงเหลือ (สำเนา)'], ['materials_reserved_sum', 'ผลรวมยอดจอง']];
        await U.modal({ title: 'ผลตรวจสำเนา', cancel: false, ok: 'ปิด', html: '<div class="tablewrap"><table class="t"><thead><tr><th>รายการ</th><th class="num">สำเนา</th><th class="num">ข้อมูลจริง</th></tr></thead><tbody>' +
          keys.map(function (k) { const same = String(r.backup[k[0]]) === String(r.live[k[0]]); return '<tr><td>' + k[1] + '</td><td class="num">' + U.esc(r.backup[k[0]]) + '</td><td class="num"' + (same ? '' : ' style="color:var(--low);font-weight:700"') + '>' + U.esc(r.live[k[0]]) + '</td></tr>'; }).join('') +
          '</tbody></table></div><p class="small muted">ค่าต่างกันได้ถ้ามีรายการใหม่หลังเวลาสำรอง · ตรวจว่า "ผลรวมคงเหลือจาก ledger" ของสำเนาเท่ากับ "ผลรวมคงเหลือ (สำเนา)"</p>' });
      } catch (er) { U.toast(er.message, 'err'); }
      b.classList.remove('busy');
    };
    await load();
  }
});


