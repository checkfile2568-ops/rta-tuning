/* ระบบบริหารวัสดุสำนักงาน · monthly.js — รายงานวัสดุคงเหลือประจำเดือน
 *  ร่าง (จัดทำอัตโนมัติวันที่ 1 หรือเจ้าหน้าที่พัสดุจัดทำ) → ตรวจ → ยืนยัน (ล็อกตัวเลข) → พิมพ์ A4 / Excel
 *  พิมพ์ด้วย TH Sarabun 17 pt · มีมูลค่า = A4 แนวนอน · เฉพาะจำนวน = A4 แนวตั้ง · ลงนามผู้จัดทำ (เจ้าหน้าที่พัสดุ) */
'use strict';
const Monthly = (function () {
  const COLS = [['open', 'ยกมา'], ['in', 'รับ'], ['out', 'จ่าย'], ['adj', 'ปรับยอด'], ['close', 'คงเหลือ']];
  const STATUS = { NONE: ['ยังไม่จัดทำ', 'gray nodot'], DRAFT: ['ร่าง · รอยืนยัน', 'low'], CONFIRMED: ['ยืนยันแล้ว', 'ok'] };
  function badge(st, extra) { const s = STATUS[st] || STATUS.NONE; return '<span class="badge ' + s[1] + '">' + s[0] + (extra || '') + '</span>'; }
  function qty(v) { return v ? U.n(v) : '–'; }
  function val(v) { return v ? U.money(v) : '–'; }
  function groups(items) {
    const out = [];
    items.forEach(function (x) {
      let g = out[out.length - 1];
      if (!g || g.cat !== x.cat_name) { g = { cat: x.cat_name, rows: [] }; out.push(g); }
      g.rows.push(x);
    });
    return out;
  }
  function sum(rows, k) { return rows.reduce(function (a, x) { return a + (Number(x[k]) || 0); }, 0); }
  function signer(rep) {
    if (rep.confirmed_name) return rep.confirmed_name;
    if (rep.created_name && rep.created_name !== 'ระบบอัตโนมัติ') return rep.created_name;
    return App.S.user.role === 'OFFICER' ? App.S.user.name : '';
  }

  /* ------------------------------------------------------------ ตารางบนหน้าจอ */
  function tableHtml(rep, showVal) {
    const span = showVal ? 2 : 1;
    const sub = showVal ? '<th class="num">จำนวน</th><th class="num">มูลค่า</th>' : '<th class="num">จำนวน</th>';
    const cell = function (x, k, bold) {
      const q = x[k + '_qty'], v = x[k + '_value'];
      const neg = k === 'adj' && q < 0 ? ' style="color:var(--out)"' : '';
      return '<td class="num"' + neg + '>' + (bold ? '<b>' + U.n(q) + '</b>' : qty(q)) + '</td>' + (showVal ? '<td class="num"' + neg + '>' + (bold ? '<b>' + U.money(v) + '</b>' : val(v)) + '</td>' : '');
    };
    const body = groups(rep.items).map(function (g) {
      return '<tr class="grp"><td colspan="' + (3 + 5 * span) + '"><b>' + U.esc(g.cat) + '</b> · ' + g.rows.length + ' รายการ</td></tr>' +
        g.rows.map(function (x) {
          return '<tr><td>' + U.esc(x.code) + '</td><td>' + U.esc(x.name) + '</td><td>' + U.esc(x.unit_name) + '</td>' +
            cell(x, 'open') + cell(x, 'in') + cell(x, 'out') + cell(x, 'adj') + cell(x, 'close', true) + '</tr>';
        }).join('') +
        (showVal ? '<tr class="sub"><td colspan="3" class="num">รวม' + U.esc(g.cat) + '</td>' + COLS.map(function (c) { return '<td></td><td class="num">' + U.money(sum(g.rows, c[0] + '_value')) + '</td>'; }).join('') + '</tr>' : '');
    }).join('');
    return '<div class="tablewrap" style="margin-top:12px"><table class="t mr-t"><thead><tr><th rowspan="2">รหัส</th><th rowspan="2">รายการ</th><th rowspan="2">หน่วย</th>' +
      COLS.map(function (c) { return '<th colspan="' + span + '" class="c">' + c[1] + '</th>'; }).join('') + '</tr><tr>' + sub + sub + sub + sub + sub + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="' + (3 + 5 * span) + '" class="muted">ไม่มีวัสดุ</td></tr>') + '</tbody></table></div>';
  }

  /* ------------------------------------------------------------ แบบพิมพ์ A4 (TH Sarabun 17 pt) */
  function sheetHtml(rep, showVal, info) {
    // มีมูลค่า: จำนวนและมูลค่าอยู่ในช่องเดียวกัน (จำนวนบรรทัดบน มูลค่าบรรทัดล่าง) ให้ชื่อวัสดุกว้างพอที่ขนาดตัวอักษร 17 pt
    const cell = function (x, k, bold) {
      const q = x[k + '_qty'], v = x[k + '_value'];
      const b = function (t) { return bold ? '<b>' + t + '</b>' : t; };
      return '<td class="r nw">' + b(q ? U.n(q) : '-') + (showVal ? '<br><span class="v">' + b(v ? U.money(v) : '-') + '</span>' : '') + '</td>';
    };
    const rows = groups(rep.items).map(function (g) {
      return '<tr class="grp"><td colspan="9"><b>' + U.esc(g.cat) + '</b></td></tr>' + g.rows.map(function (x, i) {
        return '<tr><td class="c">' + (i + 1) + '</td><td class="nw">' + U.esc(x.code) + '</td><td>' + U.esc(x.name) + '</td><td class="c">' + U.esc(x.unit_name) + '</td>' +
          cell(x, 'open') + cell(x, 'in') + cell(x, 'out') + cell(x, 'adj') + cell(x, 'close', true) + '</tr>';
      }).join('');
    }).join('');
    const tot = showVal ? '<tr class="tot"><td colspan="4" class="r"><b>รวมมูลค่าทั้งสิ้น (บาท)</b></td>' + COLS.map(function (c) { return '<td class="r nw"><b>' + U.money(sum(rep.items, c[0] + '_value')) + '</b></td>'; }).join('') + '</tr>' : '';
    const draft = rep.status !== 'CONFIRMED';
    const who = signer(rep);
    const d = rep.confirmed_at || '';
    return '<div class="sheet mr' + (showVal ? ' land' : '') + '" style="--m:' + (info.print_margin_cm || 1.5) + 'cm">' +
      (API.scope() ? '<div class="mr-flag">ข้อมูลตัวอย่างสำหรับฝึกใช้งาน — ห้ามใช้เป็นเอกสารจริง</div>' : '') +
      (draft ? '<div class="mr-flag">ร่าง — ยังไม่ยืนยัน</div>' : '') +
      '<h1>รายงานวัสดุคงเหลือประจำเดือน ' + U.esc(rep.label) + '</h1><p class="org">' + U.esc(info.org_name || 'ศาลจังหวัดลพบุรี') + ' · ปีงบประมาณ ' + U.esc(rep.fy || '') + '</p>' +
      '<div class="meta"><span>เลขที่ ' + U.esc(rep.report_no || '') + ' · ช่วงข้อมูลทั้งเดือน ' + U.esc(rep.label) + '</span><span>' +
      (draft ? 'สถานะ: <b>ร่าง</b>' : 'สถานะ: <b>ยืนยันแล้ว</b> ' + U.thDateTime(rep.confirmed_at) + (rep.reopen_count ? ' (ฉบับแก้ไขครั้งที่ ' + rep.reopen_count + ')' : '')) + '</span></div>' +
      '<table><thead><tr><th style="width:4%">ที่</th><th style="width:' + (showVal ? 8 : 9) + '%">รหัส</th><th>รายการ</th><th style="width:7%">หน่วย</th>' +
      COLS.map(function (c) { return '<th style="width:' + (showVal ? 11 : 10) + '%">' + c[1] + (showVal ? '<br><small>จำนวน / มูลค่า (บาท)</small>' : '<br><small>จำนวน</small>') + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows + tot + '</tbody></table>' +
      '<div class="sign one"><div>ลงชื่อ..................................................ผู้จัดทำ<br>(' + (who ? U.esc(who) : '..................................................') + ')' +
      '<small>เจ้าหน้าที่พัสดุ</small><small>วันที่ ' + (d ? U.thDate(d) : '...../...../.....') + '</small></div></div>' +
      '<div class="foot"><span>พิมพ์จาก' + U.esc(U.APP_NAME) + ' ' + U.thDateTime(new Date()) + '</span><span>' + (showVal ? 'แสดงจำนวนและมูลค่า' : 'แสดงเฉพาะจำนวน') + '</span></div></div>';
  }
  function exportXlsx(rep, showVal) {
    const head = ['หมวด', 'รหัส', 'รายการ', 'หน่วย'];
    COLS.forEach(function (c) { head.push(c[1] + ' (จำนวน)'); if (showVal) head.push(c[1] + ' (มูลค่า)'); });
    const rows = rep.items.map(function (x) {
      const r = [x.cat_name, x.code, x.name, x.unit_name];
      COLS.forEach(function (c) { r.push(x[c[0] + '_qty']); if (showVal) r.push(x[c[0] + '_value']); });
      return r;
    });
    if (showVal) { const t = ['', '', 'รวมทั้งสิ้น', '']; COLS.forEach(function (c) { t.push(''); t.push(Math.round(sum(rep.items, c[0] + '_value') * 100) / 100); }); rows.push(t); }
    return U.exportXlsx('รายงานวัสดุคงเหลือ ' + rep.label + (rep.status === 'CONFIRMED' ? '' : ' (ร่าง)'), [{ name: rep.label, head: head, rows: rows, widths: [16, 10, 36, 8] }]);
  }
  return { badge: badge, tableHtml: tableHtml, sheetHtml: sheetHtml, exportXlsx: exportXlsx, signer: signer };
})();

App.view('monthly', {
  title: 'รายงานประจำเดือน', roles: ['OFFICER', 'ADMIN'],
  render: async function (el, params) {
    const S = App.S;
    const officer = S.user.role === 'OFFICER';
    const F = S.forms.monthly = S.forms.monthly || {};
    el.innerHTML = '<div class="page-h"><h1>รายงานวัสดุคงเหลือประจำเดือน</h1><p>ยอดยกมา รับ จ่าย ปรับยอด และคงเหลือ จากบัญชีรับ-จ่ายวัสดุ · จัดทำได้เมื่อสิ้นเดือน · ยืนยันแล้วตัวเลขถูกล็อก</p></div>' +
      '<div id="mr-months" class="mr-months"><div class="skel"></div></div><div id="mr-one"></div>';
    let list;
    try { list = await API.call('monthlyList'); } catch (e) { U.$('#mr-months').innerHTML = App.errorBox(e); return; }
    if (F.showVal === undefined) F.showVal = list.show_value;
    if (params && params[0]) F.ym = decodeURIComponent(params[0]);
    if (!F.ym || !list.months.some(function (m) { return m.ym === F.ym; })) {
      const pend = list.months.find(function (m) { return m.status !== 'CONFIRMED'; });
      F.ym = (pend || list.months[0] || {}).ym;
    }
    U.$('#mr-months').innerHTML = list.months.length ? list.months.slice(0, 12).map(function (m) {
      return '<button class="mr-m' + (m.ym === F.ym ? ' on' : '') + '" data-ym="' + U.esc(m.ym) + '"><b>' + U.esc(m.label) + '</b>' +
        Monthly.badge(m.status, m.status === 'CONFIRMED' && m.confirmed_at ? ' ' + U.thShort(m.confirmed_at) : '') + '</button>';
    }).join('') : '<div class="empty"><p>ยังไม่มีเดือนที่สิ้นสุดให้จัดทำรายงาน — เริ่มจัดทำได้เมื่อมีรายการรับ-จ่ายครบหนึ่งเดือน</p></div>';
    U.$('#mr-months').onclick = function (e) { const b = e.target.closest('[data-ym]'); if (b) { F.ym = b.dataset.ym; App.render(); } };
    if (!F.ym) return;
    const box = U.$('#mr-one');
    box.innerHTML = '<div class="card"><div class="skel"></div><div class="skel"></div></div>';
    let rep;
    try { rep = await API.call('monthlyGet', { ym: F.ym }); } catch (e) { box.innerHTML = App.errorBox(e); return; }
    const modeTxt = list.mode === 'AUTO' ? 'โหมดอัตโนมัติ: ระบบจัดทำร่างให้ทุกวันที่ 1' : 'โหมดเจ้าหน้าที่พัสดุจัดทำ';
    if (rep.status === 'NONE') {
      box.innerHTML = '<div class="card"><h3 style="margin:0">' + U.esc(rep.label) + ' ' + Monthly.badge('NONE') + '</h3><p class="muted small">' + U.esc(modeTxt) + '</p>' +
        (officer ? '<p>ยังไม่ได้จัดทำรายงานของเดือนนี้ — กด "จัดทำรายงาน" แล้วตรวจตัวเลขก่อนยืนยัน</p><button class="btn primary lg" id="mr-gen">' + ICON('doc') + 'จัดทำรายงาน</button>'
          : '<p class="muted">รอเจ้าหน้าที่พัสดุจัดทำ</p>') + '</div>';
    } else {
      const s = rep.summary || {}, c = rep.check || {};
      const adj = rep.items.filter(function (x) { return x.adj_qty; });
      const notes = [];
      if (rep.reopen_count) {
        notes.push('<div class="notice ' + (rep.status === 'DRAFT' ? 'warn' : 'info') + '"><div><b>' + (rep.status === 'DRAFT' ? 'ยกเลิกการยืนยันเพื่อแก้ไข' : 'ฉบับแก้ไขครั้งที่ ' + rep.reopen_count) + '</b>' +
          'ยกเลิกการยืนยันโดย ' + U.esc(rep.reopened_name) + ' ' + U.thDateTime(rep.reopened_at) + ' · เหตุผล: ' + U.esc(rep.reopen_reason) +
          (rep.status === 'DRAFT' && officer ? '<br>แก้รายการที่ผิดก่อน: จำนวนส่งมอบผิด → <a href="#/queue/issued">คิวจ่ายวัสดุ แท็บ "ส่งมอบแล้ว"</a> · ยอดคลังผิด → <a href="#/count">ตรวจนับ/ปรับยอด</a> (เลือกเดือน ' + U.esc(rep.label) + ') แล้วกด "สร้างร่างใหม่" และยืนยันอีกครั้ง' : '') + '</div></div>');
      }
      if (rep.status === 'DRAFT') {
        if (c.stale) notes.push('<div class="notice warn"><div><b>ข้อมูลของเดือนนี้เปลี่ยนหลังจัดทำร่าง</b>กด "สร้างร่างใหม่" แล้วตรวจอีกครั้งก่อนยืนยัน</div></div>');
        notes.push('<div class="notice info"><div><b>ตรวจก่อนยืนยัน</b>' +
          (c.current_match === null || c.current_match === undefined ? 'มีรายการรับ-จ่ายหลังสิ้นเดือน ' + U.n(c.after_rows || 0) + ' รายการ (ยอดคงเหลือปัจจุบันจึงต่างจากสิ้นเดือนได้)' :
            'ยอดคงเหลือตรงกับคลังปัจจุบัน ' + U.n(c.current_match) + '/' + U.n(rep.items.length) + ' รายการ') +
          ' · ' + (adj.length ? 'มีการปรับยอด ' + adj.length + ' รายการ (' + adj.slice(0, 3).map(function (x) { return U.esc(x.name) + ' ' + (x.adj_qty > 0 ? '+' : '') + U.n(x.adj_qty) + ' ' + U.esc(x.unit_name); }).join(', ') + (adj.length > 3 ? ' …' : '') + ')' : 'ไม่มีการปรับยอด') +
          (s.formula_mismatch ? ' · <b>ยอดไม่สมดุล ' + s.formula_mismatch + ' รายการ — แจ้งผู้ดูแลระบบตรวจกระทบยอด</b>' : '') + '</div></div>');
      }
      const k = function (t, v, sub) { return '<div class="kpi"><small>' + t + '</small><b>' + v + '</b><span>' + sub + '</span></div>'; };
      box.innerHTML = '<div class="card"><div class="row"><div><h3 style="margin:0">' + U.esc(rep.label) + ' · ปีงบประมาณ ' + U.esc(rep.fy) + ' ' + Monthly.badge(rep.status) + '</h3>' +
        '<span class="small muted">เลขที่ ' + U.esc(rep.report_no) + ' · ' + (rep.mode === 'AUTO' ? 'จัดทำอัตโนมัติ' : 'จัดทำโดย ' + U.esc(rep.created_name)) + ' ' + U.thDateTime(rep.created_at) +
        (rep.status === 'CONFIRMED' ? ' · ยืนยันโดย ' + U.esc(rep.confirmed_name) + ' ' + U.thDateTime(rep.confirmed_at) : ' · ร่างครั้งที่ ' + rep.rev) +
        ' · วิธีคิดมูลค่า: ' + (s.cost_method === 'FIFO' ? 'เข้าก่อนออกก่อน' : 'ถัวเฉลี่ย') + '</span></div><span class="spacer"></span>' +
        '<label class="check"><input type="checkbox" id="mr-val"' + (F.showVal ? ' checked' : '') + '> แสดงมูลค่า (บาท)</label></div>' +
        '<div class="kpis" style="margin-top:12px">' + k('วัสดุทั้งหมด', U.n(s.items || rep.items.length) + ' รายการ', 'เคลื่อนไหว ' + U.n(s.moved || 0) + ' รายการ') +
        (F.showVal ? k('มูลค่ายกมา', U.money(s.open_value), 'บาท') + k('รับเข้า', U.money(s.in_value), 'บาท · ' + U.n(s.receipts || 0) + ' ใบรับ') +
          k('จ่ายออก', U.money(s.out_value), 'บาท · ' + U.n(s.issues || 0) + ' ใบเบิก') + k('มูลค่าคงเหลือ', U.money(s.close_value), 'บาท')
          : k('ใบรับเข้า', U.n(s.receipts || 0), 'ใบ') + k('ใบเบิกที่จ่าย', U.n(s.issues || 0), 'ใบ') + k('ปรับยอด', U.n(s.adjusts || 0), 'ครั้ง')) + '</div>' +
        notes.join('') + Monthly.tableHtml(rep, F.showVal) +
        '<div class="row end" style="margin-top:14px">' +
        (officer && rep.status === 'DRAFT' ? '<button class="btn" id="mr-gen">' + ICON('refresh') + 'สร้างร่างใหม่</button>' : '') +
        '<button class="btn" id="mr-xl">' + ICON('download') + 'Excel</button><button class="btn" id="mr-pr">' + ICON('print') + 'ดูตัวอย่างพิมพ์</button>' +
        (officer && rep.status === 'DRAFT' ? '<button class="btn primary lg" id="mr-ok"' + (c.stale ? ' disabled' : '') + '>' + ICON('check') + 'ยืนยันรายงาน</button>' : '') +
        (!officer && rep.status === 'DRAFT' ? '<span class="small muted">เจ้าหน้าที่พัสดุเป็นผู้ยืนยันรายงาน</span>' : '') +
        (officer && rep.status === 'CONFIRMED' ? (rep.can_reopen ? '<button class="btn ghost" id="mr-re">' + ICON('refresh') + 'ยกเลิกการยืนยันเพื่อแก้ไข</button>'
          : '<span class="small muted">แก้ไขได้เฉพาะรายงานเดือนล่าสุดที่ยืนยัน</span>') : '') + '</div></div>';
      U.$('#mr-val').onchange = function () { F.showVal = this.checked; App.render(); };
      U.$('#mr-xl').onclick = function () { Monthly.exportXlsx(rep, F.showVal); };
      U.$('#mr-pr').onclick = function () { S.forms.monthlyPrint = { rep: rep, showVal: F.showVal, info: list }; location.hash = '#/print/monthly'; };
      const re = U.$('#mr-re');
      if (re) re.onclick = async function () {
        const v = await U.modal({ title: 'ยกเลิกการยืนยันรายงาน ' + rep.label, ok: 'ยกเลิกการยืนยัน', danger: true,
          html: '<p>รายงาน ' + U.esc(rep.report_no) + ' จะกลับเป็น<b>ร่าง</b> เพื่อให้แก้รายการของเดือนนี้ได้ แล้วจัดทำร่างใหม่และยืนยันอีกครั้ง (เลขที่รายงานเดิม)</p>' +
            '<ul class="small"><li>แก้จำนวนที่ส่งมอบผิด: คิวจ่ายวัสดุ → แท็บ "ส่งมอบแล้ว"</li><li>แก้ยอดคลังผิด: ตรวจนับ/ปรับยอด → เลือกเดือน ' + U.esc(rep.label) + '</li>' +
            '<li>ระบบบันทึกผู้ยกเลิก เวลา และเหตุผลไว้ในประวัติ · ฉบับที่ยืนยันใหม่ระบุ "ฉบับแก้ไขครั้งที่ ' + (rep.reopen_count + 1) + '"</li></ul>' +
            '<label class="field"><span>เหตุผลที่ต้องแก้ไข *</span><textarea class="input" name="reason" required></textarea></label>',
          validate: function (x) { return x.reason && x.reason.trim() ? '' : 'กรุณาระบุเหตุผล'; } });
        if (!v) return;
        try {
          await API.write('monthlyReopen', { ym: rep.ym, reason: v.reason.trim() });
          U.toast('ยกเลิกการยืนยัน ' + rep.label + ' แล้ว — แก้รายการแล้วสร้างร่างใหม่', 'ok');
          App.refreshMe(); App.render();
        } catch (er) { U.toast(er.message, 'err', 7000); }
      };
      const ok = U.$('#mr-ok');
      if (ok) ok.onclick = async function () {
        const v = await U.modal({ title: 'ยืนยันรายงานเดือน ' + rep.label, ok: 'ยืนยันรายงาน',
          html: '<p>เมื่อยืนยันแล้ว ตัวเลขของเดือนนี้จะ<b>ถูกล็อก</b> ไม่เปลี่ยนตามรายการที่บันทึกภายหลัง และใช้เป็นยอดยกมาของเดือนถัดไป</p>' +
            '<ul class="small"><li>วัสดุ ' + U.n(rep.items.length) + ' รายการ · มูลค่าคงเหลือ ' + U.money(s.close_value) + ' บาท</li><li>ผู้ยืนยัน: ' + U.esc(S.user.name) + ' (เจ้าหน้าที่พัสดุ)</li></ul>' +
            '<label class="check"><input type="checkbox" name="ok"> ตรวจสอบตัวเลขแล้ว ถูกต้อง</label>',
          validate: function (x) { return x.ok ? '' : 'กรุณาติ๊ก "ตรวจสอบตัวเลขแล้ว ถูกต้อง"'; } });
        if (!v) return;
        try {
          const r = await API.write('monthlyConfirm', { ym: rep.ym, rev: rep.rev });
          U.toast('ยืนยันรายงาน ' + r.report_no + ' แล้ว', 'ok');
          App.refreshMe(); App.render();
        } catch (er) { U.toast(er.message, 'err', 7000); App.render(); }
      };
    }
    const gen = U.$('#mr-gen');
    if (gen) gen.onclick = async function () {
      if (rep.status === 'DRAFT' && !(await U.confirm('สร้างร่างใหม่', 'คำนวณรายงานเดือน ' + U.esc(rep.label) + ' ใหม่จากข้อมูลล่าสุด แทนร่างเดิม', 'สร้างร่างใหม่'))) return;
      gen.classList.add('busy');
      try { const r = await API.call('monthlyGenerate', { ym: F.ym }, { write: true, timeout: 120000 }); U.toast('จัดทำร่างรายงาน ' + r.label + ' แล้ว (' + r.items + ' รายการ)', 'ok'); App.refreshMe(); App.render(); }
      catch (er) { gen.classList.remove('busy'); U.toast(er.message, 'err', 7000); }
    };
  }
});
