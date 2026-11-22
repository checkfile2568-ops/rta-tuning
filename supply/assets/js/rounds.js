/* ระบบบริหารวัสดุสำนักงาน · rounds.js — รอบการเบิกวัสดุ (เปิดรับเฉพาะหมวดที่กำหนด) + ขอเบิกวัสดุเร่งด่วน */
'use strict';
const RW = (function () {
  const MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  function cfg() { return (App.S.cfg && App.S.cfg.request_window) || { mode: 'ALWAYS', open: true, cats: [], cat_names: [] }; }
  function d(v) { const x = v ? new Date(v) : null; return x && !isNaN(x) ? x : null; }
  /** 1–8 ธ.ค. 2569 · ข้ามเดือน: 29 ธ.ค. 2569 – 5 ม.ค. 2570 */
  function range(w) {
    if (!w) return '';
    const a = d(w.start), b = d(w.end);
    if (!a || !b) return '';
    const by = b.getFullYear() + 543;
    if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return a.getDate() + '–' + b.getDate() + ' ' + MON[b.getMonth()] + ' ' + by;
    return a.getDate() + ' ' + MON[a.getMonth()] + (a.getFullYear() !== b.getFullYear() ? ' ' + (a.getFullYear() + 543) : '') + ' – ' + b.getDate() + ' ' + MON[b.getMonth()] + ' ' + by;
  }
  function day(v) { const x = d(v); return x ? x.getDate() + ' ' + MON[x.getMonth()] + ' ' + (x.getFullYear() + 543) : ''; }
  /** สถานะ ณ เวลานี้ (เซิร์ฟเวอร์ตรวจซ้ำตอนส่งคำขอเสมอ) */
  function state() {
    const w = cfg();
    if (w.mode !== 'MONTHLY') return { on: false, open: true, w: w };
    const now = Date.now();
    let open = !!w.open, cur = w.current || null;
    if (open && cur && d(cur.end) && now > d(cur.end).getTime()) open = false;
    if (!open && w.next && d(w.next.start) && now >= d(w.next.start).getTime() && now <= d(w.next.end).getTime()) { open = true; cur = w.next; }
    return { on: true, open: open, w: w, cur: open ? cur : null, next: open ? (cur === w.next ? null : w.next) : w.next };
  }
  function catsText(w) { return (w.cat_names && w.cat_names.length ? w.cat_names : ['วัสดุสำนักงาน']).join(', '); }
  function inWindow(m) { const w = cfg(); return !!m && w.mode === 'MONTHLY' && (w.cats || []).indexOf(String(m.cat_id)) >= 0; }
  function blocked(m) { const s = state(); return s.on && !s.open && inWindow(m); }
  /** รายการในตะกร้าที่อยู่นอกรอบ */
  function blockedIds(cart) { return Object.keys(cart || {}).filter(function (id) { return blocked(App.S.idx[id]); }); }

  /** ข้อความแนะนำสำหรับผู้ขอเบิก — where: home | req | cart */
  function banner(where) {
    const s = state();
    if (!s.on) return '';
    const w = s.w, cats = U.esc(catsText(w));
    const how = '<details class="rw-how"><summary>การเบิกเป็นรอบคืออะไร</summary><ul>' +
      '<li>งานพัสดุเปิดรับคำขอ<b>' + cats + '</b>เดือนละ 1 รอบ เริ่มวันทำการแรกของเดือน รวม ' + w.days + ' วันทำการ</li>' +
      '<li>ปิดรับเวลา ' + U.esc(w.close || '16:30') + ' น. ของวันสุดท้าย · ไม่นับเสาร์–อาทิตย์และวันหยุดราชการ</li>' +
      '<li>วัสดุหมวดอื่น เช่น วัสดุคอมพิวเตอร์ ยื่นได้ทุกวันตามปกติ</li>' +
      '<li>นอกรอบ: เลือกของใส่ตะกร้าเก็บเป็นร่างไว้ได้ แล้วกดส่งเมื่อเปิดรอบ' + (w.urgent_enabled ? ' · ถ้าจำเป็นต้องใช้ทันที ยื่น <b>“ขอเบิกวัสดุเร่งด่วน”</b> พร้อมเหตุผล ให้หัวหน้าเจ้าหน้าที่พัสดุพิจารณา' : '') + '</li>' +
      '<li>ใบที่ถูกส่งกลับแก้ไข ยื่นใบเดิมได้แม้ปิดรอบแล้ว</li></ul></details>';
    if (s.open) {
      const last = s.cur && s.w.today_last && s.cur === s.w.current;
      const left = s.cur === s.w.current && s.w.left ? ' · เหลือ ' + s.w.left + ' วันทำการ' : '';
      return '<div class="notice ' + (last ? 'warn' : 'ok') + ' rw-banner">' + ICON('clock') + '<div><b>' + (last ? 'วันนี้วันสุดท้ายของรอบ — ปิดรับ ' + U.esc(w.close) + ' น.' : 'เปิดรับคำขอ' + cats) + '</b>' +
        '<span class="rw-line"><span class="nw">รอบนี้ ' + U.esc(range(s.cur)) + '</span> <span class="nw">ปิด ' + U.esc(w.close) + ' น. วันสุดท้าย' + left + '</span></span>' + (where === 'home' ? how : '') + '</div></div>';
    }
    return '<div class="notice warn rw-banner">' + ICON('clock') + '<div><b>ปิดรับคำขอ' + cats + 'ชั่วคราว</b>' +
      '<span class="rw-line">' + (s.next ? '<span class="nw">รอบถัดไป ' + U.esc(range(s.next)) + '</span> ' : '') + '<span class="nw">หมวดอื่นเบิกได้ตามปกติ</span></span>' +
      (where === 'cart' ? '' : '<span class="rw-line small">เลือกของใส่ตะกร้าเป็นร่างไว้ก่อนได้' + (w.urgent_enabled ? ' · จำเป็นเร่งด่วนยื่นพร้อมเหตุผลได้' : '') + '</span>') + how + '</div></div>';
  }
  function urgentBadge(r) { return r && r.urgent ? ' <span class="badge urgent">เร่งด่วน</span>' : ''; }
  function urgentReason(r) { return r && r.urgent ? '<p class="urgent-reason"><b>เหตุผลที่ขอเร่งด่วน:</b> ' + U.esc(r.urgent_reason || '-') + '</p>' : ''; }
  /** บรรทัดสถานะสั้นสำหรับหน้าแรกเจ้าหน้าที่ */
  function officerLine() {
    const s = state();
    const can = ['OFFICER', 'SUPPLY_HEAD', 'ADMIN'].indexOf(App.S.user.role) >= 0;
    const txt = !s.on ? 'เบิกได้ตลอด (ไม่กำหนดรอบ)'
      : s.open ? 'เปิดรับ' + catsText(s.w) + ' ' + range(s.cur) + ' ปิด ' + s.w.close + ' น.'
      : 'ปิดรับ' + catsText(s.w) + (s.next ? ' · รอบถัดไป ' + range(s.next) : '');
    return '<p class="rw-officer small">' + ICON('clock') + '<span><b>รอบการเบิก:</b> ' + U.esc(txt) + (s.on && s.w.urgent_enabled ? ' · รับคำขอเร่งด่วน' : '') + '</span>' + (can ? ' <a href="#/rounds">ตั้งค่า</a>' : '') + '</p>';
  }
  return { cfg: cfg, state: state, range: range, day: day, inWindow: inWindow, blocked: blocked, blockedIds: blockedIds,
           banner: banner, urgentBadge: urgentBadge, urgentReason: urgentReason, officerLine: officerLine, catsText: catsText };
})();

/* ---------------------------------------------------------------- ตั้งค่ารอบการเบิก */
App.view('rounds', {
  title: 'รอบการเบิก', roles: ['OFFICER', 'SUPPLY_HEAD', 'ADMIN'],
  render: async function (el) {
    const S = App.S;
    if (!S.catalog) await App.loadCatalog(true);
    const w = RW.cfg();
    const cats = (S.catalog.categories || []).filter(function (c) { return c.active !== false; });
    const F = { mode: w.mode, days: w.days || 5, cats: (w.cats || []).slice(), urgent: w.urgent_enabled !== false };
    if (!F.cats.length) cats.forEach(function (c) { if (c.name === 'วัสดุสำนักงาน') F.cats.push(String(c.cat_id)); });
    const s = RW.state();
    const now = !s.on ? '<div class="notice info"><div><b>ขณะนี้: เบิกได้ตลอด</b>ทุกหมวดยื่นคำขอได้ทุกวัน</div></div>'
      : '<div class="notice ' + (s.open ? 'ok' : 'warn') + '"><div><b>ขณะนี้: ' + (s.open ? 'เปิดรับ' : 'ปิดรับ') + U.esc(RW.catsText(s.w)) + '</b>' +
        (s.open ? 'รอบนี้ ' + U.esc(RW.range(s.cur)) + ' ปิด ' + U.esc(s.w.close) + ' น.' + (s.w.left ? ' · เหลือ ' + s.w.left + ' วันทำการ' : '') + '<br>' : '') +
        (s.next ? 'รอบถัดไป ' + U.esc(RW.range(s.next)) : '') + '</div></div>';
    el.innerHTML = '<div class="page-h"><h1>รอบการเบิกวัสดุ</h1><p>กำหนดช่วงเปิดรับคำขอเฉพาะหมวดที่เลือก หมวดอื่นเบิกได้ตลอด</p></div>' + now +
      '<form class="card rw-form" id="rwf">' +
      '<div class="field"><span>รูปแบบ</span><div class="seg" id="rw-mode"><button type="button" data-m="ALWAYS">เบิกได้ตลอด</button><button type="button" data-m="MONTHLY">กำหนดรอบรายเดือน</button></div></div>' +
      '<div id="rw-monthly">' +
      '<label class="field"><span>ระยะเวลาเปิดรับ (นับจากวันทำการแรกของเดือน)</span><select class="input" name="days">' +
        [3, 5, 7, 10].map(function (n) { return '<option value="' + n + '"' + (n === F.days ? ' selected' : '') + '>' + n + ' วันทำการ</option>'; }).join('') + '</select></label>' +
      '<p class="small muted">ปิดรับเวลา 16:30 น. ของวันทำการสุดท้าย · ไม่นับเสาร์–อาทิตย์และวันหยุดราชการ</p>' +
      '<div class="field"><span>หมวดที่ต้องเบิกตามรอบ</span><div class="rw-cats">' + cats.map(function (c) {
        return '<label class="check"><input type="checkbox" name="cat" value="' + U.esc(c.cat_id) + '"' + (F.cats.indexOf(String(c.cat_id)) >= 0 ? ' checked' : '') + '> ' + U.esc(c.name) + '</label>';
      }).join('') + '</div><small class="muted">หมวดที่ไม่เลือก (เช่น วัสดุคอมพิวเตอร์) ยื่นได้ทุกวัน</small></div>' +
      '<label class="check rw-urgent"><input type="checkbox" name="urgent"' + (F.urgent ? ' checked' : '') + '> <span><b>เปิดรับ “ขอเบิกวัสดุเร่งด่วน”</b><br><small class="muted">นอกรอบ ผู้ขอยื่นได้พร้อมเหตุผล — ใบจะมีป้าย “เร่งด่วน” ขึ้นก่อนในหน้าอนุมัติของหัวหน้าเจ้าหน้าที่พัสดุ</small></span></label>' +
      '<p class="small muted rw-hol">' + (s.on && s.w.ext_holidays === false ? '⚠ อ่านชีตวันหยุดของระบบนัดพิจารณาคดีไม่ได้ ระบบใช้วันหยุดที่บันทึกในระบบนี้แทน' : 'วันหยุดราชการอ่านจากชีตวันหยุดของระบบนัดพิจารณาคดี (อ่านอย่างเดียว) ร่วมกับวันหยุดในระบบนี้') + '</p>' +
      '</div>' +
      '<div class="row end"><button class="btn primary lg" id="rw-save">' + ICON('check') + 'บันทึกรอบการเบิก</button></div></form>';
    const paint = function () {
      U.$$('#rw-mode button').forEach(function (b) { b.classList.toggle('on', b.dataset.m === F.mode); });
      U.$('#rw-monthly').hidden = F.mode !== 'MONTHLY';
    };
    paint();
    U.$('#rw-mode').onclick = function (e) { const b = e.target.closest('[data-m]'); if (b) { F.mode = b.dataset.m; paint(); } };
    U.$('#rwf').onsubmit = async function (e) {
      e.preventDefault();
      const f = this, btn = U.$('#rw-save');
      const body = { mode: F.mode, days: Number(f.days.value), cats: U.$$('input[name=cat]:checked', f).map(function (x) { return x.value; }), urgent_enabled: f.urgent.checked };
      if (body.mode === 'MONTHLY' && !body.cats.length) { U.toast('เลือกอย่างน้อย 1 หมวดที่ต้องเบิกตามรอบ', 'err'); return; }
      btn.classList.add('busy'); btn.disabled = true;
      try {
        await API.write('requestWindowSave', body);
        await App.refreshMe();
        U.toast('บันทึกรอบการเบิกแล้ว', 'ok');
        App.render();
      } catch (er) { btn.classList.remove('busy'); btn.disabled = false; U.toast(er.message, 'err'); }
    };
  }
});
