/**
 * ============================================================================
 *  PrintHub · ไฟล์ : Queue.gs
 *  หน้าที่ : รับไฟล์ · จัดคิว · ตรวจก่อนพิมพ์ · แสดงสถานะ · ยกเลิก · พิมพ์ซ้ำ · ประวัติ
 * ----------------------------------------------------------------------------
 *  การอัปโหลด ทำเป็น 3 จังหวะ เพื่อไม่ให้ล่มบนเน็ตมือถือ
 *    1) apiUploadStart   ขอเลขอ้างอิงการอัปโหลด
 *    2) apiUploadChunk   ส่งไฟล์เป็นก้อน ๆ (ก้อนละ ~1.5 MB) เก็บเป็นไฟล์ย่อยใน Drive
 *    3) apiSubmitJob     ต่อก้อนเป็นไฟล์เดียว ลบก้อนย่อย แล้วเข้าคิว
 *
 *  โหมด "ตรวจก่อนพิมพ์"
 *    คอมแปลงเป็น PDF แล้วส่ง PDF กลับขึ้นมา งานพักที่สถานะ PREVIEW
 *    ผู้ฝากเปิดดูบนมือถือก่อน ถ้าโอเคจึงกดยืนยัน กระดาษถึงจะออก
 *    ค่าเริ่มต้น : เปิดสำหรับ Word/Excel/PowerPoint (ที่แปลงแล้วอาจเพี้ยน)
 *                 ปิดสำหรับ PDF และรูปภาพ (ไม่ต้องแปลง ไม่มีอะไรให้เพี้ยน)
 * ============================================================================
 */

const QCOLS = 21;   /* จำนวนคอลัมน์ของชีต PRINT_QUEUE */

const Q = { ID:0, AT:1, USER:2, NAME:3, FILE:4, MIME:5, KB:6, FID:7, PDF:8,
            PAGES:9, COPIES:10, DUPLEX:11, RANGE:12, PRIO:13, STATUS:14,
            AGENT:15, START:16, END:17, ERR:18, TRY:19, PREVIEW:20 };

const ST = {
  WAIT_AGENT   : 'WAIT_AGENT',   // LINE: รับไฟล์แล้ว รอ PC Agent ออนไลน์
  WAIT_CONFIRM : 'WAIT_CONFIRM', // LINE: Agent ออนไลน์แล้ว รอผู้ใช้ยืนยันก่อนพิมพ์
  QUEUED  : 'QUEUED',       // รอคิว (Agent จองได้เฉพาะสถานะนี้)
  CLAIMED : 'CLAIMED',      // คอมจองงานแล้ว
  CONVERT : 'CONVERTING',   // กำลังแปลงเป็น PDF
  PREVIEW : 'PREVIEW',      // แปลงเสร็จ รอผู้ฝากตรวจ
  PRINTING: 'PRINTING',     // กำลังพิมพ์
  SENT    : 'SENT',         // ส่งเข้าเครื่องพิมพ์แล้ว รอผู้ฝากยืนยันว่าได้รับกระดาษ
  DONE    : 'DONE',
  ERROR   : 'ERROR',
  WAIT    : 'WAIT_APPROVE', // เกินเพดานหน้า รอแอดมินอนุมัติ
  CANCEL  : 'CANCELLED',
  EXPIRED : 'EXPIRED'
};

/* สถานะที่ยังต้องแสดงในหน้าคิว — รวม ERROR ไว้ด้วย เพราะงานที่พิมพ์ไม่สำเร็จ
   ต้องค้างให้เจ้าของเห็นและตัดสินใจเอง ไม่ใช่หายเงียบแล้วระบบสั่งพิมพ์ซ้ำให้ */
const LIVE = [ST.WAIT_AGENT, ST.WAIT_CONFIRM, ST.QUEUED, ST.CLAIMED, ST.CONVERT,
              ST.PREVIEW, ST.PRINTING, ST.WAIT, ST.SENT, ST.ERROR];

const ALLOW_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg', 'image/png', 'image/webp',
  'text/plain'
];

/* ============================================================================
 *  อัปโหลด
 * ========================================================================== */
function apiUploadStart(session) {
  requireSession_(session);
  return { ok: true, uploadId: 'UP' + Utilities.getUuid().replace(/-/g, '').slice(0, 16) };
}

function apiUploadChunk(session, uploadId, index, b64) {
  requireSession_(session);
  if (!/^UP[0-9a-f]{16}$/.test(String(uploadId))) return { ok: false, msg: 'รหัสอัปโหลดไม่ถูกต้อง' };

  spoolFolder_().createFile(
    Utilities.newBlob(Utilities.base64Decode(b64), 'application/octet-stream',
                      uploadId + '.part' + ('000' + index).slice(-3))
  );
  return { ok: true, index: index };
}

/** ต่อก้อนทั้งหมดเป็นไฟล์เดียว แล้วเพิ่มงานเข้าคิว */
function apiSubmitJob(session, uploadId, meta) {
  const me = requireSession_(session);

  const name   = String(meta.name || 'ไม่มีชื่อ').slice(0, 120);
  const mime   = String(meta.mime || '');
  const copies = Math.min(Math.max(parseInt(meta.copies, 10) || 1, 1), 20);
  const duplex = !!meta.duplex;
  const prev   = !!meta.preview;
  const range  = String(meta.range || '').replace(/[^0-9,\-\s]/g, '').slice(0, 40);

  if (ALLOW_MIME.indexOf(mime) < 0 && !/\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|txt)$/i.test(name)) {
    return { ok: false, msg: 'ไม่รองรับไฟล์ชนิดนี้' };
  }

  const bytes = mergeParts_(uploadId, mime);
  if (bytes.error) return { ok: false, msg: bytes.error };

  const jobId = nextJobId_();
  const saved = spoolFolder_().createFile(
    Utilities.newBlob(bytes.data, mime || 'application/octet-stream', jobId + '_' + name)
  );

  getDb_().getSheetByName('PRINT_QUEUE').appendRow([
    jobId, new Date(), me.code, me.name, name, mime,
    Math.round(bytes.data.length / 1024), saved.getId(), '',
    '', copies, duplex, range, 0, ST.QUEUED, '', '', '', '', 0, prev
  ]);

  audit_(me.code, 'SUBMIT', 'สำเร็จ', jobId + ' · ' + name);
  return { ok: true, jobId: jobId, position: queuePosition_(jobId) };
}

/** รวมไฟล์ย่อยเป็นก้อนเดียว — ต่อครั้งเดียวจบ ไม่ต่อทีละก้อน (ช้ากว่ามาก) */
function mergeParts_(uploadId, mime) {
  const folder = spoolFolder_();
  const parts  = [];
  const it     = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(uploadId + '.part') === 0) parts.push(f);
  }
  if (!parts.length) return { error: 'ไม่พบไฟล์ที่อัปโหลด กรุณาลองใหม่' };

  parts.sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });

  const chunks = parts.map(function (f) { return f.getBlob().getBytes(); });
  const data   = Array.prototype.concat.apply([], chunks);
  parts.forEach(function (f) { f.setTrashed(true); });

  const maxMB = setting_('MAX_FILE_MB', CFG.MAX_FILE_MB);
  if (data.length > maxMB * 1024 * 1024) return { error: 'ไฟล์ใหญ่เกิน ' + maxMB + ' MB' };
  return { data: data };
}

/** ค่าเริ่มต้นสำหรับหน้าสแกน — ชื่อไฟล์ที่ผู้ดูแลตั้งไว้ + เพดานขนาดไฟล์ */
function apiScanDefaults(session) {
  requireSession_(session);
  return {
    ok    : true,
    name  : settingText_('SCAN_NAME', CFG.SCAN_NAME),
    maxMB : setting_('MAX_FILE_MB', CFG.MAX_FILE_MB)
  };
}

/* ============================================================================
 *  ดูคิว · ประวัติ
 * ========================================================================== */
function apiListQueue(session) {
  const me = requireSession_(session);
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const n  = sh.getLastRow() - 1;

  const active = [];
  if (n > 0) {
    const live = sh.getRange(2, 1, n, QCOLS).getValues()
      .filter(function (r) { return LIVE.indexOf(r[Q.STATUS]) > -1; })
      .sort(function (a, b) { return (b[Q.PRIO] - a[Q.PRIO]) || (new Date(a[Q.AT]) - new Date(b[Q.AT])); });

    live.forEach(function (r, i) {
      active.push({
        id: r[Q.ID], at: fmtThai_(r[Q.AT]), who: r[Q.NAME], mine: r[Q.USER] === me.code,
        file: r[Q.FILE], kb: r[Q.KB], pages: r[Q.PAGES] || '', copies: r[Q.COPIES],
        duplex: r[Q.DUPLEX] === true, range: r[Q.RANGE],
        status: r[Q.STATUS], err: r[Q.ERR], pos: i + 1
      });
    });
  }
  return { ok: true, jobs: active, agent: agentStatus_(), role: me.role };
}

function apiHistory(session, limit) {
  const me = requireSession_(session);
  const sh = getDb_().getSheetByName('PRINT_LOG');
  const n  = sh.getLastRow() - 1;
  const quota = setting_('QUOTA_PAGES_MONTH', 0);
  if (n < 1) return { ok: true, rows: [], pagesThisMonth: 0, quota: quota };

  const all = sh.getRange(2, 1, n, 11).getValues().filter(function (r) { return r[2] === me.code; });

  const now = new Date();
  let used = 0;
  all.forEach(function (r) {
    const d = new Date(r[1]);
    if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && r[9] === ST.DONE) {
      used += Number(r[8] || 0);
    }
  });

  const rows = all.slice(-(limit || 30)).reverse().map(function (r) {
    return { id: r[0], at: fmtThai_(r[1]), file: r[5], pages: r[6],
             copies: r[7], sheets: r[8], status: r[9], note: r[10] };
  });
  return { ok: true, rows: rows, pagesThisMonth: used, quota: quota };
}

/* ============================================================================
 *  ตรวจก่อนพิมพ์ — ส่ง PDF ที่คอมแปลงแล้วกลับมาให้ดูบนมือถือ
 * ========================================================================== */
const PREVIEW_CHUNK = 700 * 1024;      // ส่งให้เบราว์เซอร์ทีละ ~700 KB

function apiPreviewInfo(session, jobId) {
  const me = requireSession_(session);
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const i  = findJobRow_(sh, jobId);
  if (i < 0) return { ok: false, msg: 'ไม่พบงานนี้' };

  const r = sh.getRange(i, 1, 1, QCOLS).getValues()[0];
  if (r[Q.USER] !== me.code && me.role !== 'admin') return { ok: false, msg: 'ดูได้เฉพาะงานของตนเอง' };
  if (!r[Q.PDF]) return { ok: false, msg: 'ยังไม่มีไฟล์ให้ตรวจ' };

  let size = 0;
  try { size = DriveApp.getFileById(r[Q.PDF]).getSize(); }
  catch (err) { return { ok: false, msg: 'ไฟล์ตรวจถูกลบไปแล้ว' }; }

  return { ok: true, file: r[Q.FILE], pages: r[Q.PAGES],
           copies: r[Q.COPIES], duplex: r[Q.DUPLEX] === true, range: r[Q.RANGE],
           bytes: size, parts: Math.max(1, Math.ceil(size / PREVIEW_CHUNK)) };
}

function apiPreviewPart(session, jobId, index) {
  const me = requireSession_(session);
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const i  = findJobRow_(sh, jobId);
  if (i < 0) return { ok: false };

  const r = sh.getRange(i, 1, 1, QCOLS).getValues()[0];
  if (r[Q.USER] !== me.code && me.role !== 'admin') return { ok: false };

  const bytes = DriveApp.getFileById(r[Q.PDF]).getBlob().getBytes();
  const from  = Number(index || 0) * PREVIEW_CHUNK;
  if (from >= bytes.length) return { ok: false };
  const to = Math.min(from + PREVIEW_CHUNK, bytes.length);
  return { ok: true, i: index, last: to >= bytes.length,
           data: Utilities.base64Encode(bytes.slice(from, to)) };
}

/** ผู้ฝากตรวจแล้ว — ยืนยันให้พิมพ์ หรือทิ้งไป */
function apiPreviewDecide(session, jobId, approve) {
  const me = requireSession_(session);
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const i  = findJobRow_(sh, jobId);
  if (i < 0) return { ok: false, msg: 'ไม่พบงานนี้' };

  const r = sh.getRange(i, 1, 1, QCOLS).getValues()[0];
  if (r[Q.USER] !== me.code && me.role !== 'admin') return { ok: false, msg: 'ตรวจได้เฉพาะงานของตนเอง' };
  if (r[Q.STATUS] !== ST.PREVIEW) return { ok: false, msg: 'งานนี้ไม่ได้อยู่ระหว่างรอตรวจ' };

  if (approve) {
    sh.getRange(i, Q.PREVIEW + 1).setValue(false);   // ตรวจแล้ว ไม่ต้องพักอีก
    sh.getRange(i, Q.TRY + 1).setValue(0);
    sh.getRange(i, Q.STATUS + 1).setValue(ST.QUEUED);
    audit_(me.code, 'PREVIEW', 'อนุมัติ', jobId);
    return { ok: true, msg: 'ส่งเข้าคิวพิมพ์แล้ว' };
  }

  sh.getRange(i, Q.STATUS + 1).setValue(ST.CANCEL);
  sh.getRange(i, Q.END + 1).setValue(new Date());
  trashFile_(r[Q.FID]);
  trashFile_(r[Q.PDF]);
  r[Q.STATUS] = ST.CANCEL;
  archive_(r, 'ผู้ฝากตรวจแล้วไม่พิมพ์');
  audit_(me.code, 'PREVIEW', 'ไม่พิมพ์', jobId);
  return { ok: true, msg: 'ยกเลิกงานแล้ว ไม่มีกระดาษออก' };
}

/* ============================================================================
 *  ยืนยันรับเอกสาร — งานยังไม่ถือว่าเสร็จจนกว่าคนจะไปหยิบกระดาษจริง
 * ----------------------------------------------------------------------------
 *  agent รายงานได้แค่ว่า "ส่งเข้าเครื่องพิมพ์แล้ว" ซึ่งไม่ได้แปลว่ากระดาษออก
 *  ผู้ฝากจึงต้องกดยืนยันเอง หรือปล่อยให้ระบบปิดเองเมื่อครบเวลา
 * ========================================================================== */
function apiConfirmReceived(session, jobId, ok, note) {
  const me = requireSession_(session);
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const i  = findJobRow_(sh, jobId);
  if (i < 0) return { ok: false, msg: 'ไม่พบงานนี้' };

  const r = sh.getRange(i, 1, 1, QCOLS).getValues()[0];
  if (r[Q.USER] !== me.code && me.role !== 'admin') return { ok: false, msg: 'ยืนยันได้เฉพาะงานของตนเอง' };
  if (r[Q.STATUS] !== ST.SENT) return { ok: false, msg: 'งานนี้ไม่ได้อยู่ระหว่างรอยืนยันรับเอกสาร' };

  if (ok) {
    sh.getRange(i, Q.STATUS + 1).setValue(ST.DONE);
    sh.getRange(i, Q.END + 1).setValue(new Date());
    r[Q.STATUS] = ST.DONE;
    archive_(r, 'ผู้ฝากยืนยันรับเอกสารแล้ว');
    audit_(me.code, 'RECEIVE', 'สำเร็จ', jobId);
    return { ok: true, msg: 'ปิดงานเรียบร้อย' };
  }

  /* ไม่ได้รับ / กระดาษไม่ครบ — ไม่พิมพ์ซ้ำให้เอง ต้องให้คนตัดสินใจที่หน้าเครื่อง */
  const why = String(note || 'ผู้ฝากแจ้งว่าเอกสารไม่ครบหรือไม่ได้รับ').slice(0, 200);
  sh.getRange(i, Q.STATUS + 1).setValue(ST.ERROR);
  sh.getRange(i, Q.ERR + 1).setValue(why);
  audit_(me.code, 'RECEIVE', 'มีปัญหา', jobId + ' · ' + why);
  return { ok: true, msg: 'บันทึกแล้ว — ตรวจที่เครื่องพิมพ์ก่อนสั่งพิมพ์ซ้ำ' };
}

/* ============================================================================
 *  จัดการงาน
 * ========================================================================== */
function apiCancelJob(session, jobId) {
  const me = requireSession_(session);
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const i  = findJobRow_(sh, jobId);
  if (i < 0) return { ok: false, msg: 'ไม่พบงานนี้' };

  const row = sh.getRange(i, 1, 1, QCOLS).getValues()[0];
  if (row[Q.USER] !== me.code && me.role !== 'admin') return { ok: false, msg: 'ยกเลิกได้เฉพาะงานของตนเอง' };
  if ([ST.PRINTING, ST.SENT, ST.DONE].indexOf(row[Q.STATUS]) > -1)
    return { ok: false, msg: 'งานนี้ส่งเข้าเครื่องพิมพ์ไปแล้ว ยกเลิกไม่ได้' };

  sh.getRange(i, Q.STATUS + 1).setValue(ST.CANCEL);
  sh.getRange(i, Q.END + 1).setValue(new Date());
  trashFile_(row[Q.FID]);
  trashFile_(row[Q.PDF]);
  row[Q.STATUS] = ST.CANCEL;          // ให้ประวัติบันทึกสถานะที่ถูกต้อง
  archive_(row, 'ผู้ใช้ยกเลิก');
  audit_(me.code, 'CANCEL', 'สำเร็จ', jobId);
  return { ok: true };
}

/** แอดมินอนุมัติงานที่เกินเพดานหน้า */
function apiApproveJob(session, jobId) {
  const me = requireSession_(session);
  if (me.role !== 'admin') return { ok: false, msg: 'เฉพาะผู้ดูแลระบบเท่านั้น' };

  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const i  = findJobRow_(sh, jobId);
  if (i < 0) return { ok: false, msg: 'ไม่พบงานนี้' };

  sh.getRange(i, Q.PRIO + 1).setValue(1);       // 1 = ผ่านการอนุมัติแล้ว
  sh.getRange(i, Q.STATUS + 1).setValue(ST.QUEUED);
  sh.getRange(i, Q.TRY + 1).setValue(0);
  sh.getRange(i, Q.ERR + 1).setValue('');
  audit_(me.code, 'APPROVE', 'สำเร็จ', jobId);
  return { ok: true };
}

/** พิมพ์ซ้ำจากไฟล์เดิม (ยังไม่ถูกลบ) */
function apiReprint(session, jobId) {
  const me = requireSession_(session);
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const i  = findJobRow_(sh, jobId);
  if (i < 0) return { ok: false, msg: 'ไม่พบงานเดิม อาจถูกลบไปแล้ว' };

  const r = sh.getRange(i, 1, 1, QCOLS).getValues()[0];
  if (r[Q.USER] !== me.code && me.role !== 'admin') return { ok: false, msg: 'พิมพ์ซ้ำได้เฉพาะงานของตนเอง' };

  let src, fresh;
  try {
    src = DriveApp.getFileById(r[Q.FID]);
    if (src.isTrashed()) throw new Error('trashed');
    fresh = src.makeCopy();
  } catch (err) {
    return { ok: false, msg: 'ไฟล์ต้นฉบับถูกลบไปแล้ว กรุณาอัปโหลดใหม่' };
  }

  const jobId2 = nextJobId_();
  fresh.setName(jobId2 + '_' + r[Q.FILE]);
  spoolFolder_().addFile(fresh);
  DriveApp.getRootFolder().removeFile(fresh);

  sh.appendRow([jobId2, new Date(), me.code, me.name, r[Q.FILE], r[Q.MIME], r[Q.KB],
                fresh.getId(), '', '', r[Q.COPIES], r[Q.DUPLEX], r[Q.RANGE], 0,
                ST.QUEUED, '', '', '', '', 0, false]);   // พิมพ์ซ้ำไม่ต้องตรวจอีก
  audit_(me.code, 'REPRINT', 'สำเร็จ', jobId + ' → ' + jobId2);
  return { ok: true, jobId: jobId2 };
}

/* ============================================================================
 *  เครื่องมือภายใน
 * ========================================================================== */
function nextJobId_() {
  const props = PropertiesService.getScriptProperties();
  const lock  = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    const n = Number(props.getProperty('JOB_SEQ') || 0) + 1;
    props.setProperty('JOB_SEQ', String(n));
    return 'J' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMMdd') + '-' + ('000' + n).slice(-4);
  } finally { lock.releaseLock(); }
}

function findJobRow_(sh, jobId) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return -1;
  const col = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < col.length; i++) if (String(col[i][0]) === String(jobId)) return i + 2;
  return -1;
}

function queuePosition_(jobId) {
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const n  = sh.getLastRow() - 1;
  if (n < 1) return 1;
  const rows = sh.getRange(2, 1, n, QCOLS).getValues()
    .filter(function (r) { return LIVE.indexOf(r[Q.STATUS]) > -1; })
    .sort(function (a, b) { return (b[Q.PRIO] - a[Q.PRIO]) || (new Date(a[Q.AT]) - new Date(b[Q.AT])); });
  for (let i = 0; i < rows.length; i++) if (rows[i][Q.ID] === jobId) return i + 1;
  return rows.length + 1;
}

function spoolFolder_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPOOL_ID');
  if (!id) throw new Error('ยังไม่ได้ติดตั้งระบบ (ไม่พบโฟลเดอร์ _spool)');
  return DriveApp.getFolderById(id);
}

function trashFile_(id) {
  try { if (id) DriveApp.getFileById(id).setTrashed(true); } catch (err) {}
}

/** ย้ายงานที่จบแล้วลง PRINT_LOG */
function archive_(r, note) {
  const u = userByCode_(r[Q.USER]);
  const pages = Number(r[Q.PAGES] || 0);
  getDb_().getSheetByName('PRINT_LOG').appendRow([
    r[Q.ID], new Date(), r[Q.USER], r[Q.NAME], u ? u.dept : '', r[Q.FILE],
    pages, r[Q.COPIES], pages * Number(r[Q.COPIES] || 1), r[Q.STATUS], note || ''
  ]);
}

function agentStatus_() {
  const sh = getDb_().getSheetByName('AGENTS');
  const n  = sh.getLastRow() - 1;
  if (n < 1) return { online: false, printer: 'ยังไม่ได้ติดตั้งโปรแกรมฝั่งคอม' };

  let best = null;
  sh.getRange(2, 1, n, 7).getValues().forEach(function (r) {
    if (!best || new Date(r[2]) > new Date(best[2])) best = r;
  });
  const online = best && (new Date() - new Date(best[2])) < 120000;   // เงียบเกิน 2 นาที = ออฟไลน์
  return {
    online : !!online,
    name   : best ? best[1] : '',
    printer: online ? (best[3] || 'พร้อมพิมพ์') : 'คอมปิดอยู่ — งานจะค้างในคิวจนกว่าจะเปิด',
    last   : best ? fmtThai_(best[2]) : ''
  };
}

/* ===== HOOK: แจ้งเตือนผ่าน LINE เมื่อพิมพ์เสร็จ ใส่ฟังก์ชันตรงนี้ =====
 * function notifyLine_(userCode, message) { ... UrlFetchApp ไป Messaging API ... }
 */
