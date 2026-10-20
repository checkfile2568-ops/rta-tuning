/**
 * RTA จูน 3 ทาง — ตัวซิงก์ข้อมูลระหว่างมือถือ ↔ คอม (Google Apps Script + Google Sheet)
 * ติดตั้ง: สร้าง Google Sheet ใหม่ → ส่วนขยาย → Apps Script → วางโค้ดนี้ทั้งหมด → บันทึก
 *          → ทำให้ใช้งานได้ (Deploy) → การทำให้ใช้งานได้รายการใหม่ → ประเภท: เว็บแอป
 *          → ดำเนินการในฐานะ: ฉัน · ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน → ทำให้ใช้งานได้ → คัดลอก URL /exec
 * แต่ละ "รหัสซิงก์" = 1 แถวในชีต rta_sync  (A=รหัส, B=rev, C=เวลา, D=จากเครื่อง, E..=ข้อมูล JSON แบ่งช่องละ 45,000 ตัวอักษร)
 */
const SHEET_NAME = 'rta_sync';
const CHUNK = 45000;

function doGet(e) { return handle_(e && e.parameter ? e.parameter : {}); }
function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) {}
  return handle_(body);
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function handle_(p) {
  const key = String(p.key || '').trim();
  if (key.length < 6) return out_({ ok: false, err: 'รหัสซิงก์ต้องยาวอย่างน้อย 6 ตัว' });
  if (p.op === 'ping') return out_({ ok: true, pong: true });
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = sheet_();
    const last = sh.getLastRow();
    let row = -1;
    if (last > 0) {
      const keys = sh.getRange(1, 1, last, 1).getValues();
      for (let i = 0; i < keys.length; i++) if (String(keys[i][0]) === key) { row = i + 1; break; }
    }
    if (p.op === 'put') {
      const doc = String(p.doc || '');
      if (doc.length > CHUNK * 40) return out_({ ok: false, err: 'ข้อมูลใหญ่เกิน' });
      const parts = [];
      for (let i = 0; i < doc.length; i += CHUNK) parts.push(doc.substring(i, i + CHUNK));
      const prevRev = row > 0 ? Number(sh.getRange(row, 2).getValue()) || 0 : 0;
      const rev = prevRev + 1, ts = Date.now();
      if (row < 0) row = last + 1;
      const width = Math.max(sh.getLastColumn(), 4 + parts.length);
      const vals = [key, rev, ts, String(p.from || '')].concat(parts);
      while (vals.length < width) vals.push('');
      const rg = sh.getRange(row, 1, 1, width);
      rg.setNumberFormat('@');            // เก็บเป็นข้อความล้วน กัน Sheets แปลง JSON เป็นตัวเลข/สูตร
      rg.setValues([vals.map(String)]);
      return out_({ ok: true, rev: rev, ts: ts });
    }
    // get
    if (row < 0) return out_({ ok: true, rev: 0, ts: 0, doc: '' });
    const width = sh.getLastColumn();
    const r = sh.getRange(row, 1, 1, width).getValues()[0];
    let doc = '';
    for (let c = 4; c < r.length; c++) doc += String(r[c] || '');
    return out_({ ok: true, rev: Number(r[1]) || 0, ts: Number(r[2]) || 0, from: String(r[3] || ''), doc: doc });
  } finally {
    lock.releaseLock();
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
