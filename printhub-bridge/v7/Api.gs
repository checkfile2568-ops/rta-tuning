/**
 * ============================================================================
 *  PrintHub · ไฟล์ : Api.gs
 *  หน้าที่ : ช่องทางคุยกับโปรแกรมฝั่งคอม (agent) + งานดูแลอัตโนมัติ
 * ----------------------------------------------------------------------------
 *  agent ยิง POST มาที่ Web app URL เดียวกัน พร้อม JSON:
 *      { "token": "<AGENT_TOKEN>", "action": "...", ... }
 *
 *  ลำดับที่ agent ทำงาน
 *      claim      → จองงานถัดไป (บอกด้วยว่าให้ดึงไฟล์ต้นฉบับหรือ PDF ที่แปลงไว้แล้ว)
 *      part       → ดาวน์โหลดไฟล์ทีละก้อน
 *      converted  → บอกจำนวนหน้าหลังแปลง  → เซิร์ฟเวอร์ตอบว่าให้พิมพ์ หรือให้ส่ง PDF มาตรวจก่อน
 *      uploadpdf  → ส่ง PDF ที่แปลงแล้วกลับขึ้นมา (เฉพาะงานที่ขอตรวจก่อนพิมพ์)
 *      report     → แจ้งผลสุดท้าย DONE / ERROR
 *      heartbeat  → บอกว่ายังมีชีวิต + สถานะเครื่องพิมพ์ + เวอร์ชันของตัวเอง
 * ============================================================================
 */

const PART_BYTES = 2 * 1024 * 1024;   // รับส่งไฟล์กับ agent ทีละ 2 MB

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, msg: 'BAD_JSON' }); }

  const action = String(body.action || '');

  // LINE bridge ใช้ token คนละชุดกับ PC Agent เพื่อไม่ขยายสิทธิ์ AGENT_TOKEN
  if (/^line_/.test(action)) {
    const bridgeToken = PropertiesService.getScriptProperties().getProperty('PRINT_HUB_BRIDGE_TOKEN');
    if (!bridgeToken || body.token !== bridgeToken) return json_({ ok: false, msg: 'BAD_BRIDGE_TOKEN' });
    try {
      return json_(lineBridgeDispatch_(body));
    } catch (err) {
      return json_({ ok: false, msg: String(err && err.message || err) });
    }
  }

  // PC Agent เดิม — คง contract และ AGENT_TOKEN เดิมทั้งหมด
  const token = PropertiesService.getScriptProperties().getProperty('AGENT_TOKEN');
  if (!token || body.token !== token) return json_({ ok: false, msg: 'BAD_TOKEN' });

  try {
    switch (action) {
      case 'claim'    : return json_(agentClaim_(body));
      case 'part'     : return json_(agentPart_(body));
      case 'converted': return json_(agentConverted_(body));
      case 'uploadpdf': return json_(agentUploadPdf_(body));
      case 'report'   : return json_(agentReport_(body));
      case 'heartbeat': return json_(agentHeartbeat_(body));
      default         : return json_({ ok: false, msg: 'UNKNOWN_ACTION' });
    }
  } catch (err) {
    return json_({ ok: false, msg: String(err && err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================================
 *  claim — จองงานถัดไป (ล็อกกันสองเครื่องแย่งงานเดียวกัน)
 * ========================================================================== */
function agentClaim_(b) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (err) { return { ok: true, job: null }; }

  try {
    const sh = getDb_().getSheetByName('PRINT_QUEUE');
    const n  = sh.getLastRow() - 1;
    if (n < 1) return { ok: true, job: null };

    const rows = sh.getRange(2, 1, n, QCOLS).getValues();
    let pick = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][Q.STATUS] !== ST.QUEUED) continue;
      if (pick < 0) { pick = i; continue; }
      const a = rows[i], p = rows[pick];
      if (a[Q.PRIO] > p[Q.PRIO] ||
         (a[Q.PRIO] === p[Q.PRIO] && new Date(a[Q.AT]) < new Date(p[Q.AT]))) pick = i;
    }
    if (pick < 0) return { ok: true, job: null };

    const r    = rows[pick];
    const line = pick + 2;

    // ถ้ามี PDF ที่แปลงไว้แล้ว (ผ่านการตรวจมาแล้ว) ให้ดึง PDF ไปพิมพ์เลย ไม่ต้องแปลงซ้ำ
    const usePdf = !!r[Q.PDF];
    const fid    = usePdf ? r[Q.PDF] : r[Q.FID];

    sh.getRange(line, Q.STATUS + 1).setValue(ST.CLAIMED);
    sh.getRange(line, Q.AGENT + 1).setValue(String(b.agent || 'PC'));
    sh.getRange(line, Q.START + 1).setValue(new Date());
    sh.getRange(line, Q.TRY + 1).setValue(Number(r[Q.TRY] || 0) + 1);

    let size = 0;
    try { size = DriveApp.getFileById(fid).getSize(); } catch (err) {}

    return { ok: true, job: {
      id      : r[Q.ID],
      file    : usePdf ? String(r[Q.FILE]).replace(/\.\w+$/, '') + '.pdf' : r[Q.FILE],
      mime    : usePdf ? 'application/pdf' : r[Q.MIME],
      usePdf  : usePdf,
      preview : r[Q.PREVIEW] === true,
      pages   : Number(r[Q.PAGES] || 0),
      bytes   : size,
      parts   : Math.max(1, Math.ceil(size / PART_BYTES)),
      copies  : Number(r[Q.COPIES] || 1),
      duplex  : r[Q.DUPLEX] === true,
      range   : String(r[Q.RANGE] || ''),
      owner   : r[Q.NAME],
      attempt : Number(r[Q.TRY] || 0) + 1
    }};
  } finally { lock.releaseLock(); }
}

/* ============================================================================
 *  part — ส่งไฟล์ทีละก้อน (base64)
 * ========================================================================== */
function agentPart_(b) {
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const i  = findJobRow_(sh, b.job);
  if (i < 0) return { ok: false, msg: 'JOB_NOT_FOUND' };

  const r   = sh.getRange(i, 1, 1, QCOLS).getValues()[0];
  const fid = (b.which === 'pdf' && r[Q.PDF]) ? r[Q.PDF] : r[Q.FID];

  const bytes = DriveApp.getFileById(fid).getBlob().getBytes();
  const idx   = Number(b.i || 0);
  const from  = idx * PART_BYTES;
  if (from >= bytes.length) return { ok: false, msg: 'PART_OUT_OF_RANGE' };

  const to = Math.min(from + PART_BYTES, bytes.length);
  return { ok: true, i: idx, last: to >= bytes.length,
           data: Utilities.base64Encode(bytes.slice(from, to)) };
}

/* ============================================================================
 *  converted — บอกจำนวนหน้า เซิร์ฟเวอร์ตัดสินว่าให้ทำอะไรต่อ
 *      go = true            → พิมพ์ได้เลย
 *      needPreview = true   → ให้ส่ง PDF กลับมาก่อน ผู้ฝากจะตรวจ
 *      reason WAIT_APPROVE  → เกินเพดานหน้า พักรอแอดมิน
 * ========================================================================== */
function agentConverted_(b) {
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const i  = findJobRow_(sh, b.job);
  if (i < 0) return { ok: false, msg: 'JOB_NOT_FOUND' };

  const r      = sh.getRange(i, 1, 1, QCOLS).getValues()[0];
  const pages  = Math.max(0, parseInt(b.pages, 10) || 0);
  const sheets = pages * Number(r[Q.COPIES] || 1);
  sh.getRange(i, Q.PAGES + 1).setValue(pages);

  // 1) เกินเพดาน และยังไม่ได้อนุมัติ → พักไว้ก่อน ไม่พิมพ์
  const limit = setting_('MAX_PAGES_NO_APPROVE', CFG.MAX_PAGES_NO_APPROVE);
  if (limit > 0 && sheets > limit && Number(r[Q.PRIO]) !== 1) {
    sh.getRange(i, Q.STATUS + 1).setValue(ST.WAIT);
    sh.getRange(i, Q.ERR + 1).setValue('รวม ' + sheets + ' แผ่น เกินเพดาน ' + limit + ' — รอผู้ดูแลอนุมัติ');
    return { ok: true, go: false, reason: 'WAIT_APPROVE', sheets: sheets };
  }

  // 2) ผู้ฝากขอตรวจก่อน และยังไม่มี PDF บนเซิร์ฟเวอร์ → ให้ส่ง PDF ขึ้นมา
  if (r[Q.PREVIEW] === true && !r[Q.PDF]) {
    sh.getRange(i, Q.STATUS + 1).setValue(ST.CONVERT);
    return { ok: true, go: false, needPreview: true, reason: 'NEED_PREVIEW' };
  }

  // 3) พิมพ์ได้
  sh.getRange(i, Q.STATUS + 1).setValue(ST.PRINTING);
  return { ok: true, go: true, sheets: sheets };
}

/* ============================================================================
 *  uploadpdf — รับ PDF ที่แปลงแล้วกลับขึ้นมาเก็บไว้ให้ผู้ฝากตรวจ
 * ========================================================================== */
function agentUploadPdf_(b) {
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const i  = findJobRow_(sh, b.job);
  if (i < 0) return { ok: false, msg: 'JOB_NOT_FOUND' };

  const prefix = String(b.job) + '_pdf';
  spoolFolder_().createFile(
    Utilities.newBlob(Utilities.base64Decode(b.data), 'application/octet-stream',
                      prefix + '.part' + ('000' + Number(b.i || 0)).slice(-3))
  );
  if (!b.last) return { ok: true, i: b.i };

  const merged = mergeParts_(prefix, 'application/pdf');
  if (merged.error) return { ok: false, msg: merged.error };

  const r    = sh.getRange(i, 1, 1, QCOLS).getValues()[0];
  const file = spoolFolder_().createFile(
    Utilities.newBlob(merged.data, 'application/pdf',
                      r[Q.ID] + '_ตรวจ_' + String(r[Q.FILE]).replace(/\.\w+$/, '') + '.pdf')
  );

  sh.getRange(i, Q.PDF + 1).setValue(file.getId());
  sh.getRange(i, Q.STATUS + 1).setValue(ST.PREVIEW);
  sh.getRange(i, Q.ERR + 1).setValue('');
  audit_(r[Q.USER], 'PREVIEW', 'พร้อมตรวจ', r[Q.ID]);
  // ===== HOOK: แจ้งผู้ฝากทาง LINE ว่ามีงานรอตรวจ =====
  return { ok: true, done: true };
}

/* ============================================================================
 *  report — ผลสุดท้าย
 * ========================================================================== */
function agentReport_(b) {
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const i  = findJobRow_(sh, b.job);
  if (i < 0) return { ok: false, msg: 'JOB_NOT_FOUND' };

  const r  = sh.getRange(i, 1, 1, QCOLS).getValues()[0];
  const ok = String(b.status).toUpperCase() === 'DONE';

  if (b.pages) sh.getRange(i, Q.PAGES + 1).setValue(parseInt(b.pages, 10) || 0);
  sh.getRange(i, Q.END + 1).setValue(new Date());
  sh.getRange(i, Q.ERR + 1).setValue(ok ? '' : String(b.msg || 'ผิดพลาด').slice(0, 200));

  if (ok) {
    /* agent ยืนยันได้แค่ว่า "ส่งเข้าเครื่องพิมพ์แล้ว" — ยังไม่ใช่ "กระดาษออกครบ"
       งานจึงพักที่ SENT รอผู้ฝากกดยืนยันรับเอกสาร หรือให้ระบบปิดเองเมื่อครบเวลา */
    sh.getRange(i, Q.STATUS + 1).setValue(ST.SENT);
    audit_(r[Q.USER], 'PRINT', 'ส่งเข้าเครื่องแล้ว', r[Q.ID] + ' · ' + r[Q.FILE]);
    // ===== HOOK: แจ้งผู้ฝากทาง LINE ว่าเอกสารรออยู่ที่เครื่องพิมพ์ =====
  } else {
    /* ห้ามสั่งพิมพ์ซ้ำเอง — กระดาษอาจออกไปบางส่วนแล้ว ต้องให้คนไปดูของจริงก่อน */
    sh.getRange(i, Q.STATUS + 1).setValue(ST.ERROR);
    audit_(r[Q.USER], 'PRINT', 'ผิดพลาด', r[Q.ID] + ' · ' + String(b.msg || ''));
  }
  return { ok: true };
}

/* ============================================================================
 *  heartbeat
 * ========================================================================== */
function agentHeartbeat_(b) {
  const sh = getDb_().getSheetByName('AGENTS');
  const id = String(b.agent || 'PC');
  const n  = sh.getLastRow() - 1;
  let line = -1;

  if (n > 0) {
    const col = sh.getRange(2, 1, n, 1).getValues();
    for (let i = 0; i < col.length; i++) if (String(col[i][0]) === id) { line = i + 2; break; }
  }
  const ver  = String(b.version || '').slice(0, 12);
  const note = ver ? ('agent v' + ver) : String(b.note || '');
  const row  = [id, String(b.host || ''), new Date(), String(b.printer || 'พร้อมพิมพ์'),
                String(b.job || ''), Number(b.today || 0), note];

  if (line > 0) sh.getRange(line, 1, 1, 7).setValues([row]);
  else          sh.appendRow(row);

  return { ok: true, serverTime: new Date().toISOString(),
           serverVersion: CFG.APP_VERSION,
           versionOk: !ver || ver === CFG.APP_VERSION };
}

/* ============================================================================
 *  งานดูแลอัตโนมัติ — ติดตั้งทริกเกอร์ครั้งเดียว
 * ========================================================================== */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['expireOldJobs', 'purgeOldFiles'].indexOf(t.getHandlerFunction()) > -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('expireOldJobs').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('purgeOldFiles').timeBased().atHour(1).everyDays(1).create();
  ui_().alert('ตั้งเวลาทำงานอัตโนมัติเรียบร้อย\n\n' +
              '• ทุกชั่วโมง — ตรวจงานค้างเกินกำหนด\n' +
              '• ทุกวันตี 1 — ลบไฟล์เก่าที่พิมพ์แล้ว');
}

/** งานค้างในคิวนานเกินไป → หมดอายุ (กันพ่นกระดาษรัวตอนเช้า) */
function expireOldJobs() {
  try {
    const sh = getDb_().getSheetByName('PRINT_QUEUE');
    const n  = sh.getLastRow() - 1;
    if (n < 1) return;

    const hrs  = setting_('JOB_EXPIRE_HOURS', CFG.JOB_EXPIRE_HOURS);
    const dead = Date.now() - hrs * 3600000;

    const pickDead  = Date.now() - setting_('PICKUP_HOURS', CFG.PICKUP_HOURS) * 3600000;
    const stuckDead = Date.now() - setting_('STUCK_PRINT_MINUTES', CFG.STUCK_PRINT_MINUTES) * 60000;

    sh.getRange(2, 1, n, QCOLS).getValues().forEach(function (r, i) {
      const row = i + 2;

      /* ① ค้างในคิวนานเกินกำหนด → หมดอายุ */
      const live = [ST.WAIT_AGENT, ST.WAIT_CONFIRM, ST.QUEUED, ST.CLAIMED, ST.CONVERT, ST.PREVIEW].indexOf(r[Q.STATUS]) > -1;
      if (live && new Date(r[Q.AT]).getTime() < dead) {
        sh.getRange(row, Q.STATUS + 1).setValue(ST.EXPIRED);
        sh.getRange(row, Q.END + 1).setValue(new Date());
        sh.getRange(row, Q.ERR + 1).setValue('ค้างในคิวเกิน ' + hrs + ' ชั่วโมง');
        r[Q.STATUS] = ST.EXPIRED;
        archive_(r, 'หมดอายุอัตโนมัติ');
        trashFile_(r[Q.FID]);
        trashFile_(r[Q.PDF]);
        return;
      }

      /* ② ค้างที่ "กำลังพิมพ์" นานผิดปกติ = คอมดับกลางคัน — ไม่สั่งพิมพ์ซ้ำเอง */
      if (r[Q.STATUS] === ST.PRINTING) {
        const began = r[Q.START] ? new Date(r[Q.START]).getTime() : new Date(r[Q.AT]).getTime();
        if (began < stuckDead) {
          sh.getRange(row, Q.STATUS + 1).setValue(ST.ERROR);
          sh.getRange(row, Q.END + 1).setValue(new Date());
          sh.getRange(row, Q.ERR + 1).setValue('คอมหยุดกลางคัน — ตรวจกระดาษที่เครื่องก่อนสั่งพิมพ์ซ้ำ');
          audit_(r[Q.USER], 'PRINT', 'ค้างกลางคัน', r[Q.ID]);
        }
        return;
      }

      /* ③ งานที่พิมพ์ไม่สำเร็จและไม่มีใครมาจัดการ → เก็บเข้าประวัติเมื่อครบเวลา */
      if (r[Q.STATUS] === ST.ERROR) {
        const failed = r[Q.END] ? new Date(r[Q.END]).getTime() : new Date(r[Q.AT]).getTime();
        if (failed < dead) {
          r[Q.STATUS] = ST.ERROR;
          archive_(r, 'ปิดอัตโนมัติ — ไม่มีการแก้ไขหลังพิมพ์ไม่สำเร็จ');
          sh.getRange(row, Q.STATUS + 1).setValue(ST.EXPIRED);
          trashFile_(r[Q.FID]);
          trashFile_(r[Q.PDF]);
        }
        return;
      }

      /* ④ ส่งเข้าเครื่องแล้วแต่ไม่มีใครกดยืนยันรับ → ปิดเองและนับโควตา */
      if (r[Q.STATUS] === ST.SENT) {
        const sent = r[Q.END] ? new Date(r[Q.END]).getTime() : new Date(r[Q.AT]).getTime();
        if (sent < pickDead) {
          sh.getRange(row, Q.STATUS + 1).setValue(ST.DONE);
          r[Q.STATUS] = ST.DONE;
          archive_(r, 'ปิดอัตโนมัติ — ไม่มีการยืนยันรับเอกสาร');
        }
      }
    });
  } catch (err) {
    Logger.log('expireOldJobs: ' + err);
  }
}

/** ลบไฟล์ที่พิมพ์แล้วเกินกำหนด + เก็บกวาดชิ้นส่วนอัปโหลดที่ค้าง */
function purgeOldFiles() {
  try {
    const days = setting_('FILE_KEEP_DAYS', CFG.FILE_KEEP_DAYS);
    const dead = Date.now() - days * 86400000;
    const sh   = getDb_().getSheetByName('PRINT_QUEUE');
    const n    = sh.getLastRow() - 1;

    if (n > 0) {
      sh.getRange(2, 1, n, QCOLS).getValues().forEach(function (r, i) {
        const closed = [ST.DONE, ST.CANCEL, ST.EXPIRED, ST.ERROR].indexOf(r[Q.STATUS]) > -1;
        const when   = r[Q.END] ? new Date(r[Q.END]).getTime() : new Date(r[Q.AT]).getTime();
        if (closed && when < dead && (r[Q.FID] || r[Q.PDF])) {
          trashFile_(r[Q.FID]);
          trashFile_(r[Q.PDF]);
          sh.getRange(i + 2, Q.FID + 1).setValue('');
          sh.getRange(i + 2, Q.PDF + 1).setValue('');
        }
      });
    }

    /* ตัดแถวเก่าออกจาก PRINT_QUEUE — ประวัติถูกย้ายไป PRINT_LOG ตั้งแต่ตอนปิดงานแล้ว
       ถ้าไม่ตัด ชีตจะโตไม่มีเพดาน แล้วการเปิดหน้าคิวจะช้าลงเรื่อย ๆ
       ลบจากล่างขึ้นบนเพื่อไม่ให้เลขแถวเลื่อน และจำกัดจำนวนต่อรอบกันหมดเวลา 6 นาที */
    trimQueueRows_(days * 2, 300);

    // ชิ้นส่วนอัปโหลดที่ค้างเกิน 1 วัน (ผู้ใช้ปิดหน้าจอกลางคัน หรือ agent หลุด)
    const cut   = Date.now() - 86400000;
    const files = spoolFolder_().getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (/\.part\d{3}$/.test(f.getName()) && f.getDateCreated().getTime() < cut) f.setTrashed(true);
    }
  } catch (err) {
    Logger.log('purgeOldFiles: ' + err);
  }
}

/** ลบแถวงานที่ปิดไปแล้วและเก่ากว่า keepDays ออกจาก PRINT_QUEUE (สูงสุด max แถวต่อรอบ) */
function trimQueueRows_(keepDays, max) {
  const sh = getDb_().getSheetByName('PRINT_QUEUE');
  const n  = sh.getLastRow() - 1;
  if (n < 1) return 0;

  const dead   = Date.now() - keepDays * 86400000;
  const closed = [ST.DONE, ST.CANCEL, ST.EXPIRED, ST.ERROR];
  const rows   = sh.getRange(2, 1, n, QCOLS).getValues();
  const drop   = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (closed.indexOf(r[Q.STATUS]) < 0) continue;
    const when = r[Q.END] ? new Date(r[Q.END]).getTime() : new Date(r[Q.AT]).getTime();
    if (when < dead) drop.push(i + 2);
  }

  let done = 0;
  for (let k = drop.length - 1; k >= 0 && done < max; k--) { sh.deleteRow(drop[k]); done++; }
  return done;
}
