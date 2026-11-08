/* ระบบบริหารวัสดุสำนักงาน · print.js — ใบเบิกวัสดุ A4 แนวตั้ง (TH Sarabun New 16 pt) ดูตัวอย่างก่อนพิมพ์ทุกครั้ง
 * ชื่อผู้ขอเบิก ตำแหน่ง ส่วนงาน หัวหน้าส่วน = snapshot ณ วันที่ยื่น · ชื่อเจ้าหน้าที่พัสดุ = ตอนส่งมอบ · ไม่แสดงราคา */
'use strict';
const PrintDoc = (function () {
  const dots = '..................................';
  function d(v) { return v ? U.thDate(v) : '...../...../.....'; }
  /** qr = SVG จาก U.qrSvg(U.reqLink(req_id)) — ว่างได้ */
  function reqSheet(r, qr) {
    const rows = r.items.map(function (i, n) {
      return '<tr><td class="c">' + (n + 1) + '</td><td>' + U.esc(i.name) + '</td><td class="c">' + U.esc(i.unit_name) + '</td><td class="r">' + U.n(i.qty_approved !== null ? i.qty_approved : i.qty_req) + '</td>' +
        '<td class="r">' + (i.qty_issued !== null ? U.n(i.qty_issued) : '') + '</td><td>' + (i.qty_returned ? 'รับคืน ' + U.n(i.qty_returned) : '') + '</td></tr>';
    });
    while (rows.length < 8) rows.push('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>');
    const st = { ISSUED: 'จ่ายแล้ว', READY: 'พร้อมรับ', PENDING_PREP: 'รอจัดเตรียม', PENDING_APPROVAL: 'รออนุมัติ', CANCELLED: 'ยกเลิก', REJECTED: 'ไม่อนุมัติ' }[r.status] || r.status;
    return '<div class="sheet" style="--m:' + (r.print_margin_cm || App.S.cfg.print_margin_cm || 2) + 'cm">' +
      (API.scope() ? '<div style="border:2px solid #a66b00;text-align:center;font-weight:bold;padding:6px">ข้อมูลตัวอย่างสำหรับฝึกใช้งาน — ห้ามใช้เป็นเอกสารเบิกจ่ายจริง</div>' : '') +
      (!API.scope() && App.S.me && App.S.me.realTrial && App.S.me.realTrial.active ? '<div style="border:2px solid #bf6230;text-align:center;font-weight:bold;padding:6px">รอบทดสอบบนฐานข้อมูลจริง</div>' : '') +
      '<div class="head"><div></div><div><h1>ใบเบิกวัสดุ</h1><p class="org">' + U.esc(r.org_name || App.S.cfg.org_name || 'ศาลจังหวัดลพบุรี') + '</p></div>' +
      '<div class="qr">' + (qr ? qr + '<small>สแกนเปิดใบนี้</small>' : '') + '</div></div>' +
      '<div class="meta"><span>ส่วนงาน <b>' + U.esc(r.dept_name || '-') + '</b></span><span>เลขที่ <b>' + U.esc(r.req_no) + '</b></span></div>' +
      '<div class="meta"><span></span><span>วันที่ ' + U.thDate(r.created_at) + '</span></div>' +
      '<p>ข้าพเจ้า <span class="dotted">' + U.esc(r.requester_name) + '</span> ตำแหน่ง <span class="dotted">' + U.esc(r.requester_position || dots) + '</span> ' +
      'มีความประสงค์ขอเบิกวัสดุตามรายการต่อไปนี้ เพื่อ <span class="dotted">' + U.esc(r.purpose || 'ใช้ในราชการ') + '</span></p>' +
      '<table><thead><tr><th style="width:9%">ลำดับ</th><th>รายการ</th><th style="width:13%">หน่วยนับ</th><th style="width:15%">จำนวนที่ขอเบิก</th><th style="width:14%">จำนวนที่จ่าย</th><th style="width:15%">หมายเหตุ</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody></table>' +
      '<div class="sign">' +
      '<div>ลงชื่อ' + dots + '<br>ผู้ขอเบิก<br>(' + U.esc(r.requester_name) + ')<small>' + U.esc(r.requester_position || '') + '</small><small>วันที่ ' + d(r.created_at) + '</small></div>' +
      '<div>ลงชื่อ' + dots + '<br>หัวหน้าส่วน<br>(' + (r.head_name ? U.esc(r.head_name) : dots) + ')<small>' + U.esc(r.dept_name || '') + '</small><small>วันที่ ' + d(r.approved_at) + '</small></div>' +
      '<div>ลงชื่อ' + dots + '<br>เจ้าหน้าที่พัสดุ<br>(' + (r.issuer_name ? U.esc(r.issuer_name) : dots) + ')<small>&nbsp;</small><small>วันที่ ' + d(r.issued_at) + '</small></div></div>' +
      '<div class="recv">ได้รับวัสดุตามรายการข้างต้นถูกต้องครบถ้วนแล้ว &nbsp; ลงชื่อ' + dots + 'ผู้รับของ (' + (r.receiver_name ? U.esc(r.receiver_name) : dots) + ') วันที่ ' + d(r.issued_at) + '</div>' +
      '<div class="foot"><span>พิมพ์จาก' + U.esc(U.APP_NAME) + ' ' + U.thDateTime(new Date()) + '</span><span>สถานะ: ' + U.esc(st) + '</span></div></div>';
  }
  /** ใบจัดเตรียมวัสดุรวม: รวมรายการจากหลายใบ เรียงตามหมวด → รหัส · มีช่องติ๊กและจำนวนแยกตามใบ */
  function pickSheet(reqs) {
    const S = App.S;
    const lim = function (i) { return i.qty_approved !== null && i.qty_approved !== undefined ? i.qty_approved : i.qty_req; };
    const groups = {};
    reqs.forEach(function (r) {
      r.items.forEach(function (i) {
        const q = r.status === 'READY' && i.qty_ready !== null ? i.qty_ready : lim(i);
        if (!(q > 0)) return;
        const m = (S.idx && S.idx[i.mat_id]) || {};
        const cat = (S.cats && S.cats[m.cat_id] || {}).name || 'อื่น ๆ';
        const key = i.mat_id + '|' + i.unit_name;
        const g = groups[cat] = groups[cat] || {};
        const x = g[key] = g[key] || { code: m.code || '', name: i.name, unit: i.unit_name, total: 0, balance: i.balance, per: [] };
        x.total += q;
        x.per.push('<span class="nw">' + U.esc(r.req_no) + ' ×' + U.n(q) + '</span>');
      });
    });
    const cats = Object.keys(groups).sort(function (a, b) { return a === 'อื่น ๆ' ? 1 : b === 'อื่น ๆ' ? -1 : a.localeCompare(b, 'th'); });
    let n = 0;
    const body = cats.map(function (c) {
      const rows = Object.keys(groups[c]).map(function (k) { return groups[c][k]; })
        .sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'th', { numeric: true }) || a.name.localeCompare(b.name, 'th'); });
      return '<tr class="grp"><td colspan="7"><b>' + U.esc(c) + '</b> (' + rows.length + ' รายการ)</td></tr>' + rows.map(function (x) {
        n++;
        const short = typeof x.balance === 'number' && x.balance < x.total;
        return '<tr><td class="c">☐</td><td class="c">' + n + '</td><td class="nw">' + U.esc(x.code) + '</td><td>' + U.esc(x.name) + '</td><td class="c">' + U.esc(x.unit) + '</td>' +
          '<td class="r"><b>' + U.n(x.total) + '</b>' + (short ? '<br><small class="nw">เหลือ ' + U.n(x.balance) + '</small>' : '') + '</td><td class="small">' + x.per.join(' · ') + '</td></tr>';
      }).join('');
    }).join('');
    const list = reqs.map(function (r) {
      return '<tr><td>' + U.esc(r.req_no) + '</td><td>' + U.esc(r.requester_name) + '</td><td>' + U.esc(r.dept_name || '') + '</td><td class="c">' + r.items.length + '</td><td>' + U.thDateTime(r.created_at) + '</td></tr>';
    }).join('');
    return '<div class="sheet pick" style="--m:' + (S.cfg.print_margin_cm || 2) + 'cm">' +
      (API.scope() ? '<div style="border:2px solid #a66b00;text-align:center;font-weight:bold;padding:6px">ข้อมูลตัวอย่างสำหรับฝึกใช้งาน</div>' : '') +
      '<h1>ใบจัดเตรียมวัสดุ (รวม ' + reqs.length + ' ใบ)</h1><p class="org">' + U.esc(S.cfg.org_name || 'ศาลจังหวัดลพบุรี') + '</p>' +
      '<div class="meta"><span>พิมพ์เมื่อ ' + U.thDateTime(new Date()) + '</span><span>ผู้พิมพ์ ' + U.esc(S.user.name) + '</span></div>' +
      '<table><thead><tr><th style="width:5%">✓</th><th style="width:5%">ที่</th><th style="width:13%">รหัส</th><th>รายการ</th><th style="width:9%">หน่วย</th><th style="width:9%">รวม</th><th style="width:27%">แยกตามใบเบิก</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="7" class="c">ไม่มีรายการ</td></tr>') + '</tbody></table>' +
      '<p><b>ใบเบิกที่รวมในใบนี้</b></p><table class="list"><thead><tr><th>เลขที่</th><th>ผู้ขอเบิก</th><th>ส่วนงาน</th><th style="width:10%">รายการ</th><th>ยื่นเมื่อ</th></tr></thead><tbody>' + list + '</tbody></table>' +
      '<div class="sign one"><div>ลงชื่อ' + dots + 'ผู้จัดเตรียม<br>(' + U.esc(S.user.name) + ') วันที่ ...../...../.....</div></div>' +
      '<div class="foot"><span>ใบจัดเตรียมใช้ภายในงานพัสดุ — ไม่ใช่หลักฐานการจ่าย</span><span>' + U.esc(U.APP_NAME) + '</span></div></div>';
  }
  function print(sheetHtml, marginCm) {
    const root = U.$('#print-root');
    root.innerHTML = sheetHtml;
    let st = U.$('#page-style');
    if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); }
    st.textContent = '@page { size: A4 portrait; margin: ' + (marginCm || 2) + 'cm; @bottom-right { content: "หน้า " counter(page) "/" counter(pages); font-family: "PrintTHSN", "PrintSarabun", serif; font-size: 12pt; } }';
    setTimeout(function () { window.print(); }, 50);
  }
  return { reqSheet: reqSheet, pickSheet: pickSheet, print: print };
})();

App.view('print', {
  title: 'พิมพ์ใบเบิก',
  render: async function (el, params) {
    el.innerHTML = '<div class="page-h row noprint"><div><h1>ใบเบิกวัสดุ</h1><p>ตรวจตัวอย่างก่อนพิมพ์ · บันทึกเป็น PDF ได้จากหน้าต่างพิมพ์</p></div><span class="spacer"></span>' +
      '<button class="btn" onclick="history.back()">กลับ</button><button class="btn primary lg" id="pr">' + ICON('print') + 'พิมพ์ / บันทึก PDF</button></div><div class="print-preview" id="pv"><div class="skel"></div></div>';
    let html = '', margin = App.S.cfg.print_margin_cm || 2;
    if (params[0] === 'batch') {
      const B = App.S.forms.batchPrint;
      if (!B || !B.rows || !B.rows.length) {
        el.innerHTML = '<h1>พิมพ์ใบเตรียมของ</h1><div class="notice warn"><div><b>ยังไม่ได้เลือกใบเบิก</b>เลือกจากหน้า คิวจ่ายวัสดุ แล้วกด "พิมพ์ใบเตรียมของ"</div></div><a class="btn" href="#/queue">ไปคิวจ่ายวัสดุ</a>';
        return;
      }
      U.$('.page-h h1').textContent = B.mode === 'pick' ? 'ใบจัดเตรียมวัสดุ (รวม)' : 'ใบเบิก ' + B.rows.length + ' ใบ';
      if (B.mode === 'pick') html = PrintDoc.pickSheet(B.rows);
      else {
        const qrs = await Promise.all(B.rows.map(function (r) { return U.qrSvg(U.reqLink(r.req_id)); }));
        html = B.rows.map(function (r, i) { return PrintDoc.reqSheet(r, qrs[i]); }).join('');
      }
    } else {
      const r = await API.call('getRequest', { req_id: params[0] });
      html = PrintDoc.reqSheet(r, await U.qrSvg(U.reqLink(r.req_id)));
      margin = r.print_margin_cm || margin;
    }
    const pv = U.$('#pv');
    pv.innerHTML = html;
    const fit = function () {
      const sheets = U.$$('.sheet', pv); if (!sheets.length) return;
      const w = pv.clientWidth - 44, full = sheets[0].offsetWidth;
      const s = Math.min(1, w / full);
      let h = 0;
      sheets.forEach(function (sh) {
        sh.style.transform = s < 1 ? 'scale(' + s + ')' : '';
        sh.style.transformOrigin = 'top left';
        sh.style.marginBottom = s < 1 ? (-(sh.offsetHeight * (1 - s)) + 16) + 'px' : '';
        h += sh.offsetHeight * s + 16;
      });
      pv.style.height = s < 1 ? (h + 28) + 'px' : '';
    };
    fit();
    window.addEventListener('resize', fit);
    U.$('#pr').onclick = function () { PrintDoc.print(html, margin); };
  }
});


