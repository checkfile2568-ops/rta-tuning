/**
 * LINE_FLEX_NOTIFY_FIX_v2.gs
 *
 * แก้ไขครอบคลุม:
 *  1) sendFlexMessage รับ payload ว่าง/null แล้ว throw → คืน error object แทน
 *  2) checkAndNotify TypeError เมื่อไม่มี schedule sheet → สร้าง/แจ้งสถานะให้ UI
 *  3) Schema mismatch: หัวคอลัมน์ 8 ช่อง แต่อ่านแค่ 7 → เพิ่ม createdAt + lastError + sentAt
 *  4) repairNotifyScheduleSheet เคยล้างข้อมูล → เปลี่ยนเป็น migrate ปลอดภัย ไม่ลบของเดิม
 *  5) เพิ่ม initNotifySettingsSheet() สำหรับสร้าง Settings sheet ที่ getConfig ต้องใช้
 *  6) เพิ่ม API ให้ UI ฝั่ง web app เรียกได้:
 *      - getNotifySettings()        → คืน config + รายชื่อ sheet + สถานะระบบ
 *      - getScheduleList()          → คืน array ของรายการแจ้งเตือนทั้งหมด พร้อมคอลัมน์ครบ
 *      - saveScheduleRow(payload)   → เพิ่ม/แก้ไขแถว
 *      - deleteScheduleRow(id)      → ลบ (ทำ soft-delete = สถานะ "ยกเลิก")
 *      - diagnoseNotifySystem()     → ตรวจสุขภาพระบบทั้งหมด ใช้ debug หน้า UI
 *  7) Thai date parser รองรับ "dd/MM/yyyy HH:mm", "yyyy-MM-dd HH:mm", และ Date object
 *  8) Unified flex builder ทุกกลุ่มได้การ์ดหน้าตาเดียวกัน
 *
 * ติดตั้ง:
 *  - แทนที่ไฟล์ LINE_FLEX_NOTIFY_FIX.gs เดิมด้วยไฟล์นี้ทั้งไฟล์
 *  - รันคำสั่งครั้งแรก: initNotifySystem()  (จะสร้าง/ซ่อมทุก sheet ที่ต้องใช้)
 *  - หลังจากนั้นรัน diagnoseNotifySystem() เพื่อยืนยันว่าทุกอย่างพร้อม
 */

// ========== Constants =================================================

const NF_SETTINGS_KEYS = {
  NOTIFY_STATUS: { default: "ON", desc: "ON = เปิดส่งอัตโนมัติ, OFF = ปิด" },
  NOTIFY_DEFAULT_TARGETS: { default: "admins", desc: "ปลายทาง default ของแจ้งเตือนระบบ" },
  NOTIFY_FOOTER_TEXT: { default: "ระบบแจ้งเตือน", desc: "ข้อความ footer ของการ์ด Flex" },
  NOTIFY_BRAND_COLOR: { default: "#1E40AF", desc: "สี header การ์ด Flex (HEX)" },
  NOTIFY_TIMEZONE: { default: "Asia/Bangkok", desc: "เขตเวลา" }
};

const NF_SCHEDULE_HEADERS = [
  "ID",          // 0
  "วันที่ส่ง",    // 1
  "หัวข้อ",       // 2
  "ข้อความ",     // 3
  "ซ้ำ",         // 4
  "เป้าหมาย",    // 5
  "สถานะ",       // 6
  "วันที่สร้าง",  // 7  ← เดิมไม่ได้อ่าน
  "ส่งล่าสุด",    // 8  ← เพิ่มใหม่ สำหรับ UI ใช้แสดง
  "ข้อผิดพลาด"   // 9  ← เพิ่มใหม่ สำหรับ debug
];

const NF_LOG_HEADERS = [
  "ID", "เวลา", "หัวข้อ", "ข้อความ",
  "เป้าหมาย", "จำนวนผู้รับ", "สถานะ", "เปิดอ่าน", "ผู้ส่ง"
];

// ========== Public entry points ========================================

/**
 * เรียกครั้งแรกหลังติดตั้ง — สร้าง/ซ่อม sheet ทั้งหมดที่ระบบใช้ โดยไม่ลบข้อมูลเดิม
 */
function initNotifySystem() {
  const settings = initNotifySettingsSheet();
  const schedule = repairNotifyScheduleSheet();
  const log = _ensureNotifyLogSheet_();
  return {
    success: true,
    settings: settings.sheetName,
    schedule: schedule.sheetName,
    log: log.sheetName,
    migrated: schedule.migrated || false,
    addedColumns: schedule.addedColumns || []
  };
}

/**
 * ตรวจสุขภาพระบบทั้งหมด — เรียกจาก UI ปุ่ม "ตรวจสอบระบบ" ได้เลย
 */
function diagnoseNotifySystem() {
  const report = {
    success: true,
    timestamp: new Date(),
    spreadsheetId: typeof SPREADSHEET_ID !== "undefined" ? SPREADSHEET_ID : null,
    issues: [],
    sheets: {},
    config: {}
  };

  // 1) Spreadsheet ID
  if (!report.spreadsheetId) {
    report.success = false;
    report.issues.push("ไม่พบค่า SPREADSHEET_ID (ต้องประกาศใน Config.gs)");
    return report;
  }

  let ss;
  try {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    report.success = false;
    report.issues.push("เปิด Spreadsheet ไม่ได้: " + e.message);
    return report;
  }

  // 2) Settings sheet
  const settingsName = _getSettingsSheetName_();
  const settingsSheet = ss.getSheetByName(settingsName);
  if (!settingsSheet) {
    report.success = false;
    report.issues.push("ไม่พบ sheet ตั้งค่า: " + settingsName + " — รัน initNotifySettingsSheet()");
  } else {
    report.sheets[settingsName] = { rows: settingsSheet.getLastRow(), cols: settingsSheet.getLastColumn() };
    Object.keys(NF_SETTINGS_KEYS).forEach(function(k) {
      const v = _readConfigSafe_(k);
      report.config[k] = v;
      if (v === null || v === "") {
        report.issues.push("ค่า config ขาด: " + k);
      }
    });
  }

  // 3) Schedule sheet
  const schedSheet = _getNotifyScheduleSheet_();
  if (!schedSheet) {
    report.success = false;
    report.issues.push("ไม่พบ sheet ตารางเวลา — รัน repairNotifyScheduleSheet()");
  } else {
    const headers = schedSheet.getRange(1, 1, 1, Math.max(1, schedSheet.getLastColumn())).getValues()[0];
    report.sheets[schedSheet.getName()] = {
      rows: schedSheet.getLastRow(),
      cols: schedSheet.getLastColumn(),
      headers: headers
    };
    const missing = NF_SCHEDULE_HEADERS.filter(function(h) {
      return headers.map(function(x) { return String(x || "").trim(); }).indexOf(h) < 0;
    });
    if (missing.length > 0) {
      report.issues.push("คอลัมน์ตารางเวลาขาด: " + missing.join(", "));
    }
  }

  // 4) Admin IDs
  try {
    const ids = (typeof getAdminIds === "function") ? getAdminIds() : [];
    report.adminIdsCount = ids.length;
    if (!ids.length) report.issues.push("ไม่พบ admin IDs — broadcast 'admins' จะส่งไม่ได้");
  } catch (e) {
    report.issues.push("getAdminIds() error: " + e.message);
  }

  // 5) LINE access token
  try {
    const tk = (typeof getLineAccessToken === "function") ? getLineAccessToken() : null;
    report.hasLineToken = !!tk;
    if (!tk) report.issues.push("ไม่พบ LINE access token");
  } catch (e) {
    report.issues.push("getLineAccessToken() error: " + e.message);
  }

  report.success = report.issues.length === 0;
  return report;
}

/**
 * คืนค่าทั้งหมดที่หน้าตั้งค่าต้องใช้ — เรียกจาก UI ผ่าน google.script.run
 */
function getNotifySettings() {
  const out = {
    success: true,
    config: {},
    keys: NF_SETTINGS_KEYS,
    schedule: { sheetName: _getNotifyScheduleSheetName_(), exists: !!_getNotifyScheduleSheet_() },
    log: { sheetName: _getNotifyLogSheetName_() },
    counts: { schedules: 0, logs: 0 }
  };

  Object.keys(NF_SETTINGS_KEYS).forEach(function(k) {
    const v = _readConfigSafe_(k);
    out.config[k] = (v === null || v === "") ? NF_SETTINGS_KEYS[k].default : v;
  });

  try {
    const sh = _getNotifyScheduleSheet_();
    if (sh) out.counts.schedules = Math.max(0, sh.getLastRow() - 1);
  } catch (e) {}

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const lg = ss.getSheetByName(out.log.sheetName);
    if (lg) out.counts.logs = Math.max(0, lg.getLastRow() - 1);
  } catch (e) {}

  return out;
}

/**
 * บันทึกค่าการแจ้งเตือนที่ Admin ตั้งจาก Dashboard
 * payload รองรับทั้ง {config:{...}} และ object config โดยตรง
 * เขียนเฉพาะ key ที่อยู่ใน NF_SETTINGS_KEYS เพื่อป้องกันการแก้ค่าระบบอื่น
 */
function saveNotifySettings(payload) {
  try {
    payload = payload || {};
    var incoming = payload.config && typeof payload.config === "object" ? payload.config : payload;
    var values = {};
    Object.keys(NF_SETTINGS_KEYS).forEach(function(key) {
      if (incoming[key] !== undefined) values[key] = incoming[key];
    });

    if (values.NOTIFY_STATUS !== undefined) {
      var status = String(values.NOTIFY_STATUS || "").trim().toUpperCase();
      if (status !== "ON" && status !== "OFF") return { success: false, error: "NOTIFY_STATUS ต้องเป็น ON หรือ OFF" };
      values.NOTIFY_STATUS = status;
    }
    if (values.NOTIFY_BRAND_COLOR !== undefined) {
      var color = String(values.NOTIFY_BRAND_COLOR || "").trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) return { success: false, error: "สีการ์ดต้องเป็น HEX เช่น #1E40AF" };
      values.NOTIFY_BRAND_COLOR = color.toUpperCase();
    }
    if (values.NOTIFY_DEFAULT_TARGETS !== undefined) {
      values.NOTIFY_DEFAULT_TARGETS = String(values.NOTIFY_DEFAULT_TARGETS || "").trim().slice(0, 500) || "admins";
    }
    if (values.NOTIFY_FOOTER_TEXT !== undefined) {
      values.NOTIFY_FOOTER_TEXT = String(values.NOTIFY_FOOTER_TEXT || "").trim().slice(0, 120) || NF_SETTINGS_KEYS.NOTIFY_FOOTER_TEXT.default;
    }
    if (values.NOTIFY_TIMEZONE !== undefined) {
      values.NOTIFY_TIMEZONE = String(values.NOTIFY_TIMEZONE || "").trim().slice(0, 80) || NF_SETTINGS_KEYS.NOTIFY_TIMEZONE.default;
    }

    initNotifySettingsSheet();
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(_getSettingsSheetName_());
    var lastRow = sheet.getLastRow();
    var rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 3).getValues() : [];
    var rowByKey = {};
    rows.forEach(function(row, index) {
      var key = String(row[0] || "").trim();
      if (key) rowByKey[key] = index + 2;
    });
    Object.keys(values).forEach(function(key) {
      var rowNumber = rowByKey[key];
      if (rowNumber) sheet.getRange(rowNumber, 2).setValue(String(values[key]));
      else sheet.appendRow([key, String(values[key]), NF_SETTINGS_KEYS[key].desc]);
    });
    SpreadsheetApp.flush();
    return { success: true, settings: getNotifySettings() };
  } catch (e) {
    return { success: false, error: "บันทึกการตั้งค่าแจ้งเตือนไม่สำเร็จ: " + e.message };
  }
}

/**
 * คืนรายการตารางเวลาทั้งหมด พร้อมทุกคอลัมน์ — รวม createdAt, sentAt, lastError
 */
function getScheduleList() {
  const sheet = _getNotifyScheduleSheet_();
  if (!sheet) {
    return { success: false, error: "ไม่พบ sheet ตารางเวลา", rows: [] };
  }

  const last = sheet.getLastRow();
  if (last <= 1) return { success: true, rows: [] };

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(h) { return String(h || "").trim(); });
  const cols = _getNotifyScheduleColumns_(headers);
  const tz = _readConfigSafe_("NOTIFY_TIMEZONE") || Session.getScriptTimeZone();

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const runAt = _parseNotifyDate_(_cell_(r, cols.date));
    rows.push({
      rowNumber: i + 1,
      id: _cell_(r, cols.id),
      runAt: runAt ? Utilities.formatDate(runAt, tz, "yyyy-MM-dd HH:mm") : "",
      runAtRaw: _cell_(r, cols.date),
      title: _cell_(r, cols.title),
      body: _cell_(r, cols.body),
      repeat: _cell_(r, cols.repeat) || "once",
      targets: _cell_(r, cols.targets) || "admins",
      status: _cell_(r, cols.status) || "ใช้งาน",
      createdAt: _cell_(r, cols.createdAt),
      sentAt: _cell_(r, cols.sentAt),
      lastError: _cell_(r, cols.lastError)
    });
  }

  return { success: true, rows: rows, total: rows.length };
}

/**
 * เพิ่ม/แก้ไขแถวตารางเวลา จาก UI
 * payload: { id?, runAt, title, body, repeat?, targets?, status? }
 */
function saveScheduleRow(payload) {
  if (!payload || typeof payload !== "object") {
    return { success: false, error: "payload ว่าง" };
  }
  if (!payload.body) return { success: false, error: "ข้อความว่าง" };
  if (!payload.runAt) return { success: false, error: "ไม่ได้กำหนดเวลาส่ง" };

  const runAt = _parseNotifyDate_(payload.runAt);
  if (!runAt) return { success: false, error: "รูปแบบวันที่ไม่ถูกต้อง: " + payload.runAt };

  const sheet = _getNotifyScheduleSheet_() || ensureScheduleSheet_();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const cols = _getNotifyScheduleColumns_(headers);

  const id = payload.id || ("S" + new Date().getTime());
  const tz = _readConfigSafe_("NOTIFY_TIMEZONE") || Session.getScriptTimeZone();
  const createdAt = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");

  // ค้นหาแถวเดิมถ้ามี
  let targetRow = -1;
  if (payload.id) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][cols.id] || "").trim() === String(payload.id).trim()) {
        targetRow = i + 1; break;
      }
    }
  }

  const writeAt = function(rowNo, key, val) {
    const idx = cols[key];
    if (idx >= 0) sheet.getRange(rowNo, idx + 1).setValue(val);
  };

  if (targetRow > 0) {
    writeAt(targetRow, "date", runAt);
    writeAt(targetRow, "title", payload.title || "แจ้งเตือน");
    writeAt(targetRow, "body", payload.body);
    if (payload.repeat) writeAt(targetRow, "repeat", payload.repeat);
    if (payload.targets) writeAt(targetRow, "targets", payload.targets);
    if (payload.status) writeAt(targetRow, "status", payload.status);
    return { success: true, action: "update", id: id, rowNumber: targetRow };
  }

  // append แถวใหม่ - เรียงตาม cols
  const row = new Array(Math.max(headers.length, NF_SCHEDULE_HEADERS.length)).fill("");
  if (cols.id >= 0)        row[cols.id]        = id;
  if (cols.date >= 0)      row[cols.date]      = runAt;
  if (cols.title >= 0)     row[cols.title]     = payload.title || "แจ้งเตือน";
  if (cols.body >= 0)      row[cols.body]      = payload.body;
  if (cols.repeat >= 0)    row[cols.repeat]    = payload.repeat || "once";
  if (cols.targets >= 0)   row[cols.targets]   = payload.targets || "admins";
  if (cols.status >= 0)    row[cols.status]    = payload.status || "ใช้งาน";
  if (cols.createdAt >= 0) row[cols.createdAt] = createdAt;
  sheet.appendRow(row);

  return { success: true, action: "create", id: id, rowNumber: sheet.getLastRow() };
}

/**
 * soft-delete ตามคำขอจาก UI
 */
function deleteScheduleRow(id) {
  if (!id) return { success: false, error: "ไม่ได้ระบุ ID" };
  const sheet = _getNotifyScheduleSheet_();
  if (!sheet) return { success: false, error: "ไม่พบ sheet ตารางเวลา" };

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const cols = _getNotifyScheduleColumns_(headers);
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][cols.id] || "").trim() === String(id).trim()) {
      const rowNo = i + 1;
      if (cols.status >= 0) sheet.getRange(rowNo, cols.status + 1).setValue("ยกเลิก");
      return { success: true, rowNumber: rowNo };
    }
  }
  return { success: false, error: "ไม่พบ ID: " + id };
}

// ========== sendFlexMessage / checkAndNotify ===========================

function sendFlexMessage(targetOrPayload, maybePayload) {
  const data = _normalizeFlexNotifyPayload_(targetOrPayload, maybePayload);
  if (!data.ok) {
    Logger.log("sendFlexMessage skipped: " + data.error);
    return { success: false, error: data.error };
  }
  const flex = _buildUnifiedNotifyFlex_(data);
  return _sendFlexNotifyTargets_(data, flex);
}

function checkAndNotify() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, error: "checkAndNotify is already running" };
  }

  try {
    if (String(_readConfigSafe_("NOTIFY_STATUS") || "ON").trim().toUpperCase() === "OFF") {
      return { success: true, sent: 0, skipped: 0, failed: 0, message: "NOTIFY_STATUS = OFF" };
    }

    let sheet = _getNotifyScheduleSheet_();
    if (!sheet) {
      // auto-recover แทนการ throw
      Logger.log("checkAndNotify: schedule sheet missing — creating");
      sheet = ensureScheduleSheet_();
      return { success: true, sent: 0, skipped: 0, failed: 0, message: "สร้าง sheet ตารางเวลาแล้ว ยังไม่มีรายการ" };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { success: true, sent: 0, skipped: 0, failed: 0, message: "ไม่มีรายการ" };
    }

    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(function(h) { return String(h || "").trim(); });
    const cols = _getNotifyScheduleColumns_(headers);
    const tz = _readConfigSafe_("NOTIFY_TIMEZONE") || Session.getScriptTimeZone();
    const now = new Date();

    let sent = 0, skipped = 0, failed = 0;

    for (let i = 1; i < values.length; i++) {
      const rowNo = i + 1;
      const row = values[i];

      if (!_isNotifyScheduleActive_(_cell_(row, cols.status))) { skipped++; continue; }

      const runAt = _parseNotifyDate_(_cell_(row, cols.date));
      if (!runAt || runAt > now) { skipped++; continue; }

      const title = _cell_(row, cols.title) || "แจ้งเตือน";
      const body = _cell_(row, cols.body);
      const targets = _cell_(row, cols.targets) || _readConfigSafe_("NOTIFY_DEFAULT_TARGETS") || "admins";
      const repeat = String(_cell_(row, cols.repeat) || "once").trim().toLowerCase();
      const scheduleId = _cell_(row, cols.id) || ("ROW" + rowNo);

      if (!body) {
        failed++;
        _writeNotifyMeta_(sheet, rowNo, cols, { status: "ผิดพลาด: ข้อความว่าง", lastError: "empty body" });
        continue;
      }

      const result = sendFlexMessage({ title: title, body: body, targets: targets, scheduleId: scheduleId });

      if (result && result.success) {
        sent++;
        _appendNotifyLogSafe_(title, body, targets, result.recipientCount || 0, "ส่งแล้ว", "checkAndNotify");
        const meta = { sentAt: Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss"), lastError: "" };

        if (repeat === "once" || repeat === "ครั้งเดียว" || repeat === "") {
          meta.status = "ส่งแล้ว";
        } else {
          meta.status = "ใช้งาน";
          const next = _nextNotifyDate_(runAt, repeat, now);
          if (cols.date >= 0) sheet.getRange(rowNo, cols.date + 1).setValue(next);
        }
        _writeNotifyMeta_(sheet, rowNo, cols, meta);
      } else {
        failed++;
        const reason = (result && result.error) ? result.error : "send failed";
        _writeNotifyMeta_(sheet, rowNo, cols, {
          status: "ผิดพลาด",
          lastError: String(reason).substring(0, 200)
        });
      }
    }

    return { success: failed === 0, sent: sent, skipped: skipped, failed: failed };
  } catch (e) {
    Logger.log("checkAndNotify error: " + e.message + "\n" + e.stack);
    return { success: false, error: String(e.message || e) };
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

// ========== Sheet creation / migration =================================

/**
 * สร้าง/ซ่อม sheet ตารางเวลา — *ไม่ลบข้อมูลเดิม* migrate header อย่างปลอดภัย
 */
function repairNotifyScheduleSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const name = _getNotifyScheduleSheetName_();
  let sheet = ss.getSheetByName(name);
  let migrated = false;
  const addedColumns = [];

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(NF_SCHEDULE_HEADERS);
    _formatNotifyHeader_(sheet);
    return { success: true, sheetName: name, migrated: false, addedColumns: NF_SCHEDULE_HEADERS };
  }

  // อ่าน header ปัจจุบัน
  const lastCol = Math.max(1, sheet.getLastColumn());
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || "").trim(); });

  // ถ้า header ว่างเลย (sheet ใหม่/พัง) → เขียน header ใหม่ทับ แต่ "ไม่ลบ" ข้อมูลข้างล่าง
  const hasAnyHeader = existing.some(function(h) { return h !== ""; });
  if (!hasAnyHeader) {
    sheet.getRange(1, 1, 1, NF_SCHEDULE_HEADERS.length).setValues([NF_SCHEDULE_HEADERS]);
    _formatNotifyHeader_(sheet);
    return { success: true, sheetName: name, migrated: true, addedColumns: NF_SCHEDULE_HEADERS };
  }

  // migrate: เพิ่มคอลัมน์ที่ขาด ต่อท้ายขวา ไม่แตะคอลัมน์เดิม
  NF_SCHEDULE_HEADERS.forEach(function(h) {
    if (existing.indexOf(h) < 0) {
      const newColIdx = sheet.getLastColumn() + 1;
      sheet.getRange(1, newColIdx).setValue(h);
      addedColumns.push(h);
      migrated = true;
    }
  });

  if (migrated) _formatNotifyHeader_(sheet);
  return { success: true, sheetName: name, migrated: migrated, addedColumns: addedColumns };
}

/**
 * สร้าง/ซ่อม Settings sheet — เติม key ที่ขาดเท่านั้น ไม่ทับค่าเดิม
 */
function initNotifySettingsSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const name = _getSettingsSheetName_();
  let sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(["Key", "Value", "Description"]);
    _formatNotifyHeader_(sheet);
  } else {
    // ตรวจ header
    const lastCol = Math.max(1, sheet.getLastColumn());
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h || "").trim().toLowerCase(); });
    if (headers.indexOf("key") < 0) {
      // sheet มีอยู่แต่ผิดรูป — เติม header เฉพาะถ้าแถว 1 ว่าง
      const row1 = sheet.getRange(1, 1, 1, 3).getValues()[0];
      const empty = row1.every(function(v) { return String(v || "").trim() === ""; });
      if (empty) {
        sheet.getRange(1, 1, 1, 3).setValues([["Key", "Value", "Description"]]);
        _formatNotifyHeader_(sheet);
      }
    }
  }

  // อ่าน key ที่มีอยู่
  const existing = {};
  if (sheet.getLastRow() > 1) {
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    data.forEach(function(r) {
      const k = String(r[0] || "").trim();
      if (k) existing[k] = true;
    });
  }

  const added = [];
  Object.keys(NF_SETTINGS_KEYS).forEach(function(k) {
    if (!existing[k]) {
      sheet.appendRow([k, NF_SETTINGS_KEYS[k].default, NF_SETTINGS_KEYS[k].desc]);
      added.push(k);
    }
  });

  return { success: true, sheetName: name, addedKeys: added };
}

function ensureScheduleSheet_() {
  repairNotifyScheduleSheet();
  return _getNotifyScheduleSheet_();
}

function _ensureNotifyLogSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const name = _getNotifyLogSheetName_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(NF_LOG_HEADERS);
    _formatNotifyHeader_(sheet);
  }
  return { success: true, sheetName: name };
}

function _formatNotifyHeader_(sheet) {
  try {
    sheet.getRange(1, 1, 1, sheet.getLastColumn())
      .setFontWeight("bold")
      .setBackground("#1e3a8a")
      .setFontColor("#ffffff")
      .setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  } catch (e) {}
}

// ========== Flex Payload / Builder / Sender ============================

function _normalizeFlexNotifyPayload_(targetOrPayload, maybePayload) {
  let payload = {};
  if (targetOrPayload && typeof targetOrPayload === "object" && !maybePayload) {
    payload = targetOrPayload;
  } else {
    payload = (maybePayload && typeof maybePayload === "object") ? maybePayload : {};
    payload.to = payload.to || payload.target || payload.targetId || targetOrPayload;
  }

  if (!payload || typeof payload !== "object") return { ok: false, error: "payload ว่าง" };

  const title = _safeFlexText_(payload.title || payload.subject || payload.header || "แจ้งเตือน", 80);
  const body = _safeFlexText_(payload.body || payload.message || payload.text || payload.detail || "", 1800);
  const targets = payload.targets || payload.to || payload.target || payload.targetId || payload.lineId || payload.groupId || "";
  const replyToken = payload.replyToken || "";

  if (!body) return { ok: false, error: "ข้อความว่าง" };
  if (!replyToken && !targets) return { ok: false, error: "ไม่ได้กำหนดเป้าหมาย" };

  return {
    ok: true,
    title: title,
    body: body,
    targets: targets,
    replyToken: replyToken,
    footer: _safeFlexText_(payload.footer || _readConfigSafe_("NOTIFY_FOOTER_TEXT") || "ระบบแจ้งเตือน", 80),
    brandColor: _readConfigSafe_("NOTIFY_BRAND_COLOR") || "#1E40AF",
    url: payload.url || payload.link || "",
    label: _safeFlexText_(payload.label || "เปิดดู", 20),
    scheduleId: payload.scheduleId || ""
  };
}

function _buildUnifiedNotifyFlex_(data) {
  const title = data.title || "แจ้งเตือน";
  const body = data.body || "-";
  const tz = _readConfigSafe_("NOTIFY_TIMEZONE") || Session.getScriptTimeZone();
  const nowText = Utilities.formatDate(new Date(), tz, "dd/MM/yyyy HH:mm");
  const brand = data.brandColor || "#1E40AF";

  const footerContents = [
    { type: "text", text: data.footer + " · " + nowText, size: "xxs", color: "#6B7280", align: "center", wrap: true }
  ];

  if (data.url) {
    footerContents.unshift({
      type: "button", style: "primary", height: "sm", color: brand,
      action: { type: "uri", label: data.label || "เปิดดู", uri: String(data.url) }
    });
  }

  return {
    type: "flex",
    altText: title + ": " + body.substring(0, 80),
    contents: {
      type: "bubble", size: "mega",
      header: {
        type: "box", layout: "vertical", backgroundColor: brand, paddingAll: "16px",
        contents: [
          { type: "text", text: title, color: "#FFFFFF", weight: "bold", size: "lg", wrap: true },
          { type: "text", text: "LINE Notification", color: "#DBEAFE", size: "xs", margin: "xs" }
        ]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "16px",
        contents: [{ type: "text", text: body, size: "sm", color: "#111827", wrap: true }]
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "10px", spacing: "xs",
        contents: footerContents
      }
    }
  };
}

function _sendFlexNotifyTargets_(data, flex) {
  const message = { type: "flex", altText: flex.altText, contents: flex.contents };

  if (data.replyToken) {
    const res = _linePost("https://api.line.me/v2/bot/message/reply", {
      replyToken: data.replyToken, messages: [message]
    });
    return { success: res.responseCode === 200, responseCode: res.responseCode, recipientCount: 1, body: res.body };
  }

  const targets = _resolveNotifyTargets_(data.targets);
  if (targets.broadcast) {
    const res = _linePost("https://api.line.me/v2/bot/message/broadcast", { messages: [message] });
    return { success: res.responseCode === 200, responseCode: res.responseCode, recipientCount: 0, body: res.body };
  }

  if (targets.ids.length === 0) {
    return { success: false, error: "ไม่พบเป้าหมายที่ resolve ได้", recipientCount: 0 };
  }

  let ok = true, sent = 0, lastErr = "";
  targets.ids.forEach(function(id) {
    const res = _linePost("https://api.line.me/v2/bot/message/push", { to: id, messages: [message] });
    if (res.responseCode === 200) sent++;
    else { ok = false; lastErr = "HTTP " + res.responseCode + ": " + (res.body || "").substring(0, 120); }
  });

  return { success: ok, recipientCount: sent, error: ok ? undefined : lastErr };
}

function _resolveNotifyTargets_(rawTargets) {
  const raw = String(rawTargets || "").trim();
  if (!raw || raw.toLowerCase() === "admins") {
    return { broadcast: false, ids: (typeof getAdminIds === "function") ? getAdminIds() : [] };
  }

  const parts = raw.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
  if (parts.length === 1 && parts[0].toLowerCase() === "all") {
    return { broadcast: true, ids: [] };
  }

  let ids = [];
  parts.forEach(function(p) {
    if (p.toLowerCase() === "admins") {
      try { ids = ids.concat(getAdminIds()); } catch (e) {}
    } else {
      ids.push(p);
    }
  });

  const seen = {};
  ids = ids.filter(function(id) {
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  });
  return { broadcast: false, ids: ids };
}

// ========== Sheet helpers ==============================================

function _getNotifyScheduleSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const candidates = [
    (typeof SHEETS !== "undefined" && SHEETS.SCHEDULE) ? SHEETS.SCHEDULE : "",
    "ตารางเวลา", "Schedule", "SCHEDULE", "แจ้งเตือนล่วงหน้า"
  ].filter(Boolean);
  for (let i = 0; i < candidates.length; i++) {
    const sheet = ss.getSheetByName(candidates[i]);
    if (sheet) return sheet;
  }
  return null;
}

function _getNotifyScheduleSheetName_() {
  return (typeof SHEETS !== "undefined" && SHEETS.SCHEDULE) ? SHEETS.SCHEDULE : "ตารางเวลา";
}

function _getNotifyLogSheetName_() {
  return (typeof SHEETS !== "undefined" && SHEETS.NOTIFY_LOG) ? SHEETS.NOTIFY_LOG : "แจ้งเตือน";
}

function _getSettingsSheetName_() {
  return (typeof SHEETS !== "undefined" && SHEETS.SETTINGS) ? SHEETS.SETTINGS : "ตั้งค่า";
}

function _getNotifyScheduleColumns_(headers) {
  return {
    id:        _findHeaderIndex_(headers, ["ID", "id"], 0),
    date:      _findHeaderIndex_(headers, ["วันที่ส่ง", "เวลาส่ง", "sendAt", "datetime", "date"], 1),
    title:     _findHeaderIndex_(headers, ["หัวข้อ", "title", "subject"], 2),
    body:      _findHeaderIndex_(headers, ["ข้อความ", "message", "body", "text"], 3),
    repeat:    _findHeaderIndex_(headers, ["ซ้ำ", "repeat"], 4),
    targets:   _findHeaderIndex_(headers, ["เป้าหมาย", "targets", "target", "to"], 5),
    status:    _findHeaderIndex_(headers, ["สถานะ", "status"], 6),
    createdAt: _findHeaderIndex_(headers, ["วันที่สร้าง", "createdAt", "created"], 7),  // ← เพิ่ม
    sentAt:    _findHeaderIndex_(headers, ["ส่งล่าสุด", "sentAt", "lastSentAt"], 8),     // ← เพิ่ม
    lastError: _findHeaderIndex_(headers, ["ข้อผิดพลาด", "lastError", "error"], 9)      // ← เพิ่ม
  };
}

function _findHeaderIndex_(headers, aliases, fallback) {
  const normalized = headers.map(function(h) {
    return String(h || "").trim().toLowerCase().replace(/\s+/g, "");
  });
  for (let i = 0; i < aliases.length; i++) {
    const a = String(aliases[i] || "").trim().toLowerCase().replace(/\s+/g, "");
    const idx = normalized.indexOf(a);
    if (idx >= 0) return idx;
  }
  return (fallback >= 0 && fallback < headers.length) ? fallback : -1;
}

function _isNotifyScheduleActive_(status) {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return true;
  // blacklist
  if (["off", "inactive", "disabled", "cancel", "cancelled", "ยกเลิก", "ปิด", "ส่งแล้ว", "done", "ผิดพลาด"].indexOf(s) >= 0) return false;
  // ไม่อยู่ในรายการแบล็คลิสต์ → ถือว่าใช้งาน (เปิดกว้างกว่าเดิม)
  return true;
}

// ========== Date / Status / Log ========================================

/**
 * Parse วันที่หลายรูปแบบ:
 *   - Date object
 *   - "dd/MM/yyyy HH:mm" / "dd/MM/yyyy"
 *   - "yyyy-MM-dd HH:mm" / "yyyy-MM-dd"
 *   - ISO 8601
 */
function _parseNotifyDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (value === null || value === undefined || value === "") return null;

  // ตัวเลขล้วน (epoch)
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  const s = String(value).trim();
  if (!s) return null;

  // dd/MM/yyyy[ HH:mm[:ss]]
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (m) {
    let y = parseInt(m[3], 10);
    // รองรับปี พ.ศ. (>= 2400)
    if (y >= 2400) y -= 543;
    const d = new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10),
                       parseInt(m[4] || "0", 10), parseInt(m[5] || "0", 10), parseInt(m[6] || "0", 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // yyyy-MM-dd[ HH:mm[:ss]]
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/);
  if (m) {
    const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
                       parseInt(m[4] || "0", 10), parseInt(m[5] || "0", 10), parseInt(m[6] || "0", 10));
    return isNaN(d.getTime()) ? null : d;
  }

  // fallback - native parser
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function _nextNotifyDate_(date, repeat, now) {
  const next = new Date(date.getTime());
  const mode = String(repeat || "once").trim().toLowerCase();
  do {
    if (mode === "daily" || mode === "รายวัน") next.setDate(next.getDate() + 1);
    else if (mode === "weekly" || mode === "รายสัปดาห์") next.setDate(next.getDate() + 7);
    else if (mode === "monthly" || mode === "รายเดือน") next.setMonth(next.getMonth() + 1);
    else return next;
  } while (next <= now);
  return next;
}

function _writeNotifyMeta_(sheet, rowNo, cols, meta) {
  if (meta.status !== undefined && cols.status >= 0)
    sheet.getRange(rowNo, cols.status + 1).setValue(meta.status);
  if (meta.sentAt !== undefined && cols.sentAt >= 0)
    sheet.getRange(rowNo, cols.sentAt + 1).setValue(meta.sentAt);
  if (meta.lastError !== undefined && cols.lastError >= 0)
    sheet.getRange(rowNo, cols.lastError + 1).setValue(meta.lastError);
}

function _appendNotifyLogSafe_(title, body, targets, count, status, sender) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheetName = _getNotifyLogSheetName_();
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow(NF_LOG_HEADERS);
      _formatNotifyHeader_(sheet);
    }
    sheet.appendRow([
      "N" + new Date().getTime(),
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      title, body, targets, count, status, 0, sender || "system"
    ]);
  } catch (e) {
    Logger.log("_appendNotifyLogSafe_ error: " + e.message);
  }
}

function _cell_(row, idx) {
  return idx >= 0 ? String(row[idx] || "").trim() : "";
}

function _safeFlexText_(value, maxLen) {
  const text = String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .trim();
  return text.length > maxLen ? text.substring(0, maxLen - 1) + "…" : text;
}

/**
 * อ่าน config แบบปลอดภัย - ถ้า getConfig ไม่มี/พัง คืน null แทนการ throw
 */
function _readConfigSafe_(key) {
  try {
    if (typeof getConfig === "function") {
      const v = getConfig(key);
      if (v !== null && v !== undefined && v !== "") return v;
    }
  } catch (e) {}
  // fallback: อ่านจาก settings sheet โดยตรง
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(_getSettingsSheetName_());
    if (!sheet || sheet.getLastRow() < 2) return null;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0] || "").trim() === key) return String(data[i][1] || "").trim();
    }
  } catch (e) {}
  return null;
}
// ========== ตรวจ payload ที่ client รับมาจริง ==========

function diagnoseSettingsPayload() {
  Logger.log("=== ตรวจสอบ getSettingsPayload20260511 ===\n");

  if (typeof getSettingsPayload20260511 !== "function") {
    Logger.log("❌ ไม่พบฟังก์ชัน getSettingsPayload20260511 ในระบบ");
    Logger.log("→ ต้องสร้างหรือแก้ชื่อฟังก์ชันใน รหัส.gs");
    return;
  }

  try {
    const payload = getSettingsPayload20260511();

    Logger.log("✅ ฟังก์ชันรันได้");
    Logger.log("payload type = " + typeof payload);
    Logger.log("top-level keys = " + Object.keys(payload || {}).join(", "));
    Logger.log("payload.ok = " + payload.ok);
    Logger.log("payload.loadedKeys = " + payload.loadedKeys);
    Logger.log("payload.sheetLoadedKeys = " + payload.sheetLoadedKeys);

    if (payload.settings && typeof payload.settings === "object") {
      const keys = Object.keys(payload.settings);
      Logger.log("\n✅ payload.settings มี " + keys.length + " keys");
      Logger.log("Sample: " + keys.slice(0, 15).join(", "));

      const required = ["BOT_STATUS", "VIP_SECRET_CODE", "LOC_SAVE_MSG_STATUS",
                        "LOC_SAVE_MSG_TEXT", "COURT_STATUS", "COURT_SHEET_ID", "COURT_SHEET_NAME"];
      Logger.log("\n--- เช็ค required keys (7 ตัวที่ client ต้องการ) ---");
      required.forEach(function(k) {
        const v = payload.settings[k];
        const status = (v === undefined) ? "❌ MISSING" : (v === null || v === "") ? "⚠️ EMPTY" : "✅";
        Logger.log(status + " " + k + " = " + JSON.stringify(v));
      });
    } else {
      Logger.log("\n⚠️ ไม่มี payload.settings — รูปแบบไม่ตรงกับ client คาด");
      Logger.log("Client คาดรูปแบบ: { ok: true, loadedKeys: N, settings: {...} }");
    }

    if (payload._debug || payload.debug) {
      Logger.log("\n--- debug info ---");
      Logger.log(JSON.stringify(payload._debug || payload.debug, null, 2));
    }

  } catch (e) {
    Logger.log("❌ Error: " + e.message);
    Logger.log("Stack: " + (e.stack || "").substring(0, 800));
  }
}

// ========== ตรวจ repair functions ที่ fail =====

function diagnoseRepairFunctions() {
  Logger.log("=== ทดสอบ repairFullSystem ===");
  try {
    if (typeof repairFullSystem !== "function") {
      Logger.log("❌ ไม่พบฟังก์ชัน repairFullSystem");
    } else {
      const r = repairFullSystem();
      Logger.log("✅ Result: " + JSON.stringify(r, null, 2).substring(0, 1500));
    }
  } catch (e) {
    Logger.log("❌ Error: " + e.message);
    Logger.log("Stack: " + (e.stack || "").substring(0, 800));
  }

  Logger.log("\n=== ทดสอบ repairAndUpgradeSheets ===");
  try {
    if (typeof repairAndUpgradeSheets !== "function") {
      Logger.log("❌ ไม่พบฟังก์ชัน repairAndUpgradeSheets");
    } else {
      const r = repairAndUpgradeSheets();
      Logger.log("✅ Result: " + JSON.stringify(r, null, 2).substring(0, 1500));
    }
  } catch (e) {
    Logger.log("❌ Error: " + e.message);
    Logger.log("Stack: " + (e.stack || "").substring(0, 800));
  }
}

// ========== รันทั้งหมดทีเดียว ==========

function diagnoseAllSettings() {
  diagnoseSettingsPayload();
  Logger.log("\n\n" + "=".repeat(60) + "\n");
  diagnoseRepairFunctions();
}
// ========== Light-weight wrappers สำหรับ UI ==========
// แก้บั๊ก "ซ่อมแซมไม่สำเร็จ + {} ว่าง" ที่เกิดจาก payload ใหญ่เกินไป

/**
 * เรียกจาก UI แทน repairFullSystem — คืนแค่ผลลัพธ์สรุป ไม่ส่ง nested settings ใหญ่ๆ
 */
function repairFullSystemLight() {
  try {
    const r = repairFullSystem();
    return {
      success: !!(r && r.success),
      message: (r && r.message) || "ซ่อมแซมเสร็จเรียบร้อย",
      sheetName: r && r.structure && r.structure.settingsRepair && r.structure.settingsRepair.sheetName || "ตั้งค่า",
      rowsAfter: r && r.structure && r.structure.settingsRepair && r.structure.settingsRepair.rowsAfter || 0,
      timestamp: Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss")
    };
  } catch (e) {
    return { success: false, message: String(e.message || e).substring(0, 200) };
  }
}

/**
 * เรียกจาก UI แทน getSettingsPayload20260511 — คืน settings สะอาด ไม่มี _debug nested
 */
function getSettingsPayloadLight() {
  // Log ทุกครั้งที่ client เรียก เพื่อ trace ปัญหา
  try {
    Logger.log("[CLIENT CALL] getSettingsPayloadLight invoked");

    if (typeof getSettingsPayload20260511 !== "function") {
      Logger.log("[ERROR] getSettingsPayload20260511 not a function");
      return _fallbackSettingsPayload_("getSettingsPayload20260511 not found");
    }

    let full;
    try {
      full = getSettingsPayload20260511();
    } catch (e) {
      Logger.log("[ERROR] getSettingsPayload20260511 threw: " + e.message);
      return _fallbackSettingsPayload_("inner throw: " + e.message);
    }

    if (!full) {
      Logger.log("[ERROR] full is null/undefined");
      return _fallbackSettingsPayload_("full is null");
    }
    if (!full.settings) {
      Logger.log("[ERROR] full.settings missing. keys = " + Object.keys(full).join(","));
      return _fallbackSettingsPayload_("settings key missing");
    }

    const clean = {};
    Object.keys(full.settings).forEach(function(k) {
      if (k !== "_debug" && k !== "debug") clean[k] = full.settings[k];
    });

    Logger.log("[OK] returning " + Object.keys(clean).length + " keys");

    return {
      ok: true,
      loadedKeys: Object.keys(clean).length,
      sheetLoadedKeys: Object.keys(clean).length,
      rawLoadedKeys: Object.keys(clean).length,
      hasBotStatus: !!clean.BOT_STATUS,
      settings: clean,
      serverTime: Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss")
    };
  } catch (outer) {
    Logger.log("[FATAL] " + outer.message + "\n" + (outer.stack || ""));
    return _fallbackSettingsPayload_("fatal: " + outer.message);
  }
}

function _fallbackSettingsPayload_(reason) {
  // อ่านจาก sheet ตรงๆ เป็น fallback สุดท้าย ไม่พึ่ง getSettingsPayload20260511
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName("ตั้งค่า");
    if (!sheet || sheet.getLastRow() < 2) {
      return { ok: false, error: reason + " | sheet missing", settings: {}, loadedKeys: 0 };
    }
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    const settings = {};
    data.forEach(function(r) {
      const k = String(r[0] || "").trim();
      const v = String(r[1] || "").trim();
      if (k) settings[k] = v;
    });
    return {
      ok: true,
      loadedKeys: Object.keys(settings).length,
      sheetLoadedKeys: Object.keys(settings).length,
      rawLoadedKeys: Object.keys(settings).length,
      hasBotStatus: !!settings.BOT_STATUS,
      settings: settings,
      serverTime: Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss"),
      _fallback: true,
      _fallbackReason: reason
    };
  } catch (e) {
    return { ok: false, error: reason + " | fallback failed: " + e.message,
             settings: {}, loadedKeys: 0 };
  }
}

function testLightWrappersInEditor() {
  Logger.log("=== ทดสอบฟังก์ชันใน editor ===\n");
  
  Logger.log("getSettingsPayloadLight: " + typeof getSettingsPayloadLight);
  Logger.log("repairFullSystemLight: " + typeof repairFullSystemLight);
  Logger.log("getSettingsPayload20260511: " + typeof getSettingsPayload20260511);
  
  Logger.log("\n--- เรียก getSettingsPayloadLight() ---");
  const r = getSettingsPayloadLight();
  Logger.log("ok = " + r.ok);
  Logger.log("loadedKeys = " + r.loadedKeys);
  Logger.log("BOT_STATUS = " + (r.settings && r.settings.BOT_STATUS));
  Logger.log("COURT_SHEET_ID = " + (r.settings && r.settings.COURT_SHEET_ID));
  
  if (r.error) Logger.log("⚠️ error = " + r.error);
}