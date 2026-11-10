/* ═══════════════════════════════════════════════════════════════════════
 * print-kit · adapters/supply.js · v1.0.0
 * แปลงข้อมูลใบเบิกของระบบบริหารวัสดุสำนักงาน (r จาก API getRequest)
 * → ข้อมูลคีย์ภาษาไทยของแม่แบบ supply.req
 * ตรรกะเดียวกับ PrintDoc.reqSheet() ของระบบวัสดุ 1.7.4 (ไม่แสดงราคา)
 * ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  function n(v) { return v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('th-TH'); }
  function reqData(r, cfg, appName) {
    const K = root.PrintKit;
    const short = function (v) { return v ? K.thDateS(v) : ''; };   // 9 พ.ย. 2569 · ว่าง → ตัวกรอง shortdots เติมจุดไข่ปลา
    return {
      'หน่วยงาน': r.org_name || (cfg && cfg.org_name) || 'ศาลจังหวัดลพบุรี',
      'ส่วนงาน': r.dept_name || '-',
      'เลขที่': r.req_no || '',
      'วันที่': K.thDate(r.created_at),
      'ผู้ขอเบิก': r.requester_name || '',
      'ตำแหน่ง': r.requester_position || '',
      'วัตถุประสงค์': r.purpose || 'ใช้ในราชการ',
      'หัวหน้าส่วน': r.head_name || '',
      'เจ้าหน้าที่พัสดุ': r.issuer_name || '',
      'ผู้รับวัสดุ': r.receiver_name || '',
      'วันที่ยื่น': short(r.created_at),
      'วันที่อนุมัติ': short(r.approved_at),
      'วันที่จ่าย': short(r.issued_at),
      'รายการ': (r.items || []).map(function (i) {
        const req = i.qty_approved !== null && i.qty_approved !== undefined ? i.qty_approved : i.qty_req;
        return {
          'รายการ': i.name,
          'หน่วยนับ': i.unit_name,
          'จำนวนเบิก': n(req),
          'จำนวนจ่าย': i.qty_issued !== null && i.qty_issued !== undefined ? n(i.qty_issued - (i.qty_returned || 0)) : '',
          'หมายเหตุ': i.qty_returned ? 'จ่าย ' + n(i.qty_issued) + ' คืน/แก้ ' + n(i.qty_returned) : ''
        };
      }),
      'หมายเหตุแก้ไข': r.edit_count ? 'แก้ไขจำนวนที่จ่าย ' + r.edit_count + ' ครั้ง ล่าสุด ' + K.thDateTime(r.edited_at) + ' โดย ' + (r.edited_name || '') + ' เหตุผล ' + (r.edit_reason || '') : '',
      'ชื่อระบบ': appName || 'ระบบบริหารวัสดุสำนักงาน',
      'เวลาพิมพ์': K.thDateTime(new Date())
    };
  }
  root.PrintKitSupply = { reqData: reqData };
})(typeof window !== 'undefined' ? window : this);
