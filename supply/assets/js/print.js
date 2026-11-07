/* ระบบเบิกวัสดุ · print.js — ใบเบิกวัสดุ A4 แนวตั้ง (TH Sarabun New 16 pt) ดูตัวอย่างก่อนพิมพ์ทุกครั้ง
 * ชื่อผู้ขอเบิก ตำแหน่ง ส่วนงาน หัวหน้าส่วน = snapshot ณ วันที่ยื่น · ชื่อเจ้าหน้าที่พัสดุ = ตอนส่งมอบ · ไม่แสดงราคา */
'use strict';
const PrintDoc = (function () {
  const dots = '..................................';
  function d(v) { return v ? U.thDate(v) : '...../...../.....'; }
  function reqSheet(r) {
    const rows = r.items.map(function (i, n) {
      return '<tr><td class="c">' + (n + 1) + '</td><td>' + U.esc(i.name) + '</td><td class="c">' + U.esc(i.unit_name) + '</td><td class="r">' + U.n(i.qty_approved !== null ? i.qty_approved : i.qty_req) + '</td>' +
        '<td class="r">' + (i.qty_issued !== null ? U.n(i.qty_issued) : '') + '</td><td>' + (i.qty_returned ? 'รับคืน ' + U.n(i.qty_returned) : '') + '</td></tr>';
    });
    while (rows.length < 8) rows.push('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>');
    const st = { ISSUED: 'จ่ายแล้ว', READY: 'พร้อมรับ', PENDING_PREP: 'รอจัดเตรียม', PENDING_APPROVAL: 'รออนุมัติ', CANCELLED: 'ยกเลิก', REJECTED: 'ไม่อนุมัติ' }[r.status] || r.status;
    return '<div class="sheet" style="--m:' + (r.print_margin_cm || 2) + 'cm">' +
      (API.scope() ? '<div style="border:2px solid #a66b00;text-align:center;font-weight:bold;padding:6px">ข้อมูลตัวอย่างสำหรับฝึกใช้งาน — ห้ามใช้เป็นเอกสารเบิกจ่ายจริง</div>' : '') +
      '<h1>ใบเบิกวัสดุ</h1><p class="org">' + U.esc(r.org_name || 'ศาลจังหวัดลพบุรี') + '</p>' +
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
      '<div class="foot"><span>พิมพ์จากระบบเบิกวัสดุ ' + U.thDateTime(new Date()) + '</span><span>สถานะ: ' + U.esc(st) + '</span></div></div>';
  }
  function print(sheetHtml, marginCm) {
    const root = U.$('#print-root');
    root.innerHTML = sheetHtml;
    let st = U.$('#page-style');
    if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); }
    st.textContent = '@page { size: A4 portrait; margin: ' + (marginCm || 2) + 'cm; @bottom-right { content: "หน้า " counter(page) "/" counter(pages); font-family: "PrintTHSN", "PrintSarabun", serif; font-size: 12pt; } }';
    setTimeout(function () { window.print(); }, 50);
  }
  return { reqSheet: reqSheet, print: print };
})();

App.view('print', {
  title: 'พิมพ์ใบเบิก',
  render: async function (el, params) {
    el.innerHTML = '<div class="page-h row noprint"><div><h1>ใบเบิกวัสดุ</h1><p>ตรวจตัวอย่างก่อนพิมพ์ · บันทึกเป็น PDF ได้จากหน้าต่างพิมพ์</p></div><span class="spacer"></span>' +
      '<button class="btn" onclick="history.back()">กลับ</button><button class="btn primary lg" id="pr">' + ICON('print') + 'พิมพ์ / บันทึก PDF</button></div><div class="print-preview" id="pv"><div class="skel"></div></div>';
    const r = await API.call('getRequest', { req_id: params[0] });
    const html = PrintDoc.reqSheet(r);
    const pv = U.$('#pv');
    pv.innerHTML = html;
    const fit = function () {
      const sh = pv.querySelector('.sheet'); if (!sh) return;
      const w = pv.clientWidth - 44, full = sh.offsetWidth;
      const s = Math.min(1, w / full);
      sh.style.transform = s < 1 ? 'scale(' + s + ')' : '';
      sh.style.transformOrigin = 'top left';
      pv.style.height = s < 1 ? (sh.offsetHeight * s + 44) + 'px' : '';
    };
    fit();
    window.addEventListener('resize', fit);
    U.$('#pr').onclick = function () { PrintDoc.print(html, r.print_margin_cm); };
  }
});

