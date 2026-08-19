/**
 * 🤖 Line Chatbot Admin Dashboard - Google Apps Script
 * ─────────────────────────────────────────────────────────────
 * 👑 v10.5 Master Build — Mission Group Mode (whitelist auto-save)
 *
 * ⭐ NEW IN v10.4 (ใช้คู่กับ SearchUnified.gs):
 *   🎯 Single keyword "ค้นหา" — ทำได้ทุกอย่าง (ค้นทุกฐาน + dbHint + listMode)
 *   👥 กลุ่ม: ใช้ "บอท ค้นหา ..." (default — แก้ใน config ได้)
 *   🛡️ Permission: VIP register แล้ว + Admin
 *   🌟 Flex Carousel แบบรวมศูนย์ (พิกัด + ผู้ใหญ่บ้าน + ฯลฯ)
 *   🚫 ปลด auto-prefix เก่า (SearchUnified จัดการเองแล้ว)
 *
 * 📊 v10.3 (เก่า — คงไว้):
 *   🛡️ Always-reply (safeSendReply ไม่ silent fail)
 *   ✅ House number validation (กรอง dirty data)
 *   📊 Force update stats หลัง search สำเร็จ
 *
 * 📊 v10 (เก่า):
 *   + Fallback Database_LastWeek สำหรับบัญชีนัดความ
 *   + Fix addSearchDatabase hang (ตรวจ Sheet ID ก่อน)
 *   + เพิ่ม logging ให้ debug ง่ายขึ้น
 *   คงโครงสร้าง v9 ทุกฟังก์ชัน
 * ─────────────────────────────────────────────────────────────
 */

const SPREADSHEET_ID = "1llnzNFkDirqGAxqIg77azh8FZBbSadFGUvNYfUM4xcc";

// 🔐 อ่าน Channel Access Token จาก Script Properties เท่านั้น (ห้าม hardcode)
// ตั้งค่า: Project Settings → Script Properties → key: LINE_CHANNEL_ACCESS_TOKEN
const LINE_CHANNEL_ACCESS_TOKEN =
  PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || "";

function getLineChannelAccessToken_() {
  return String(LINE_CHANNEL_ACCESS_TOKEN || "").trim();
}

function getLineAuthHeaders_() {
  const token = getLineChannelAccessToken_();
  if (!token) {
    throw new Error("ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ใน Script Properties");
  }
  return { "Authorization": "Bearer " + token };
}

const SHEETS = {
  MEMBERS    : "สมาชิก",
  KNOWLEDGE  : "ความรู้",
  ACTIVITY   : "กิจกรรม",
  STATISTICS : "สถิติ",
  CONFIG     : "ตั้งค่า",
  NOTIFY_LOG : "แจ้งเตือน",
  SCHEDULE   : "ตารางเวลา",
  LOCATION   : "ข้อมูลพิกัด",
  SAVED_IDS  : "บันทึกไอดี",
  PHOTOS     : "รูปภาพหลักฐาน",
  SEARCH_DB        : "ฐานค้นหา",
  PERMISSION_AUDIT : "บันทึกสิทธิ์",
  ONLINE_COURT_USAGE : "สถิติศูนย์ประสานงานคดี",
  GROUP_WHITELIST: "GROUP_WHITELIST",
  PERSONAL_ARCHIVE: "บันทึกส่วนตัว",
};

function openSpreadsheetByIdSafe_(spreadsheetId, label) {
  const id = String(spreadsheetId || "").trim();
  if (!id) throw new Error((label || "Spreadsheet") + ": Sheet ID ว่าง");

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      lastError = e;
      if (attempt < 3) Utilities.sleep(350 * attempt);
    }
  }

  const rawMessage = lastError && lastError.message ? lastError.message : String(lastError);
  throw new Error((label || "Spreadsheet") + " เข้าไม่ได้ (ID: " + id + "): " + rawMessage);
}

function _withScriptLock_(timeoutMs, callback) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    locked = lock.tryLock(timeoutMs || 5000);
    if (!locked) throw new Error("ไม่สามารถขอ lock ได้ในเวลาที่กำหนด");
    return callback();
  } finally {
    if (locked) lock.releaseLock();
  }
}

function authorizeSystemAccess() {
  const result = {
    success: true,
    checkedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
    items: []
  };

  _pushAuthCheck_(result, "Spreadsheet หลัก", function() {
    const ss = openSpreadsheetByIdSafe_(SPREADSHEET_ID, "SPREADSHEET_ID");
    return ss.getName();
  });

  _pushAuthCheck_(result, "Google Drive", function() {
    return DriveApp.getRootFolder().getName();
  });

  _pushAuthCheck_(result, "Script Triggers", function() {
    return ScriptApp.getProjectTriggers().length + " triggers";
  });

  _pushAuthCheck_(result, "LINE API", function() {
    const response = UrlFetchApp.fetch("https://api.line.me/v2/bot/info", {
      method: "get",
      headers: getLineAuthHeaders_(),
      muteHttpExceptions: true
    });
    return "HTTP " + response.getResponseCode();
  });

  const court = checkCourtSheetAccess();
  result.items.push({
    name: "COURT_SHEET_ID",
    ok: court.success,
    detail: court.success ? court.spreadsheetName : court.error,
    url: court.url || ""
  });

  result.success = result.items.every(function(item) { return item.ok; });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function authorizeCourtSheetAccess() {
  return checkCourtSheetAccess();
}

function acceptCourtSheetPermission() {
  return checkCourtSheetAccess();
}

function checkCourtSheetAccess() {
  const sheetId = String(getConfig("COURT_SHEET_ID") || "").trim();
  const sheetName = String(getConfig("COURT_SHEET_NAME") || "Database").trim();
  const result = {
    success: false,
    status: getConfig("COURT_STATUS") || "OFF",
    sheetId: sheetId,
    sheetName: sheetName,
    url: sheetId ? _spreadsheetUrl_(sheetId) : "",
    spreadsheetName: "",
    availableSheets: [],
    error: "",
    fix: ""
  };

  if (!sheetId) {
    result.error = "COURT_SHEET_ID ว่าง";
    result.fix = "ถ้ายังไม่ใช้บัญชีนัดความ ให้ตั้ง COURT_STATUS = OFF หรือใส่ Sheet ID ให้ถูกต้อง";
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  }

  try {
    const ss = openSpreadsheetByIdSafe_(sheetId, "COURT_SHEET_ID");
    result.spreadsheetName = ss.getName();
    result.availableSheets = ss.getSheets().map(function(sheet) { return sheet.getName(); });
    result.hasTargetSheet = !!ss.getSheetByName(sheetName);
    if (!result.hasTargetSheet) {
      result.error = "เปิด Spreadsheet ได้ แต่ไม่พบชีทชื่อ " + sheetName;
      result.fix = "เปลี่ยน COURT_SHEET_NAME ให้ตรง หรือสร้างชีทชื่อ " + sheetName;
      Logger.log(JSON.stringify(result, null, 2));
      return result;
    }
    result.success = true;
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    result.error = e && e.message ? e.message : String(e);
    result.fix = "เปิดลิงก์นี้แล้วแชร์ Google Sheet ให้บัญชีเจ้าของ Apps Script เป็น Editor: " + result.url;
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  }
}

function _pushAuthCheck_(result, name, fn) {
  try {
    result.items.push({ name: name, ok: true, detail: String(fn()) });
  } catch (e) {
    result.items.push({ name: name, ok: false, detail: e && e.message ? e.message : String(e) });
  }
}

function _spreadsheetUrl_(id) {
  return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(String(id || "").trim()) + "/edit";
}

// ==========================================
// 1. SETUP & CONFIG
// ==========================================
function repairAndUpgradeSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const structures = [
    { name: SHEETS.MEMBERS,    headers: ["ID", "Line User ID", "ชื่อ", "อีเมล", "บทบาท", "สถานะ", "รหัสผ่าน", "วันที่เข้าร่วม"] },
    { name: SHEETS.KNOWLEDGE,  headers: ["ID", "คำถาม", "คำตอบ", "หมวดหมู่", "แท็ก", "สถานะ", "สิทธิ์การเข้าถึง", "วันที่สร้าง", "รูปย่อ", "ลิงก์เปิด", "File ID", "วันที่อัปโหลดรูป"] },
    { name: SHEETS.ACTIVITY,   headers: ["ID", "เวลา", "ผู้ใช้", "การกระทำ", "ข้อความ", "รายละเอียด", "สถานะ", "เวลาตอบ"] },
    { name: SHEETS.STATISTICS, headers: ["วันที่", "รวมผู้ใช้", "รวมคำถาม", "สำเร็จ", "ล้มเหลว", "อัตราสำเร็จ", "เวลาตอบเฉลี่ย"] },
    { name: SHEETS.CONFIG,     headers: ["คีย์", "ค่า", "คำอธิบาย"] },
    { name: SHEETS.NOTIFY_LOG, headers: ["ID", "เวลา", "หัวข้อ", "ข้อความ", "เป้าหมาย", "จำนวนผู้รับ", "สถานะ", "เปิดอ่าน", "ผู้ส่ง"] },
    { name: SHEETS.SCHEDULE,   headers: ["ID", "วันที่ส่ง", "ข้อความ", "ซ้ำ", "เป้าหมาย", "สถานะ", "วันที่สร้าง"] },
    { name: SHEETS.LOCATION,   headers: ["ID", "เวลา", "ผู้ส่ง (Line ID)", "บ้านเลขที่", "ละติจูด (Lat)", "ลองจิจูด (Lng)", "ที่อยู่จากแผนที่", "Group ID"] },
    { name: SHEETS.SAVED_IDS,  headers: ["ID", "ชื่อเรียก", "LINE ID", "วันที่บันทึก"] },
    { name: SHEETS.PHOTOS,     headers: ["ID", "เวลา", "ผู้ส่ง (Line ID)", "ชื่อผู้ส่ง", "บ้านเลขที่", "URL รูป", "Group ID", "Loc ID"] },
    { name: SHEETS.PERSONAL_ARCHIVE, headers: ["ID", "เวลา", "เดือนKey", "เดือน", "ประเภทแชท", "แหล่งข้อมูล (LINE ID)", "ผู้ส่ง (LINE ID)", "ชื่อผู้ส่ง", "ประเภทข้อมูล", "รายละเอียด", "URL ที่พบ", "Drive URL", "Drive File ID", "โหมดรูป", "ขนาดไฟล์ (bytes)", "สถานะรูป", "LINE Message ID"] },
    { name: SHEETS.SEARCH_DB,        headers: ["ID", "ชื่อฐาน", "ไอคอน", "Sheet ID", "ชื่อชีท", "สิทธิ์", "สถานะ", "วันที่สร้าง"] },
    { name: SHEETS.PERMISSION_AUDIT, headers: ["เวลา", "User ID", "การกระทำ", "เหตุผล", "บทบาท", "สถานะ"] },
  ];
  structures.forEach(struct => {
    let sheet = ss.getSheetByName(struct.name);
    if (!sheet) {
      sheet = ss.insertSheet(struct.name);
      sheet.appendRow(struct.headers);
      sheet.getRange(1, 1, 1, sheet.getLastColumn()).setFontWeight("bold").setBackground("#1e3a8a").setFontColor("#ffffff").setHorizontalAlignment("center");
    } else {
      const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (struct.name === SHEETS.LOCATION && currentHeaders.length < 8) {
        sheet.getRange(1, 8).setValue("Group ID").setFontWeight("bold").setBackground("#1e3a8a").setFontColor("#ffffff").setHorizontalAlignment("center");
      }
      if (struct.name === SHEETS.PHOTOS && currentHeaders.length < 8) {
        sheet.getRange(1, 8).setValue("Loc ID").setFontWeight("bold").setBackground("#1e3a8a").setFontColor("#ffffff").setHorizontalAlignment("center");
      }
      if (struct.name === SHEETS.KNOWLEDGE && currentHeaders.length < 12) {
        const extraHeaders = ["รูปย่อ", "ลิงก์เปิด", "File ID", "วันที่อัปโหลดรูป"];
        for (let h = 0; h < extraHeaders.length; h++) {
          const col = 9 + h;
          if (!currentHeaders[col - 1]) {
            sheet.getRange(1, col).setValue(extraHeaders[h]).setFontWeight("bold").setBackground("#1e3a8a").setFontColor("#ffffff").setHorizontalAlignment("center");
          }
        }
      }
    }
  });
  initializeConfig(ss);
  const settingsRepair = normalizeSettingsSheetFormat();
  SpreadsheetApp.flush();
  if (typeof _clearConfigCache === "function") _clearConfigCache();
  _clearCodeLocalCache_();
  return {
    success: true,
    message: "ซ่อมแซมและอัปเกรดฐานข้อมูลเสร็จสมบูรณ์!",
    settingsRepair: settingsRepair,
    settingsPayload: getSettingsPayload20260511()
  };
}

function initializeConfig(ss) {
  const configSheet = ss.getSheetByName(SHEETS.CONFIG);
  const data = configSheet.getDataRange().getValues();
  const keys = data.slice(1).map(r => normalizeConfigKey_(r[0])).filter(Boolean);
  const defaultConfigs = [
    ["BOT_STATUS", "ON", "สถานะบอท (ON/OFF)"],
    ["MSG_FALLBACK", "ขออภัยครับไม่พบข้อมูลหรือต้องลงทะเบียนเพื่อเข้าการใช้งานระบบครับ✨", "ข้อความเมื่อไม่พบคำตอบ"],
    ["POLITE_PREFIX", "สวัสดีครับ ยินดีที่ได้ให้บริการครับ\n\n", "คำขึ้นต้นที่สุภาพ"],
    ["POLITE_SUFFIX", "\n\nหากมีเรื่องอื่นให้ช่วยแจ้งได้เลยนะครับ ขอบคุณครับ", "คำลงท้ายที่สุภาพ"],
    ["NOTIFY_STATUS", "ON", "สถานะระบบแจ้งเตือน (ON/OFF)"],
    ["ADMIN_LINE_IDS", "", "Line User ID ของ Admin คั่นด้วยจุลภาค"],
    ["VIP_SECRET_CODE", "VIP2026", "รหัสลับสำหรับลงทะเบียน VIP"],
    ["VIP_PROMPT_MSG", "รหัสถูกต้อง✨ กรุณาพิมพ์ ชื่อ-นามสกุล ของคุณเพื่อลงทะเบียนรับสิทธิ์ VIP ครับ (พิมพ์ /ยกเลิก เพื่อยกเลิก)", "ข้อความถามชื่อ"],
    ["VIP_SUCCESS_MSG", "✅ ลงทะเบียนรับสิทธิ์ VIP สำเร็จเรียบร้อยแล้ว ยินดีต้อนรับครับ!", "ข้อความเมื่อลงทะเบียนเสร็จ"],
    ["LOC_SAVE_MSG_STATUS", "ON", "เปิด/ปิด ข้อความตอบกลับเมื่อบันทึกพิกัด/หมาย"],
    ["LOC_SAVE_MSG_TEXT", "(บันทึกข้อมูลแล้ว)", "ข้อความตอบกลับเมื่อบันทึกพิกัด/หมาย"],
    ["SUMMARY_STATUS", "OFF", "เปิด/ปิด สรุปสถิติอัตโนมัติ"],
    ["SUMMARY_INTERVAL", "daily", "ความถี่ (daily/weekly/monthly)"],
    ["SUMMARY_TARGETS", "admins", "เป้าหมายรับสรุป (admins, all, หรือ LINE IDs คั่น ,)"],
    ["PHOTO_SAVE_STATUS", "OFF", "เปิด/ปิด ระบบรับรูปภาพ"],
    ["PHOTO_ALLOWED_IDS", "admins", "ใครส่งรูปได้ (admins, vip, all, หรือ LINE IDs คั่น ,)"],
    ["PHOTO_ALLOWED_SOURCES", "all", "แหล่งที่อนุญาตให้ส่งรูป (all, private, groups, หรือ Group/User IDs คั่น ,)"],
    ["LOC_ALLOWED_SOURCES", "all", "แหล่งที่อนุญาตให้ส่งพิกัด (all, private, groups, หรือ Group/User IDs คั่น ,)"],
    ["PHOTO_FOLDER_ID", "", "Google Drive Folder ID สำหรับเก็บรูป"],
    ["PHOTO_MAX_WIDTH", "800", "ความกว้างสูงสุดรูปย่อ (px)"],
    ["PHOTO_REPLY_MSG", "📸 บันทึกรูปสำเร็จ", "ข้อความตอบกลับเมื่อรับรูป"],
    ["SEARCH_STATUS", "OFF", "เปิด/ปิด ระบบค้นหาข้อมูลจากฐาน"],
    ["SEARCH_NO_PERM_MSG", "🔒 ข้อมูลนี้สำหรับเจ้าหน้าที่ระบบภายในเท่านั้นครับ", "ข้อความเมื่อไม่มีสิทธิ์"],
    ["SEARCH_NO_RESULT_MSG", "❌ ไม่พบข้อมูลที่ค้นหาครับ ลองเปลี่ยนคำค้นใหม่", "ข้อความเมื่อไม่พบ"],
    ["SEARCH_MAX_RESULTS", "12", "จำนวนผลลัพธ์สูงสุด"],
    ["HEALTH_STATUS", "OFF", "เปิด/ปิด รายงานสุขภาพระบบอัตโนมัติ"],
    ["HEALTH_INTERVAL", "daily", "ความถี่ (daily/weekly/monthly)"],
    ["HEALTH_TARGETS", "admins", "เป้าหมายรับรายงาน"],
    // 🆕 v10: บัญชีนัดความ + fallback
    ["COURT_STATUS", "OFF", "เปิด/ปิด ระบบบัญชีนัดความ"],
    ["COURT_ACCESS", "vip", "สิทธิ์เข้าถึง (all/vip/admin)"],
    ["COURT_SHEET_ID", "", "Sheet ID ฐานบัญชีนัดความ"],
    ["COURT_SHEET_NAME", "Database", "ชื่อชีทหลัก (Tab) — default: Database"],
    ["COURT_MAX_RESULTS", "10", "จำนวนคดีต่อหน้า"],
    ["COURT_USE_FLEX", "ON", "ใช้ Flex Message (ON) หรือ Text (OFF)"],
    ["COURT_FALLBACK_SHEETS", "Database_LastWeek", "ชีตสำรองที่จะค้นต่อถ้าชีตหลักไม่เจอ (คั่น ,)"],
    // 🆕 v10.3: SearchPatch v3 configs
    ["SEARCH_USE_FLEX", "ON", "ใช้ Flex Message สำหรับ /ค้นหา (ON/OFF)"],
    ["SEARCH_AUTO_PREFIX", "ON", "เติม / อัตโนมัติเมื่อพิมพ์ 'ค้นหา' (ON/OFF)"],
    // 🆕 v10.4.2: SearchUnified configs
    ["SEARCH_KEYWORD",            "ค้นหา", "คีย์เวิร์ดหลักของระบบค้นหา"],
    ["SEARCH_GROUP_PREFIX",       "บอท",   "Prefix ในกลุ่ม (default: บอท)"],
    ["SEARCH_WHITELIST_GROUPS",   "",      "Group IDs ที่อนุญาตให้ค้น (ว่าง = ทุกกลุ่ม) คั่น ,"],
    ["SEARCH_MAX_RESULTS_PER_DB", "12",    "ผลลัพธ์สูงสุดต่อฐาน"],
    ["SEARCH_MAX_BUBBLES",        "12",    "จำนวน bubble สูงสุดใน Carousel"],
    ["SEARCH_NO_PERM_MSG_V2",     "🔒 คำสั่งค้นหาสำหรับเจ้าหน้าที่เท่านั้น\n\n💡 ลงทะเบียน VIP ก่อนใช้งานครับ", "ข้อความเมื่อไม่มีสิทธิ์ (v2)"],
    // 🆕 v10.4.2: Pikad configs (เพิ่มเติมจาก setupPikadSession)
    ["PIKAD_USE_FLEX",            "ON",    "ใช้ Flex Message สำหรับ Pikad reply (ON/OFF)"],
    ["LOCATION_REPLY_MSG",        "📌 บันทึกข้อมูลแล้ว", "ข้อความตอบกลับแบบข้อความธรรมดาของ Pikad เมื่อปิด Flex หรือสร้าง Flex ไม่สำเร็จ"],
    ["PIKAD_SESSION_MINUTES",     "2",     "เวลา merge รูป+พิกัด+เลขที่งานหมาย (นาที, ไม่เกิน 2)"],
    // 🆕 v10.4.2: ชื่อหน่วยงาน (สำหรับ photo folder)
    ["COURT_NAME",                "ศาลจังหวัดลพบุรี", "ชื่อหน่วยงาน (ใช้ตั้งชื่อโฟลเดอร์ Drive)"],
    ["ORGANIZATION_NAME",         "",      "ชื่อหน่วยงาน (สำรอง — ถ้า COURT_NAME ว่าง)"],
    // 📺 แจ้งเตือนสถานะ TV (NEW)
    ["TV_NOTIFY_STATUS",     "OFF", "เปิด/ปิด แจ้งเตือนสถานะ TV ON/OFF"],
    ["TV_NOTIFY_URL",        "",    "URL ระบบบัญชีนัด ?page=tvstatus"],
    ["TV_NOTIFY_TARGETS",    "",    "เป้าหมายรับแจ้ง (admins/all/Uxxx,Cxxx)"],
    ["TV_NOTIFY_ON_ONLINE",  "ON",  "แจ้งเมื่อ TV ออนไลน์"],
    ["TV_NOTIFY_ON_OFFLINE", "ON", "แจ้งเมื่อ TV ออฟไลน์"],
    ["FORCE_NOTIFY",        "OFF", "บังคับแจ้งเตือน TV นอกเวลา 06:00-18:00 (ON/OFF)"],
    // 📚 General Info Admin: เมนูข้อมูลทั่วไปแบบการ์ด
    ["GENERAL_INFO_STATUS", "ON", "เปิด/ปิด เมนูข้อมูลทั่วไป"],
    ["GENERAL_INFO_MENU_KEYWORDS", "ข้อมูลทั่วไป", "คำเรียกเมนูข้อมูลทั่วไป คั่นด้วย ,"],
    // 🚀 v10.4.3: Mission Group Mode
    ["MISSION_GROUP_IDS",    "", "Group IDs ของกลุ่มส่งหมาย คั่น , (รับบ้านเลขที่+พิกัด+รูปอัตโนมัติ)"],
    ["MISSION_REPLY_MODE",   "session", "โหมดตอบในกลุ่มส่งหมาย: silent / session / all"],
    // 📁 ระบบบันทึกส่วนตัว (แยกจากงานหมาย)
    ["PERSONAL_ARCHIVE_STATUS", "OFF", "เปิด/ปิด ระบบบันทึกส่วนตัว (ลิงก์และรูป)"],
    ["PERSONAL_ARCHIVE_ALLOWED_SOURCES", "", "แหล่งที่บันทึกได้: private, groups หรือ Cxxx/Rxxx/Uxxx คั่นด้วย ,"],
    ["PERSONAL_ARCHIVE_SEARCH_USER_IDS", "admins", "Line User IDs ที่ค้นบันทึกส่วนตัวได้ คั่นด้วย , หรือ admins"],
    ["PERSONAL_ARCHIVE_SEARCH_ALLOWED_SOURCES", "private", "ต้นทางที่อนุญาตให้ค้น: private, groups หรือ Cxxx/Rxxx/Uxxx"],
    ["PERSONAL_ARCHIVE_FOLDER_ID", "", "Google Drive Folder ID สำหรับบันทึกส่วนตัว (เก็บเป็น private)"],
    ["PERSONAL_ARCHIVE_IMAGE_MODE", "ORIGINAL", "ORIGINAL = เก็บไฟล์ต้นฉบับ, COMPRESSED = บีบอัดจริงผ่าน compressor URL"],
    ["PERSONAL_ARCHIVE_MAX_WIDTH", "800", "ความกว้างสูงสุดที่ส่งให้บริการบีบอัดรูป (px)"],
    ["PERSONAL_ARCHIVE_JPEG_QUALITY", "75", "คุณภาพ JPEG ที่ส่งให้บริการบีบอัดรูป (50-95)"],
    ["PERSONAL_ARCHIVE_COMPRESSOR_URL", "", "HTTPS endpoint รับรูปและคืนรูปที่บีบอัดแล้ว"],
    ["PERSONAL_ARCHIVE_COMPRESSOR_TOKEN", "", "Bearer token สำหรับ endpoint บีบอัดรูป (ถ้ามี)"],
    ["PERSONAL_ARCHIVE_REPLY_STATUS", "OFF", "เปิด/ปิด ข้อความยืนยันหลังบันทึกส่วนตัว"],
    // 💻 Online Court Coordination Mode
    ["ONLINE_COURT_STATUS", "OFF", "เปิด/ปิด โหมดศูนย์ประสานงานคดีออนไลน์"],
    ["ONLINE_COURT_GROUP_IDS", "", "ขอบเขตการตอบ: all, groups, private หรือ Cxxx/Rxxx/Uxxx ผสมกันได้"],
    ["ONLINE_COURT_EXCLUDED_IDS", "", "ID ที่ยกเว้นไม่ให้ศูนย์ประสานงานคดีตอบ"],
    ["ONLINE_COURT_PRIVATE_MENU_KEYWORDS", "ศูนย์ประสานงานคดี", "คำเรียกเมนูศูนย์ประสานงานคดีในแชทส่วนตัว"],
    ["ONLINE_COURT_GROUP_MENU_KEYWORDS", "ศูนย์ประสานงานคดี", "คำเรียกเมนูศูนย์ประสานงานคดีในกลุ่ม"],
    ["ONLINE_COURT_SCHEDULE_MODE", "business_hours", "โหมดวันเวลาทำการของศูนย์ประสานงานคดี"],
    ["ONLINE_COURT_WELCOME_STATUS", "ON", "ส่งการ์ดต้อนรับศูนย์ประสานงานคดีเมื่อเพิ่มเพื่อน"],
    ["ONLINE_COURT_WELCOME_MSG", "สวัสดีครับ/ค่ะ ยินดีต้อนรับสู่ศูนย์ประสานงานคดีออนไลน์ ศาลจังหวัดลพบุรี\nให้บริการแนะนำการเข้าร่วมพิจารณาคดีออนไลน์ ข้อปฏิบัติ ตัวอย่างคำสาบานตน การแก้ปัญหาเบื้องต้น และช่องทางติดต่อเจ้าหน้าที่\nเริ่มต้นได้โดยพิมพ์คำว่า “ศูนย์ประสานงานคดี” หรือกดปุ่มด้านล่างเพื่อดูเมนูทั้งหมด", "ข้อความต้อนรับเมื่อผู้ใช้เพิ่มเพื่อน"],
    ["ONLINE_COURT_MODE", "register_then_menu", "โหมดตอบ: keyword / menu / register_then_menu"],
    ["ONLINE_COURT_REQUIRE_NAME", "ON", "โหมด register_then_menu ให้ถามชื่อก่อนแสดงเมนู (ON/OFF)"],
    ["ONLINE_COURT_REGISTER_PROMPT", "สวัสดีครับ/ค่ะ ศูนย์ประสานงานคดีออนไลน์\nเพื่อให้เจ้าหน้าที่ตรวจสอบข้อมูลได้ถูกต้อง กรุณาระบุชื่อ-สกุล และเลขคดี/บัลลังก์/เวลานัด หากทราบ", "ข้อความถามข้อมูลเบื้องต้นในแชทส่วนตัว"],
    ["ONLINE_COURT_GROUP_PRIVACY_REPLY", "ศูนย์ประสานงานคดีออนไลน์รับทราบครับ/ค่ะ\nเพื่อคุ้มครองข้อมูลส่วนบุคคล หากต้องแจ้งชื่อ-สกุล เลขคดี บัลลังก์ หรือเวลานัด กรุณาเพิ่มเพื่อนบอทและแจ้งข้อมูลในแชทส่วนตัว\nระหว่างนี้สามารถพิมพ์เลขหัวข้อเพื่อดูคำแนะนำทั่วไปได้", "ข้อความตอบในกลุ่ม/ห้องเพื่อชวนเพิ่มเพื่อนบอท"],
    ["ONLINE_COURT_MENU_TITLE", "ศูนย์ประสานงานคดีออนไลน์\nกรุณาเลือกหัวข้อที่ต้องการสอบถาม", "หัวข้อการ์ด/เมนูศูนย์ประสานงานคดี"],
    ["ONLINE_COURT_DAYS", "MON,TUE,WED,THU,FRI", "วันที่ให้บอทตอบ (MON-SUN หรือชื่อวันภาษาไทย)"],
    ["ONLINE_COURT_START_TIME", "08.00 น.", "เวลาเริ่มตอบ รูปแบบ 24 ชั่วโมง เช่น 08.00 น."],
    ["ONLINE_COURT_END_TIME", "16.30 น.", "เวลาสิ้นสุดการตอบ รูปแบบ 24 ชั่วโมง เช่น 16.30 น."],
    ["ONLINE_COURT_FALLBACK_STATUS", "OFF", "ถ้าข้อความไม่ตรงรูปแบบ ให้ตอบติดต่อเจ้าหน้าที่หรือไม่"],
    ["ONLINE_COURT_COOLDOWN_MINUTES", "3", "เวลาหน่วงการตอบซ้ำต่อผู้ใช้/ประเภทคำตอบ"],
    ["ONLINE_COURT_TRIGGER_KEYWORDS", "ทนาย,โจทก์,จำเลย,คดี,นัดวันนี้,ออนไลน์,เข้าร่วม,รอเข้า,ขอเข้า,เข้าไม่ได้,บัลลังก์,บ1,บ2,บ3,บ4,บ5,บ6,บ7,บ8,คำสาบาน,สาบานตน,ศูนย์ประสานงานคดี,การเข้าใช้งาน,เตรียมความพร้อม,พิจารณาคดีออนไลน์,ห้องพิจารณาคดีอิเล็กทรอนิกส์,โน้ต,โน๊ต", "คำเปิดให้บอทพิจารณาตอบ"],
    ["ONLINE_COURT_JOIN_KEYWORDS", "ทนาย,โจทก์,จำเลย,คดี,นัดวันนี้,ออนไลน์,เข้าร่วม,รอเข้า,ขอเข้า,ขออนุญาต,ศูนย์ประสานงานคดี", "คำกลุ่มเข้าออนไลน์/แจ้งตัว"],
    ["ONLINE_COURT_PROBLEM_KEYWORDS", "เข้าไม่ได้,ใช้งานไม่ได้,เข้าไม่ติด,ลิงก์ไม่ได้,เสียงไม่ได้,ไม่ได้ยิน,กล้องไม่ได้,ไมค์ไม่ได้,ไมโครโฟนไม่ได้,หลุด", "คำกลุ่มเข้าไม่ได้"],
    ["ONLINE_COURT_OATH_KEYWORDS", "คำสาบาน,สาบานตน,สาบาน,การเข้าใช้งาน,เตรียมความพร้อม,พิจารณาคดีออนไลน์,เข้าร่วมพิจารณาคดี,ห้องพิจารณาคดีอิเล็กทรอนิกส์,โน้ต,โน๊ต,โนต", "คำกลุ่มคำสาบาน/การใช้งานออนไลน์"],
    ["ONLINE_COURT_CONTACT_KEYWORDS", "ติดต่อเจ้าหน้าที่,หาเจ้าหน้าที่,เจ้าหน้าที่ช่วย,โทร,เบอร์,ไกล่เกลี่ย", "คำกลุ่มติดต่อเจ้าหน้าที่"],
    ["ONLINE_COURT_JOIN_REPLY", "รับทราบครับ/ค่ะ ท่านแจ้งเข้าร่วมพิจารณาคดีออนไลน์แล้ว\nกรุณารอเจ้าหน้าที่ตรวจสอบชื่อ เลขคดี และลำดับนัด จากนั้นเจ้าหน้าที่จะเชิญเข้าห้องพิจารณาคดีตามลำดับ\nระหว่างรอ กรุณาตั้งชื่อแสดงผลให้ตรวจสอบได้ เช่น ชื่อ-สกุล/ฝ่าย/เลขคดี และเปิดการแจ้งเตือนของ LINE ไว้", "ข้อความตอบเมื่อแจ้งเข้าออนไลน์/นัดวันนี้"],
    ["ONLINE_COURT_PROBLEM_REPLY", "กรณีเข้าออนไลน์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต กล้อง ไมโครโฟน ชื่อแสดงผล และลองออกเข้าใหม่อีกครั้ง\nหากได้รับแจ้งบัลลังก์ เช่น บ1-บ8 ให้รอในศูนย์ประสานงานคดี เจ้าหน้าที่จะตรวจสอบและเชิญเข้าห้องตามลำดับ", "ข้อความตอบเมื่อเข้าออนไลน์ไม่ได้"],
    ["ONLINE_COURT_OATH_REPLY", "📌 การเข้าใช้งานห้องพิจารณาคดีอิเล็กทรอนิกส์\n1. กรุณาอ่านโน้ตสำคัญในกลุ่มนี้ก่อนเข้าร่วม\n2. เตรียมบัตรประชาชน/เอกสารที่เกี่ยวข้อง และตั้งชื่อแสดงผลให้ตรวจสอบได้\n3. อยู่ในที่สงบ แต่งกายสุภาพ เปิดกล้อง/ไมโครโฟนเมื่อศาลหรือเจ้าหน้าที่แจ้ง\n4. กรณีสาบานตน ให้กล่าวตามถ้อยคำที่ศาลหรือเจ้าหน้าที่แจ้งในห้องพิจารณา\n5. ระหว่างรอ กรุณาอย่าออกจากกลุ่มหรือปิดการแจ้งเตือน", "ข้อความตอบเรื่องคำสาบาน/การใช้งานออนไลน์"],
    ["ONLINE_COURT_CONTACT_REPLY", "หากดำเนินการตามคำแนะนำแล้วยังไม่สามารถเข้าร่วมได้ กรุณาแจ้งชื่อ-สกุล เลขคดี เบอร์ติดต่อ และบัลลังก์/เวลานัดที่ได้รับแจ้ง เพื่อให้เจ้าหน้าที่ศูนย์ประสานงานคดีตรวจสอบเป็นลำดับสุดท้าย", "ข้อความตอบให้ติดต่อเจ้าหน้าที่"],
    ["ONLINE_COURT_FALLBACK_REPLY", "กรุณาติดต่อเจ้าหน้าที่ศูนย์ประสานงานคดี หรือแจ้งชื่อ-สกุล เลขคดี และช่องทางออนไลน์ที่ได้รับแจ้ง", "ข้อความ fallback เมื่อเปิดให้ตอบข้อความไม่ตรงรูปแบบ"],
    ["ONLINE_COURT_TOPIC_1_TITLE", "การเข้าใช้งาน", "ชื่อหัวข้อเมนู 1"],
    ["ONLINE_COURT_TOPIC_1_REPLY", "กรุณาตรวจสอบลิงก์ห้องพิจารณาคดีออนไลน์ อินเทอร์เน็ต กล้อง ไมโครโฟน และตั้งชื่อแสดงผลให้ตรวจสอบได้ เช่น ชื่อ-สกุล/ฝ่าย/เลขคดี จากนั้นรอเจ้าหน้าที่เชิญเข้าห้องตามลำดับ", "ข้อความหัวข้อเมนู 1"],
    ["ONLINE_COURT_TOPIC_2_TITLE", "ข้อปฏิบัติการใช้งานออนไลน์", "ชื่อหัวข้อเมนู 2"],
    ["ONLINE_COURT_TOPIC_2_REPLY", "กรุณาอยู่ในสถานที่สงบ แต่งกายสุภาพ เตรียมบัตรประชาชนหรือเอกสารที่เกี่ยวข้อง เปิดกล้องเมื่อศาลหรือเจ้าหน้าที่แจ้ง และปิดไมโครโฟนไว้ก่อนจนกว่าจะได้รับอนุญาตให้พูด", "ข้อความหัวข้อเมนู 2"],
    ["ONLINE_COURT_TOPIC_3_TITLE", "ตัวอย่างคำสาบานตน", "ชื่อหัวข้อเมนู 3"],
    ["ONLINE_COURT_TOPIC_3_REPLY", "กรณีต้องสาบานตน ให้กล่าวตามถ้อยคำที่ศาลหรือเจ้าหน้าที่แจ้งในห้องพิจารณา และปฏิบัติตามคำแนะนำของศาลอย่างเคร่งครัด", "ข้อความหัวข้อเมนู 3"],
    ["ONLINE_COURT_TOPIC_4_TITLE", "ปัญหาในการใช้งานและการแก้ไขเบื้องต้น", "ชื่อหัวข้อเมนู 4"],
    ["ONLINE_COURT_TOPIC_4_REPLY", "หากเข้าไม่ได้ เสียงไม่ได้ยิน หรือกล้อง/ไมโครโฟนมีปัญหา กรุณาตรวจสอบอินเทอร์เน็ต ออกจากห้องแล้วเข้าใหม่ และแจ้งอาการพร้อมชื่อ-สกุล เลขคดี บัลลังก์ หรือเวลานัดที่ได้รับแจ้ง", "ข้อความหัวข้อเมนู 4"],
    ["ONLINE_COURT_TOPIC_5_TITLE", "ติดต่อเจ้าหน้าที่", "ชื่อหัวข้อเมนู 5"],
    ["ONLINE_COURT_TOPIC_5_REPLY", "หากยังไม่สามารถดำเนินการได้ กรุณาแจ้งชื่อ-สกุล เลขคดี เบอร์ติดต่อ บัลลังก์ และเวลานัด เพื่อให้เจ้าหน้าที่ศูนย์ประสานงานคดีตรวจสอบต่อไป", "ข้อความหัวข้อเมนู 5"],
  ];
  defaultConfigs.forEach(([key, value, desc]) => {
    if (!keys.includes(key)) configSheet.appendRow([key, value, desc]);
  });
}

// ──────────────────────────────────────────────────────────────
// getConfig / setConfig — มี Performance.gs override (ไม่ต้องแก้)
// ──────────────────────────────────────────────────────────────
function previewSettingsSheetFormatRepair() {
  return _repairSettingsSheetFormat_({ dryRun: true });
}

function normalizeSettingsSheetFormat() {
  return _repairSettingsSheetFormat_({ dryRun: false });
}

function repairSettingsSheetFormat() {
  return normalizeSettingsSheetFormat();
}

function _repairSettingsSheetFormat_(options) {
  const dryRun = options && options.dryRun === true;
  const result = {
    success: false,
    dryRun: dryRun,
    sheetName: SHEETS.CONFIG,
    rowsBefore: 0,
    rowsAfter: 0,
    normalizedKeys: 0,
    hiddenCharsFixed: 0,
    duplicateRowsRemoved: 0,
    blankRowsRemoved: 0,
    aliasesMerged: [],
    duplicateKeys: [],
    syncedKeys: [],
    error: ""
  };

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEETS.CONFIG);
    if (!sheet) {
      if (dryRun) {
        result.error = "CONFIG sheet not found";
        return result;
      }
      sheet = ss.insertSheet(SHEETS.CONFIG);
      sheet.appendRow(["KEY", "VALUE", "DESCRIPTION"]);
    }

    if (!dryRun) {
      if (sheet.getMaxColumns() < 3) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), 3 - sheet.getMaxColumns());
      }
      initializeConfig(ss);
    }

    const data = sheet.getDataRange().getValues();
    result.rowsBefore = Math.max(0, data.length - 1);

    const aliases = {
      VIP_PWD: "VIP_SECRET_CODE",
      VIP_PASSWORD: "VIP_SECRET_CODE",
      VIP_CODE: "VIP_SECRET_CODE",
      COURT_SPREADSHEET_ID: "COURT_SHEET_ID",
      COURT_DB_ID: "COURT_SHEET_ID",
      COURT_TAB_NAME: "COURT_SHEET_NAME",
      LOCATION_SAVE_MSG_TEXT: "LOC_SAVE_MSG_TEXT",
      LOCATION_SAVE_MSG_STATUS: "LOC_SAVE_MSG_STATUS",
      LOC_REPLY_MSG: "LOCATION_REPLY_MSG",
      SEARCH_NOT_FOUND_MSG: "SEARCH_NO_RESULT_MSG"
    };

    const rowsByKey = {};
    const orderedKeys = [];
    const duplicateKeyMap = {};

    for (let i = 1; i < data.length; i++) {
      const rawKey = data[i][0];
      const rawValue = data[i][1];
      const rawDesc = data[i][2];
      const normalizedRawKey = normalizeConfigKey_(rawKey);
      const key = aliases[normalizedRawKey] || normalizedRawKey;

      if (!key) {
        if (_configCellHasValue_(rawKey) || _configCellHasValue_(rawValue) || _configCellHasValue_(rawDesc)) {
          result.blankRowsRemoved++;
        }
        continue;
      }

      if (String(rawKey || "") !== key) result.normalizedKeys++;
      if (aliases[normalizedRawKey]) {
        result.aliasesMerged.push({ row: i + 1, from: normalizedRawKey, to: key });
      }

      const value = _cleanConfigSheetCell_(rawValue);
      const desc = _cleanConfigSheetCell_(rawDesc);
      if (typeof rawValue === "string" && value !== rawValue) result.hiddenCharsFixed++;
      if (typeof rawDesc === "string" && desc !== rawDesc) result.hiddenCharsFixed++;

      const nextRow = { key: key, value: value, desc: desc };
      if (!rowsByKey[key]) {
        rowsByKey[key] = nextRow;
        orderedKeys.push(key);
        continue;
      }

      duplicateKeyMap[key] = true;
      result.duplicateRowsRemoved++;
      const current = rowsByKey[key];
      if (!_configCellHasValue_(current.value) && _configCellHasValue_(value)) current.value = value;
      if (!_configCellHasValue_(current.desc) && _configCellHasValue_(desc)) current.desc = desc;
    }

    _syncConfigPair_(rowsByKey, "LOC_SAVE_MSG_TEXT", "LOCATION_REPLY_MSG", result);
    _syncConfigPair_(rowsByKey, "SEARCH_NO_RESULT_MSG", "MSG_FALLBACK", result);

    result.duplicateKeys = Object.keys(duplicateKeyMap);
    const rows = orderedKeys.map(function(key) {
      const row = rowsByKey[key];
      return [row.key, row.value, row.desc];
    });

    if (!dryRun) {
      sheet.getRange(1, 1, 1, 3).setValues([["KEY", "VALUE", "DESCRIPTION"]]);
      sheet.getRange(1, 1, Math.max(1, sheet.getMaxRows()), 3).setNumberFormat("@");
      if (sheet.getMaxRows() > 1) {
        sheet.getRange(2, 1, sheet.getMaxRows() - 1, 3).clearContent();
      }
      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, 3).setValues(rows);
      }
      sheet.getRange(1, 1, 1, 3)
        .setFontWeight("bold")
        .setBackground("#1e3a8a")
        .setFontColor("#ffffff")
        .setHorizontalAlignment("center");
      sheet.setFrozenRows(1);
      SpreadsheetApp.flush();
      if (typeof _clearConfigCache === "function") _clearConfigCache();
      _clearCodeLocalCache_();
    }

    result.rowsAfter = rows.length;
    result.success = true;
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    result.error = e && e.message ? e.message : String(e);
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  }
}

function _cleanConfigSheetCell_(value) {
  if (typeof value !== "string") return value;
  return normalizeOnOffConfigValue_(sanitizeConfigValue_(value));
}

function _configCellHasValue_(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function _syncConfigPair_(rowsByKey, preferredKey, fallbackKey, result) {
  if (!rowsByKey[preferredKey] || !rowsByKey[fallbackKey]) return;
  const preferred = rowsByKey[preferredKey];
  const fallback = rowsByKey[fallbackKey];
  if (!_configCellHasValue_(preferred.value) && _configCellHasValue_(fallback.value)) {
    preferred.value = fallback.value;
    result.syncedKeys.push(preferredKey + "<-" + fallbackKey);
  }
  if (!_configCellHasValue_(fallback.value) && _configCellHasValue_(preferred.value)) {
    fallback.value = preferred.value;
    result.syncedKeys.push(fallbackKey + "<-" + preferredKey);
  }
}

function sanitizeConfigValue_(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");
}

function normalizeOnOffConfigValue_(value) {
  if (typeof value !== "string") return value;
  const cleanValue = sanitizeConfigValue_(value);
  const text = cleanValue.trim().toLowerCase();
  if (["เปิด", "เปิดใช้งาน", "on", "enable", "enabled", "true"].includes(text)) return "ON";
  if (["ปิด", "ปิดใช้งาน", "off", "disable", "disabled", "false"].includes(text)) return "OFF";
  return cleanValue;
}

function normalizeConfigKey_(key) {
  return String(key || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().toUpperCase();
}

var _CODE_CONFIG_CACHE = null;
var _CODE_CONFIG_CACHE_TIME = 0;
var _CODE_USER_LOOKUP_CACHE = {};
const _CODE_CONFIG_CACHE_TTL = 60000;
const _CODE_USER_CACHE_TTL = 300000;

function _clearCodeLocalCache_() {
  _CODE_CONFIG_CACHE = null;
  _CODE_CONFIG_CACHE_TIME = 0;
  _CODE_USER_LOOKUP_CACHE = {};
}

function getConfig(key) {
  const targetKey = normalizeConfigKey_(key);
  const now = Date.now();
  if (!_CODE_CONFIG_CACHE || (now - _CODE_CONFIG_CACHE_TIME) > _CODE_CONFIG_CACHE_TTL) {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.CONFIG);
    const data = sheet ? sheet.getDataRange().getValues() : [];
    const cache = {};
    for (let i = 1; i < data.length; i++) {
      const keyName = normalizeConfigKey_(data[i][0]);
      if (!keyName) continue;
      const value = normalizeOnOffConfigValue_(data[i][1]);
      if (!Object.prototype.hasOwnProperty.call(cache, keyName) || String(value || "") !== "") {
        cache[keyName] = value;
      }
    }
    _CODE_CONFIG_CACHE = cache;
    _CODE_CONFIG_CACHE_TIME = now;
  }
  const value = _CODE_CONFIG_CACHE && Object.prototype.hasOwnProperty.call(_CODE_CONFIG_CACHE, targetKey)
    ? _CODE_CONFIG_CACHE[targetKey]
    : null;
  return value === "" || value === undefined ? null : value;
}

function setConfig(key, value) {
  const targetKey = normalizeConfigKey_(key);
  const nextValue = normalizeOnOffConfigValue_(sanitizeConfigValue_(value));
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.CONFIG);
  const data = sheet.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < data.length; i++) {
    if (normalizeConfigKey_(data[i][0]) === targetKey) {
      sheet.getRange(i + 1, 1).setValue(targetKey);
      sheet.getRange(i + 1, 2).setValue(nextValue);
      found = true;
    }
  }
  if (found) {
    if (typeof _clearConfigCache === "function") _clearConfigCache();
    _clearCodeLocalCache_();
    return true;
  }
  sheet.appendRow([targetKey, nextValue, ""]);
  if (typeof _clearConfigCache === "function") _clearConfigCache();
  _clearCodeLocalCache_();
  return true;
}

function clearPoliteSuffix() {
  setConfig("POLITE_SUFFIX", "");
  if (typeof _clearConfigCache === "function") _clearConfigCache();
  return { success: true, key: "POLITE_SUFFIX", value: "", message: "POLITE_SUFFIX cleared" };
}

function cleanPoliteSuffix() {
  const current = String(getConfig("POLITE_SUFFIX") || "");
  const cleaned = sanitizeConfigValue_(current).trim();
  setConfig("POLITE_SUFFIX", cleaned);
  if (typeof _clearConfigCache === "function") _clearConfigCache();
  return {
    success: true,
    key: "POLITE_SUFFIX",
    beforeLength: current.length,
    afterLength: cleaned.length,
    value: cleaned
  };
}

function checkConfigHiddenChars() {
  return scanConfigHiddenChars_(false);
}

function cleanConfigHiddenChars() {
  return scanConfigHiddenChars_(true);
}

function clearConfigFields(keys) {
  const list = Array.isArray(keys)
    ? keys
    : String(keys || "").split(/[\n,]/);
  const cleanedKeys = list
    .map(function(key) { return normalizeConfigKey_(key); })
    .filter(Boolean);

  if (!cleanedKeys.length) {
    return { success: false, error: "No config keys provided" };
  }

  cleanedKeys.forEach(function(key) {
    setConfig(key, "");
  });
  if (typeof _clearConfigCache === "function") _clearConfigCache();
  return { success: true, cleared: cleanedKeys.length, keys: cleanedKeys };
}

function scanConfigHiddenChars_(applyFix) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.CONFIG);
  if (!sheet) return { success: false, error: "CONFIG sheet not found" };

  const data = sheet.getDataRange().getValues();
  const issues = [];
  for (let i = 1; i < data.length; i++) {
    const key = normalizeConfigKey_(data[i][0]);
    const value = data[i][1];
    if (!key || typeof value !== "string") continue;

    const cleaned = sanitizeConfigValue_(value);
    if (cleaned !== value) {
      const hiddenCodes = describeHiddenChars_(value);
      issues.push({
        row: i + 1,
        key: key,
        beforeLength: value.length,
        afterLength: cleaned.length,
        removed: value.length - cleaned.length,
        hiddenCodes: hiddenCodes
      });
      if (applyFix) sheet.getRange(i + 1, 2).setValue(cleaned);
    }
  }

  if (applyFix && typeof _clearConfigCache === "function") _clearConfigCache();
  return {
    success: true,
    mode: applyFix ? "clean" : "check",
    found: issues.length,
    fixed: applyFix ? issues.length : 0,
    issues: issues
  };
}

function describeHiddenChars_(text) {
  const found = {};
  String(text || "").split("").forEach(function(ch) {
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/.test(ch)) {
      const code = ch.charCodeAt(0).toString(16).toUpperCase();
      found["U+" + ("0000" + code).slice(-4)] = true;
    }
  });
  return Object.keys(found);
}

function getAdminIds() { const raw = getConfig("ADMIN_LINE_IDS") || ""; return raw ? raw.split(",").map(s => s.trim()).filter(Boolean) : []; }
function isAdmin(userId) { return getAdminIds().includes(userId); }

function getLineUserProfile(userId) {
  const url = "https://api.line.me/v2/bot/profile/" + userId;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, { method: "get", headers: getLineAuthHeaders_(), muteHttpExceptions: true });
      if (response.getResponseCode() === 200) { return JSON.parse(response.getContentText()).displayName; }
      if (attempt < 2 && response.getResponseCode() >= 500) Utilities.sleep(500);
    } catch (e) {
      if (attempt < 2) Utilities.sleep(500);
    }
  }
  return null;
}

// 🆕 v10.1: getUserByLineId — มี Performance.gs override (ไม่ต้องแก้)
function getUserByLineId(lineUserId) {
  if (!lineUserId) return null;
  const now = Date.now();
  const cached = _CODE_USER_LOOKUP_CACHE[lineUserId];
  if (cached && (now - cached.time) < _CODE_USER_CACHE_TTL) return cached.user;

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.MEMBERS);
  const lr = sheet.getLastRow();
  if (lr < 2) return null;
  const data = sheet.getRange(2, 1, lr - 1, 7).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][1] === lineUserId) {
      let rawRole = String(data[i][4] || "User").trim();
      if (rawRole.toUpperCase() === "VIP") rawRole = "VIP";
      else if (rawRole.toLowerCase() === "user") rawRole = "User";
      const user = {
        id: data[i][0],
        name: data[i][2],
        role: rawRole,
        status: String(data[i][5] || "Active").trim(),
        state: String(data[i][6] || "").trim(),
        rowIndex: i + 2
      };
      _CODE_USER_LOOKUP_CACHE[lineUserId] = { user: user, time: now };
      return user;
    }
  }
  return null;
}

// ==========================================
// 2. WEBHOOK & BOT REPLY (UPDATED v10.3 + SearchPatch v3)
// ==========================================
function legacyDoPost_(e) {
  try {
    const contents = JSON.parse(e.postData.contents);
    const event = contents.events[0];
    if (!event) return HtmlService.createHtmlOutput("OK");
    if (_shouldSkipDuplicateLineEvent_(event)) return HtmlService.createHtmlOutput("OK");

    const replyToken = event.replyToken;
    const userId = event.source.userId;
    const isGroup = event.source.type === "group" || event.source.type === "room";
    const groupId = isGroup ? (event.source.groupId || event.source.roomId) : "";

    if (isGroup && event.type === "message" && event.message && event.message.type === "text") {
      const isPersonalArchiveLink = typeof shouldHandlePersonalArchiveGroupText_ === "function" &&
        shouldHandlePersonalArchiveGroupText_(event.message.text, groupId);
      if (!_shouldHandleGroupText_(event.message.text, groupId) && !isPersonalArchiveLink) {
        return HtmlService.createHtmlOutput("OK");
      }
    }

    let sheetMembers = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.MEMBERS);
    let user = getUserByLineId(userId);

    if (!user) {
      user = _withScriptLock_(5000, function() {
        const existing = getUserByLineId(userId);
        if (existing) return existing;
        const newId = sheetMembers.getLastRow();
        const realName = getLineUserProfile(userId) || ("User_" + newId);
        sheetMembers.appendRow([newId, userId, realName, "", "User", "Active", "", Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd")]);
        const created = { id: newId, name: realName, role: "User", status: "Active", state: "", rowIndex: sheetMembers.getLastRow() };
        if (typeof _clearUserCache === "function") _clearUserCache(userId);
        if (typeof _clearCodeLocalCache_ === "function") _clearCodeLocalCache_();
        return created;
      });
    }

    if (user.status === "Blocked") return HtmlService.createHtmlOutput("OK");

    const sourceId = isGroup ? groupId : userId;

    if (event.type === "follow" && typeof _handleOnlineCourtFollow_ === "function" &&
        _handleOnlineCourtFollow_(userId, user.name, replyToken)) {
      return HtmlService.createHtmlOutput("OK");
    }

    // 📍 Location
    if (event.type === "message" && event.message.type === "location") {
      if (!_isLocationAllowed(userId, user.role, sourceId, isGroup)) {
        return HtmlService.createHtmlOutput("OK");
      }
      const address = event.message.address;

      // v10.2: Pikad Session Integration
      const locResult = _saveOrUpdateLocationDataCompat_(userId, event.message.latitude, event.message.longitude, address, groupId);

      if (isGroup && _isMissionGroup(groupId)) {
        if (!locResult || !locResult.duplicate) {
          _sendMissionPikadReply_(replyToken, "coord", locResult && locResult.rowIndex);
        }
      } else if (typeof sendPikadSessionReply === "function" &&
                 locResult && locResult.rowIndex > 0 &&
                 !locResult.duplicate) {
        sendPikadSessionReply(replyToken, "coord", locResult.rowIndex);
      } else if (getConfig("LOC_SAVE_MSG_STATUS") === "ON" &&
                 (!locResult || !locResult.duplicate)) {
        // 🔧 v3: ใช้ safeSendReply
        safeSendReply(replyToken, getConfig("LOC_SAVE_MSG_TEXT") || "📌 บันทึกข้อมูลแล้ว");
      }

      logActivity(userId, user.name, "ส่งพิกัด/หมาย", "Location", "Success", 0);
      return HtmlService.createHtmlOutput("OK");
    }

    // 📸 Photo
    if (event.type === "message" && event.message.type === "image") {
      // 📁 ระบบบันทึกส่วนตัว: แยกการเก็บรูปและโฟลเดอร์จากงานหมายโดยสิ้นเชิง
      if (typeof capturePersonalArchiveImage_ === "function") {
        const personalArchiveResult = capturePersonalArchiveImage_(event.message.id, {
          sourceId: sourceId,
          isGroup: isGroup,
          userId: userId,
          userName: user.name,
          messageId: event.message.id
        });
        if (personalArchiveResult && personalArchiveResult.handled) {
          if (typeof sendPersonalArchiveCaptureReply_ === "function") {
            sendPersonalArchiveCaptureReply_(replyToken, personalArchiveResult);
          }
          logActivity(userId, user.name, personalArchiveResult.ok ? "บันทึกรูปส่วนตัว" : "บันทึกรูปส่วนตัวไม่สำเร็จ", "PersonalArchive", personalArchiveResult.ok ? "Success" : "Error", 0);
          return HtmlService.createHtmlOutput("OK");
        }
      }

      const missionPhotoAllowed = isGroup && typeof _isMissionGroup === "function" && _isMissionGroup(groupId);
      if (getConfig("PHOTO_SAVE_STATUS") === "ON"
          && (missionPhotoAllowed || _isPhotoAllowed(userId, user.role))
          && _isPhotoSourceAllowed(sourceId, isGroup)) {
        try {
          const msgId = event.message.id;
          const photoResult = _downloadAndSavePhoto(msgId, userId, user.name, groupId);
          if (photoResult.ok) {
            try {
              if (typeof linkPhotoToSession === "function") {
                const linkResult = linkPhotoToSession(userId, photoResult.url, photoResult.photoRowId, groupId);
                if (isGroup && _isMissionGroup(groupId)) {
                  _sendMissionPikadReply_(replyToken, "photo", linkResult && linkResult.rowIndex);
                } else if (typeof sendPikadSessionReply === "function" && linkResult && linkResult.rowIndex > 0) {
                  sendPikadSessionReply(replyToken, "photo", linkResult.rowIndex);
                } else {
                  safeSendReply(replyToken, (getConfig("PHOTO_REPLY_MSG") || "📸 บันทึกรูปสำเร็จ") + "\n📄 " + photoResult.fileName);
                }
              } else {
                safeSendReply(replyToken, (getConfig("PHOTO_REPLY_MSG") || "📸 บันทึกรูปสำเร็จ") + "\n📄 " + photoResult.fileName);
              }
            } catch (linkErr) {
              Logger.log("⚠️ linkPhotoToSession error: " + linkErr.message);
              safeSendReply(replyToken, (getConfig("PHOTO_REPLY_MSG") || "📸 บันทึกรูปสำเร็จ") + "\n📄 " + photoResult.fileName);
            }
          } else {
            safeSendReply(replyToken, "⚠️ บันทึกรูปไม่สำเร็จ: " + photoResult.message);
          }
          logActivity(userId, user.name, "ส่งรูปภาพ" + (photoResult.ok ? " ✅" : " ❌"), "Photo", photoResult.ok ? "Success" : "Error", 0);
        } catch (err) {
          Logger.log("Photo save error: " + err);
          safeSendReply(replyToken, "⚠️ เกิดข้อผิดพลาดในการบันทึกรูป");
        }
      }
      return HtmlService.createHtmlOutput("OK");
    }

    // 💬 Text message
    if (event.type === "message" && event.message.type === "text") {
      let messageText = event.message.text.trim();
      const isMissionGroup = isGroup && typeof _isMissionGroup === "function" && _isMissionGroup(groupId);
      let allowBareGroupSearch = false;

      // 📁 บันทึกเฉพาะข้อความที่มี URL จากแหล่งที่ Admin อนุญาต
      if (typeof capturePersonalArchiveLink_ === "function") {
        const personalArchiveResult = capturePersonalArchiveLink_(messageText, {
          sourceId: sourceId,
          isGroup: isGroup,
          userId: userId,
          userName: user.name,
          messageId: event.message.id
        });
        if (personalArchiveResult && personalArchiveResult.handled) {
          if (typeof sendPersonalArchiveCaptureReply_ === "function") {
            sendPersonalArchiveCaptureReply_(replyToken, personalArchiveResult);
          }
          logActivity(userId, user.name, personalArchiveResult.ok ? "บันทึกลิงก์ส่วนตัว" : "บันทึกลิงก์ส่วนตัวไม่สำเร็จ", "PersonalArchive", personalArchiveResult.ok ? "Success" : "Error", 0);
          return HtmlService.createHtmlOutput("OK");
        }
      }

      // (ระบบค้นหาใช้ SearchUnified.gs จัดการ — ดู block ด้านล่าง)

      // VIP registration
      if (user.state === "WAITING_NAME") {
        if (messageText === "/ยกเลิก") {
          sheetMembers.getRange(user.rowIndex, 7).setValue("");
          safeSendReply(replyToken, "ยกเลิกการลงทะเบียนแล้วครับ");
          return HtmlService.createHtmlOutput("OK");
        }
        sheetMembers.getRange(user.rowIndex, 3).setValue(messageText);
        sheetMembers.getRange(user.rowIndex, 5).setValue("VIP");
        sheetMembers.getRange(user.rowIndex, 7).setValue("");
        safeSendReply(replyToken, getConfig("VIP_SUCCESS_MSG"));
        logActivity(userId, messageText, "ลงทะเบียน VIP", "VIP_REG", "Success", 0);
        return HtmlService.createHtmlOutput("OK");
      }

      const secretCode = getConfig("VIP_SECRET_CODE");
      if (secretCode && messageText === secretCode && !isGroup) {
        sheetMembers.getRange(user.rowIndex, 7).setValue("WAITING_NAME");
        safeSendReply(replyToken, getConfig("VIP_PROMPT_MSG"));
        return HtmlService.createHtmlOutput("OK");
      }

      // /ไอดีกลุ่ม
      if (messageText === "/ไอดีกลุ่ม" || messageText === "บอท /ไอดีกลุ่ม" || messageText === "#บอท /ไอดีกลุ่ม") {
        let chatType = isGroup ? "กลุ่ม/ห้องแชท" : "แชทส่วนตัว";
        let cId = isGroup ? groupId : userId;
        safeSendReply(replyToken, "📌 ไอดี" + chatType + "นี้คือ:\n\n" + cId + "\n\n💡 (ก๊อปปี้ไปใส่ในเว็บเพื่อตั้งเป้าหมายแจ้งเตือนได้เลย)");
        return HtmlService.createHtmlOutput("OK");
      }

      // 📖 /help — แสดงคู่มือคำสั่ง (Flex Card)
      if (messageText === "/help" || messageText === "/ช่วยเหลือ" || messageText === "?" ||
          messageText === "บอท /help" || messageText === "บอท /ช่วยเหลือ" ||
          messageText === "#บอท /help" || messageText === "#บอท /ช่วยเหลือ") {
        sendHelpCard(replyToken, user.role, userId);
        logActivity(userId, user.name, "ขอคู่มือ", "Help", "Success", 0);
        return HtmlService.createHtmlOutput("OK");
      }

      // 🆕 v10.4: กรองกลุ่ม (รองรับ "บอท ค้นหา ...")
      // 🚀 v10.4.3: เพิ่ม Mission Group bypass สำหรับเลขบ้านอัตโนมัติ
      if (isGroup) {
        const trimmed = messageText.trim();
        const groupPrefix = (getConfig("SEARCH_GROUP_PREFIX") || "บอท").trim();
        const searchKeyword = (getConfig("SEARCH_KEYWORD") || "ค้นหา").trim();

        // "บอท ค้นหา ..." → ส่งต่อให้ SearchUnified ไม่ strip prefix
        const groupSearchPattern = new RegExp("^/?(#?" + _escapeRegexLocal_(groupPrefix) + ")\\s+/?" + _escapeRegexLocal_(searchKeyword) + "(\\s|$)", "i");
        const bareSearchPattern = new RegExp("^/?" + _escapeRegexLocal_(searchKeyword) + "(\\s|$)", "i");

        if (groupSearchPattern.test(trimmed)) {
          // ผ่าน — SearchUnified จะจัดการเอง
        }
        else if (isMissionGroup && bareSearchPattern.test(trimmed)) {
          allowBareGroupSearch = true;
        }
        else if (/^#บอท/i.test(trimmed)) {
          messageText = trimmed.substring(4).trim();
        }
        else if (/^บอท/i.test(trimmed)) {
          messageText = trimmed.substring(3).trim();
        }
        else if (/^(บัญชีนัดความ|บัญชีนัด|นัดความ|นัด)(\s|$)/.test(trimmed)) {
          // ผ่าน
        }
        else if (_isWhitelistedCommand(trimmed)) {
          // ผ่าน — Whitelist อ่านจาก Sheet GROUP_WHITELIST
        }
        else if (_isMissionGroup(groupId) &&
                 typeof _looksLikeMissionCoordinateText === "function" &&
                 _looksLikeMissionCoordinateText(trimmed)) {
          // ผ่าน — จะถูก process ที่ mission coordinate block
        }
        // 🚀 v10.4.3: Mission Group + เลขบ้าน → ผ่าน (ตกไปที่ mission house block)
        else if (_isMissionGroup(groupId) && _looksLikeMissionHouseNumber(trimmed)) {
          // ผ่าน — จะถูก process ที่ mission house block
        }
        else if (typeof _shouldHandleOnlineCourtText_ === "function" &&
                 _shouldHandleOnlineCourtText_(trimmed, groupId)) {
          // ผ่าน — โหมดศูนย์ประสานงานคดีออนไลน์จะจัดการเอง
        }
        else if (typeof _shouldHandleGeneralInfoText_ === "function" &&
                 _shouldHandleGeneralInfoText_(trimmed, groupId)) {
          // ผ่าน — เมนูข้อมูลทั่วไปจะจัดการเอง
        }
        else {
          return HtmlService.createHtmlOutput("OK");
        }
      }

      if (isMissionGroup) {
        if (typeof _looksLikeMissionCoordinateText === "function" &&
            _looksLikeMissionCoordinateText(messageText) &&
            _handleMissionCoordinateText_(messageText, userId, user.name, groupId, replyToken)) {
          return HtmlService.createHtmlOutput("OK");
        }
        if (typeof _looksLikeMissionHouseNumber === "function" &&
            _looksLikeMissionHouseNumber(messageText) &&
            _handleMissionHouseText_(messageText, userId, user.name, groupId, replyToken)) {
          return HtmlService.createHtmlOutput("OK");
        }
      }

      // 📁 ค้นข้อมูลส่วนตัว: "ค้นหา ส่วนตัวกรกฎาคม" (กลุ่มใช้ "บอท ค้นหา ...")
      if (typeof routePersonalArchiveSearch_ === "function") {
        const personalSearchResult = routePersonalArchiveSearch_(messageText, user, userId, sourceId, isGroup, replyToken);
        if (personalSearchResult && personalSearchResult.handled) {
          return HtmlService.createHtmlOutput("OK");
        }
      }

      if (typeof _handleOnlineCourtMessage_ === "function" &&
          _handleOnlineCourtMessage_(messageText, userId, user.name, groupId, replyToken, isGroup)) {
        return HtmlService.createHtmlOutput("OK");
      }

      // 📚 General Info — เมนูข้อมูลทั่วไปแบบการ์ด
      if (typeof _handleGeneralInfoMessage_ === "function" &&
          _handleGeneralInfoMessage_(messageText, userId, user.name, groupId, replyToken, isGroup)) {
        return HtmlService.createHtmlOutput("OK");
      }

      // ════════════════════════════════════════════════════════════
      // 🆕 v10.4: Unified Search — "ค้นหา" คำเดียว ทำได้ทุกอย่าง
      // ════════════════════════════════════════════════════════════
      if (typeof routeSearchCommandV2 === "function") {
        const searchResult = routeSearchCommandV2(
          messageText, user, userId, isGroup, sourceId, replyToken,
          { allowBareGroupSearch: allowBareGroupSearch }
        );
        if (searchResult && searchResult.handled) {
          return HtmlService.createHtmlOutput("OK");
        }
      }

      // ⚖️ Quick shortcut บัญชีนัดความ
      const quickShortcut = _matchQuickDateShortcut(messageText);
      if (quickShortcut) {
        Logger.log("⚖️ Court quick: user=" + userId + " role=" + user.role + " isAdmin=" + isAdmin(userId) + " date=" + quickShortcut);
        const result = _searchCourtSchedule(quickShortcut, user.role, userId);
        if (result) {
          _sendCourtReply(replyToken, result);
          logActivity(userId, user.name, "ค้นบัญชีนัดความลัด: " + messageText, "Court", "Success", 0);
          return HtmlService.createHtmlOutput("OK");
        }
      }

      // ⚖️ บัญชีนัดความ
      const courtMatch = messageText.match(/^(บัญชีนัดความ|บัญชีนัด|นัดความ|นัด)\s*(.+)$/);
      if (courtMatch) {
        const dateStr = courtMatch[2].trim();
        Logger.log("⚖️ Court full: user=" + userId + " role=" + user.role + " isAdmin=" + isAdmin(userId) + " date=" + dateStr);
        const result = _searchCourtSchedule(dateStr, user.role, userId);
        if (result) {
          _sendCourtReply(replyToken, result);
          logActivity(userId, user.name, "ค้นบัญชีนัดความ: " + dateStr, "Court", "Success", 0);
          return HtmlService.createHtmlOutput("OK");
        }
      }

      // Admin commands
      if (isAdmin(userId)) {
        const adminReply = handleAdminCommand(messageText, userId, replyToken);
        if (adminReply === "__HANDLED__") return HtmlService.createHtmlOutput("OK");
      }

      const startTime = new Date().getTime();
      if (getConfig("BOT_STATUS") === "OFF") {
        safeSendReply(replyToken, getConfig("MSG_FALLBACK")); return HtmlService.createHtmlOutput("OK");
      }

      // Knowledge base
      const kbResult = _isPikadOnlyGroup_(groupId) ? null : searchKnowledgeBase(messageText, user.role, userId);
      if (kbResult) {
        const responseTime = new Date().getTime() - startTime;
        if (kbResult && typeof kbResult === "object" && kbResult.type === "flex") {
          sendUniversalReply(replyToken, kbResult);
        } else {
          safeSendReply(replyToken, formatPoliteResponse(kbResult));
        }
        logActivity(userId, user.name, messageText, "KB Search", "Success", responseTime);
        updateDailyStats(1, 1, responseTime);
        return HtmlService.createHtmlOutput("OK");
      }

      // 🏠 House number detection
      const houseNoRegex = /^[\d\s\/\-\.]+$/;
      const hasHouseKeyword = messageText.includes("บ้านเลขที่") || messageText.includes("เลขที่บ้าน");
      const hasMooKeyword = /^หมู่\s*\d/.test(messageText);
      const isShortNumber = houseNoRegex.test(messageText.trim()) && messageText.trim().length <= 20;
      const isHouseWithMoo = /^\d[\d\/\-\.]*\s*(หมู่|ม\.)\s*\d/.test(messageText.trim());
      const isHouseNoPattern = isShortNumber || hasHouseKeyword || hasMooKeyword || isHouseWithMoo;

      if (isHouseNoPattern || isWaitingForHouseNumber(userId)) {
        let cleanHouseNum;
        let extractedAddress = "";

        // 🚀 v10.4.3: ใน Mission Group → normalize ทุกรูปแบบ
        if (isGroup && _isMissionGroup(groupId)) {
          const norm = _normalizeMissionAddress(messageText);
          cleanHouseNum = norm.houseNum;
          extractedAddress = norm.address;
        } else {
          // เดิม: แค่ตัด keyword
          cleanHouseNum = messageText.replace(/บ้านเลขที่/g, "").replace(/เลขที่บ้าน/g, "").trim();
        }

        // ════════════════════════════════════════════════════════════
        // 🆕 v3 EDIT 3: Validate ก่อนบันทึก
        // ════════════════════════════════════════════════════════════
        if (!_isValidHouseNumber(cleanHouseNum)) {
          Logger.log("⚠️ Reject invalid house number: " + cleanHouseNum);
          // ไม่ตอบและไม่บันทึก — ป้องกัน dirty data
          return HtmlService.createHtmlOutput("OK");
        }

        // v10.2: Pikad Session Integration
        const houseResult = _saveOrUpdateHouseNumberCompat_(userId, cleanHouseNum, groupId);

        // 🚀 v10.4.3: บันทึกที่อยู่ใน column G ถ้ามี (Mission Group)
        if (extractedAddress && houseResult && houseResult.rowIndex > 0) {
          try {
            SpreadsheetApp.openById(SPREADSHEET_ID)
              .getSheetByName(SHEETS.LOCATION)
              .getRange(houseResult.rowIndex, 7)  // col G = ที่อยู่
              .setValue(extractedAddress);
          } catch(addrErr) {
            Logger.log("⚠️ Save address error: " + addrErr.message);
          }
        }

        // 🚀 v10.4.3: Reply mode สำหรับ Mission Group
        if (isGroup && _isMissionGroup(groupId)) {
          if (!houseResult || !houseResult.duplicate) {
            _sendMissionPikadReply_(replyToken, "house", houseResult && houseResult.rowIndex);
          }
        } else {
          // เดิม: แชทส่วนตัว / กลุ่มอื่น
          if (typeof sendPikadSessionReply === "function" &&
              houseResult && houseResult.rowIndex > 0 &&
              !houseResult.duplicate) {
            sendPikadSessionReply(replyToken, "house", houseResult.rowIndex);
          } else if (getConfig("LOC_SAVE_MSG_STATUS") === "ON" &&
                     (!houseResult || !houseResult.duplicate)) {
            safeSendReply(replyToken, getConfig("LOC_SAVE_MSG_TEXT") || "📌 บันทึกข้อมูลแล้ว");
          }
        }

        // 🔧 v3: Force update stats
        if (typeof updateDailyStats === "function") {
          updateDailyStats(0, 0, 1);  // saves++
        }

        logActivity(userId, user.name, "ส่งข้อมูล: " + cleanHouseNum, "Location", "Success", 0);
        return HtmlService.createHtmlOutput("OK");
      }

      // Smart search
      if (getConfig("SEARCH_STATUS") === "ON" && !_isPikadOnlyGroup_(groupId)) {
        const searchResult = _smartSearchAllDbs(messageText, user.role, userId);
        if (searchResult) {
          sendUniversalReply(replyToken, searchResult);
          logActivity(userId, user.name, "ค้นหา: " + messageText, "SmartSearch", "Success", new Date().getTime() - startTime);
          return HtmlService.createHtmlOutput("OK");
        }
      }

      const responseTime = new Date().getTime() - startTime;
      safeSendReply(replyToken, formatPoliteResponse(getConfig("MSG_FALLBACK")));
      logActivity(userId, user.name, messageText, "Fallback", "Error", responseTime);
      updateDailyStats(1, 0, responseTime);
    }

    return HtmlService.createHtmlOutput("OK");
  } catch (error) {
    Logger.log("doPost error: " + error.message + "\n" + error.stack);
    return HtmlService.createHtmlOutput("ERROR");
  }
}

function _shouldHandleGroupText_(messageText, groupId) {
  const trimmed = String(messageText || "").trim();
  if (!trimmed) return false;

  const groupPrefix = (getConfig("SEARCH_GROUP_PREFIX") || "บอท").trim();
  const searchKeyword = (getConfig("SEARCH_KEYWORD") || "ค้นหา").trim();
  const groupSearchPattern = new RegExp(
    "^/?(#?" + _escapeRegexLocal_(groupPrefix) + ")\\s+/?" + _escapeRegexLocal_(searchKeyword) + "(\\s|$)",
    "i"
  );

  if (groupSearchPattern.test(trimmed)) return true;
  if (typeof _isMissionGroup === "function" && _isMissionGroup(groupId) && _isBareSearchCommand_(trimmed)) return true;
  if (/^#บอท/i.test(trimmed)) return true;
  if (/^บอท/i.test(trimmed)) return true;
  if (/^(บัญชีนัดความ|บัญชีนัด|นัดความ|นัด)(\s|$)/.test(trimmed)) return true;
  if (typeof _isWhitelistedCommand === "function" && _isWhitelistedCommand(trimmed)) return true;
  if (typeof _isMissionGroup === "function" &&
      typeof _looksLikeMissionCoordinateText === "function" &&
      _isMissionGroup(groupId) &&
      _looksLikeMissionCoordinateText(trimmed)) return true;
  if (typeof _isMissionGroup === "function" && typeof _looksLikeMissionHouseNumber === "function") {
    if (_isMissionGroup(groupId) && _looksLikeMissionHouseNumber(trimmed)) return true;
  }
  if (typeof _shouldHandleOnlineCourtText_ === "function" &&
      _shouldHandleOnlineCourtText_(trimmed, groupId)) return true;
  return false;
}

// ════════════════════════════════════════════════════════════════════
// OnlineCourt logic is separated in OnlineCourt.gs. Code.gs keeps only guarded delegation points.

function _shouldSkipDuplicateLineEvent_(event) {
  try {
    const eventId = String(
      event.webhookEventId ||
      (event.message && event.message.id) ||
      ""
    ).trim();
    if (!eventId) return false;

    const cache = CacheService.getScriptCache();
    const key = "LINE_EVENT_SEEN_" + eventId;
    if (cache.get(key)) {
      Logger.log("Skip duplicate LINE event: " + eventId);
      return true;
    }
    cache.put(key, "1", 600);
  } catch (e) {
    Logger.log("_shouldSkipDuplicateLineEvent_ error: " + e.message);
  }
  return false;
}

function _isBareSearchCommand_(messageText) {
  const keyword = (getConfig("SEARCH_KEYWORD") || "ค้นหา").trim();
  const pattern = new RegExp("^/?" + _escapeRegexLocal_(keyword) + "(\\s|$)", "i");
  return pattern.test(String(messageText || "").trim());
}

function _sendMissionPikadReply_(replyToken, eventType, rowIndex) {
  if (!replyToken || !rowIndex || rowIndex <= 0) {
    Logger.log("_sendMissionPikadReply_ skipped: missing replyToken/rowIndex eventType=" + eventType + " rowIndex=" + rowIndex);
    return null;
  }

  const mode = String(getConfig("MISSION_REPLY_MODE") || "session").trim().toLowerCase();
  const useFlex = String(getConfig("PIKAD_USE_FLEX") || "ON").trim().toUpperCase();
  Logger.log("_sendMissionPikadReply_: mode=" + mode + " useFlex=" + useFlex + " eventType=" + eventType + " rowIndex=" + rowIndex);

  if (mode === "silent") {
    Logger.log("_sendMissionPikadReply_ skipped: MISSION_REPLY_MODE=silent");
    return { skipped: true, reason: "silent" };
  }

  if (mode === "all") {
    if (typeof sendPikadSessionReply === "function") {
      return sendPikadSessionReply(replyToken, eventType, rowIndex);
    }
    Logger.log("_sendMissionPikadReply_ fallback text: sendPikadSessionReply missing");
    if (getConfig("LOC_SAVE_MSG_STATUS") === "ON") {
      return safeSendReply(replyToken, getConfig("LOC_SAVE_MSG_TEXT") || getConfig("LOCATION_REPLY_MSG") || "บันทึกข้อมูลแล้ว");
    }
    return { skipped: true, reason: "missing_sendPikadSessionReply" };
  }

  // session mode: ลดข้อความซ้ำในกลุ่มส่งหมาย โดยตอบเป็นการ์ดเมื่อข้อมูลครบเท่านั้น
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
    if (sheet && typeof _getSessionStatus === "function") {
      const status = _getSessionStatus(sheet, rowIndex);
      if (status && status.complete && typeof sendPikadSessionReply === "function") {
        Logger.log("_sendMissionPikadReply_: session complete -> sendPikadSessionReply");
        return sendPikadSessionReply(replyToken, eventType, rowIndex);
      }
      Logger.log("_sendMissionPikadReply_: session waiting hasCoord=" + !!(status && status.hasCoord) +
        " hasPhoto=" + !!(status && status.hasPhoto) +
        " hasHouseNum=" + !!(status && status.hasHouseNum));
    }
  } catch (e) {
    Logger.log("_sendMissionPikadReply_ error: " + e.message);
  }
  if (getConfig("LOC_SAVE_MSG_STATUS") === "ON") {
    return safeSendReply(replyToken, getConfig("LOC_SAVE_MSG_TEXT") || getConfig("LOCATION_REPLY_MSG") || "บันทึกข้อมูลแล้ว");
  }
  return { skipped: true, reason: "session_waiting" };
}

function _escapeRegexLocal_(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ════════════════════════════════════════════════════════════════════
// 🆕 v10.3: SEARCHPATCH v3 HELPERS
// ════════════════════════════════════════════════════════════════════

/**
 * 🔧 v3: Auto-prefix "ค้นหา..." → "/ค้นหา..."
 * รองรับ:
 *   "ค้นหา 102/2"  → "/ค้นหา 102/2"
 *   "หา 102/2"     → "/ค้นหา 102/2"
 *   "/ค้นหา 102/2" → ไม่เปลี่ยน (มี / แล้ว)
 *   "ค้นหาบ้าน"    → ไม่เปลี่ยน (ไม่มีเลข — เป็นคำถาม)
 */
/**
 * 🔧 v3: Safe reply — ส่งข้อความตอบเสมอ ไม่ silent fail
 * ใช้แทน sendLineReply ทั่วไปเพื่อให้แน่ใจว่า user เห็นการตอบ
 */
function safeSendReply(replyToken, text) {
  if (!replyToken) {
    Logger.log("⚠️ safeSendReply: missing replyToken");
    return null;
  }
  if (text === null || text === undefined || String(text).trim() === "") {
    Logger.log("⚠️ safeSendReply: empty text; using fallback");
    text = getConfig("MSG_FALLBACK") || "OK";
  }

  try {
    const result = sendLineReply(replyToken, String(text));
    return result;
  } catch (e) {
    Logger.log("⚠️ safeSendReply error: " + e.message + " | text: " + String(text).substring(0, 50));
    return null;
  }
}

/**
 * 🔧 v3: Universal reply — รองรับทั้ง text และ Flex Message
 * - ถ้า result เป็น object {type:"flex", contents:...} → ส่ง Flex
 * - ถ้า result เป็น string → ส่ง text
 */
function sendUniversalReply(replyToken, result) {
  if (!replyToken) {
    Logger.log("⚠️ sendUniversalReply: missing replyToken");
    return null;
  }

  try {
    // Flex Message
    if (result && typeof result === "object" && result.type === "flex") {
      const res = _linePost("https://api.line.me/v2/bot/message/reply", {
        replyToken: replyToken,
        messages: [{
          type: "flex",
          altText: String(result.altText || "ผลการค้นหา"),
          contents: result.contents
        }]
      });
      if (res.responseCode !== 200) {
        Logger.log("⚠️ Flex reply failed: HTTP " + res.responseCode);
        return safeSendReply(replyToken, result.altText || "ไม่สามารถแสดงผลแบบ Flex ได้");
      }
      return res;
    }

    // Text
    return safeSendReply(replyToken, String(result));
  } catch (e) {
    Logger.log("⚠️ sendUniversalReply error: " + e.message);
    return safeSendReply(replyToken, result && result.altText ? result.altText : "ไม่สามารถแสดงผลข้อความนี้ได้");
  }
}

/**
 * 🔧 v3: ตรวจว่าเป็น "เลขบ้าน" จริง (ไม่ใช่ข้อความปน)
 * Reject patterns:
 *   - ขึ้นต้นด้วย "ค้นหา", "บอท", "หา", "บัญชี", "นัด", "ส่ง", "#"
 *   - ขึ้นต้นด้วย "/"
 *   - ความยาวเกิน 30 ตัว
 *   - ไม่เริ่มด้วยตัวเลข (ยกเว้น "หมู่")
 */
function _isValidHouseNumber(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t) return false;
  if (t.length > 30) return false;

  // ❌ Reject patterns
  if (/^(ค้นหา|บอท|หา|บัญชี|นัด|ส่ง|#)/.test(t)) return false;
  if (t.startsWith("/")) return false;

  // ✅ ต้องเริ่มด้วยตัวเลข (หรือคำว่า "หมู่")
  if (!/^\d/.test(t) && !/^หมู่\s*\d/.test(t)) return false;

  return true;
}

// 🆕 v10.2: searchKnowledgeBase ใช้ SmartMatching.gs ถ้ามี
function searchKnowledgeBase(query, userRole, userId) {
  if (!query) return null;

  try {
    if (typeof improvedKBSearch === "function") {
      return improvedKBSearch(query, userRole, userId);
    }
  } catch (e) {
    Logger.log("⚠️ SmartMatching error, fallback: " + e.message);
  }

  // Fallback: legacy
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.KNOWLEDGE);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  const lowerQuery = String(query || "").toLowerCase();
  const normRole = String(userRole || "").trim().toUpperCase();

  for (let i = 1; i < data.length; i++) {
    const question = (data[i][1] || "").toString().trim().toLowerCase();
    const answer = data[i][2];
    if (!answer) continue;
    const tags = (data[i][4] || "").toString().toLowerCase();
    const status = (data[i][5] || "Active").toString().trim();
    const accessLevel = (data[i][6] || "Public").toString().trim().toUpperCase();

    if (status !== "Active" && status !== "TRUE" && status !== "ใช้งาน" && status !== "1") continue;
    if (accessLevel === "INTERNAL" && normRole !== "VIP" && !isAdmin(userId)) continue;
    if (accessLevel === "ADMIN" && !isAdmin(userId)) continue;
    if (!question && !tags) continue;

    if ((question && lowerQuery.includes(question)) || (question && question.includes(lowerQuery)) || (tags && tags.split(",").some(t => lowerQuery.includes(t.trim().toLowerCase())))) {
      return _buildKnowledgeReplyFromRow_(data[i]);
    }
  } return null;
}

function _buildKnowledgeReplyFromRow_(row) {
  const answer = String(row && row[2] || "");
  const imageUrl = String(row && row[8] || "").trim();
  if (!imageUrl || !/^https:\/\//i.test(imageUrl)) return answer;
  return _buildKnowledgeImageFlex_(row);
}

function _buildKnowledgeImageFlex_(row) {
  const title = String(row && row[1] || "ข้อมูลความรู้").trim();
  const answer = String(row && row[2] || "").trim();
  const category = String(row && row[3] || "").trim();
  const tags = String(row && row[4] || "").trim();
  const imageUrl = String(row && row[8] || "").trim();
  const linkUrl = String(row && row[9] || imageUrl).trim();
  const bodyContents = [
    {
      type: "text",
      text: title.substring(0, 120),
      weight: "bold",
      size: "md",
      color: "#111827",
      wrap: true
    }
  ];

  if (answer) {
    bodyContents.push({
      type: "text",
      text: answer.substring(0, 500),
      size: "sm",
      color: "#374151",
      margin: "md",
      wrap: true
    });
  }
  if (category || tags) {
    bodyContents.push({
      type: "text",
      text: [category, tags].filter(Boolean).join(" • ").substring(0, 160),
      size: "xxs",
      color: "#6B7280",
      margin: "md",
      wrap: true
    });
  }

  const bubble = {
    type: "bubble",
    size: "kilo",
    hero: {
      type: "image",
      url: imageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
      action: { type: "uri", uri: linkUrl }
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "14px",
      contents: bodyContents
    }
  };

  if (linkUrl) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      paddingAll: "10px",
      contents: [{
        type: "button",
        style: "primary",
        height: "sm",
        color: "#2563EB",
        action: {
          type: "uri",
          label: "เปิดรูป/ลิงก์",
          uri: linkUrl
        }
      }]
    };
  }

  return {
    type: "flex",
    altText: "ผลค้นหา: " + title.substring(0, 80),
    contents: bubble
  };
}

function formatPoliteResponse(text) { return (getConfig("POLITE_PREFIX") || "") + text + (getConfig("POLITE_SUFFIX") || ""); }

// ==========================================
// 3. DASHBOARD DATA & MEMBERS & CHART
// ==========================================
function legacyDoGet_(e) {
  if (!_isDashboardRequestAuthorized_(e)) {
    return _renderDashboardAccessDenied_();
  }

  if (e && e.parameter && e.parameter.debugSettings === "1") {
    return HtmlService.createHtmlOutput(
      "<pre style='white-space:pre-wrap;font:13px Consolas,monospace;'>" +
      JSON.stringify(getSettingsPayload20260511(), null, 2).replace(/[<>&]/g, function(ch) {
        return ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[ch];
      }) +
      "</pre>"
    ).setTitle("Settings Debug");
  }

  return HtmlService.createHtmlOutputFromFile("Dashboard")
    .setTitle("ศูนย์ควบคุมระบบราชการ (AI Bot)")
    .setWidth(1200).setHeight(800)
    .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doGet(e) {
  if (typeof doGet_FIXED === "function") return doGet_FIXED(e);
  return legacyDoGet_(e);
}

function _isDashboardRequestAuthorized_(e) {
  const params = (e && e.parameter) || {};
  const props = PropertiesService.getScriptProperties();

  const adminKey = String(
    props.getProperty("WEB_ADMIN_KEY") ||
    getConfig("WEB_ADMIN_KEY") ||
    ""
  ).trim();

  const requestKey = String(params.adminKey || params.key || "").trim();
  if (adminKey && requestKey && requestKey === adminKey) return true;

  const allowedEmailsRaw = String(
    props.getProperty("WEB_ADMIN_EMAILS") ||
    getConfig("WEB_ADMIN_EMAILS") ||
    ""
  ).trim();

  if (allowedEmailsRaw) {
    try {
      const activeEmail = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
      const allowedEmails = allowedEmailsRaw
        .split(",")
        .map(email => String(email).trim().toLowerCase())
        .filter(Boolean);
      if (activeEmail && allowedEmails.indexOf(activeEmail) >= 0) return true;
    } catch (err) {
      Logger.log("Dashboard auth email check failed: " + err.message);
    }
  }

  return false;
}

function _renderDashboardAccessDenied_() {
  const html =
    '<!doctype html><html lang="th"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>ปฏิเสธการเข้าถึง</title>' +
    '<style>body{font-family:Sarabun,Segoe UI,Tahoma,sans-serif;background:#f8fafc;color:#1f2937;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.box{max-width:680px;background:#fff;border:1px solid #e5e7eb;border-left:6px solid #dc2626;border-radius:12px;padding:24px 28px;box-shadow:0 12px 30px rgba(15,23,42,.08)}h1{font-size:22px;margin:0 0 12px;color:#991b1b}p{line-height:1.7;margin:8px 0}code{background:#f1f5f9;padding:2px 6px;border-radius:6px}</style>' +
    '</head><body><div class="box">' +
    '<h1>ไม่อนุญาตให้เข้า Dashboard</h1>' +
    '<p>หน้า Admin ถูกล็อกแล้ว กรุณาเข้าใช้งานด้วยบัญชีหรือรหัสที่ตั้งไว้เท่านั้น</p>' +
    '<p><b>วิธีตั้งค่า:</b> ตั้ง Script Property ชื่อ <code>WEB_ADMIN_KEY</code> แล้วเข้า URL ด้วย <code>?adminKey=รหัสของคุณ</code></p>' +
    '<p>ถ้า deploy แบบให้ผู้ใช้ล็อกอิน Google ได้ ให้ตั้ง <code>WEB_ADMIN_EMAILS</code> เป็นอีเมลแอดมิน คั่นด้วยจุลภาค</p>' +
    '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle("Access denied");
}

function getDashboardData() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const statsData = ss.getSheetByName(SHEETS.STATISTICS).getDataRange().getValues();
  const notifySheet = ss.getSheetByName(SHEETS.NOTIFY_LOG);

  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  let notifySent = 0;
  if (notifySheet && notifySheet.getLastRow() > 1) {
    const notifyData = notifySheet.getRange(2, 1, notifySheet.getLastRow()-1, 2).getValues();
    notifySent = notifyData.filter(r =>
      r[1] && Utilities.formatDate(new Date(r[1]), Session.getScriptTimeZone(), "yyyy-MM-dd") === todayStr
    ).length;
  }

  let totalUsers = Math.max(0, ss.getSheetByName(SHEETS.MEMBERS).getLastRow() - 1);
  let todayQ = 0, totalQ = 0, totalS = 0, totalTime = 0, count = 0;

  let chartLabels = [];
  let chartDataQuestions = [];
  let chartDataSuccess = [];

  for (let i = 1; i < statsData.length; i++) {
    const dStr = statsData[i][0] instanceof Date ? Utilities.formatDate(statsData[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd") : statsData[i][0];
    const q = Number(statsData[i][2])||0;
    const s = Number(statsData[i][3])||0;
    const t = Number(statsData[i][6])||0;
    const sampleCount = Number(statsData[i][8]) || (t > 0 ? Math.max(q, 1) : 0);
    totalQ += q;
    totalS += s;
    if (t > 0 && sampleCount > 0) { totalTime += t * sampleCount; count += sampleCount; }
    if (dStr === todayStr) todayQ = q;
  }

  const last7 = statsData.slice(Math.max(1, statsData.length - 7));
  last7.forEach(row => {
    chartLabels.push(row[0] instanceof Date ? Utilities.formatDate(row[0], Session.getScriptTimeZone(), "dd/MM") : row[0]);
    chartDataQuestions.push(Number(row[2])||0);
    chartDataSuccess.push(Number(row[3])||0);
  });

  return {
    stats: {
      totalUsers: totalUsers,
      todayQuestions: todayQ,
      notifySent: notifySent,
      totalQuestions: totalQ,
      totalSuccess: totalS,
      successRate: totalQ > 0 ? ((totalS/totalQ)*100).toFixed(1) : 0,
      avgResponseTime: count > 0 ? (totalTime/count).toFixed(0) : 0
    },
    logs: getRecentLogs(ss, 10),
    chart: { labels: chartLabels, dataQ: chartDataQuestions, dataS: chartDataSuccess }
  };
}

function getQuickStats() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const statsSheet = ss.getSheetByName(SHEETS.STATISTICS);
  const statsData = statsSheet ? statsSheet.getDataRange().getValues() : [];
  const notifySheet = ss.getSheetByName(SHEETS.NOTIFY_LOG);
  const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  let notifySent = 0;
  if (notifySheet && notifySheet.getLastRow() > 1) {
    const notifyData = notifySheet.getRange(2, 1, notifySheet.getLastRow() - 1, 2).getValues();
    notifySent = notifyData.filter(function(r) {
      return r[1] && Utilities.formatDate(new Date(r[1]), Session.getScriptTimeZone(), "yyyy-MM-dd") === todayStr;
    }).length;
  }

  let todayQ = 0, totalQ = 0, totalS = 0, totalTime = 0, count = 0;
  for (let i = 1; i < statsData.length; i++) {
    const dStr = statsData[i][0] instanceof Date ? Utilities.formatDate(statsData[i][0], Session.getScriptTimeZone(), "yyyy-MM-dd") : statsData[i][0];
    const q = Number(statsData[i][2]) || 0;
    const s = Number(statsData[i][3]) || 0;
    const avg = Number(statsData[i][6]) || 0;
    const sampleCount = Number(statsData[i][8]) || (avg > 0 ? Math.max(q, 1) : 0);
    totalQ += q;
    totalS += s;
    if (avg > 0 && sampleCount > 0) {
      totalTime += avg * sampleCount;
      count += sampleCount;
    }
    if (dStr === todayStr) todayQ = q;
  }

  return {
    totalUsers: Math.max(0, ss.getSheetByName(SHEETS.MEMBERS).getLastRow() - 1),
    todayQuestions: todayQ,
    notifySent: notifySent,
    totalQuestions: totalQ,
    totalSuccess: totalS,
    successRate: totalQ > 0 ? ((totalS / totalQ) * 100).toFixed(1) : 0,
    avgResponseTime: count > 0 ? (totalTime / count).toFixed(0) : 0
  };
}

function getKnowledgeData() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.KNOWLEDGE);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  _ensureKnowledgeImageSchema_();
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(sheet.getLastColumn(), 12)).getValues();
  let formatted = [];
  for (let i = 0; i < data.length; i++) {
    if (!data[i][1] && !data[i][2]) continue;
    formatted.push({
      id: data[i][0] || "-",
      question: data[i][1] || "",
      answer: data[i][2] || "",
      category: data[i][3] || "ทั่วไป",
      tags: data[i][4] || "",
      status: data[i][5] || "Active",
      access: data[i][6] || "Public",
      imageUrl: data[i][8] || "",
      linkUrl: data[i][9] || "",
      fileId: data[i][10] || ""
    });
  }
  return formatted.reverse();
}

function _ensureKnowledgeImageSchema_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEETS.KNOWLEDGE);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.KNOWLEDGE);
    sheet.appendRow(["ID", "คำถาม", "คำตอบ", "หมวดหมู่", "แท็ก", "สถานะ", "สิทธิ์การเข้าถึง", "วันที่สร้าง", "รูปย่อ", "ลิงก์เปิด", "File ID", "วันที่อัปโหลดรูป"]);
  }
  const headers = ["รูปย่อ", "ลิงก์เปิด", "File ID", "วันที่อัปโหลดรูป"];
  for (let i = 0; i < headers.length; i++) {
    const col = 9 + i;
    if (!String(sheet.getRange(1, col).getValue() || "").trim()) {
      sheet.getRange(1, col).setValue(headers[i]);
    }
  }
  sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 12))
    .setFontWeight("bold")
    .setBackground("#1e3a8a")
    .setFontColor("#ffffff")
    .setHorizontalAlignment("center");
  return sheet;
}

function _driveThumbnailUrl_(fileId, width) {
  const w = Math.max(240, Math.min(parseInt(width || getConfig("PHOTO_MAX_WIDTH") || "800", 10) || 800, 1600));
  return "https://drive.google.com/thumbnail?id=" + encodeURIComponent(fileId) + "&sz=w" + w;
}

function uploadKnowledgeImage(payload) {
  try {
    const p = payload || {};
    const base64 = String(p.base64 || "");
    const mimeType = String(p.mimeType || "image/jpeg");
    if (!base64) return { success: false, error: "ไม่พบไฟล์รูป" };
    if (!/^image\//i.test(mimeType)) return { success: false, error: "รองรับเฉพาะไฟล์รูปภาพ" };

    const question = String(p.question || p.title || p.keywords || "").trim();
    if (!question) return { success: false, error: "กรุณาใส่คำค้น/หัวข้อ" };

    const folder = _getOrCreatePhotoFolder();
    if (!folder) return { success: false, error: "ไม่สามารถเข้าถึงโฟลเดอร์รูปได้" };

    const now = new Date();
    const cleanBase64 = base64.indexOf(",") >= 0 ? base64.split(",").pop() : base64;
    const bytes = Utilities.base64Decode(cleanBase64);
    const ext = mimeType.indexOf("png") >= 0 ? ".png" : mimeType.indexOf("webp") >= 0 ? ".webp" : ".jpg";
    const rawName = String(p.fileName || question || "knowledge-image").replace(/[\\\/:*?"<>|]/g, "_").substring(0, 80);
    const fileName = "KB_" + Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd_HHmmss") + "_" + rawName + (rawName.toLowerCase().endsWith(ext) ? "" : ext);
    const blob = Utilities.newBlob(bytes, mimeType, fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId = file.getId();
    const thumbnailUrl = _driveThumbnailUrl_(fileId, p.maxWidth || getConfig("PHOTO_MAX_WIDTH") || "800");
    const fileUrl = file.getUrl();
    const linkUrl = String(p.linkUrl || fileUrl).trim();
    const answer = String(p.answer || p.description || "ดูรูปประกอบ").trim();
    const tags = String(p.tags || p.keywords || question).trim();
    const category = String(p.category || "รูปภาพ").trim();
    const access = String(p.access || "Public").trim();
    const status = String(p.status || "Active").trim();
    const createdAt = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

    const sheet = _ensureKnowledgeImageSchema_();
    const rowId = "KIMG" + now.getTime();
    sheet.appendRow([
      rowId,
      question,
      answer,
      category,
      tags,
      status,
      access,
      createdAt,
      thumbnailUrl,
      linkUrl,
      fileId,
      createdAt
    ]);

    try {
      PropertiesService.getScriptProperties().setProperty("KB_CACHE_VERSION", String(now.getTime()));
    } catch (cacheErr) {}

    return {
      success: true,
      id: rowId,
      fileId: fileId,
      fileUrl: fileUrl,
      thumbnailUrl: thumbnailUrl,
      linkUrl: linkUrl,
      message: "นำเข้ารูปเข้า Knowledge Base แล้ว"
    };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

function getMembersData() {
  const data = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.MEMBERS).getDataRange().getValues();
  return data.slice(1).map(row => ({
    id: row[0],
    lineUserId: row[1],
    name: row[2],
    role: row[4],
    status: row[5],
    joined: row[7] instanceof Date ? Utilities.formatDate(row[7], Session.getScriptTimeZone(), "dd/MM/yyyy") : (row[7] || "")
  })).reverse();
}

function updateMemberRole(lineUserId, newRole) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.MEMBERS);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][1] === lineUserId) {
        sheet.getRange(i+1, 5).setValue(newRole);
        SpreadsheetApp.flush();
        try { if (typeof _clearUserCache === "function") _clearUserCache(lineUserId); } catch (e) {}
        try { if (typeof _clearCodeLocalCache_ === "function") _clearCodeLocalCache_(); } catch (e) {}
        return {success: true};
      }
    }
    return {success: false, error: "ไม่พบผู้ใช้"};
  } catch(e) { return {success: false, error: String(e)}; }
}

function getRecentLogs(ss, limit) {
  const sheet = ss.getSheetByName(SHEETS.ACTIVITY);
  const lr = sheet.getLastRow();
  if (lr <= 1) return [];
  const start = Math.max(2, lr - limit + 1);
  return sheet.getRange(start, 1, lr - start + 1, 8).getValues().reverse().map(r => ({
    time: r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), "HH:mm") : r[1],
    user: r[2],
    message: r[4],
    status: r[6]
  }));
}

// 🔧 v3: ปรับให้เร็วขึ้น (ใช้ ss object ครั้งเดียว)
function logActivity(uid, uname, msg, action, status, time) {
  try {
    _withScriptLock_(5000, function() {
      const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.ACTIVITY);
      const lr = sheet.getLastRow();
      sheet.appendRow([
        "A" + new Date().getTime() + "_" + Math.floor(Math.random() * 9999),
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
        uname,
        action,
        msg,
        "",
        status,
        time
      ]);
    });
  } catch (e) {
    Logger.log("⚠️ logActivity error: " + e.message);
  }
}

function _ensureStatisticsTimingColumns_(sheet) {
  if (!sheet) return;
  if (sheet.getLastColumn() < 8) sheet.getRange(1, 8).setValue("Response Total");
  if (sheet.getLastColumn() < 9) sheet.getRange(1, 9).setValue("Response Count");
}

function updateDailyStats(q, s, t) {
  try {
    _withScriptLock_(5000, function() {
      const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.STATISTICS);
      _ensureStatisticsTimingColumns_(sheet);
      const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
      const data = sheet.getDataRange().getValues();
      const responseCountToAdd = (Number(q) > 0 && Number(t) > 0) ? Number(q) : 0;
      const responseTimeToAdd = responseCountToAdd > 0 ? Number(t) * responseCountToAdd : 0;
      for (let i = 1; i < data.length; i++) {
        if (Utilities.formatDate(new Date(data[i][0]), Session.getScriptTimeZone(), "yyyy-MM-dd") === today) {
          const oldQ = Number(data[i][2]) || 0;
          const oldAvg = Number(data[i][6]) || 0;
          const oldCount = Number(data[i][8]) || (oldAvg > 0 ? Math.max(oldQ, 1) : 0);
          const oldTotalTime = Number(data[i][7]) || (oldAvg * oldCount);
          const newQ = oldQ + (Number(q) || 0);
          const newS = (Number(data[i][3]) || 0) + (Number(s) || 0);
          const newFail = newQ - newS;
          const newTimeCount = oldCount + responseCountToAdd;
          const newTotalTime = oldTotalTime + responseTimeToAdd;
          const successRate = newQ > 0 ? ((newS / newQ) * 100).toFixed(1) : 0;
          const avgTime = newTimeCount > 0 ? (newTotalTime / newTimeCount).toFixed(0) : 0;
          sheet.getRange(i + 1, 3, 1, 7).setValues([[newQ, newS, newFail, successRate, avgTime, newTotalTime, newTimeCount]]);
          return;
        }
      }
      const avgTime = responseCountToAdd > 0 ? (responseTimeToAdd / responseCountToAdd).toFixed(0) : 0;
      sheet.appendRow([today, 1, q, s, q - s, q > 0 ? (s / q * 100).toFixed(1) : 100, avgTime, responseTimeToAdd, responseCountToAdd]);
    });
  } catch (e) {
    Logger.log("⚠️ updateDailyStats error: " + e.message);
  }
}

// ==========================================
// 4. NOTIFICATION & SCHEDULE
// ==========================================
function sendLineNotification(p) {
  try {
    p = p || {};
    if (getConfig("NOTIFY_STATUS") === "OFF") return {success:false, error:"ปิดแจ้งเตือน"};
    let tgts = p.targets || ["all"];
    const notifyTitle = String(p.title || "");
    const notifyBody = String(p.body || p.message || "");
    let msg = notifyTitle ? notifyTitle + "\n\n" + notifyBody : notifyBody;
    if (!msg.trim()) return {success:false, error:"ข้อความว่าง"};
    if (typeof tgts === 'string') tgts = tgts.split(",");
    tgts = tgts.map(t => t.trim());
    if (tgts.length === 1 && String(tgts[0]).trim().toLowerCase() === "all") {
      const res = _lineBroadcast(msg);
      _logNotify(p.title, p.body, "all", 0, res.responseCode === 200 ? "ส่งแล้ว" : "ล้มเหลว", "Admin");
      return {success: res.responseCode === 200};
    } else {
      let uIds = [];
      const mb = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.MEMBERS).getDataRange().getValues();
      tgts.forEach(t => {
        const tl = t.toLowerCase();
        if (tl === "all") uIds = uIds.concat(mb.slice(1).map(m => m[1]));
        else if (tl === "admins") uIds = uIds.concat(getAdminIds());
        else if (tl === "members") uIds = uIds.concat(mb.filter(m => m[4] === "User").map(m => m[1]));
        else if (tl.startsWith("group_")) {
          const groupTarget = t.substring(6).trim();
          if (groupTarget) uIds.push(groupTarget);
        }
        else uIds.push(t);
      });
      uIds = [...new Set(uIds)].filter(Boolean);
      if (uIds.length === 0) return {success:false, error:"ไม่พบเป้าหมาย"};
      let success = true;
      const us = uIds.filter(id => id.startsWith("U"));
      const gs = uIds.filter(id => !id.startsWith("U"));
      if (us.length > 0) if (_lineMulticast(us, msg).responseCode !== 200) success = false;
      gs.forEach(id => { if (_linePush(id, msg).responseCode !== 200) success = false; });
      _logNotify(p.title, p.body, tgts.join(","), uIds.length, success ? "ส่งแล้ว" : "ล้มเหลว", "Admin");
      return {success: success, recipientCount: uIds.length};
    }
  } catch(e) { return {success:false, error:String(e)}; }
}

function _logNotify(t, b, tg, c, s, sd) {
  SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.NOTIFY_LOG).appendRow([
    "N" + new Date().getTime(),
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
    t, b, tg, c, s, 0, sd
  ]);
}

function addScheduledNotify(d) {
  try {
    SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SCHEDULE).appendRow([
      "S" + new Date().getTime(),
      new Date(d.datetime),
      d.message || "",
      d.repeat || "once",
      d.targets || "all",
      "ใช้งาน",
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
    ]);
    setupScheduleTrigger();
    return {success:true, message:"บันทึกกำหนดการและตั้ง Trigger แล้ว"};
  } catch(e) { return {success:false, error:String(e)}; }
}

function deleteScheduledNotify(id) {
  const s = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SCHEDULE);
  const d = s.getDataRange().getValues();
  for (let i = 1; i < d.length; i++) {
    if (String(d[i][0]) === String(id)) {
      s.deleteRow(i+1);
      setupScheduleTrigger();
      return {success:true};
    }
  }
  return {success:false};
}

function getScheduledNotify() {
  const s = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SCHEDULE);
  if (!s || s.getLastRow() <= 1) return [];
  return s.getRange(2, 1, s.getLastRow()-1, 7).getValues().map(r => ({
    id: r[0],
    datetime: r[1] ? Utilities.formatDate(new Date(r[1]), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm") : "",
    message: r[2],
    repeat: r[3],
    status: r[5]
  }));
}

function setupScheduleTrigger() {
  try {
    const triggers = ScriptApp.getProjectTriggers().filter(t =>
      t.getHandlerFunction() === "runScheduledNotify"
    );

    if (!_hasActiveScheduledNotify_()) {
      triggers.forEach(t => ScriptApp.deleteTrigger(t));
      return { success: true, message: "ไม่มีรายการกำหนดส่งที่เปิดใช้งาน" };
    }

    if (triggers.length === 0) {
      ScriptApp.newTrigger("runScheduledNotify").timeBased().everyMinutes(1).create();
    } else if (triggers.length > 1) {
      triggers.slice(1).forEach(t => ScriptApp.deleteTrigger(t));
    }

    return { success: true, message: "ตั้ง Trigger กำหนดส่งทุก 1 นาทีแล้ว" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

function runScheduledNotify() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, message: "มีรอบส่งกำหนดการกำลังทำงานอยู่" };
  }

  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SCHEDULE);
    if (!sheet || sheet.getLastRow() <= 1) return { success: true, sent: 0, failed: 0 };

    const now = new Date();
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
    let sent = 0;
    let failed = 0;

    data.forEach((row, idx) => {
      const rowNo = idx + 2;
      const runAt = row[1] instanceof Date ? row[1] : new Date(row[1]);
      const message = String(row[2] || "").trim();
      const repeat = String(row[3] || "once").trim().toLowerCase();
      const targets = String(row[4] || "all").trim();
      const status = String(row[5] || "").trim();

      if (!_isScheduleActive_(status)) return;
      if (!message || isNaN(runAt.getTime()) || runAt > now) return;

      const result = sendLineNotification({ title: "", body: message, targets: targets });
      if (result && result.success) {
        sent++;
        if (repeat === "once") {
          sheet.getRange(rowNo, 6).setValue("ส่งแล้ว");
        } else {
          sheet.getRange(rowNo, 2).setValue(_nextScheduledDate_(runAt, repeat, now));
          sheet.getRange(rowNo, 6).setValue("ใช้งาน");
        }
      } else {
        failed++;
        const reason = result && result.error ? result.error : "ส่งไม่สำเร็จ";
        sheet.getRange(rowNo, 6).setValue("ผิดพลาด: " + String(reason).substring(0, 80));
      }
    });

    setupScheduleTrigger();
    return { success: true, sent: sent, failed: failed };
  } catch (e) {
    Logger.log("runScheduledNotify error: " + e.message);
    return { success: false, error: String(e) };
  } finally {
    lock.releaseLock();
  }
}

function _hasActiveScheduledNotify_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SCHEDULE);
  if (!sheet || sheet.getLastRow() <= 1) return false;
  const statuses = sheet.getRange(2, 6, sheet.getLastRow() - 1, 1).getValues();
  return statuses.some(r => _isScheduleActive_(String(r[0] || "")));
}

function _isScheduleActive_(status) {
  const s = String(status || "").trim().toLowerCase();
  return !s || s === "ใช้งาน" || s === "active" || s === "on";
}

function _nextScheduledDate_(date, repeat, now) {
  const next = new Date(date.getTime());
  const mode = String(repeat || "once").toLowerCase();
  do {
    if (mode === "daily") next.setDate(next.getDate() + 1);
    else if (mode === "weekly") next.setDate(next.getDate() + 7);
    else if (mode === "monthly") next.setMonth(next.getMonth() + 1);
    else return next;
  } while (next <= now);
  return next;
}

function _linePost(u, p) {
  const headers = getLineAuthHeaders_();
  headers["Content-Type"] = "application/json";
  return {
    responseCode: UrlFetchApp.fetch(u, {
      method: "post",
      headers: headers,
      payload: JSON.stringify(p),
      muteHttpExceptions: true
    }).getResponseCode()
  };
}

function sendLineReply(rt, tx) {
  return _linePost("https://api.line.me/v2/bot/message/reply", {
    replyToken: rt,
    messages: [{ type: "text", text: tx }]
  });
}

function _lineBroadcast(tx) {
  return _linePost("https://api.line.me/v2/bot/message/broadcast", {
    messages: [{ type: "text", text: tx }]
  });
}

function _linePush(id, tx) {
  return _linePost("https://api.line.me/v2/bot/message/push", {
    to: id,
    messages: [{ type: "text", text: tx }]
  });
}

function _lineMulticast(ids, tx) {
  let s = true;
  for (let i = 0; i < ids.length; i += 500) {
    if (_linePost("https://api.line.me/v2/bot/message/multicast", {
      to: ids.slice(i, i+500),
      messages: [{ type: "text", text: tx }]
    }).responseCode !== 200) s = false;
  }
  return { responseCode: s ? 200 : 400 };
}

// ==========================================
// 5. LOCATION / HOUSE (Legacy Fallback)
// ==========================================
//
// ⚠️ v10.2 NOTE:
// ฟังก์ชัน saveOrUpdateLocationData, saveOrUpdateHouseNumber,
// isWaitingForHouseNumber ถูก OVERRIDE โดย PikadSession.gs
// (Apps Script ใช้ฟังก์ชันที่ define หลังสุด)
//
// ในกรณีที่ไม่ได้ติดตั้ง PikadSession.gs:
// → ใช้ logic เดิมด้านล่างนี้ (legacy fallback)
// ==========================================

function _saveOrUpdateLocationDataCompat_(userId, lat, lng, address, groupId) {
  if (typeof saveOrUpdateLocationData === "function") {
    return saveOrUpdateLocationData(userId, lat, lng, address, groupId);
  }
  return _legacySaveOrUpdateLocationData_(userId, lat, lng, address, groupId);
}

function _saveOrUpdateHouseNumberCompat_(userId, houseNum, groupId) {
  if (typeof saveOrUpdateHouseNumber === "function") {
    return saveOrUpdateHouseNumber(userId, houseNum, groupId);
  }
  return _legacySaveOrUpdateHouseNumber_(userId, houseNum, groupId);
}

function _legacySaveOrUpdateLocationData_(userId, lat, lng, address, groupId) {
  return _withScriptLock_(5000, function() {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
    if (!sheet) return { rowIndex: -1, isNew: false };
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i > 0; i--) {
      if (data[i][2] === userId) {
        if (data[i][3] !== "" && data[i][4] === "") {
          sheet.getRange(i + 1, 2).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"));
          sheet.getRange(i + 1, 5).setValue(lat);
          sheet.getRange(i + 1, 6).setValue(lng);
          sheet.getRange(i + 1, 7).setValue(address);
          if (groupId && !data[i][7]) sheet.getRange(i + 1, 8).setValue(groupId);
          return { rowIndex: i + 1, isNew: false };
        }
        break;
      }
    }
    sheet.appendRow([
      "LOC" + new Date().getTime(),
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      userId, "", lat, lng, address, groupId
    ]);
    return { rowIndex: sheet.getLastRow(), isNew: true };
  });
}

function _legacySaveOrUpdateHouseNumber_(userId, houseNum, groupId) {
  return _withScriptLock_(5000, function() {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
    if (!sheet) return { rowIndex: -1, isNew: false };
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i > 0; i--) {
      if (data[i][2] === userId) {
        if (data[i][3] === "" && data[i][4] !== "") {
          sheet.getRange(i+1, 4).setValue(houseNum);
          if (groupId && !data[i][7]) sheet.getRange(i+1, 8).setValue(groupId);
          return { rowIndex: i+1, isNew: false };
        }
        if (data[i][3] !== "" && data[i][4] === "") {
          break;
        }
        break;
      }
    }
    sheet.appendRow([
      "LOC" + new Date().getTime(),
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      userId, houseNum, "", "", "", groupId
    ]);
    return { rowIndex: sheet.getLastRow(), isNew: true };
  });
}

function isWaitingForHouseNumber(userId) {
  // ลองใช้ session-based ก่อน
  try {
    if (typeof _findActiveSession === "function") {
      return _findActiveSession(userId) > 0;
    }
  } catch (e) {}

  // Fallback: legacy
  const data = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION).getDataRange().getValues();
  for (let i = data.length - 1; i > 0; i--) {
    if (data[i][2] === userId) {
      if (data[i][3] === "" && data[i][4] !== "") return true;
      break;
    }
  }
  return false;
}

// ==========================================
// 6. SAVED IDs & SETTINGS & ADMIN
// ==========================================
function getSavedIds() {
  const s = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SAVED_IDS);
  if (!s || s.getLastRow() <= 1) return [];
  return s.getDataRange().getValues().slice(1).map(r => ({
    id: r[0], name: r[1], lineId: r[2],
    date: r[3] ? Utilities.formatDate(new Date(r[3]), Session.getScriptTimeZone(), "dd/MM/yyyy") : ""
  })).reverse();
}

function addSavedId(d) {
  try {
    SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SAVED_IDS).appendRow([
      "ID" + new Date().getTime(),
      d.name, d.lineId,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
    ]);
    return {success: true};
  } catch(e) { return {success: false, error: String(e)}; }
}

function deleteSavedId(id) {
  const s = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SAVED_IDS);
  const d = s.getDataRange().getValues();
  for (let i = 1; i < d.length; i++) {
    if (String(d[i][0]) === String(id)) { s.deleteRow(i+1); return {success: true}; }
  }
  return {success: false};
}

function getSystemSettings() {
  const debug = {
    spreadsheetId: SPREADSHEET_ID,
    expectedSheetName: SHEETS.CONFIG,
    actualSheetName: "",
    lastRow: 0,
    lastColumn: 0,
    rowsRead: 0,
    keysCount: 0,
    sampleKeys: []
  };
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    debug.spreadsheetName = ss.getName();
    let sheet = ss.getSheetByName(SHEETS.CONFIG);
    if (!sheet) {
      sheet = ss.getSheets().find(function(sh) {
        const name = String(sh.getName() || "").trim().toLowerCase();
        return name === "ตั้งค่า" || name === "config";
      });
    }
    if (!sheet) {
      try {
        repairAndUpgradeSheets();
        sheet = ss.getSheetByName(SHEETS.CONFIG);
      } catch (fixErr) {
        debug.repairError = fixErr.message || String(fixErr);
      }
    }
    if (!sheet) {
      debug.error = "CONFIG_SHEET_NOT_FOUND";
      return { _debug: debug };
    }
    debug.actualSheetName = sheet.getName();
    debug.lastRow = sheet.getLastRow();
    debug.lastColumn = sheet.getLastColumn();
    if (debug.lastRow <= 1 || debug.lastColumn < 2) {
      try {
        initializeConfig(ss);
        debug.initializedDefaults = true;
        debug.lastRow = sheet.getLastRow();
        debug.lastColumn = sheet.getLastColumn();
      } catch (initErr) {
        debug.initError = initErr.message || String(initErr);
      }
    }
    let d = sheet.getDataRange().getValues();
    debug.rowsRead = d.length;
    let c = _settingsRowsToObject_(d);

    const missingImportantKeys = _getSettingsImportantKeys_().filter(function(key) {
      return !Object.prototype.hasOwnProperty.call(c, key);
    });
    if (missingImportantKeys.length > 0) {
      try {
        initializeConfig(ss);
        if (typeof _clearConfigCache === "function") _clearConfigCache();
        _clearCodeLocalCache_();
        d = sheet.getDataRange().getValues();
        c = _settingsRowsToObject_(d);
        debug.rowsRead = d.length;
        debug.initializedMissingDefaults = missingImportantKeys;
      } catch (missingInitErr) {
        debug.missingDefaultsError = missingInitErr.message || String(missingInitErr);
        debug.missingImportantKeys = missingImportantKeys;
      }
    }

    debug.keysCount = Object.keys(c).length;
    debug.sampleKeys = Object.keys(c).slice(0, 15);
    c._debug = debug;
    return c;
  } catch (e) {
    debug.error = e.message || String(e);
    return { _debug: debug };
  }
}

function getSystemSettingsV2() {
  return getSystemSettings();
}

function repairSettingsSystem() {
  const result = {
    success: false,
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEETS.CONFIG,
    createdSheet: false,
    normalizedRows: 0,
    deletedDuplicates: 0,
    addedDefaults: false,
    cacheCleared: false,
    payload: null
  };

  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEETS.CONFIG);
    if (!sheet) {
      sheet = ss.insertSheet(SHEETS.CONFIG);
      result.createdSheet = true;
    }

    if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 2) {
      sheet.clear();
      sheet.getRange(1, 1, 1, 3).setValues([["คีย์", "ค่า", "คำอธิบาย"]]);
      sheet.getRange(1, 1, 1, 3)
        .setFontWeight("bold")
        .setBackground("#1e3a8a")
        .setFontColor("#ffffff")
        .setHorizontalAlignment("center");
    }

    let data = sheet.getDataRange().getValues();
    const groups = {};
    for (let i = 1; i < data.length; i++) {
      const key = normalizeConfigKey_(data[i][0]);
      if (!key) continue;
      if (!groups[key]) groups[key] = [];
      groups[key].push({
        row: i + 1,
        value: normalizeOnOffConfigValue_(data[i][1]),
        desc: data[i][2] || ""
      });
    }

    const rowsToDelete = [];
    Object.keys(groups).forEach(function(key) {
      const rows = groups[key];
      const keep = rows[0];
      let chosen = rows[0];
      for (let i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i].value || "") !== "") {
          chosen = rows[i];
          break;
        }
      }
      sheet.getRange(keep.row, 1).setValue(key);
      sheet.getRange(keep.row, 2).setValue(chosen.value);
      if (chosen.desc) sheet.getRange(keep.row, 3).setValue(chosen.desc);
      result.normalizedRows++;
      rows.slice(1).forEach(function(item) { rowsToDelete.push(item.row); });
    });

    rowsToDelete.sort(function(a, b) { return b - a; }).forEach(function(row) {
      sheet.deleteRow(row);
      result.deletedDuplicates++;
    });

    initializeConfig(ss);
    result.addedDefaults = true;

    SpreadsheetApp.flush();
    if (typeof _clearConfigCache === "function") _clearConfigCache();
    _clearCodeLocalCache_();
    try { CacheService.getScriptCache().remove("_groupWhitelist_v1"); } catch (e) {}
    result.cacheCleared = true;
    result.payload = getSettingsPayload20260511();
    result.success = true;
    result.message = "Settings repaired and cache cleared";
    Logger.log("repairSettingsSystem => " + JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    result.error = e && e.message ? e.message : String(e);
    Logger.log("repairSettingsSystem ERROR => " + JSON.stringify(result, null, 2));
    return result;
  }
}

function repairFullSystem() {
  const result = {
    success: false,
    structure: null,
    settings: null,
    message: ""
  };
  try {
    result.structure = repairAndUpgradeSheets();
  } catch (e) {
    result.structure = { success: false, error: e && e.message ? e.message : String(e) };
  }
  result.settings = repairSettingsSystem();
  result.success = !!(result.settings && result.settings.success);
  result.message = result.success
    ? "ซ่อมโครงสร้าง + โหลดค่าตั้งค่าจากชีตใหม่แล้ว"
    : "ซ่อมโครงสร้างบางส่วน แต่ซ่อมค่าตั้งค่าไม่สำเร็จ";
  return result;
}

function forceReloadSystemSettings() {
  if (typeof _clearConfigCache === "function") _clearConfigCache();
  _clearCodeLocalCache_();
  try { CacheService.getScriptCache().remove("_groupWhitelist_v1"); } catch (e) {}
  return getSettingsPayload20260511();
}

function _settingsRowsToObject_(rows) {
  const c = {};
  for (let i = 1; i < rows.length; i++) {
    const key = normalizeConfigKey_(rows[i][0]);
    if (!key) continue;
    const value = normalizeOnOffConfigValue_(rows[i][1]);
    if (!Object.prototype.hasOwnProperty.call(c, key) || String(value || "") !== "") {
      c[key] = value;
    }
  }
  return c;
}

function _getSettingsImportantKeys_() {
  return [
    "BOT_STATUS", "MSG_FALLBACK", "POLITE_PREFIX", "POLITE_SUFFIX",
    "NOTIFY_STATUS", "ADMIN_LINE_IDS", "VIP_SECRET_CODE",
    "LOC_SAVE_MSG_STATUS", "LOC_SAVE_MSG_TEXT", "LOCATION_REPLY_MSG", "LOC_ALLOWED_SOURCES",
    "SEARCH_STATUS", "SEARCH_NO_PERM_MSG", "SEARCH_NO_RESULT_MSG", "SEARCH_NO_PERM_MSG_V2",
    "SEARCH_MAX_RESULTS", "SEARCH_USE_FLEX", "SEARCH_KEYWORD", "SEARCH_GROUP_PREFIX",
    "SEARCH_MAX_RESULTS_PER_DB", "SEARCH_MAX_BUBBLES", "SEARCH_WHITELIST_GROUPS",
    "SUMMARY_STATUS", "SUMMARY_INTERVAL", "SUMMARY_TARGETS",
    "PHOTO_SAVE_STATUS", "PHOTO_ALLOWED_IDS", "PHOTO_FOLDER_ID",
    "PHOTO_MAX_WIDTH", "PHOTO_REPLY_MSG", "PHOTO_ALLOWED_SOURCES",
    "PERSONAL_ARCHIVE_STATUS", "PERSONAL_ARCHIVE_ALLOWED_SOURCES", "PERSONAL_ARCHIVE_SEARCH_USER_IDS", "PERSONAL_ARCHIVE_SEARCH_ALLOWED_SOURCES",
    "PERSONAL_ARCHIVE_FOLDER_ID", "PERSONAL_ARCHIVE_IMAGE_MODE", "PERSONAL_ARCHIVE_MAX_WIDTH",
    "PERSONAL_ARCHIVE_JPEG_QUALITY", "PERSONAL_ARCHIVE_COMPRESSOR_URL", "PERSONAL_ARCHIVE_COMPRESSOR_TOKEN",
    "PERSONAL_ARCHIVE_REPLY_STATUS",
    "COURT_STATUS", "COURT_ACCESS", "COURT_SHEET_ID",
    "COURT_SHEET_NAME", "COURT_MAX_RESULTS", "COURT_USE_FLEX", "COURT_FALLBACK_SHEETS",
    "HEALTH_STATUS", "HEALTH_INTERVAL", "HEALTH_TARGETS",
    "ONLINE_COURT_STATUS", "ONLINE_COURT_GROUP_IDS", "ONLINE_COURT_EXCLUDED_IDS", "ONLINE_COURT_PRIVATE_MENU_KEYWORDS", "ONLINE_COURT_GROUP_MENU_KEYWORDS", "ONLINE_COURT_WELCOME_STATUS", "ONLINE_COURT_WELCOME_MSG", "ONLINE_COURT_SCHEDULE_MODE", "ONLINE_COURT_MODE",
    "ONLINE_COURT_REQUIRE_NAME", "ONLINE_COURT_REGISTER_PROMPT",
    "ONLINE_COURT_GROUP_PRIVACY_REPLY", "ONLINE_COURT_MENU_TITLE", "ONLINE_COURT_DAYS",
    "ONLINE_COURT_START_TIME", "ONLINE_COURT_END_TIME", "ONLINE_COURT_FALLBACK_STATUS",
    "ONLINE_COURT_COOLDOWN_MINUTES", "ONLINE_COURT_TRIGGER_KEYWORDS",
    "ONLINE_COURT_JOIN_KEYWORDS", "ONLINE_COURT_PROBLEM_KEYWORDS",
    "ONLINE_COURT_OATH_KEYWORDS", "ONLINE_COURT_CONTACT_KEYWORDS",
    "ONLINE_COURT_JOIN_REPLY", "ONLINE_COURT_PROBLEM_REPLY", "ONLINE_COURT_OATH_REPLY",
    "ONLINE_COURT_CONTACT_REPLY", "ONLINE_COURT_FALLBACK_REPLY",
    "ONLINE_COURT_TOPIC_1_TITLE", "ONLINE_COURT_TOPIC_1_REPLY",
    "ONLINE_COURT_TOPIC_2_TITLE", "ONLINE_COURT_TOPIC_2_REPLY",
    "ONLINE_COURT_TOPIC_3_TITLE", "ONLINE_COURT_TOPIC_3_REPLY",
    "ONLINE_COURT_TOPIC_4_TITLE", "ONLINE_COURT_TOPIC_4_REPLY",
    "ONLINE_COURT_TOPIC_5_TITLE", "ONLINE_COURT_TOPIC_5_REPLY"
  ];
}

function _getSettingsDefaultValues_() {
  return {
    BOT_STATUS: "ON",
    MSG_FALLBACK: "ขออภัยครับไม่พบข้อมูลหรือต้องลงทะเบียนเพื่อเข้าการใช้งานระบบครับ✨",
    POLITE_PREFIX: "สวัสดีครับ ยินดีที่ได้ให้บริการครับ\n\n",
    POLITE_SUFFIX: "",
    NOTIFY_STATUS: "ON",
    ADMIN_LINE_IDS: "",
    VIP_SECRET_CODE: "VIP2026",
    LOC_SAVE_MSG_STATUS: "ON",
    LOC_SAVE_MSG_TEXT: "(บันทึกข้อมูลแล้ว)",
    LOCATION_REPLY_MSG: "📌 บันทึกข้อมูลแล้ว",
    LOC_ALLOWED_SOURCES: "all",
    SEARCH_STATUS: "OFF",
    SEARCH_NO_PERM_MSG: "",
    SEARCH_NO_RESULT_MSG: "",
    SEARCH_NO_PERM_MSG_V2: "",
    SEARCH_MAX_RESULTS: "12",
    SEARCH_USE_FLEX: "ON",
    SEARCH_KEYWORD: "ค้นหา",
    SEARCH_GROUP_PREFIX: "บอท",
    SEARCH_MAX_RESULTS_PER_DB: "12",
    SEARCH_MAX_BUBBLES: "12",
    SEARCH_WHITELIST_GROUPS: "",
    SUMMARY_STATUS: "OFF",
    SUMMARY_INTERVAL: "daily",
    SUMMARY_TARGETS: "admins",
    PHOTO_SAVE_STATUS: "OFF",
    PHOTO_ALLOWED_IDS: "admins",
    PHOTO_FOLDER_ID: "",
    PHOTO_MAX_WIDTH: "800",
    PHOTO_REPLY_MSG: "📸 บันทึกรูปสำเร็จ",
    PHOTO_ALLOWED_SOURCES: "all",
    PERSONAL_ARCHIVE_STATUS: "OFF",
    PERSONAL_ARCHIVE_ALLOWED_SOURCES: "",
    PERSONAL_ARCHIVE_SEARCH_USER_IDS: "admins",
    PERSONAL_ARCHIVE_SEARCH_ALLOWED_SOURCES: "private",
    PERSONAL_ARCHIVE_FOLDER_ID: "",
    PERSONAL_ARCHIVE_IMAGE_MODE: "ORIGINAL",
    PERSONAL_ARCHIVE_MAX_WIDTH: "800",
    PERSONAL_ARCHIVE_JPEG_QUALITY: "75",
    PERSONAL_ARCHIVE_COMPRESSOR_URL: "",
    PERSONAL_ARCHIVE_COMPRESSOR_TOKEN: "",
    PERSONAL_ARCHIVE_REPLY_STATUS: "OFF",
    COURT_STATUS: "OFF",
    COURT_ACCESS: "vip",
    COURT_SHEET_ID: "",
    COURT_SHEET_NAME: "Database",
    COURT_MAX_RESULTS: "10",
    COURT_USE_FLEX: "ON",
    COURT_FALLBACK_SHEETS: "Database_LastWeek",
    HEALTH_STATUS: "OFF",
    HEALTH_INTERVAL: "daily",
    HEALTH_TARGETS: "admins",
    ONLINE_COURT_STATUS: "OFF",
    ONLINE_COURT_GROUP_IDS: "",
    ONLINE_COURT_EXCLUDED_IDS: "",
    ONLINE_COURT_PRIVATE_MENU_KEYWORDS: "ศูนย์ประสานงานคดี",
    ONLINE_COURT_GROUP_MENU_KEYWORDS: "ศูนย์ประสานงานคดี",
    ONLINE_COURT_WELCOME_STATUS: "ON",
    ONLINE_COURT_WELCOME_MSG: "สวัสดีครับ/ค่ะ ยินดีต้อนรับสู่ศูนย์ประสานงานคดีออนไลน์ ศาลจังหวัดลพบุรี\nให้บริการแนะนำการเข้าร่วมพิจารณาคดีออนไลน์ ข้อปฏิบัติ ตัวอย่างคำสาบานตน การแก้ปัญหาเบื้องต้น และช่องทางติดต่อเจ้าหน้าที่\nเริ่มต้นได้โดยพิมพ์คำว่า “ศูนย์ประสานงานคดี” หรือกดปุ่มด้านล่างเพื่อดูเมนูทั้งหมด",
    ONLINE_COURT_SCHEDULE_MODE: "business_hours",
    ONLINE_COURT_MODE: "register_then_menu",
    ONLINE_COURT_REQUIRE_NAME: "ON",
    ONLINE_COURT_REGISTER_PROMPT: "สวัสดีครับ/ค่ะ ศูนย์ประสานงานคดีออนไลน์\nเพื่อให้เจ้าหน้าที่ตรวจสอบข้อมูลได้ถูกต้อง กรุณาระบุชื่อ-สกุล และเลขคดี/บัลลังก์/เวลานัด หากทราบ",
    ONLINE_COURT_GROUP_PRIVACY_REPLY: "ศูนย์ประสานงานคดีออนไลน์รับทราบครับ/ค่ะ\nเพื่อคุ้มครองข้อมูลส่วนบุคคล หากต้องแจ้งชื่อ-สกุล เลขคดี บัลลังก์ หรือเวลานัด กรุณาเพิ่มเพื่อนบอทและแจ้งข้อมูลในแชทส่วนตัว\nระหว่างนี้สามารถพิมพ์เลขหัวข้อเพื่อดูคำแนะนำทั่วไปได้",
    ONLINE_COURT_MENU_TITLE: "ศูนย์ประสานงานคดีออนไลน์\nกรุณาเลือกหัวข้อที่ต้องการสอบถาม",
    ONLINE_COURT_DAYS: "MON,TUE,WED,THU,FRI",
    ONLINE_COURT_START_TIME: "08.00 น.",
    ONLINE_COURT_END_TIME: "16.30 น.",
    ONLINE_COURT_FALLBACK_STATUS: "OFF",
    ONLINE_COURT_COOLDOWN_MINUTES: "3",
    ONLINE_COURT_TRIGGER_KEYWORDS: "ทนาย,โจทก์,จำเลย,คดี,นัดวันนี้,ออนไลน์,เข้าร่วม,รอเข้า,ขอเข้า,เข้าไม่ได้,บัลลังก์,บ1,บ2,บ3,บ4,บ5,บ6,บ7,บ8,คำสาบาน,สาบานตน,ศูนย์ประสานงานคดี,การเข้าใช้งาน,เตรียมความพร้อม,พิจารณาคดีออนไลน์,ห้องพิจารณาคดีอิเล็กทรอนิกส์,โน้ต,โน๊ต",
    ONLINE_COURT_JOIN_KEYWORDS: "ทนาย,โจทก์,จำเลย,คดี,นัดวันนี้,ออนไลน์,เข้าร่วม,รอเข้า,ขอเข้า,ขออนุญาต,ศูนย์ประสานงานคดี",
    ONLINE_COURT_PROBLEM_KEYWORDS: "เข้าไม่ได้,ใช้งานไม่ได้,เข้าไม่ติด,ลิงก์ไม่ได้,เสียงไม่ได้,ไม่ได้ยิน,กล้องไม่ได้,ไมค์ไม่ได้,ไมโครโฟนไม่ได้,หลุด",
    ONLINE_COURT_OATH_KEYWORDS: "คำสาบาน,สาบานตน,สาบาน,การเข้าใช้งาน,เตรียมความพร้อม,พิจารณาคดีออนไลน์,เข้าร่วมพิจารณาคดี,ห้องพิจารณาคดีอิเล็กทรอนิกส์,โน้ต,โน๊ต,โนต",
    ONLINE_COURT_CONTACT_KEYWORDS: "ติดต่อเจ้าหน้าที่,หาเจ้าหน้าที่,เจ้าหน้าที่ช่วย,โทร,เบอร์,ไกล่เกลี่ย",
    ONLINE_COURT_JOIN_REPLY: "รับทราบครับ/ค่ะ ท่านแจ้งเข้าร่วมพิจารณาคดีออนไลน์แล้ว\nกรุณารอเจ้าหน้าที่ตรวจสอบชื่อ เลขคดี และลำดับนัด จากนั้นเจ้าหน้าที่จะเชิญเข้าห้องพิจารณาคดีตามลำดับ\nระหว่างรอ กรุณาตั้งชื่อแสดงผลให้ตรวจสอบได้ เช่น ชื่อ-สกุล/ฝ่าย/เลขคดี และเปิดการแจ้งเตือนของ LINE ไว้",
    ONLINE_COURT_PROBLEM_REPLY: "กรณีเข้าออนไลน์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต กล้อง ไมโครโฟน ชื่อแสดงผล และลองออกเข้าใหม่อีกครั้ง\nหากได้รับแจ้งบัลลังก์ เช่น บ1-บ8 ให้รอในศูนย์ประสานงานคดี เจ้าหน้าที่จะตรวจสอบและเชิญเข้าห้องตามลำดับ",
    ONLINE_COURT_OATH_REPLY: "📌 การเข้าใช้งานห้องพิจารณาคดีอิเล็กทรอนิกส์\n1. กรุณาอ่านโน้ตสำคัญในกลุ่มนี้ก่อนเข้าร่วม\n2. เตรียมบัตรประชาชน/เอกสารที่เกี่ยวข้อง และตั้งชื่อแสดงผลให้ตรวจสอบได้\n3. อยู่ในที่สงบ แต่งกายสุภาพ เปิดกล้อง/ไมโครโฟนเมื่อศาลหรือเจ้าหน้าที่แจ้ง\n4. กรณีสาบานตน ให้กล่าวตามถ้อยคำที่ศาลหรือเจ้าหน้าที่แจ้งในห้องพิจารณา\n5. ระหว่างรอ กรุณาอย่าออกจากกลุ่มหรือปิดการแจ้งเตือน",
    ONLINE_COURT_CONTACT_REPLY: "หากดำเนินการตามคำแนะนำแล้วยังไม่สามารถเข้าร่วมได้ กรุณาแจ้งชื่อ-สกุล เลขคดี เบอร์ติดต่อ และบัลลังก์/เวลานัดที่ได้รับแจ้ง เพื่อให้เจ้าหน้าที่ศูนย์ประสานงานคดีตรวจสอบเป็นลำดับสุดท้าย",
    ONLINE_COURT_FALLBACK_REPLY: "กรุณาติดต่อเจ้าหน้าที่ศูนย์ประสานงานคดี หรือแจ้งชื่อ-สกุล เลขคดี และช่องทางออนไลน์ที่ได้รับแจ้ง",
    ONLINE_COURT_TOPIC_1_TITLE: "การเข้าใช้งาน",
    ONLINE_COURT_TOPIC_1_REPLY: "กรุณาตรวจสอบลิงก์ห้องพิจารณาคดีออนไลน์ อินเทอร์เน็ต กล้อง ไมโครโฟน และตั้งชื่อแสดงผลให้ตรวจสอบได้ เช่น ชื่อ-สกุล/ฝ่าย/เลขคดี จากนั้นรอเจ้าหน้าที่เชิญเข้าห้องตามลำดับ",
    ONLINE_COURT_TOPIC_2_TITLE: "ข้อปฏิบัติการใช้งานออนไลน์",
    ONLINE_COURT_TOPIC_2_REPLY: "กรุณาอยู่ในสถานที่สงบ แต่งกายสุภาพ เตรียมบัตรประชาชนหรือเอกสารที่เกี่ยวข้อง เปิดกล้องเมื่อศาลหรือเจ้าหน้าที่แจ้ง และปิดไมโครโฟนไว้ก่อนจนกว่าจะได้รับอนุญาตให้พูด",
    ONLINE_COURT_TOPIC_3_TITLE: "ตัวอย่างคำสาบานตน",
    ONLINE_COURT_TOPIC_3_REPLY: "กรณีต้องสาบานตน ให้กล่าวตามถ้อยคำที่ศาลหรือเจ้าหน้าที่แจ้งในห้องพิจารณา และปฏิบัติตามคำแนะนำของศาลอย่างเคร่งครัด",
    ONLINE_COURT_TOPIC_4_TITLE: "ปัญหาในการใช้งานและการแก้ไขเบื้องต้น",
    ONLINE_COURT_TOPIC_4_REPLY: "หากเข้าไม่ได้ เสียงไม่ได้ยิน หรือกล้อง/ไมโครโฟนมีปัญหา กรุณาตรวจสอบอินเทอร์เน็ต ออกจากห้องแล้วเข้าใหม่ และแจ้งอาการพร้อมชื่อ-สกุล เลขคดี บัลลังก์ หรือเวลานัดที่ได้รับแจ้ง",
    ONLINE_COURT_TOPIC_5_TITLE: "ติดต่อเจ้าหน้าที่",
    ONLINE_COURT_TOPIC_5_REPLY: "หากยังไม่สามารถดำเนินการได้ กรุณาแจ้งชื่อ-สกุล เลขคดี เบอร์ติดต่อ บัลลังก์ และเวลานัด เพื่อให้เจ้าหน้าที่ศูนย์ประสานงานคดีตรวจสอบต่อไป"
  };
}

function _normalizeSettingsMap_(settings) {
  const normalized = {};
  Object.keys(settings || {}).forEach(function(key) {
    if (key === "_debug") return;
    const cleanKey = normalizeConfigKey_(key);
    if (!cleanKey) return;
    normalized[cleanKey] = normalizeOnOffConfigValue_(settings[key]);
  });
  return normalized;
}

function _fillSettingsFromGetConfig_(settings) {
  const result = settings || {};
  const fallbackKeys = [];
  const defaultKeys = [];
  const defaults = _getSettingsDefaultValues_();
  _getSettingsImportantKeys_().forEach(function(key) {
    const current = result[key];
    if (current !== undefined && current !== null && String(current) !== "") return;
    try {
      const value = getConfig(key);
      if (value !== null && value !== undefined && String(value) !== "") {
        result[key] = value;
        fallbackKeys.push(key);
      }
    } catch (e) {}
    if ((result[key] === undefined || result[key] === null || String(result[key]) === "") &&
        Object.prototype.hasOwnProperty.call(defaults, key)) {
      result[key] = defaults[key];
      defaultKeys.push(key);
    }
  });

  if (!result.LOC_SAVE_MSG_TEXT && result.LOCATION_REPLY_MSG) {
    result.LOC_SAVE_MSG_TEXT = result.LOCATION_REPLY_MSG;
  }
  if (!result.LOCATION_REPLY_MSG && result.LOC_SAVE_MSG_TEXT) {
    result.LOCATION_REPLY_MSG = result.LOC_SAVE_MSG_TEXT;
  }

  return { settings: result, fallbackKeys: fallbackKeys, defaultKeys: defaultKeys };
}

function getSettingsPayload20260511() {
  try {
    const rawSettings = getSystemSettings() || {};
    const debug = rawSettings._debug || {};
    const rawNormalizedSettings = _normalizeSettingsMap_(rawSettings);
    const sheetKeys = Object.keys(rawNormalizedSettings || {});
    const sheetHasBotStatus = Object.prototype.hasOwnProperty.call(rawNormalizedSettings, "BOT_STATUS");
    let settings = rawNormalizedSettings;
    const fallback = _fillSettingsFromGetConfig_(settings);
    settings = fallback.settings;
    settings._debug = debug;
    settings._debug.fallbackKeys = fallback.fallbackKeys;
    settings._debug.defaultKeys = fallback.defaultKeys;
    const keys = Object.keys(settings || {}).filter(function(key) { return key !== "_debug"; });
    const rawLoadedKeys = Number(debug.keysCount) || sheetKeys.length;
    const payload = {
      ok: !debug.error && rawLoadedKeys >= 10 && sheetHasBotStatus,
      settings: settings,
      loadedKeys: keys.length,
      rawLoadedKeys: rawLoadedKeys,
      sheetLoadedKeys: sheetKeys.length,
      hasBotStatus: !!(settings && settings.BOT_STATUS),
      sheetHasBotStatus: sheetHasBotStatus,
      debug: debug,
      serverTime: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
    };
    Logger.log("getSettingsPayload20260511 => " + JSON.stringify({
      ok: payload.ok,
      loadedKeys: payload.loadedKeys,
      hasBotStatus: payload.hasBotStatus,
      sampleKeys: keys.slice(0, 20),
      debug: payload.debug
    }, null, 2));
    return payload;
  } catch (e) {
    const payload = {
      ok: false,
      settings: {},
      loadedKeys: 0,
      hasBotStatus: false,
      debug: { error: e.message || String(e), stack: e.stack || "" },
      serverTime: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
    };
    Logger.log("getSettingsPayload20260511 ERROR => " + JSON.stringify(payload, null, 2));
    return payload;
  }
}

function saveMultipleConfigs(c) {
  try {
    const inputKeys = Object.keys(c || {});
    if (inputKeys.length > 10 && c.__CLIENT_LOADED_OK !== "1") {
      return {
        success: false,
        error: "Dashboard ยังโหลดค่าจากชีตไม่สมบูรณ์หรือเป็นหน้าเก่า จึงไม่บันทึกเพื่อกันค่าถูกรีเซ็ต",
        saved: 0
      };
    }
    const saved = [];
    for (let k in c) {
      if (String(k).indexOf("__") === 0) continue;
      setConfig(k, c[k]);
      saved.push(k);
    }
    if (typeof _clearConfigCache === "function") _clearConfigCache();
    return {success: true, saved: saved.length, keys: saved};
  } catch(e) { return {success: false, error: String(e)}; }
}

// OnlineCourt dashboard save/debug endpoints are implemented in OnlineCourt.gs.

function debugConfigWriteTest() {
  const key = "_CONFIG_WRITE_TEST";
  const marker = "OK_" + new Date().getTime();
  const result = {
    key: key,
    marker: marker,
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEETS.CONFIG
  };
  try {
    setConfig(key, marker);
    SpreadsheetApp.flush();
    if (typeof _clearConfigCache === "function") _clearConfigCache();
    result.readByGetConfig = getConfig(key);
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.CONFIG);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === key) {
        result.row = i + 1;
        result.rawSheetValue = data[i][1];
        break;
      }
    }
    result.success = result.readByGetConfig === marker && result.rawSheetValue === marker;
  } catch (e) {
    result.success = false;
    result.error = e.message || String(e);
  }
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function handleAdminCommand(msg, uid, rt) {
  if (msg.startsWith("/สอน ")) {
    const p = msg.replace("/สอน ", "").split("|");
    if (p.length < 2) { safeSendReply(rt, "❌ /สอน คำถาม | คำตอบ"); return "__HANDLED__"; }
    SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.KNOWLEDGE).appendRow([
      "K" + new Date().getTime(), p[0].trim(), p[1].trim(), "ทั่วไป", "",
      "Active", "Public",
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
    ]);
    safeSendReply(rt, "✅ สอนบอทสำเร็จ");
    return "__HANDLED__";
  }
  if (msg === "/รายการ") {
    const d = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.KNOWLEDGE).getDataRange().getValues();
    if (d.length <= 1) { safeSendReply(rt, "📭 ว่างเปล่า"); return "__HANDLED__"; }
    let t = "📚 10 อันดับล่าสุด:\n\n";
    let c = 0;
    for (let i = d.length - 1; i >= 1 && c < 10; i--) {
      t += "ID: " + d[i][0] + "\n❓ " + d[i][1] + "\n---\n";
      c++;
    }
    safeSendReply(rt, t);
    return "__HANDLED__";
  }
  if (msg.startsWith("/แก้ไข ")) {
    const p = msg.replace("/แก้ไข ", "").split("|");
    if (p.length < 2) { safeSendReply(rt, "❌ /แก้ไข ID | คำตอบใหม่"); return "__HANDLED__"; }
    const s = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.KNOWLEDGE);
    const d = s.getDataRange().getValues();
    let f = false;
    for (let i = 1; i < d.length; i++) {
      if (String(d[i][0]) === p[0].trim()) { s.getRange(i+1, 3).setValue(p[1].trim()); f = true; break; }
    }
    safeSendReply(rt, f ? "✅ แก้ไขสำเร็จ" : "❌ ไม่พบ ID");
    return "__HANDLED__";
  }
  if (msg.startsWith("/ลบ ")) {
    const id = msg.replace("/ลบ ", "").trim();
    const s = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.KNOWLEDGE);
    const d = s.getDataRange().getValues();
    let f = false;
    for (let i = 1; i < d.length; i++) {
      if (String(d[i][0]) === id) { s.deleteRow(i+1); f = true; break; }
    }
    safeSendReply(rt, f ? "✅ ลบสำเร็จ" : "❌ ไม่พบ ID");
    return "__HANDLED__";
  }
  if (msg.startsWith("/แจ้งเตือน ")) {
    sendLineNotification({title: "", body: msg.replace("/แจ้งเตือน ", "").trim(), targets: ["all"]});
    safeSendReply(rt, "✅ ส่ง Broadcast แล้ว");
    return "__HANDLED__";
  }
  if (msg === "/จำนวนรวม" || msg === "/สถิติ") {
    const d = getQuickStats();
    safeSendReply(rt,
      "📊 สถิติระบบ\n" +
      "👥 ผู้ใช้ทั้งหมด: " + d.totalUsers + " คน\n" +
      "💬 คำถามวันนี้: " + d.todayQuestions + " ครั้ง\n" +
      "✅ ตอบสำเร็จ: " + d.totalSuccess + "/" + d.totalQuestions + " (" + d.successRate + "%)\n" +
      "🔔 แจ้งเตือน: " + d.notifySent + " แคมเปญ"
    );
    return "__HANDLED__";
  }
  if (msg === "/บอท เปิด") { setConfig("BOT_STATUS", "ON"); safeSendReply(rt, "🟢 เปิดบอทแล้ว"); return "__HANDLED__"; }
  if (msg === "/บอท ปิด") { setConfig("BOT_STATUS", "OFF"); safeSendReply(rt, "🔴 ปิดบอทแล้ว"); return "__HANDLED__"; }
  return "";
}

function testLineNotify() {
  const a = getAdminIds();
  if (a.length === 0) return {success: false, error: "ไม่พบ Admin ID"};
  a.forEach(id => _linePush(id, "🧪 ทดสอบระบบแจ้งเตือน"));
  return {success: true, message: "ส่งทดสอบแล้ว"};
}

// ==========================================
// 📸 ระบบรับรูปภาพหลักฐาน + ย่อรูป + ตั้งชื่อ
// ==========================================
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function _thaiDateShort(d) {
  const dd = d.getDate();
  const mm = TH_MONTHS[d.getMonth()];
  const yy = (d.getFullYear() + 543) % 100;
  const hh = ("0" + d.getHours()).slice(-2);
  const mi = ("0" + d.getMinutes()).slice(-2);
  return dd + mm + yy + "_" + hh + mi;
}

function _isPhotoAllowed(userId, role) {
  const allowed = getConfig("PHOTO_ALLOWED_IDS") || "admins";
  if (allowed.trim().toLowerCase() === "all") return true;
  const parts = allowed.split(",").map(s => s.trim());
  const partsLower = parts.map(s => s.toLowerCase());
  if (partsLower.includes("admins") && isAdmin(userId)) return true;
  if (partsLower.includes("vip") && (String(role || "").trim().toUpperCase() === "VIP" || isAdmin(userId))) return true;
  if (parts.includes(userId)) return true;
  return false;
}

function _isPhotoSourceAllowed(sourceId, isGroup) {
  return _isSourceAllowed(getConfig("PHOTO_ALLOWED_SOURCES") || "all", sourceId, isGroup);
}

function _isLocationAllowed(userId, role, sourceId, isGroup) {
  const sourceOk = _isSourceAllowed(getConfig("LOC_ALLOWED_SOURCES") || "all", sourceId, isGroup);
  if (!sourceOk) return false;
  const user = getUserByLineId(userId);
  const status = String(user && user.status || "Active").trim().toLowerCase();
  if (status === "blocked" || status === "ระงับ" || status === "ปิด") return false;
  return true;
}

function _isSourceAllowed(allowedRaw, sourceId, isGroup) {
  const allowed = (allowedRaw || "all").trim().toLowerCase();
  if (allowed === "all" || allowed === "") return true;
  const parts = (allowedRaw || "").split(",").map(s => s.trim()).filter(Boolean);
  const partsLower = parts.map(s => s.toLowerCase());
  if (partsLower.includes("private") && !isGroup) return true;
  if (partsLower.includes("groups") && isGroup) return true;
  if (parts.includes(sourceId)) return true;
  return false;
}

function _downloadAndSavePhoto(messageId, userId, userName, groupId) {
  let folder = _getOrCreatePhotoFolder();
  if (!folder) return { ok: false, message: "ไม่สามารถสร้าง/เข้าถึง Drive ได้" };

  const url = "https://api-data.line.me/v2/bot/message/" + messageId + "/content";
  const res = UrlFetchApp.fetch(url, {
    headers: getLineAuthHeaders_(),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return { ok: false, message: "ดาวน์โหลดรูปไม่ได้ HTTP " + res.getResponseCode() };

  const blob = res.getBlob();
  const now = new Date();
  const shortName = (userName || "user").substring(0, 10).replace(/\s+/g, "");
  const fileName = "หมาย_" + _thaiDateShort(now) + "_" + shortName + ".jpg";
  blob.setName(fileName).setContentType("image/jpeg");

  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const originalUrl = file.getUrl();
  const fileId = file.getId();
  const fileUrl = _driveThumbnailUrl_(fileId, getConfig("PHOTO_MAX_WIDTH") || "800") || originalUrl;

  let houseNum = "";
  try {
    const locSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
    if (locSheet && locSheet.getLastRow() > 1) {
      const locData = locSheet.getDataRange().getValues();
      const useGroupHouse = groupId && typeof _isMissionGroup === "function" && _isMissionGroup(groupId);
      for (let i = locData.length - 1; i > 0; i--) {
        const sameSession = useGroupHouse
          ? String(locData[i][7] || "") === String(groupId)
          : locData[i][2] === userId;
        if (sameSession && locData[i][3]) { houseNum = String(locData[i][3]); break; }
      }
    }
  } catch (e) {}

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let pSheet = ss.getSheetByName(SHEETS.PHOTOS);
  if (!pSheet) {
    pSheet = ss.insertSheet(SHEETS.PHOTOS);
    pSheet.appendRow(["ID", "เวลา", "ผู้ส่ง (Line ID)", "ชื่อผู้ส่ง", "บ้านเลขที่", "URL รูป", "Group ID", "Loc ID"]);
    pSheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#1e3a8a").setFontColor("#ffffff");
  } else if (pSheet.getLastColumn() < 8) {
    pSheet.getRange(1, 8).setValue("Loc ID").setFontWeight("bold").setBackground("#1e3a8a").setFontColor("#ffffff");
  }

  const photoRowId = _withScriptLock_(5000, function() {
    const rowId = "PH" + Date.now();
    pSheet.appendRow([
      rowId,
      Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      userId, userName, houseNum, fileUrl, groupId, ""
    ]);
    return rowId;
  });

  return { ok: true, url: fileUrl, originalUrl: originalUrl, fileName: fileName, photoRowId: photoRowId };
}

// ══════════════════════════════════════════════════════════════
// 📁 Auto-Create Photo Folder
// ══════════════════════════════════════════════════════════════
function _getPhotoFolderName() {
  const courtName = getConfig("COURT_NAME") || getConfig("ORGANIZATION_NAME") || "ศาลจังหวัดลพบุรี";
  return courtName + " - รูปภาพหลักฐาน";
}

function _getOrCreatePhotoFolder() {
  const folderId = getConfig("PHOTO_FOLDER_ID");
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  try {
    const name = _getPhotoFolderName();
    const folder = DriveApp.createFolder(name);
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    setConfig("PHOTO_FOLDER_ID", folder.getId());
    Logger.log("📁 สร้างโฟลเดอร์ใหม่อัตโนมัติ: " + name);
    return folder;
  } catch (e) {
    Logger.log("❌ สร้างโฟลเดอร์ไม่ได้: " + e.message);
    return null;
  }
}

function autoCreatePhotoFolder() {
  try {
    const existingId = getConfig("PHOTO_FOLDER_ID");
    if (existingId) {
      try {
        const existing = DriveApp.getFolderById(existingId);
        return {
          success: true, reused: true,
          folderId: existingId, folderUrl: existing.getUrl(), folderName: existing.getName(),
          message: "มีโฟลเดอร์อยู่แล้ว: " + existing.getName()
        };
      } catch (e) {}
    }
    const name = _getPhotoFolderName();
    const folder = DriveApp.createFolder(name);
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    setConfig("PHOTO_FOLDER_ID", folder.getId());
    return {
      success: true, reused: false,
      folderId: folder.getId(), folderUrl: folder.getUrl(), folderName: name,
      message: "สร้างโฟลเดอร์ใหม่สำเร็จ: " + name
    };
  } catch (e) { return { success: false, error: String(e) }; }
}

function checkPhotoFolder() {
  try {
    const folderId = getConfig("PHOTO_FOLDER_ID");
    if (!folderId) return { success: false, status: "empty", message: "ยังไม่ได้สร้างโฟลเดอร์" };
    try {
      const folder = DriveApp.getFolderById(folderId);
      const files = folder.getFiles();
      let count = 0;
      while (files.hasNext() && count < 1000) { files.next(); count++; }
      const hasMore = files.hasNext();
      return {
        success: true, status: "ok",
        folderId: folderId, folderUrl: folder.getUrl(), folderName: folder.getName(),
        fileCount: count, fileCountLabel: hasMore ? (count + "+") : String(count),
        createdAt: Utilities.formatDate(folder.getDateCreated(), Session.getScriptTimeZone(), "dd/MM/yyyy")
      };
    } catch (e) {
      return { success: false, status: "broken", folderId: folderId, message: "โฟลเดอร์ถูกลบหรือเข้าถึงไม่ได้" };
    }
  } catch (e) { return { success: false, status: "error", error: String(e) }; }
}

function unlinkPhotoFolder() {
  try {
    setConfig("PHOTO_FOLDER_ID", "");
    return { success: true, message: "ปลดล็อกโฟลเดอร์แล้ว (ของเดิมใน Drive ยังอยู่)" };
  } catch (e) { return { success: false, error: String(e) }; }
}

// ══════════════════════════════════════════════════════════════════════
// 🔍 ค้นหาสถานะหมายจากบ้านเลขที่ — REWRITE v3 → Flex Carousel
// ══════════════════════════════════════════════════════════════════════
//
// 🆕 v10.3 Changes:
//   ✨ Return Flex Message (Carousel) แทน text plain
//   ✨ Filter dirty records (ตัด user/group ID, ค้นหา command, etc.)
//   ✨ Group by lat,lng (ลด duplicate)
//   ✨ มีปุ่มเปิด Google Maps
//   ✨ Fallback กลับไป text ถ้า config SEARCH_USE_FLEX = OFF
//
// ──────────────────────────────────────────────────────────────────────
// Flex Builders
// ──────────────────────────────────────────────────────────────────────

/**
 * 🎨 Flex: ระบบว่าง (ไม่มีข้อมูลเลย)
 */
/**
 * 🎨 Flex: ไม่พบผลลัพธ์
 */
/**
 * 🎨 Flex: ผลการค้นหา (Carousel)
 */
/**
 * 🎨 Flex: 1 bubble ของผลลัพธ์
 */
// ==========================================
// 📊 สรุปสถิติอัตโนมัติ
// ==========================================
function sendAutoSummary() {
  try {
    if (getConfig("SUMMARY_STATUS") !== "ON") return;
    const stats = getDashboardData().stats;
    const locSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
    const locCount = locSheet ? Math.max(0, locSheet.getLastRow() - 1) : 0;
    const photoSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.PHOTOS);
    const photoCount = photoSheet ? Math.max(0, photoSheet.getLastRow() - 1) : 0;

    const now = new Date();
    const interval = getConfig("SUMMARY_INTERVAL") || "daily";
    let period = "";
    if (interval === "daily") period = "ประจำวันที่ " + now.getDate() + " " + TH_MONTHS[now.getMonth()] + " " + (now.getFullYear() + 543);
    else if (interval === "weekly") period = "ประจำสัปดาห์ (สิ้นสุด " + now.getDate() + " " + TH_MONTHS[now.getMonth()] + ")";
    else if (interval === "monthly") period = "ประจำเดือน " + TH_MONTHS[now.getMonth()] + " " + (now.getFullYear() + 543);

    const msg = "📊 สรุปสถิติระบบ\n" + period + "\n"
      + "━━━━━━━━━━━━━━━━\n"
      + "👥 ผู้ใช้ทั้งหมด: " + stats.totalUsers + " คน\n"
      + "💬 คำถามวันนี้: " + stats.todayQuestions + " ครั้ง\n"
      + "✅ ตอบสำเร็จ: " + stats.totalSuccess + "/" + stats.totalQuestions + " (" + stats.successRate + "%)\n"
      + "🔔 แจ้งเตือน: " + stats.notifySent + " รายการ\n"
      + "📍 พิกัดทั้งหมด: " + locCount + " รายการ\n"
      + "📸 รูปหลักฐาน: " + photoCount + " รูป\n"
      + "━━━━━━━━━━━━━━━━\n"
      + "⏱️ รายงาน ณ " + Utilities.formatDate(now, Session.getScriptTimeZone(), "HH:mm") + " น.";

    const targets = getConfig("SUMMARY_TARGETS") || "admins";
    sendLineNotification({ title: "", body: msg, targets: targets });
  } catch (e) { Logger.log("sendAutoSummary error: " + e); }
}

function setupSummaryTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "sendAutoSummary") ScriptApp.deleteTrigger(t);
  });
  if (getConfig("SUMMARY_STATUS") !== "ON") return { success: true, message: "ปิดระบบสรุปสถิติแล้ว" };
  const interval = getConfig("SUMMARY_INTERVAL") || "daily";
  const builder = ScriptApp.newTrigger("sendAutoSummary").timeBased();
  if (interval === "daily") builder.everyDays(1).atHour(18).create();
  else if (interval === "weekly") builder.everyWeeks(1).onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(18).create();
  else if (interval === "monthly") builder.onMonthDay(28).atHour(18).create();
  return { success: true, message: "ตั้งเวลาสรุป " + interval + " สำเร็จ" };
}

function saveSummarySettings(params) {
  try {
    setConfig("SUMMARY_STATUS", params.status || "OFF");
    setConfig("SUMMARY_INTERVAL", params.interval || "daily");
    setConfig("SUMMARY_TARGETS", params.targets || "admins");
    return setupSummaryTrigger();
  } catch (e) { return { success: false, error: String(e) }; }
}

function testSummary() {
  try { sendAutoSummary(); return { success: true, message: "ส่งสรุปทดสอบแล้ว" }; }
  catch (e) { return { success: false, error: String(e) }; }
}

function getPhotoStats() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const pSheet = ss.getSheetByName(SHEETS.PHOTOS);
    if (!pSheet || pSheet.getLastRow() <= 1) return { total: 0, today: 0, recent: [] };
    const data = pSheet.getDataRange().getValues();
    const todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
    let today = 0;
    const recent = [];
    for (let i = data.length - 1; i >= 1; i--) {
      const ts = data[i][1] ? Utilities.formatDate(new Date(data[i][1]), Session.getScriptTimeZone(), "yyyy-MM-dd") : "";
      if (ts === todayStr) today++;
      if (recent.length < 10) {
        recent.push({
          ts: data[i][1] ? Utilities.formatDate(new Date(data[i][1]), Session.getScriptTimeZone(), "dd/MM/yy HH:mm") : "",
          name: data[i][3] || "", house: data[i][4] || "", url: data[i][5] || ""
        });
      }
    }
    return { total: data.length - 1, today: today, recent: recent };
  } catch (e) { return { total: 0, today: 0, recent: [] }; }
}

// ==========================================
// 🔍 ระบบค้นหาข้อมูลจากฐานภายนอก (Smart Search)
// ==========================================

function getSearchDatabases() {
  try {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SEARCH_DB);
    if (!sh || sh.getLastRow() <= 1) return [];
    return sh.getDataRange().getValues().slice(1).map(r => ({
      id: String(r[0] || "").trim(), name: String(r[1] || "").trim(), icon: String(r[2] || "📋").trim(), sheetId: String(r[3] || "").trim(), sheetName: String(r[4] || "").trim(),
      access: String(r[5] || "Internal").trim(), status: String(r[6] || "ON").trim(),
      created: r[7] ? Utilities.formatDate(new Date(r[7]), Session.getScriptTimeZone(), "dd/MM/yy") : ""
    }));
  } catch (e) { return []; }
}

function addSearchDatabase(d) {
  try {
    if (!d || !d.name || !d.sheetId || !d.sheetName) {
      return { success: false, error: "กรุณากรอกชื่อฐาน, Sheet ID และชื่อชีทให้ครบ" };
    }

    const name = String(d.name).trim();
    const sheetId = String(d.sheetId).trim();
    const sheetName = String(d.sheetName).trim();

    if (!/^[a-zA-Z0-9_-]{20,100}$/.test(sheetId)) {
      return {
        success: false,
        error: "❌ Sheet ID ไม่ถูกต้อง\n\nต้องเป็นรหัสยาว ~44 ตัวที่คัดลอกจาก URL\nตัวอย่าง: https://docs.google.com/spreadsheets/d/<คัดลอกส่วนนี้>/edit"
      };
    }

    let sh;
    try {
      sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SEARCH_DB);
      if (!sh) return { success: false, error: "ไม่พบชีท 'ฐานค้นหา' ในระบบ กรุณากดปุ่ม '⚙️ ซ่อมแซม' ก่อน" };
    } catch (e) {
      Logger.log("addSearchDatabase: cannot open main sheet - " + e.message);
      return { success: false, error: "ไม่สามารถเข้าถึงระบบฐานข้อมูลหลักได้: " + e.message };
    }

    try {
      const targetSS = SpreadsheetApp.openById(sheetId);
      const targetSheet = targetSS.getSheetByName(sheetName);
      if (!targetSheet) {
        const available = targetSS.getSheets().map(s => s.getName()).join(", ");
        return { success: false, error: "❌ ไม่พบชีท '" + sheetName + "' ใน Spreadsheet ที่ระบุ\n\nชีทที่มี: " + available };
      }
    } catch (e) {
      Logger.log("addSearchDatabase: cannot open target sheet - " + e.message);
      const m = e.message || String(e);
      if (m.includes("not found") || m.includes("ไม่พบ") || m.includes("does not exist")) {
        return { success: false, error: "❌ ไม่พบ Spreadsheet นี้ — ตรวจสอบว่า Sheet ID ถูกต้อง" };
      }
      if (m.includes("permission") || m.includes("access") || m.includes("denied")) {
        return { success: false, error: "❌ ไม่มีสิทธิ์เข้าถึง Spreadsheet นี้\n\nให้เปิดสิทธิ์ให้บัญชี Apps Script ของระบบก่อน" };
      }
      return { success: false, error: "❌ เปิด Spreadsheet ไม่ได้: " + m };
    }

    const newId = "DB" + Date.now();
    sh.appendRow([
      newId, name, d.icon || "📋", sheetId, sheetName,
      d.access || "Internal", "ON",
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
    ]);
    Logger.log("addSearchDatabase: added '" + name + "' (" + newId + ")");
    return { success: true, message: "เพิ่มฐาน '" + name + "' สำเร็จ", id: newId };
  } catch (e) {
    Logger.log("addSearchDatabase: unexpected error - " + e.message + "\n" + e.stack);
    return { success: false, error: "เกิดข้อผิดพลาด: " + String(e.message || e) };
  }
}

function updateSearchDatabase(d) {
  try {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SEARCH_DB);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(d.id)) {
        if (d.name !== undefined) sh.getRange(i+1, 2).setValue(d.name);
        if (d.icon !== undefined) sh.getRange(i+1, 3).setValue(d.icon);
        if (d.sheetId !== undefined) sh.getRange(i+1, 4).setValue(d.sheetId);
        if (d.sheetName !== undefined) sh.getRange(i+1, 5).setValue(d.sheetName);
        if (d.access !== undefined) sh.getRange(i+1, 6).setValue(d.access);
        if (d.status !== undefined) sh.getRange(i+1, 7).setValue(d.status);
        return { success: true };
      }
    }
    return { success: false, error: "ไม่พบ ID" };
  } catch (e) { return { success: false, error: String(e) }; }
}

function deleteSearchDatabase(id) {
  try {
    const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SEARCH_DB);
    const data = sh.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(id)) { sh.deleteRow(i+1); return { success: true }; }
    }
    return { success: false, error: "ไม่พบ ID" };
  } catch (e) { return { success: false, error: String(e) }; }
}

function getSearchDbRecords(dbId) {
  try {
    const dbs = getSearchDatabases();
    const db = dbs.find(d => d.id === dbId);
    if (!db) return { columns: [], rows: [], total: 0, error: "ไม่พบฐาน" };
    const sh = SpreadsheetApp.openById(db.sheetId).getSheetByName(db.sheetName);
    if (!sh || sh.getLastRow() < 1) return { columns: [], rows: [], total: 0 };
    const all = sh.getDataRange().getValues();
    const columns = all[0].map(String);
    const rows = all.slice(1).map((r, idx) => {
      const obj = { _row: idx + 2 };
      columns.forEach((c, ci) => { obj[c] = String(r[ci] || ""); });
      return obj;
    });
    return { columns: columns, rows: rows.slice(-100).reverse(), total: all.length - 1 };
  } catch (e) { return { columns: [], rows: [], total: 0, error: String(e) }; }
}

function addSearchRecord(dbId, record) {
  try {
    const dbs = getSearchDatabases();
    const db = dbs.find(d => d.id === dbId);
    if (!db) return { success: false, error: "ไม่พบฐาน" };
    const sh = SpreadsheetApp.openById(db.sheetId).getSheetByName(db.sheetName);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = headers.map(h => record[h] || "");
    sh.appendRow(row);
    return { success: true, message: "เพิ่มข้อมูลสำเร็จ" };
  } catch (e) { return { success: false, error: String(e) }; }
}

function updateSearchRecord(dbId, rowNum, record) {
  try {
    const dbs = getSearchDatabases();
    const db = dbs.find(d => d.id === dbId);
    if (!db) return { success: false, error: "ไม่พบฐาน" };
    const sh = SpreadsheetApp.openById(db.sheetId).getSheetByName(db.sheetName);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    headers.forEach((h, ci) => { if (record[h] !== undefined) sh.getRange(rowNum, ci+1).setValue(record[h]); });
    return { success: true };
  } catch (e) { return { success: false, error: String(e) }; }
}

function deleteSearchRecord(dbId, rowNum) {
  try {
    const dbs = getSearchDatabases();
    const db = dbs.find(d => d.id === dbId);
    if (!db) return { success: false, error: "ไม่พบฐาน" };
    SpreadsheetApp.openById(db.sheetId).getSheetByName(db.sheetName).deleteRow(rowNum);
    return { success: true };
  } catch (e) { return { success: false, error: String(e) }; }
}

// 🆕 v10.2: ใช้ SmartMatching.gs ถ้ามี
function _smartSearchAllDbs(query, userRole, userId) {
  if (!query || query.length < 2) return null;

  try {
    if (typeof smartSearchAllDbs_v2 === "function") {
      return smartSearchAllDbs_v2(query, userRole, userId);
    }
  } catch (e) {
    Logger.log("⚠️ smartSearchAllDbs_v2 error, fallback: " + e.message);
  }

  // Fallback: legacy
  const dbs = getSearchDatabases();
  if (!dbs.length) return null;
  const maxResults = parseInt(getConfig("SEARCH_MAX_RESULTS")) || 12;
  const keywords = query.split(/[\s,]+/).filter(k => k.length > 0);
  let allResults = [];

  for (const db of dbs) {
    if (db.status !== "ON") continue;
    if (db.access === "Internal" && userRole !== "VIP" && !isAdmin(userId)) continue;
    if (db.access === "Admin" && !isAdmin(userId)) continue;

    try {
      const sh = SpreadsheetApp.openById(db.sheetId).getSheetByName(db.sheetName);
      if (!sh || sh.getLastRow() <= 1) continue;
      const data = sh.getDataRange().getValues();
      const headers = data[0].map(String);

      for (let i = 1; i < data.length; i++) {
        const rowVals = data[i].map(v => String(v || "").toLowerCase());
        const rowAll = rowVals.join(" ");
        let score = 0;
        keywords.forEach(kw => { if (rowAll.includes(kw.toLowerCase())) score++; });
        if (score > 0) {
          const entry = {};
          headers.forEach((h, ci) => { entry[h] = String(data[i][ci] || ""); });
          allResults.push({ db: db, entry: entry, score: score });
        }
      }
    } catch (e) { continue; }
  }

  if (!allResults.length) return null;
  allResults.sort((a, b) => b.score - a.score);
  allResults = allResults.slice(0, maxResults);

  if (String(getConfig("SEARCH_USE_FLEX") || "ON").toUpperCase() !== "OFF" &&
      typeof _buildSmartSearchFlexV2_ === "function") {
    return _buildSmartSearchFlexV2_(query, query, {}, allResults);
  }

  let msg = "🔍 ผลค้นหา: \"" + query + "\"\n━━━━━━━━━━━━━━\n";
  let currentDb = "";
  const SKIP_COLS = ["timestamp", "_row", "id"];
  allResults.forEach(r => {
    if (r.db.name !== currentDb) {
      currentDb = r.db.name;
      msg += "\n" + (r.db.icon || "📋") + " " + r.db.name + "\n━━━━━━━━━━━━━━\n";
    }
    const keys = Object.keys(r.entry);
    keys.forEach(k => {
      const kLower = String(k).toLowerCase().trim();
      if (SKIP_COLS.includes(kLower)) return;
      const v = r.entry[k];
      if (v) msg += "  " + k + ": " + v + "\n";
    });
    msg += "━━━━━━━━━━━━━━\n";
  });
  msg += "\n🔍 พบ " + allResults.length + " รายการ";
  return msg;
}

function getSearchStats() {
  try {
    const dbs = getSearchDatabases();
    let totalRecords = 0;
    dbs.forEach(db => {
      if (db.status !== "ON") return;
      try {
        const sh = SpreadsheetApp.openById(db.sheetId).getSheetByName(db.sheetName);
        if (sh) totalRecords += Math.max(0, sh.getLastRow() - 1);
      } catch (e) {}
    });
    return {
      dbCount: dbs.length,
      activeCount: dbs.filter(d => d.status === "ON").length,
      totalRecords: totalRecords
    };
  } catch (e) { return { dbCount: 0, activeCount: 0, totalRecords: 0 }; }
}

// ==========================================
// 🩺 Health Check (ระบบสุขภาพดั้งเดิม - ใน Code.gs)
// ==========================================
function runHealthCheck() {
  const results = [];
  const t0 = new Date().getTime();

  try { SpreadsheetApp.openById(SPREADSHEET_ID); results.push({ name: "เชื่อมต่อ Spreadsheet หลัก", ok: true }); }
  catch (e) { results.push({ name: "เชื่อมต่อ Spreadsheet หลัก", ok: false, error: e.message }); }

  const sheetList = Object.entries(SHEETS);
  sheetList.forEach(([key, name]) => {
    try {
      const sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
      if (sh) {
        const rows = sh.getLastRow();
        results.push({ name: "ชีท \"" + name + "\" (" + Math.max(0, rows - 1) + " แถว)", ok: true });
      } else {
        results.push({ name: "ชีท \"" + name + "\"", ok: false, error: "ไม่พบชีท" });
      }
    } catch (e) { results.push({ name: "ชีท \"" + name + "\"", ok: false, error: e.message }); }
  });

  try {
    const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/info", {
      headers: getLineAuthHeaders_(), muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 200) {
      const info = JSON.parse(res.getContentText());
      results.push({ name: "LINE Bot API (Bot: " + (info.displayName || "OK") + ")", ok: true });
    } else {
      results.push({ name: "LINE Bot API", ok: false, error: "HTTP " + code });
    }
  } catch (e) { results.push({ name: "LINE Bot API", ok: false, error: e.message }); }

  try {
    const botStatus = getConfig("BOT_STATUS");
    results.push({ name: "สถานะ Bot: " + (botStatus || "ไม่พบ"), ok: botStatus !== null });
    const adminIds = getConfig("ADMIN_LINE_IDS");
    const admins = adminIds ? adminIds.split(",").filter(Boolean) : [];
    results.push({ name: "Admin IDs (" + admins.length + " คน)", ok: admins.length > 0, error: admins.length === 0 ? "ยังไม่ได้ตั้ง Admin" : "" });
  } catch (e) { results.push({ name: "ตั้งค่าระบบ", ok: false, error: e.message }); }

  try {
    const nStatus = getConfig("NOTIFY_STATUS");
    results.push({ name: "ระบบแจ้งเตือน: " + (nStatus || "OFF"), ok: true });
  } catch (e) { results.push({ name: "ระบบแจ้งเตือน", ok: false, error: e.message }); }

  try {
    const pStatus = getConfig("PHOTO_SAVE_STATUS");
    if (pStatus === "ON") {
      const check = checkPhotoFolder();
      if (check.status === "ok") {
        results.push({ name: "ระบบรับรูป: เปิด + โฟลเดอร์ \"" + check.folderName + "\" (" + check.fileCount + " ไฟล์)", ok: true });
      } else if (check.status === "empty") {
        results.push({ name: "ระบบรับรูป: เปิด แต่ยังไม่มีโฟลเดอร์", ok: false, error: "กด 'สร้างโฟลเดอร์' ใน Dashboard" });
      } else {
        results.push({ name: "ระบบรับรูป: โฟลเดอร์เข้าไม่ได้", ok: false, error: "กด 'สร้างโฟลเดอร์ใหม่' ใน Dashboard" });
      }
    } else { results.push({ name: "ระบบรับรูป: ปิด", ok: true }); }
  } catch (e) { results.push({ name: "ระบบรับรูป", ok: false, error: e.message }); }

  try {
    const sStatus = getConfig("SUMMARY_STATUS");
    results.push({ name: "สรุปสถิติอัตโนมัติ: " + (sStatus || "OFF"), ok: true });
  } catch (e) { results.push({ name: "สรุปสถิติ", ok: false, error: e.message }); }

  try {
    const srStatus = getConfig("SEARCH_STATUS");
    const dbs = getSearchDatabases();
    const activeDbs = dbs.filter(d => d.status === "ON");
    results.push({ name: "ระบบค้นหา: " + (srStatus || "OFF") + " (" + activeDbs.length + "/" + dbs.length + " ฐาน)", ok: true });
    activeDbs.forEach(db => {
      try {
        const sh = SpreadsheetApp.openById(db.sheetId).getSheetByName(db.sheetName);
        if (sh) results.push({ name: "  ↳ ฐาน \"" + db.name + "\" (" + Math.max(0, sh.getLastRow() - 1) + " แถว)", ok: true });
        else results.push({ name: "  ↳ ฐาน \"" + db.name + "\"", ok: false, error: "ไม่พบชีท" });
      } catch (e) { results.push({ name: "  ↳ ฐาน \"" + db.name + "\"", ok: false, error: "เข้าถึงไม่ได้" }); }
    });
  } catch (e) { results.push({ name: "ระบบค้นหา", ok: false, error: e.message }); }

  try {
    const cStatus = getConfig("COURT_STATUS");
    const cSheetId = getConfig("COURT_SHEET_ID");
    const primarySheet = getConfig("COURT_SHEET_NAME") || "Database";

    if (cStatus === "ON") {
      if (cSheetId) {
        results.push({
          name: "บัญชีนัดความ: ON (" + primarySheet + ")",
          ok: true,
          note: "Health Check ไม่เปิดอ่าน COURT_SHEET_ID เพื่อไม่ให้ Dashboard ล้ม ถ้าชีตยังไม่ได้แชร์สิทธิ์"
        });
      } else {
        results.push({ name: "บัญชีนัดความ", ok: false, error: "ยังไม่ตั้ง Sheet ID" });
      }
    } else {
      results.push({ name: "บัญชีนัดความ: ปิด", ok: true });
    }
  } catch (e) { results.push({ name: "บัญชีนัดความ", ok: false, error: e.message }); }

  try {
    const triggers = ScriptApp.getProjectTriggers();
    results.push({ name: "Trigger ที่ตั้งไว้: " + triggers.length + " รายการ", ok: true });
    triggers.forEach(t => {
      results.push({ name: "  ↳ " + t.getHandlerFunction() + " (" + t.getEventType() + ")", ok: true });
    });
  } catch (e) { results.push({ name: "Trigger", ok: false, error: e.message }); }

  const elapsed = new Date().getTime() - t0;
  results.push({ name: "เวลาตรวจสอบ: " + elapsed + " ms", ok: elapsed < 20000 });

  const okCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  return {
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss"),
    total: results.length, passed: okCount, failed: failCount,
    score: results.length > 0 ? Math.round((okCount / results.length) * 100) : 0,
    items: results
  };
}

function sendHealthReport() {
  try {
    if (getConfig("HEALTH_STATUS") !== "ON") return;
    const check = runHealthCheck();
    const now = new Date();
    let msg = "🩺 รายงานสุขภาพระบบ\n";
    msg += now.getDate() + " " + TH_MONTHS[now.getMonth()] + " " + (now.getFullYear() + 543) + "\n";
    msg += "━━━━━━━━━━━━━━━━\n";
    msg += "📊 คะแนน: " + check.score + "% (" + check.passed + "✅ / " + check.failed + "❌)\n";
    msg += "━━━━━━━━━━━━━━━━\n\n";
    check.items.forEach(item => {
      msg += (item.ok ? "✅" : "❌") + " " + item.name;
      if (!item.ok && item.error) msg += "\n   ⚠️ " + item.error;
      msg += "\n";
    });
    msg += "\n━━━━━━━━━━━━━━━━\n";
    msg += "⏱️ ตรวจเมื่อ " + check.timestamp;
    const targets = getConfig("HEALTH_TARGETS") || "admins";
    sendLineNotification({ title: "", body: msg, targets: targets });
  } catch (e) { Logger.log("sendHealthReport error: " + e); }
}

function setupHealthTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "sendHealthReport") ScriptApp.deleteTrigger(t);
  });
  if (getConfig("HEALTH_STATUS") !== "ON") return { success: true, message: "ปิดระบบตรวจสอบแล้ว" };
  const interval = getConfig("HEALTH_INTERVAL") || "daily";
  const builder = ScriptApp.newTrigger("sendHealthReport").timeBased();
  if (interval === "daily") builder.everyDays(1).atHour(7).create();
  else if (interval === "weekly") builder.everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  else if (interval === "monthly") builder.onMonthDay(1).atHour(7).create();
  return { success: true, message: "ตั้งเวลาตรวจ " + interval + " สำเร็จ" };
}

function saveHealthSettings(params) {
  try {
    const status = normalizeOnOffConfigValue_(params.status || "OFF");
    const interval = params.interval || "daily";
    const targets = params.targets || "admins";
    setConfig("HEALTH_STATUS", status);
    setConfig("HEALTH_INTERVAL", interval);
    setConfig("HEALTH_TARGETS", targets);
    SpreadsheetApp.flush();
    if (typeof _clearConfigCache === "function") _clearConfigCache();
    const triggerResult = setupHealthTrigger();
    if (typeof _clearConfigCache === "function") _clearConfigCache();
    return {
      success: triggerResult.success !== false,
      message: triggerResult.message || "บันทึกตั้งค่าสุขภาพระบบแล้ว",
      saved: {
        status: getConfig("HEALTH_STATUS"),
        interval: getConfig("HEALTH_INTERVAL"),
        targets: getConfig("HEALTH_TARGETS")
      }
    };
  } catch (e) { return { success: false, error: String(e) }; }
}

function debugHealthConfigStatus() {
  const result = {
    HEALTH_STATUS: getConfig("HEALTH_STATUS"),
    HEALTH_INTERVAL: getConfig("HEALTH_INTERVAL"),
    HEALTH_TARGETS: getConfig("HEALTH_TARGETS"),
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEETS.CONFIG
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function debugDuplicateConfigKeys() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.CONFIG);
  const data = sheet.getDataRange().getValues();
  const seen = {};
  const duplicates = [];
  for (let i = 1; i < data.length; i++) {
    const rawKey = String(data[i][0] || "").trim();
    const key = normalizeConfigKey_(rawKey);
    if (!key) continue;
    if (!seen[key]) {
      seen[key] = [{ row: i + 1, rawKey: rawKey, value: data[i][1] }];
    } else {
      seen[key].push({ row: i + 1, rawKey: rawKey, value: data[i][1] });
    }
  }
  Object.keys(seen).forEach(function(key) {
    if (seen[key].length > 1) duplicates.push({ key: key, rows: seen[key] });
  });
  const result = {
    success: true,
    totalKeys: Object.keys(seen).length,
    duplicateCount: duplicates.length,
    duplicates: duplicates
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function testHealthCheck() {
  try {
    const prev = getConfig("HEALTH_STATUS");
    setConfig("HEALTH_STATUS", "ON");
    sendHealthReport();
    if (prev !== null && prev !== undefined && String(prev).trim() !== "") {
      setConfig("HEALTH_STATUS", prev);
    }
    return { success: true, message: "ส่งรายงานทดสอบแล้ว" };
  } catch (e) { return { success: false, error: String(e) }; }
}

// ==========================================
// ⚖️ ระบบบัญชีนัดความ v10 (+ Fallback Database_LastWeek)
// ==========================================

function _readCourtSheetForDate(sheetId, sheetName, targetDate) {
  try {
    const ss = openSpreadsheetByIdSafe_(sheetId, "COURT_SHEET_ID");
    const sh = ss.getSheetByName(sheetName);
    if (!sh) return null;

    const data = sh.getDataRange().getValues();
    if (data.length < 2) return { matches: [], minDate: null, maxDate: null, colIdx: null };

    const headers = data[0].map(h => String(h).trim());
    const colIdx = {
      date     : _findColIdxStrict(headers, ["วันที่นัด","วันนัด","วันที่","Date"]),
      time     : _findColIdxStrict(headers, ["เวลา","Time"]),
      blackNo  : _findColIdxStrict(headers, ["เลขคดีดำ","เลขดำที่","เลขดำ","Black"]),
      redNo    : _findColIdxStrict(headers, ["เลขคดีแดง","เลขที่แดง","เลขแดง","Red"]),
      plaintiff: _findColIdxStrict(headers, ["โจทก์/ผู้ร้อง","โจทก์","ผู้ร้อง","Plaintiff"]),
      defendant: _findColIdxStrict(headers, ["จำเลย","ผู้คัดค้าน","Defendant"]),
      subject  : _findColIdxStrict(headers, ["เรื่อง","ข้อหา","Subject"]),
      reason   : _findColIdxStrict(headers, ["นัดมาทำไม","Reason"]),
      judge    : _findColIdxStrict(headers, ["ผู้พิพากษา","องค์คณะ","Judge"]),
      bail     : _findColIdxStrict(headers, ["ขัง/ประกัน","ขังประกัน","Bail"])
    };
    if (colIdx.date < 0) return null;

    const matches = [];
    const tKey = _dateKey(targetDate);
    let minDate = null, maxDate = null;

    for (let i = 1; i < data.length; i++) {
      const cellDate = _parseAnyDate(data[i][colIdx.date]);
      if (!cellDate) continue;
      if (!minDate || cellDate < minDate) minDate = cellDate;
      if (!maxDate || cellDate > maxDate) maxDate = cellDate;
      if (_dateKey(cellDate) === tKey) matches.push(data[i]);
    }
    return { matches, minDate, maxDate, colIdx };
  } catch (e) {
    Logger.log("_readCourtSheetForDate(" + sheetName + "): " + e.message);
    return null;
  }
}

function _searchCourtSchedule(dateQuery, userRole, userId) {
  if (getConfig("COURT_STATUS") !== "ON") return null;

  const normRole = String(userRole || "").trim().toUpperCase();
  const userIsAdmin = isAdmin(userId);
  const userIsVip = (normRole === "VIP") || userIsAdmin;

  const perm = (getConfig("COURT_ACCESS") || "vip").toLowerCase().trim();
  if (perm === "admin" && !userIsAdmin) {
    try { if (typeof logPermissionDenied === "function") logPermissionDenied(userId, "court", "ไม่ใช่ Admin"); } catch (e) {}
    return "🔒 ข้อมูลบัญชีนัดความสำหรับผู้ดูแลเท่านั้นครับ";
  }
  if (perm === "vip" && !userIsVip) {
    try { if (typeof logPermissionDenied === "function") logPermissionDenied(userId, "court", "ไม่ใช่ VIP"); } catch (e) {}
    return "🔒 ข้อมูลบัญชีนัดความสำหรับเจ้าหน้าที่ (VIP) เท่านั้นครับ";
  }

  const sheetId = getConfig("COURT_SHEET_ID");
  if (!sheetId) return "⚠️ ยังไม่ได้ตั้งค่าฐานข้อมูลบัญชีนัดความ";

  const primarySheet = getConfig("COURT_SHEET_NAME") || "Database";
  const fallbackList = (getConfig("COURT_FALLBACK_SHEETS") || "Database_LastWeek")
    .split(",").map(s => s.trim()).filter(Boolean);
  const sheetsToSearch = [primarySheet].concat(fallbackList);

  let page = 1;
  let cleanDate = dateQuery;
  const pageMatch = dateQuery.match(/^(.+?)\s+(?:หน้า|page|p)\s*(\d+)\s*$/i);
  if (pageMatch) { cleanDate = pageMatch[1].trim(); page = parseInt(pageMatch[2]); }

  const targetDate = _parseThaiDate(cleanDate);
  if (!targetDate) return "❌ รูปแบบวันที่ไม่ถูกต้องครับ\n\n✅ ลองใช้:\n• 9 เม.ย. 69\n• 9 เมษายน 2569\n• 9/04/69\n• 9-04-2569";

  let finalResult = null;
  let foundInSheet = "";
  let unionMinDate = null, unionMaxDate = null;
  let anySheetReadable = false;

  for (const shName of sheetsToSearch) {
    const res = _readCourtSheetForDate(sheetId, shName, targetDate);
    if (!res) continue;
    anySheetReadable = true;
    if (res.minDate && (!unionMinDate || res.minDate < unionMinDate)) unionMinDate = res.minDate;
    if (res.maxDate && (!unionMaxDate || res.maxDate > unionMaxDate)) unionMaxDate = res.maxDate;
    if (res.matches.length > 0 && !finalResult) {
      finalResult = res;
      foundInSheet = shName;
    }
  }

  if (!anySheetReadable) {
    return "⚠️ เข้าถึงชีตบัญชีนัดความไม่ได้\n\n🔍 ชีตที่ลอง: " + sheetsToSearch.join(", ");
  }

  const useFlex = (getConfig("COURT_USE_FLEX") || "ON") === "ON";

  if (!finalResult) {
    return useFlex
      ? _buildCourtNoResultsFlex(targetDate, unionMinDate, unionMaxDate)
      : _buildCourtNoResultsText(targetDate, unionMinDate, unionMaxDate);
  }

  const perPage = _getCourtPerPage();
  const matches = finalResult.matches;
  const totalPages = Math.ceil(matches.length / perPage);
  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;

  const isFromBackup = (foundInSheet !== primarySheet);

  return useFlex
    ? _buildCourtFlexMessage(targetDate, matches, page, totalPages, perPage, finalResult.colIdx, cleanDate, isFromBackup, foundInSheet)
    : _buildCourtTextMessage(targetDate, matches, page, totalPages, perPage, finalResult.colIdx, cleanDate, isFromBackup, foundInSheet);
}

function _buildCourtFlexMessage(targetDate, matches, page, totalPages, perPage, colIdx, cleanDate, isFromBackup, foundInSheet) {
  const startIdx = (page - 1) * perPage;
  const endIdx = Math.min(startIdx + perPage, matches.length);

  const caseBlocks = [];
  for (let i = startIdx; i < endIdx; i++) {
    caseBlocks.push(_buildSingleCaseBox(matches[i], i + 1, colIdx));
    if (i < endIdx - 1) caseBlocks.push({ type: "separator", color: "#E5E7EB", margin: "none" });
  }

  const footerContents = [
    { type: "text",
      text: "📖 แสดงคดีที่ " + (startIdx + 1) + "-" + endIdx + " จาก " + matches.length + " คดี",
      size: "xs", color: "#6B7280", align: "center", margin: "sm", wrap: true }
  ];

  if (totalPages > 1) {
    const pageButtons = [];
    if (page > 1) {
      pageButtons.push({
        type: "button",
        action: { type: "message", label: "◀️ หน้าก่อน", text: "บัญชีนัดความ " + cleanDate + " หน้า " + (page - 1) },
        style: "secondary", height: "sm", flex: 1
      });
    }
    if (page < totalPages) {
      pageButtons.push({
        type: "button",
        action: { type: "message", label: "หน้าถัดไป ▶️", text: "บัญชีนัดความ " + cleanDate + " หน้า " + (page + 1) },
        style: "primary", color: "#7C3AED", height: "sm", flex: 1
      });
    }
    if (pageButtons.length > 0) {
      footerContents.push({ type: "box", layout: "horizontal", spacing: "sm", margin: "md", contents: pageButtons });
    }
  }

  footerContents.push({
    type: "box", layout: "horizontal", spacing: "xs", margin: "sm",
    contents: [
      _quickDateBtn("📅 วันนี้",   "บัญชีนัดความ วันนี้"),
      _quickDateBtn("⏭️ พรุ่งนี้", "บัญชีนัดความ พรุ่งนี้"),
      _quickDateBtn("⏩ มะรืน",   "บัญชีนัดความ มะรืน")
    ]
  });

  return {
    type: "flex",
    altText: "⚖️ บัญชีนัดความ " + _formatThaiDateFull(targetDate) +
             " (" + matches.length + " คดี หน้า " + page + "/" + totalPages + ")" +
             (isFromBackup ? " [ชีตสำรอง]" : ""),
    contents: {
      type: "bubble", size: "giga",
      header: _buildCourtHeader(targetDate, matches.length, page, totalPages, isFromBackup),
      body: { type: "box", layout: "vertical", paddingAll: "0px", spacing: "none", contents: caseBlocks },
      footer: { type: "box", layout: "vertical", paddingAll: "12px", spacing: "none", contents: footerContents }
    }
  };
}

function _buildCourtHeader(targetDate, totalMatches, page, totalPages, isFromBackup) {
  const headerContents = [
    { type: "text", text: "⚖️ บัญชีนัดความ", color: "#FFFFFF", weight: "bold", size: "lg" },
    { type: "text", text: "📅 " + _formatThaiDateFull(targetDate), color: "#E9D5FF", size: "sm", wrap: true }
  ];
  if (isFromBackup) {
    headerContents.push({
      type: "text",
      text: "📦 ข้อมูลจากชีตสำรอง (สัปดาห์ที่แล้ว)",
      color: "#FDE68A", size: "xs", margin: "xs", weight: "bold", wrap: true
    });
  }
  headerContents.push({
    type: "box", layout: "horizontal", margin: "sm",
    contents: [
      { type: "text", text: "📋 จำนวนคดีทั้งหมด " + totalMatches + " คดี", color: "#FDE68A", size: "xs", flex: 3, wrap: true },
      { type: "text", text: "หน้า " + page + "/" + totalPages, color: "#FDE68A", size: "xs", flex: 1, align: "end" }
    ]
  });
  return {
    type: "box", layout: "vertical",
    backgroundColor: isFromBackup ? "#6D28D9" : "#4C1D95",
    paddingAll: "16px", spacing: "xs",
    contents: headerContents
  };
}

function _buildSingleCaseBox(row, caseNo, colIdx) {
  const contents = [];

  const hasBlack = colIdx.blackNo >= 0 && _hasVal(row[colIdx.blackNo]);
  const hasRed = colIdx.redNo >= 0 && _hasVal(row[colIdx.redNo]);
  let line1Text = "";
  if (hasBlack) line1Text += "เลขคดีดำ " + _fmtCell(row[colIdx.blackNo]);
  if (hasRed) line1Text += (hasBlack ? "  " : "") + "เลขคดีแดง " + _fmtCell(row[colIdx.redNo]);
  if (!hasBlack && !hasRed) line1Text = "(ไม่มีเลขคดี)";

  contents.push({
    type: "box", layout: "baseline",
    contents: [
      { type: "text", text: caseNo + ".", weight: "bold", color: "#7C3AED", size: "sm", flex: 0 },
      { type: "text", text: " " + line1Text, size: "sm", color: "#111827", weight: "bold", flex: 1, wrap: true }
    ]
  });

  if (colIdx.plaintiff >= 0 && _hasVal(row[colIdx.plaintiff])) {
    contents.push(_buildKVRow("👤", "โจทก์", _fmtCell(row[colIdx.plaintiff]), "#374151"));
  }
  if (colIdx.defendant >= 0 && _hasVal(row[colIdx.defendant])) {
    contents.push(_buildKVRow("👥", "จำเลย", _fmtCell(row[colIdx.defendant]), "#374151"));
  }

  const subjectText = _getSubjectText(row, colIdx);
  const hasTime = colIdx.time >= 0 && _hasVal(row[colIdx.time]);
  if (subjectText || hasTime) {
    const row4 = [];
    if (subjectText) {
      row4.push({ type: "text", text: "📄 " + _shortenSubject(subjectText), size: "xs", color: "#6B7280", flex: hasTime ? 3 : 1, wrap: true });
    }
    if (hasTime) {
      row4.push({ type: "text", text: "🕐 " + _fmtTime(row[colIdx.time]), size: "xs", color: "#059669", weight: "bold", flex: 1, align: "end" });
    }
    contents.push({ type: "box", layout: "baseline", margin: "xs", contents: row4 });
  }

  if (colIdx.judge >= 0 && _hasVal(row[colIdx.judge])) {
    contents.push({ type: "text", text: "⚖️ " + _fmtCell(row[colIdx.judge]), size: "xxs", color: "#9CA3AF", margin: "xs", wrap: true });
  }

  return { type: "box", layout: "vertical", paddingAll: "12px", spacing: "xs", contents: contents };
}

function _buildKVRow(icon, label, value, color) {
  return {
    type: "box", layout: "baseline", margin: "sm",
    contents: [
      { type: "text", text: icon, size: "xs", flex: 0 },
      { type: "text", text: " " + label + " " + value, size: "sm", color: color, flex: 1, wrap: true }
    ]
  };
}

function _quickDateBtn(label, text) {
  return {
    type: "button",
    action: { type: "message", label: label, text: text },
    style: "link", height: "sm", flex: 1
  };
}

// 🔧 v10.3: เปลี่ยนชื่อจาก _buildNoResultsFlex → _buildCourtNoResultsFlex
// (เพื่อไม่ชนกับ _buildNoResultsFlex ของ search ใหม่)
function _buildCourtNoResultsFlex(targetDate, minDate, maxDate) {
  const isOutOfRange = minDate && maxDate && (targetDate < minDate || targetDate > maxDate);
  const dayName = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"][targetDate.getDay()];
  const isWeekend = targetDate.getDay() === 0 || targetDate.getDay() === 6;

  const bodyContents = [];
  if (isOutOfRange) {
    bodyContents.push(
      { type: "text", text: "📭 ยังไม่มีข้อมูลในระบบ", size: "md", color: "#DC2626", weight: "bold", wrap: true },
      { type: "separator", margin: "md", color: "#E5E7EB" },
      { type: "text", text: "ข้อมูลในระบบปัจจุบัน:", size: "sm", color: "#6B7280", margin: "md" },
      { type: "text", text: "📅 " + _formatThaiDateFull(minDate), size: "sm", color: "#374151", margin: "xs", wrap: true },
      { type: "text", text: "    ถึง " + _formatThaiDateFull(maxDate), size: "sm", color: "#374151", margin: "xs", wrap: true },
      { type: "text", text: "💡 กรุณารอ Admin นำเข้าข้อมูล", size: "xs", color: "#9CA3AF", margin: "md", wrap: true }
    );
  } else {
    bodyContents.push(
      { type: "text", text: "📌 ไม่มีคดีพิจารณาในวันนี้", size: "md", color: "#DC2626", weight: "bold", wrap: true },
      { type: "text", text: "(วัน" + dayName + ")", size: "sm", color: "#6B7280", margin: "xs" },
      { type: "separator", margin: "md", color: "#E5E7EB" },
      { type: "text", text: isWeekend ? "🏖️ วันเสาร์-อาทิตย์ ปกติศาลปิดทำการ" : "อาจเป็นวันหยุดราชการ หรือไม่มีคดีพิจารณา",
        size: "sm", color: "#374151", margin: "md", wrap: true }
    );
  }

  return {
    type: "flex",
    altText: "บัญชีนัดความ " + _formatThaiDateFull(targetDate) + " — ไม่มีคดี",
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#4C1D95", paddingAll: "16px",
        contents: [
          { type: "text", text: "⚖️ บัญชีนัดความ", color: "#FFFFFF", weight: "bold", size: "lg" },
          { type: "text", text: "📅 " + _formatThaiDateFull(targetDate), color: "#E9D5FF", size: "sm", margin: "xs", wrap: true }
        ]
      },
      body: { type: "box", layout: "vertical", paddingAll: "16px", contents: bodyContents },
      footer: {
        type: "box", layout: "horizontal", spacing: "xs", paddingAll: "12px",
        contents: [
          _quickDateBtn("📅 วันนี้",   "บัญชีนัดความ วันนี้"),
          _quickDateBtn("⏭️ พรุ่งนี้", "บัญชีนัดความ พรุ่งนี้"),
          _quickDateBtn("⏩ มะรืน",   "บัญชีนัดความ มะรืน")
        ]
      }
    }
  };
}

function _buildCourtTextMessage(targetDate, matches, page, totalPages, perPage, colIdx, cleanDate, isFromBackup, foundInSheet) {
  const startIdx = (page - 1) * perPage;
  const endIdx = Math.min(startIdx + perPage, matches.length);

  let msg = "⚖️ บัญชีนัดความ\n";
  msg += "📅 วันที่ " + _formatThaiDateFull(targetDate) + "\n";
  if (isFromBackup) msg += "📦 ข้อมูลจากชีตสำรอง (" + foundInSheet + ")\n";
  msg += "📋 จำนวนคดีทั้งหมด " + matches.length + " คดี  หน้า " + page + "/" + totalPages + "\n";
  msg += "━━━━━━━━━━━━━━━━━━━━";

  for (let i = startIdx; i < endIdx; i++) {
    const r = matches[i];
    const no = i + 1;
    let line1 = no + ". ";
    const hasBlack = colIdx.blackNo >= 0 && _hasVal(r[colIdx.blackNo]);
    const hasRed = colIdx.redNo >= 0 && _hasVal(r[colIdx.redNo]);
    if (hasBlack) line1 += "เลขคดีดำ " + _fmtCell(r[colIdx.blackNo]);
    if (hasRed) line1 += (hasBlack ? "  " : "") + "เลขคดีแดง " + _fmtCell(r[colIdx.redNo]);
    if (!hasBlack && !hasRed) line1 += "(ไม่มีเลขคดี)";
    msg += "\n\n" + line1;

    if (colIdx.plaintiff >= 0 && _hasVal(r[colIdx.plaintiff])) msg += "\n   โจทก์ " + _fmtCell(r[colIdx.plaintiff]);
    if (colIdx.defendant >= 0 && _hasVal(r[colIdx.defendant])) msg += "\n   จำเลย " + _fmtCell(r[colIdx.defendant]);

    const subjectText = _getSubjectText(r, colIdx);
    const timeText = (colIdx.time >= 0 && _hasVal(r[colIdx.time])) ? _fmtTime(r[colIdx.time]) : "";
    const parts = [];
    if (subjectText) parts.push("เรื่อง " + _shortenSubject(subjectText));
    if (timeText) parts.push("🕐 " + timeText);
    if (parts.length > 0) msg += "\n   " + parts.join("  ");

    if (i < endIdx - 1) msg += "\n____________________________________________";
  }

  msg += "\n━━━━━━━━━━━━━━━━━━━━";
  msg += "\n📖 แสดงคดี " + (startIdx + 1) + "-" + endIdx + " จาก " + matches.length;
  if (page < totalPages) msg += "\n▶️ หน้าถัดไป: บัญชีนัดความ " + cleanDate + " หน้า " + (page + 1);
  if (page > 1) msg += "\n◀️ หน้าก่อน: บัญชีนัดความ " + cleanDate + " หน้า " + (page - 1);
  return msg;
}

function _buildCourtNoResultsText(targetDate, minDate, maxDate) {
  let msg = "⚖️ บัญชีนัดความ\n📅 วันที่ " + _formatThaiDateFull(targetDate) + "\n━━━━━━━━━━━━━━━━━━━━\n\n";
  if (minDate && maxDate && (targetDate < minDate || targetDate > maxDate)) {
    msg += "📭 ยังไม่มีข้อมูลในระบบ\n\n";
    msg += "ข้อมูลในระบบปัจจุบัน:\n";
    msg += "📅 " + _formatThaiDateFull(minDate) + "\n";
    msg += "    ถึง " + _formatThaiDateFull(maxDate) + "\n\n";
    msg += "💡 กรุณารอ Admin นำเข้าข้อมูลของสัปดาห์นี้";
  } else {
    const dayName = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"][targetDate.getDay()];
    msg += "📌 ไม่มีคดีพิจารณาในวันนี้\n(วัน" + dayName + ")\n\n";
    if (targetDate.getDay() === 0 || targetDate.getDay() === 6) msg += "🏖️ วันเสาร์-อาทิตย์ ปกติศาลปิดทำการ";
    else msg += "อาจเป็นวันหยุดราชการ หรือไม่มีคดีพิจารณา";
  }
  return msg;
}

function _sendCourtReply(replyToken, result) {
  if (result && typeof result === "object" && result.type === "flex") {
    const res = _linePost("https://api.line.me/v2/bot/message/reply", {
      replyToken: replyToken,
      messages: [{ type: "flex", altText: String(result.altText || "บัญชีนัดความ"), contents: result.contents }]
    });
    if (res.responseCode !== 200) Logger.log("⚠️ Flex reply failed with code " + res.responseCode);
    return res;
  }
  return safeSendReply(replyToken, String(result));
}

// ═══════════ HELPERS ═══════════
function _findColIdxStrict(headers, aliases) {
  const norm = s => String(s).toLowerCase().replace(/\s+/g, "").replace(/[\/\-._]/g, "");
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    for (const a of aliases) { if (h === norm(a)) return i; }
  }
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    for (const a of aliases) { if (h.includes(norm(a))) return i; }
  }
  return -1;
}

function _findColIdx(headers, aliases) { return _findColIdxStrict(headers, aliases); }

function _getSubjectText(row, colIdx) {
  if (colIdx.subject >= 0 && _hasVal(row[colIdx.subject])) return String(row[colIdx.subject]).trim();
  if (colIdx.reason >= 0 && _hasVal(row[colIdx.reason])) return String(row[colIdx.reason]).trim();
  return "";
}

function _hasVal(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  return s !== "" && s !== "-";
}

function _getCourtPerPage() {
  const v = parseInt(getConfig("COURT_MAX_RESULTS") || "10");
  return (v > 0 && v <= 50) ? v : 10;
}

function _fmtCell(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), "HH:mm");
  return String(v).trim();
}

function _fmtTime(v) {
  if (v instanceof Date) {
    const h = v.getHours();
    const m = v.getMinutes();
    return h + "." + String(m).padStart(2, "0") + " น.";
  }
  const s = String(v).trim();
  if (!s) return "";
  const mColon = s.match(/^(\d{1,2}):(\d{1,2})/);
  if (mColon) return parseInt(mColon[1]) + "." + String(parseInt(mColon[2])).padStart(2, "0") + " น.";
  const mDot = s.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (mDot) {
    const h = parseInt(mDot[1]);
    const m = parseInt(mDot[2].length === 1 ? mDot[2] + "0" : mDot[2]);
    return h + "." + String(m).padStart(2, "0") + " น.";
  }
  if (/^\d{1,2}$/.test(s)) return parseInt(s) + ".00 น.";
  return s;
}

function _shortenSubject(s) {
  const text = String(s || "").trim();
  if (!text) return "";
  const MAX = 50;
  if (text.length <= MAX) return text;
  let cut = text.substring(0, MAX);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > MAX * 0.6) cut = cut.substring(0, lastSpace);
  cut = cut.replace(/[\s,\.ฯ]+$/, "");
  return cut + "ฯ";
}

// ═══════════ DATE PARSING ═══════════
function _parseThaiDate(input) {
  if (!input) return null;
  const s = String(input).trim();
  const TH_M = {
    "ม.ค.":1,"มกราคม":1,  "ก.พ.":2,"กุมภาพันธ์":2,
    "มี.ค.":3,"มีนาคม":3,  "เม.ย.":4,"เมษายน":4,
    "พ.ค.":5,"พฤษภาคม":5, "มิ.ย.":6,"มิถุนายน":6,
    "ก.ค.":7,"กรกฎาคม":7, "ส.ค.":8,"สิงหาคม":8,
    "ก.ย.":9,"กันยายน":9, "ต.ค.":10,"ตุลาคม":10,
    "พ.ย.":11,"พฤศจิกายน":11, "ธ.ค.":12,"ธันวาคม":12
  };
  for (const key in TH_M) {
    const idx = s.indexOf(key);
    if (idx >= 0) {
      const before = s.substring(0, idx).replace(/[\s,.\/\-]+$/, '').trim();
      const after = s.substring(idx + key.length).replace(/^[\s,.\/\-]+/, '').trim();
      const dM = before.match(/\d+/);
      const yM = after.match(/\d+/);
      const d = dM ? parseInt(dM[0]) : NaN;
      const y = yM ? parseInt(yM[0]) : NaN;
      if (d >= 1 && d <= 31 && y > 0) return new Date(_normalizeYear(y), TH_M[key] - 1, d);
    }
  }
  const m2 = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m2) {
    const d = parseInt(m2[1]);
    const mo = parseInt(m2[2]);
    const y = _normalizeYear(parseInt(m2[3]));
    return new Date(y, mo - 1, d);
  }
  return null;
}

function _normalizeYear(y) {
  if (y < 100) {
    const curYear = new Date().getFullYear();
    const curYearShort = curYear % 100;
    const curBEShort = (curYear + 543) % 100;
    if (Math.abs(y - curBEShort) <= 5) return 2500 + y - 543;
    if (Math.abs(y - curYearShort) <= 5) return 2000 + y;
    return 2500 + y - 543;
  }
  if (y >= 2400) return y - 543;
  return y;
}

function _parseAnyDate(cell) {
  if (cell instanceof Date) {
    const y = cell.getFullYear();
    if (y < 1900) return null;
    if (y >= 1900 && y < 2000) return new Date(y + 57, cell.getMonth(), cell.getDate());
    if (y >= 2400) return new Date(y - 543, cell.getMonth(), cell.getDate());
    return cell;
  }
  if (!cell) return null;
  return _parseThaiDate(cell);
}

function _dateKey(d) { return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }

function _formatThaiDateFull(d) {
  const TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
              "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  return d.getDate() + " " + TH[d.getMonth()] + " " + (d.getFullYear() + 543);
}

function _matchQuickDateShortcut(text) {
  const t = text.trim();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (/^(บัญชีนัดความ|บัญชีนัด|นัดความ|นัด)\s*วันนี้$/.test(t)) return _toDateStr(today);
  if (/^(บัญชีนัดความ|บัญชีนัด|นัดความ|นัด)\s*พรุ่งนี้$/.test(t)) {
    const d = new Date(today); d.setDate(d.getDate() + 1); return _toDateStr(d);
  }
  if (/^(บัญชีนัดความ|บัญชีนัด|นัดความ|นัด)\s*มะรืน(นี้)?$/.test(t)) {
    const d = new Date(today); d.setDate(d.getDate() + 2); return _toDateStr(d);
  }
  const mDays = t.match(/^(บัญชีนัดความ|บัญชีนัด|นัดความ|นัด)\s*(?:อีก|ใน)?\s*(\d+)\s*วัน$/);
  if (mDays) {
    const d = new Date(today); d.setDate(d.getDate() + parseInt(mDays[2]));
    return _toDateStr(d);
  }
  if (/^(บัญชีนัดความ|บัญชีนัด|นัดความ|นัด)\s*เมื่อวาน(นี้)?$/.test(t)) {
    const d = new Date(today); d.setDate(d.getDate() - 1);
    return _toDateStr(d);
  }
  return null;
}

function _toDateStr(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = (d.getFullYear() + 543).toString().slice(-2);
  return dd + "/" + mm + "/" + yy;
}

// ═══════════ COURT DASHBOARD CONFIG ═══════════
function saveCourtConfig(params) {
  try {
    setConfig("COURT_STATUS",      normalizeOnOffConfigValue_(params.status || "OFF"));
    setConfig("COURT_ACCESS",      params.access      || "vip");
    setConfig("COURT_SHEET_ID",    params.sheetId     || "");
    setConfig("COURT_SHEET_NAME",  params.sheetName   || "Database");
    setConfig("COURT_MAX_RESULTS", params.maxResults  || "10");
    setConfig("COURT_USE_FLEX",    normalizeOnOffConfigValue_(params.useFlex || "ON"));
    if (params.fallbackSheets !== undefined) {
      setConfig("COURT_FALLBACK_SHEETS", params.fallbackSheets || "Database_LastWeek");
    }
    return { success: true, message: "บันทึกตั้งค่าบัญชีนัดความแล้ว" };
  } catch (e) { return { success: false, error: String(e) }; }
}

function getCourtConfig() {
  return {
    status         : getConfig("COURT_STATUS") || "OFF",
    access         : getConfig("COURT_ACCESS") || "vip",
    sheetId        : getConfig("COURT_SHEET_ID") || "",
    sheetName      : getConfig("COURT_SHEET_NAME") || "Database",
    maxResults     : getConfig("COURT_MAX_RESULTS") || "10",
    useFlex        : getConfig("COURT_USE_FLEX") || "ON",
    fallbackSheets : getConfig("COURT_FALLBACK_SHEETS") || "Database_LastWeek"
  };
}

function debugCourtConfigStatus() {
  const cfg = getCourtConfig();
  const result = {
    success: true,
    config: cfg,
    mainSpreadsheetId: SPREADSHEET_ID,
    configSheetName: SHEETS.CONFIG,
    courtSpreadsheet: null,
    courtSheets: [],
    duplicateCourtKeys: []
  };
  try {
    const configSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.CONFIG);
    const data = configSheet.getDataRange().getValues();
    const seen = {};
    for (let i = 1; i < data.length; i++) {
      const key = String(data[i][0] || "").trim();
      if (!key || key.indexOf("COURT_") !== 0) continue;
      if (!seen[key]) seen[key] = [];
      seen[key].push({ row: i + 1, value: data[i][1] });
    }
    Object.keys(seen).forEach(function(key) {
      if (seen[key].length > 1) result.duplicateCourtKeys.push({ key: key, rows: seen[key] });
    });
    result.configRows = seen;
  } catch (e) {
    result.configReadError = e.message || String(e);
  }
  if (!cfg.sheetId) {
    result.success = false;
    result.error = "COURT_SHEET_ID ว่าง";
    Logger.log(JSON.stringify(result, null, 2));
    return result;
  }
  try {
    const ss = openSpreadsheetByIdSafe_(cfg.sheetId, "COURT_SHEET_ID");
    result.courtSpreadsheet = { id: cfg.sheetId, name: ss.getName() };
    const fallbackList = String(cfg.fallbackSheets || "Database_LastWeek").split(",").map(s => s.trim()).filter(Boolean);
    const sheetNames = [cfg.sheetName || "Database"].concat(fallbackList);
    result.availableSheetNames = ss.getSheets().map(s => s.getName());
    sheetNames.forEach(function(name) {
      const sh = ss.getSheetByName(name);
      result.courtSheets.push({
        name: name,
        exists: !!sh,
        rows: sh ? Math.max(0, sh.getLastRow() - 1) : 0,
        columns: sh ? sh.getLastColumn() : 0
      });
    });
  } catch (e) {
    result.success = false;
    result.error = "เปิด Spreadsheet บัญชีนัดความไม่ได้: " + (e.message || String(e));
  }
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function testCourtLookup() {
  try {
    const sheetId = getConfig("COURT_SHEET_ID");
    const primarySheet = getConfig("COURT_SHEET_NAME") || "Database";
    const fallbackList = (getConfig("COURT_FALLBACK_SHEETS") || "Database_LastWeek")
      .split(",").map(s => s.trim()).filter(Boolean);

    if (!sheetId) return { success: false, error: "ยังไม่ได้ตั้ง Sheet ID" };

    const ss = openSpreadsheetByIdSafe_(sheetId, "COURT_SHEET_ID");
    let dbg = "🔍 ตรวจฐานบัญชีนัดความ v10\n━━━━━━━━━━━━━━\n";
    dbg += "📋 ชีตหลัก: " + primarySheet + "\n";
    dbg += "📦 ชีตสำรอง: " + fallbackList.join(", ") + "\n";
    dbg += "🎴 โหมด Flex: " + (getConfig("COURT_USE_FLEX") || "ON") + "\n\n";

    const allSheets = [primarySheet].concat(fallbackList);
    let anyOk = false;

    allSheets.forEach(sn => {
      dbg += "━━━━━━━━━━━━━━\n";
      const sh = ss.getSheetByName(sn);
      if (!sh) { dbg += "❌ " + sn + ": ไม่พบชีท\n"; return; }
      anyOk = true;
      const data = sh.getDataRange().getValues();
      dbg += "✅ " + sn + ": " + (data.length - 1) + " แถว\n";
      if (data.length >= 2) {
        const headers = data[0].map(h => String(h).trim());
        const cols = {
          date:      _findColIdxStrict(headers, ["วันที่นัด","วันนัด","วันที่","Date"]),
          blackNo:   _findColIdxStrict(headers, ["เลขคดีดำ","เลขดำที่","เลขดำ"]),
          plaintiff: _findColIdxStrict(headers, ["โจทก์/ผู้ร้อง","โจทก์","ผู้ร้อง"])
        };
        dbg += "  col date: " + cols.date + ", blackNo: " + cols.blackNo + ", plaintiff: " + cols.plaintiff + "\n";
        if (cols.date >= 0) {
          const sampleVal = data[1][cols.date];
          const parsed = _parseAnyDate(sampleVal);
          dbg += "  ตัวอย่างวันแรก: " + sampleVal + " → " + (parsed ? _formatThaiDateFull(parsed) : "❌ แปลงไม่ได้") + "\n";
        }
      }
    });

    const todayDateStr = _toDateStr(new Date());
    dbg += "\n🧪 ทดสอบค้น \"" + todayDateStr + "\":\n";
    const testRes = _searchCourtSchedule(todayDateStr, "VIP", "test");
    if (!testRes) dbg += "  (ระบบปิดอยู่)\n";
    else if (typeof testRes === "string") dbg += "  [Text] " + testRes.substring(0, 200) + "...\n";
    else dbg += "  [Flex] " + (testRes.altText || "no altText") + "\n";

    return { success: anyOk, message: dbg, debug: dbg };
  } catch (e) { return { success: false, error: String(e) }; }
}

function testCourtFlexSend() {
  try {
    const adminIds = getAdminIds();
    if (adminIds.length === 0) return { success: false, error: "ไม่พบ Admin ID" };
    const today = new Date();
    const dateStr = _toDateStr(today);
    const result = _searchCourtSchedule(dateStr, "VIP", adminIds[0]);

    if (!result) return { success: false, error: "ระบบบัญชีนัดความปิดอยู่" };
    if (typeof result === "string") {
      adminIds.forEach(id => _linePush(id, result));
      return { success: true, message: "ส่งข้อความทดสอบแล้ว (" + adminIds.length + " คน)" };
    }
    if (result && result.type === "flex") {
      let ok = true;
      adminIds.forEach(id => {
        const res = _linePost("https://api.line.me/v2/bot/message/push", {
          to: id, messages: [{ type: "flex", altText: result.altText, contents: result.contents }]
        });
        if (res.responseCode !== 200) ok = false;
      });
      return { success: ok, message: ok ? "ส่ง Flex Message ทดสอบแล้ว (" + adminIds.length + " คน)" : "ส่งไม่สำเร็จ — ตรวจ Logger.log" };
    }
    return { success: false, error: "ประเภทผลลัพธ์ไม่รู้จัก" };
  } catch (e) { return { success: false, error: String(e) }; }
}

// ═══════════ v10.1 WARM-UP (ป้องกัน Cold Start) ═══════════
function warmUp() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    SpreadsheetApp.flush();
    ss.getSheetByName(SHEETS.CONFIG).getRange("A1").getValue();
    ss.getSheetByName(SHEETS.MEMBERS).getRange("A1").getValue();
    Logger.log("🔥 Warm-up OK at " + new Date().toLocaleString());
    return { success: true, message: "Warm-up สำเร็จ" };
  } catch (e) {
    Logger.log("❌ Warm-up fail: " + e.message);
    return { success: false, error: String(e) };
  }
}

function setupWarmUpTrigger() {
  try {
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === "warmUp") ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger("warmUp").timeBased().everyMinutes(10).create();
    return { success: true, message: "✅ ตั้ง warm-up trigger ทุก 10 นาทีสำเร็จ" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  📺 TV STATUS NOTIFICATION SYSTEM                                ║
// ║  แจ้งเตือนสถานะหน้าจอ TV ของระบบบัญชีนัด ผ่าน LINE             ║
// ╚══════════════════════════════════════════════════════════════════╝

const TV_NOTIFY_STATE_KEY = "tv_notify_last_states";

function fetchCourtTVStatus() {
  const url = getConfig("TV_NOTIFY_URL");
  if (!url) return { error: "ยังไม่ได้ตั้งค่า URL ระบบบัญชีนัด" };

  try {
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      muteHttpExceptions: true,
      followRedirects: true,
      validateHttpsCertificates: true
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      return { error: "HTTP " + code + " — กรุณาตรวจ URL หรือสิทธิ์ Web App (Anyone)" };
    }
    const txt = res.getContentText();
    if (!txt || txt.charAt(0) !== "{") {
      return { error: "Response ไม่ใช่ JSON (อาจเป็นหน้า login) — Web App ต้องเปิดเป็น Anyone" };
    }
    return JSON.parse(txt);
  } catch (e) {
    return { error: "Fetch error: " + e.message };
  }
}

function _isCourtTVNotifyWindow_() {
  const hour = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "H"));
  return hour >= 6 && hour < 18;
}

function _isForceNotifyOn_() {
  const value = String(getConfig("FORCE_NOTIFY") || "OFF").trim().toUpperCase();
  return ["ON", "TRUE", "1", "YES", "เปิด"].indexOf(value) >= 0;
}

function checkTVStatusAndNotify() {
  try {
    if (getConfig("TV_NOTIFY_STATUS") !== "ON") return;

    const data = fetchCourtTVStatus();
    if (data.error) {
      Logger.log("⚠️ checkTVStatusAndNotify: " + data.error);
      logActivity("system", "TV-NOTIFY", "Fetch TV status ผิดพลาด", "FETCH_FAIL", "Error", 0);
      return;
    }

    const lastRaw = PropertiesService.getScriptProperties().getProperty(TV_NOTIFY_STATE_KEY);
    const lastStates = lastRaw ? JSON.parse(lastRaw) : null;
    const withinWindow = _isCourtTVNotifyWindow_();
    const forceNotify = _isForceNotifyOn_();
    const allowNotify = withinWindow || forceNotify;
    if (!allowNotify) {
      Logger.log("📺 TV-Notify: อยู่นอกช่วง 06:00-18:00 และ FORCE_NOTIFY=OFF — อัปเดตสถานะโดยไม่ส่งแจ้งเตือน");
    }

    const currentStates = {};
    (data.tv || []).forEach(c => {
      currentStates[c.clientId] = {
        online: !!c.online,
        firstSeen: c.firstSeen,
        lastSeen: c.lastSeen
      };
    });

    if (!lastStates) {
      PropertiesService.getScriptProperties().setProperty(
        TV_NOTIFY_STATE_KEY, JSON.stringify(currentStates)
      );
      Logger.log("📺 TV-Notify: Initialized state (เงียบครั้งแรก)");
      return;
    }

    const targets = getConfig("TV_NOTIFY_TARGETS") || "";
    if (!targets) {
      Logger.log("⚠️ TV-Notify: ยังไม่ได้ตั้ง target");
      PropertiesService.getScriptProperties().setProperty(
        TV_NOTIFY_STATE_KEY, JSON.stringify(currentStates)
      );
      return;
    }

    const notifyOnline  = getConfig("TV_NOTIFY_ON_ONLINE")  !== "OFF";
    const notifyOffline = getConfig("TV_NOTIFY_ON_OFFLINE") !== "OFF";
    let sentCount = 0;

    Object.keys(currentStates).forEach(clientId => {
      const cur = currentStates[clientId];
      const last = lastStates[clientId];

      if (allowNotify && !last && cur.online && notifyOnline) {
        _sendTVNotify("online", clientId, cur, data, targets);
        sentCount++;
      }
      else if (allowNotify && last && !last.online && cur.online && notifyOnline) {
        _sendTVNotify("online", clientId, cur, data, targets);
        sentCount++;
      }
      else if (allowNotify && last && last.online && !cur.online && notifyOffline) {
        _sendTVNotify("offline", clientId, cur, data, targets);
        sentCount++;
      }
    });

    Object.keys(lastStates).forEach(clientId => {
      if (allowNotify && !currentStates[clientId] && lastStates[clientId].online && notifyOffline) {
        _sendTVNotify("offline", clientId, lastStates[clientId], data, targets);
        sentCount++;
      }
    });

    PropertiesService.getScriptProperties().setProperty(
      TV_NOTIFY_STATE_KEY, JSON.stringify(currentStates)
    );

    if (sentCount > 0) {
      Logger.log("📺 TV-Notify: ส่งแจ้ง " + sentCount + " event(s)");
    }
  } catch (e) {
    Logger.log("❌ checkTVStatusAndNotify error: " + e.message + "\n" + e.stack);
  }
}

function _sendTVNotify(type, clientId, info, data, targets) {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const timeStr = Utilities.formatDate(now, tz, "HH:mm") + " น.";
  const dateStr = _thaiDateLong(now);
  const shortId = (clientId || "").substring(0, 18) + "...";
  const onlineCount = (data && typeof data.onlineCount === "number") ? data.onlineCount : 0;
  const courtName = (data && data.courtName) ? data.courtName : "ศาลจังหวัดลพบุรี";

  let msg;
  if (type === "online") {
    msg =
      "🟢 หน้าจอ TV เริ่มออนไลน์\n" +
      "━━━━━━━━━━━━━\n" +
      "📺 เครื่อง: " + shortId + "\n" +
      "⏰ เวลา: " + timeStr + " (" + dateStr + ")\n" +
      "📊 รวมเครื่อง Online: " + onlineCount + " เครื่อง\n" +
      "🏛 " + courtName;
  } else {
    const firstTime = info && info.firstSeen
      ? Utilities.formatDate(new Date(info.firstSeen), tz, "HH:mm") + " น."
      : "-";
    msg =
      "🔴 หน้าจอ TV ขาดการเชื่อมต่อ\n" +
      "━━━━━━━━━━━━━\n" +
      "📺 เครื่อง: " + shortId + "\n" +
      "⏰ Online ตั้งแต่: " + firstTime + "\n" +
      "⏰ ขาดการเชื่อมต่อเมื่อ: " + timeStr + " (" + dateStr + ")\n" +
      "📊 รวมเครื่อง Online: " + onlineCount + " เครื่อง\n" +
      "🏛 " + courtName;
  }

  try {
    sendLineNotification({ title: "", body: msg, targets: targets });
  } catch (e) {
    Logger.log("⚠️ _sendTVNotify send fail: " + e.message);
  }
}

function setupTVNotifyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "checkTVStatusAndNotify") {
      ScriptApp.deleteTrigger(t);
    }
  });

  if (getConfig("TV_NOTIFY_STATUS") !== "ON") {
    return { success: true, message: "ปิดระบบแจ้งเตือน TV แล้ว (Trigger ถูกลบ)" };
  }

  ScriptApp.newTrigger("checkTVStatusAndNotify")
    .timeBased()
    .everyMinutes(1)
    .create();

  return { success: true, message: "ตั้ง Trigger ทุก 1 นาที สำเร็จ" };
}

function saveTVNotifySettings(params) {
  try {
    const p = params || {};
    const status = p.status || "OFF";

    if (status === "ON") {
      if (!p.url || !String(p.url).trim()) {
        return { success: false, error: "กรุณาระบุ URL ระบบบัญชีนัด" };
      }
      if (!p.targets || !String(p.targets).trim()) {
        return { success: false, error: "กรุณาระบุเป้าหมายผู้รับแจ้งเตือน" };
      }
    }

    setConfig("TV_NOTIFY_STATUS",     status);
    setConfig("TV_NOTIFY_URL",        String(p.url || "").trim());
    setConfig("TV_NOTIFY_TARGETS",    String(p.targets || "").trim());
    setConfig("TV_NOTIFY_ON_ONLINE",  p.onOnline  || "ON");
    setConfig("TV_NOTIFY_ON_OFFLINE", p.onOffline || "ON");

    if (status !== "ON" || p.resetState) {
      PropertiesService.getScriptProperties().deleteProperty(TV_NOTIFY_STATE_KEY);
    }

    return setupTVNotifyTrigger();
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

function testTVNotifyNow() {
  try {
    const data = fetchCourtTVStatus();
    if (data.error) return { success: false, error: data.error };

    const targets = getConfig("TV_NOTIFY_TARGETS") || "";
    if (!targets) return { success: false, error: "ยังไม่ได้ตั้ง target — กรุณากรอกและบันทึกก่อน" };

    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const timeStr = Utilities.formatDate(now, tz, "HH:mm") + " น.";
    const dateStr = _thaiDateLong(now);

    const msg =
      "🧪 ทดสอบระบบแจ้งเตือน TV\n" +
      "━━━━━━━━━━━━━\n" +
      "⏰ เวลา: " + timeStr + " (" + dateStr + ")\n" +
      "📊 รวมเครื่อง Online: " + (data.onlineCount || 0) + " เครื่อง\n" +
      "📊 รวมเครื่องทั้งหมด: " + (data.totalCount || 0) + " เครื่อง\n" +
      "🏛 " + (data.courtName || "ศาลจังหวัดลพบุรี") + "\n\n" +
      "✅ ระบบแจ้งเตือนพร้อมใช้งาน";

    const res = sendLineNotification({ title: "", body: msg, targets: targets });
    if (res && res.success) {
      return { success: true, message: "ส่งทดสอบสำเร็จ — ตรวจสอบ LINE ของผู้รับ" };
    }
    return { success: false, error: (res && res.error) || "ส่งไม่สำเร็จ" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

function getTVNotifyState() {
  try {
    const status        = getConfig("TV_NOTIFY_STATUS")     || "OFF";
    const url           = getConfig("TV_NOTIFY_URL")        || "";
    const targets       = getConfig("TV_NOTIFY_TARGETS")    || "";
    const onOnline      = getConfig("TV_NOTIFY_ON_ONLINE")  || "ON";
    const onOffline     = getConfig("TV_NOTIFY_ON_OFFLINE") || "ON";

    let triggerCount = 0;
    ScriptApp.getProjectTriggers().forEach(t => {
      if (t.getHandlerFunction() === "checkTVStatusAndNotify") triggerCount++;
    });

    let trackedCount = 0;
    let onlineNow = 0;
    try {
      const raw = PropertiesService.getScriptProperties().getProperty(TV_NOTIFY_STATE_KEY);
      if (raw) {
        const lastSnapshot = JSON.parse(raw);
        Object.keys(lastSnapshot).forEach(id => {
          trackedCount++;
          if (lastSnapshot[id].online) onlineNow++;
        });
      }
    } catch(e) {}

    let liveTest = null;
    if (url) {
      const data = fetchCourtTVStatus();
      if (data.error) {
        liveTest = { ok: false, error: data.error };
      } else {
        liveTest = {
          ok: true,
          onlineCount: data.onlineCount || 0,
          totalCount:  data.totalCount  || 0,
          courtName:   data.courtName   || "-"
        };
      }
    }

    return {
      success: true,
      status: status,
      url: url,
      targets: targets,
      onOnline: onOnline,
      onOffline: onOffline,
      triggerCount: triggerCount,
      trackedCount: trackedCount,
      lastKnownOnline: onlineNow,
      liveTest: liveTest
    };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

function resetTVNotifyState() {
  try {
    PropertiesService.getScriptProperties().deleteProperty(TV_NOTIFY_STATE_KEY);
    return { success: true, message: "ล้าง state เรียบร้อย — รอบถัดไปจะเริ่มเงียบใหม่" };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

function _thaiDateLong(d) {
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.',
                  'ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

// ═══════════════════════════════════════════════════════════════════
//  📊 LINE API QUOTA CHECKER (เช็คโควต้าเหลือ)
// ═══════════════════════════════════════════════════════════════════

function getLineQuotaInfo() {
  try {
    try {
      const cached = CacheService.getScriptCache().get("LINE_QUOTA_INFO_V1");
      if (cached) return JSON.parse(cached);
    } catch (cacheErr) {}

    const headers = getLineAuthHeaders_();

    const qRes = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/quota", {
      method: "get", headers: headers, muteHttpExceptions: true
    });

    const cRes = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/quota/consumption", {
      method: "get", headers: headers, muteHttpExceptions: true
    });

    if (qRes.getResponseCode() !== 200) {
      return { success: false, error: "Quota API: HTTP " + qRes.getResponseCode() };
    }
    if (cRes.getResponseCode() !== 200) {
      return { success: false, error: "Consume API: HTTP " + cRes.getResponseCode() };
    }

    const qData = JSON.parse(qRes.getContentText());
    const cData = JSON.parse(cRes.getContentText());

    const total = (qData.type === 'limited') ? Number(qData.value) : -1;
    const used  = Number(cData.totalUsage) || 0;
    const remaining = total > 0 ? Math.max(0, total - used) : -1;
    const percent = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;

    let planName = 'Free';
    if (total === 15000) planName = 'Basic';
    else if (total === 35000) planName = 'Pro';
    else if (total === -1) planName = 'Unlimited';
    else if (total !== 200) planName = 'Custom';

    let status = 'ok';
    if (percent >= 100) status = 'exceeded';
    else if (percent >= 80) status = 'warning';
    else if (percent >= 50) status = 'half';

    const now = new Date();
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const daysLeft = Math.ceil((nextReset - now) / (1000 * 60 * 60 * 24));

    const result = {
      success: true,
      plan: planName,
      total: total,
      used: used,
      remaining: remaining,
      percent: percent,
      status: status,
      daysLeft: daysLeft,
      resetDate: _thaiDateLong(nextReset)
    };
    try {
      CacheService.getScriptCache().put("LINE_QUOTA_INFO_V1", JSON.stringify(result), 300);
    } catch (cacheErr) {}
    return result;
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}


// ╔══════════════════════════════════════════════════════════════════╗
// ║  🚀 v10.4.3 — MISSION GROUP MODE                                 ║
// ║  รับบ้านเลขที่/พิกัด/รูปอัตโนมัติเฉพาะกลุ่มที่ระบุ                  ║
// ╠══════════════════════════════════════════════════════════════════╣
// ║  Configs:                                                         ║
// ║   • MISSION_GROUP_IDS     — Group IDs คั่นด้วย ,                  ║
// ║   • MISSION_REPLY_MODE    — silent / session / all                ║
// ╚══════════════════════════════════════════════════════════════════╝

/**
 * เช็คว่า Group ID อยู่ใน Mission whitelist
 */
function _isMissionGroup(groupId) {
  if (!groupId) return false;
  const raw = getConfig("MISSION_GROUP_IDS") || "";
  if (!raw.trim()) return false;
  const list = raw.split(",").map(function(s){ return s.trim(); }).filter(Boolean);
  return list.indexOf(groupId) >= 0;
}

/**
 * Validate ว่า text น่าจะเป็นเลขบ้าน (สำหรับใน Mission Group)
 *
 * รับ:
 *  - ขึ้นต้นด้วยเลข (200, 102/2, 89/9/1)
 *  - ขึ้นต้นด้วย "บ้านเลขที่"/"เลขที่บ้าน" + เลข
 *
 * ปฏิเสธ:
 *  - คำสั่ง: บอท, ค้นหา, หา, บัญชี, นัด, ส่ง, /, #
 *  - เวลา: 09:00, 10.30 น.
 *  - หน่วย: 5 บาท, 100 กิโล, 30 นาที
 */
function _looksLikeMissionHouseNumber(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (t.length < 1 || t.length > 200) return false;

  // ❌ Reject: คำสั่ง
  if (/^(บอท|ค้นหา|หา|บัญชี|นัด|ส่ง|#|\/)/i.test(t)) return false;

  // ❌ Reject: เวลา (09:00, 10.30 น.)
  if (/^\d{1,2}[:.]\d{2}\s*(น\.?)?$/i.test(t)) return false;

  // ❌ Reject: หน่วย
  if (/^\d+\s*(บาท|กก|กิโล|ชม|ชั่วโมง|นาที|วัน|เดือน|ปี|km|kg|hr|min|sec)\s*$/i.test(t)) return false;

  // ✅ Accept: เริ่มด้วยเลข
  if (/^\d/.test(t)) return true;

  // ✅ Accept: keyword "บ้านเลขที่" / "เลขที่บ้าน" / "เลขที่"
  if (/^(บ้านเลขที่|เลขที่บ้าน|เลขที่)\s*\d/.test(t)) return true;

  return false;
}

function _looksLikeMissionCoordinateText(text) {
  if (!text) return false;
  const t = String(text).trim();
  if (!t || t.length > 500) return false;
  if (/^(บอท|ค้นหา|หา|บัญชี|นัด|ส่ง|#|\/)/i.test(t)) return false;
  if (/^(พิกัด|ตำแหน่ง|location|coord|coords|gps|แผนที่)(\s|:|：|-|$)/i.test(t)) return true;
  if (/maps\.app\.goo\.gl|google\.[^\/\s]+\/maps|goo\.gl\/maps/i.test(t)) return true;
  if (/@-?\d{1,2}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?/.test(t)) return true;
  if (/-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+/.test(t)) return true;
  if (/^[23456789CFGHJMPQRVWX]{4,}\+[23456789CFGHJMPQRVWX]{2,}/i.test(t)) return true;
  return false;
}

function _handleMissionHouseText_(messageText, userId, userName, groupId, replyToken) {
  const norm = _normalizeMissionAddress(messageText);
  const cleanHouseNum = String(norm.houseNum || "").trim();
  if (!_isValidHouseNumber(cleanHouseNum)) {
    Logger.log("Mission house rejected: " + cleanHouseNum);
    return true;
  }

  const houseResult = _saveOrUpdateHouseNumberCompat_(userId, cleanHouseNum, groupId);
  if (norm.address && houseResult && houseResult.rowIndex > 0) {
    _saveMissionAddressToLocationRow_(houseResult.rowIndex, norm.address);
  }
  if (!houseResult || !houseResult.duplicate) {
    _sendMissionPikadReply_(replyToken, "house", houseResult && houseResult.rowIndex);
  }
  if (typeof updateDailyStats === "function") updateDailyStats(0, 0, 1);
  logActivity(userId, userName, "ส่งเลขที่งานหมาย: " + cleanHouseNum, "Location", "Success", 0);
  return true;
}

function _handleMissionCoordinateText_(messageText, userId, userName, groupId, replyToken) {
  const parsed = _parseMissionCoordinateText_(messageText);
  if (!parsed) return false;

  const locResult = _saveOrUpdateLocationDataCompat_(
    userId,
    parsed.lat || "",
    parsed.lng || "",
    parsed.address || String(messageText || "").trim(),
    groupId
  );
  if (!locResult || !locResult.duplicate) {
    _sendMissionPikadReply_(replyToken, "coord", locResult && locResult.rowIndex);
  }
  if (typeof updateDailyStats === "function") updateDailyStats(0, 0, 1);
  logActivity(userId, userName, "ส่งพิกัดงานหมาย: " + (parsed.lat && parsed.lng ? parsed.lat + "," + parsed.lng : parsed.address), "Location", "Success", 0);
  return true;
}

function _parseMissionCoordinateText_(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  let t = raw.replace(/^(พิกัด|ตำแหน่ง|location|coord|coords|gps|แผนที่)\s*[:：-]?\s*/i, "").trim();
  let decoded = t;
  try { decoded = decodeURIComponent(t); } catch(e) {}

  const coordPatterns = [
    /@(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|query|ll)=(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/,
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/
  ];
  for (let i = 0; i < coordPatterns.length; i++) {
    const m = decoded.match(coordPatterns[i]) || raw.match(coordPatterns[i]);
    if (m && _isValidMissionLatLng_(m[1], m[2])) {
      return { lat: String(m[1]), lng: String(m[2]), address: raw };
    }
  }

  try {
    const geo = Maps.newGeocoder().setRegion("th").setLanguage("th").geocode(t || raw);
    if (geo && geo.status === "OK" && geo.results && geo.results.length) {
      const loc = geo.results[0].geometry && geo.results[0].geometry.location;
      if (loc && _isValidMissionLatLng_(loc.lat, loc.lng)) {
        return {
          lat: String(loc.lat),
          lng: String(loc.lng),
          address: geo.results[0].formatted_address || raw
        };
      }
    }
  } catch(e) {
    Logger.log("Mission geocode skipped: " + e.message);
  }

  return { lat: "", lng: "", address: raw };
}

function _isValidMissionLatLng_(lat, lng) {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (isNaN(nLat) || isNaN(nLng)) return false;
  if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) return false;
  if (nLat === 0 && nLng === 0) return false;
  return true;
}

function _saveMissionAddressToLocationRow_(rowIndex, address) {
  try {
    SpreadsheetApp.openById(SPREADSHEET_ID)
      .getSheetByName(SHEETS.LOCATION)
      .getRange(rowIndex, 7)
      .setValue(String(address || "").trim());
  } catch(e) {
    Logger.log("Mission save address error: " + e.message);
  }
}

/**
 * Normalize ที่อยู่ — แปลงรูปแบบทุกแบบเป็นมาตรฐาน
 *
 * รองรับ:
 *  - ม / ม. / หมู่ / หมู / MOO / moo  → "หมู่"
 *  - 200/5, 102/2, 89/9/1 (multi-level)
 *  - 200-5 → 200/5
 *  - whitespace รอบ "/" → ตัดออก
 *  - prefix: บ้านเลขที่/เลขที่บ้าน/เลขที่/ที่ → ตัด
 *
 * คืน:
 *  { houseNum: "200 หมู่ 6", address: "ถนนใหญ่ มบ.แสนอารี" }
 */
function _normalizeMissionAddress(text) {
  if (!text) return { houseNum: "", address: "" };

  let t = String(text).trim();

  // [1] Whitespace + delimiters
  t = t.replace(/\s+/g, " ").replace(/\s*[,،]\s*/g, " ");

  // [2] ตัด prefix
  t = t.replace(/^(บ้านเลขที่|เลขที่บ้าน|เลขที่|ที่)\s*/i, "");

  // [3] ตัด whitespace รอบ "/" — รันหลายรอบจน stable
  for (let i = 0; i < 5; i++) {
    const before = t;
    t = t.replace(/(\d)\s+\/\s*(\d)/g, "$1/$2");
    t = t.replace(/(\d)\s*\/\s+(\d)/g, "$1/$2");
    if (t === before) break;
  }

  // [4] - → / (200-5 → 200/5)
  t = t.replace(/^(\d+)-(\d+)/, "$1/$2");

  // [5] Match รูปแบบหลัก
  // group 1 = เลขบ้าน เช่น 200, 102/2, 89/9/1
  // group 2 = "หมู่ keyword" (ม/ม./หมู่/หมู/moo)
  // group 3 = เลขหมู่ (เช่น 5)
  // group 4 = ที่อยู่ที่เหลือ
  const HOUSE_NUM = "(\\d+(?:\\/\\d+)*)";
  const MOO_KW    = "(ม\\.?|หมู่|หมู|moo)";

  const fullPattern = new RegExp(
    "^" + HOUSE_NUM +
    "(?:\\s*" + MOO_KW +
    "\\s*(\\d+))?" +
    "(?:\\s+(.+))?$",
    "i"
  );

  const m = t.match(fullPattern);
  if (!m) {
    return { houseNum: t, address: "" };
  }

  const numPart = m[1];
  const mooNumber = m[3];
  const remaining = m[4] || "";

  let houseNum = numPart;
  if (mooNumber) {
    houseNum += " หมู่ " + mooNumber;  // แปลงทุกรูปแบบเป็น "หมู่"
  }

  return {
    houseNum: houseNum.trim(),
    address: remaining.trim()
  };
}

/**
 * 🧪 ทดสอบฟังก์ชัน Mission Group (รันใน Apps Script editor)
 */
function testMissionGroupNormalize() {
  const cases = [
    "200 ม 6  ถนนใหญ่ มบ.แสนอารี แยกท่าแค",
    "51/3 ม 6  ท่าแค ซอยข้างร้านค้าบ้านอสม.",
    "102/2 หมู 5 ต.ถนนใหญ่",
    "89/9 ม.6 อ.เมือง จ.ลพบุรี",
    "บ้านเลขที่ 200 หมู 3",
    "200-5 ม 7",
    "89 / 9",
    "89",
    "200 MOO 5",
    // Should reject
    "09:00",
    "5 บาท",
    "OK ค่ะ"
  ];

  Logger.log("═══ Mission Group Normalize Test ═══");
  cases.forEach(function(c) {
    const valid = _looksLikeMissionHouseNumber(c);
    if (valid) {
      const r = _normalizeMissionAddress(c);
      Logger.log("✅ \"" + c + "\"\n   → houseNum: \"" + r.houseNum + "\"" +
                 (r.address ? "\n   → address: \"" + r.address + "\"" : ""));
    } else {
      Logger.log("❌ REJECT: \"" + c + "\"");
    }
  });

  return { success: true, message: "ดู Logger.log" };
}
// ════════════════════════════════════════════════════════════
// 🛡️ Group Whitelist System v10.4.5
// ────────────────────────────────────────────────────────────
// อ่าน whitelist คำสั่งในกลุ่มจาก Sheet GROUP_WHITELIST
// แทนการ hardcode ใน regex → เพิ่ม/ลบคำสั่งโดยไม่ต้องแก้โค้ด
// Cache 5 นาที เพื่อประสิทธิภาพ
// ════════════════════════════════════════════════════════════

const _WHITELIST_CACHE_KEY = "_groupWhitelist_v1";
const _WHITELIST_CACHE_TTL = 300; // 5 นาที

/**
 * อ่าน whitelist จาก Sheet (พร้อม cache + fallback)
 * @return {string[]} รายการคำสั่งที่ status = ON
 */
function _getGroupWhitelist() {
  // ลอง cache ก่อน
  try {
    const cached = CacheService.getScriptCache().get(_WHITELIST_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (e) {}

  // อ่านจาก Sheet
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID)
      .getSheetByName(SHEETS.GROUP_WHITELIST);
    
    if (!sheet) {
      Logger.log("⚠️ GROUP_WHITELIST sheet not found — using default");
      return _getDefaultWhitelist();
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return _getDefaultWhitelist();

    const list = [];
    for (let i = 1; i < data.length; i++) {
      const cmd = String(data[i][0] || "").trim();
      const status = String(data[i][1] || "").trim().toUpperCase();
      if (cmd && status === "ON") list.push(cmd);
    }

    const result = list.length > 0 ? list : _getDefaultWhitelist();
    try {
      CacheService.getScriptCache().put(
        _WHITELIST_CACHE_KEY, JSON.stringify(result), _WHITELIST_CACHE_TTL);
    } catch (e) {}
    return result;
  } catch (e) {
    Logger.log("❌ _getGroupWhitelist error: " + e.message);
    return _getDefaultWhitelist();
  }
}

/**
 * Fallback whitelist (กรณี Sheet หาย/อ่านไม่ได้)
 */
function _getDefaultWhitelist() {
  return [
    "/ค้นหา", "/สอน", "/แก้ไข", "/ลบ", "/รายการ",
    "/แจ้งเตือน", "/สถิติ", "/จำนวนรวม", "/บอท",
    "/ช่วยเหลือ", "/ไอดีกลุ่ม"
  ];
}

/**
 * เช็คว่าข้อความเป็นคำสั่งที่อนุญาตในกลุ่มหรือไม่
 * @param {string} messageText - ข้อความผู้ใช้
 * @return {boolean}
 */
function _isWhitelistedCommand(messageText) {
  if (!messageText || !messageText.startsWith("/")) return false;
  
  const whitelist = _getGroupWhitelist();
  for (let i = 0; i < whitelist.length; i++) {
    const cmd = whitelist[i];
    // รองรับ "/สอน" (เดี่ยว) และ "/สอน Q | A" (มี space)
    if (messageText === cmd ||
        messageText.startsWith(cmd + " ") ||
        messageText.startsWith(cmd + "\t")) {
      return true;
    }
  }
  return false;
}

/**
 * ล้าง cache (เรียกหลังแก้ Sheet เพื่อให้เห็นผลทันที)
 */
function _clearWhitelistCache() {
  try {
    CacheService.getScriptCache().remove(_WHITELIST_CACHE_KEY);
    Logger.log("✅ Whitelist cache cleared");
  } catch (e) {
    Logger.log("⚠️ Clear whitelist cache failed: " + e.message);
  }
}
/**
 * สร้าง Sheet GROUP_WHITELIST + ใส่ค่า default
 * รันครั้งเดียวตอน Phase 1 deploy
 */
function setupGroupWhitelistSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEETS.GROUP_WHITELIST);

  if (sheet) {
    Logger.log("ℹ️ Sheet already exists — skipping");
    return { ok: true, created: false, message: "มีอยู่แล้ว" };
  }

  sheet = ss.insertSheet(SHEETS.GROUP_WHITELIST);

  // Header
  sheet.getRange(1, 1, 1, 5).setValues([[
    "คำสั่ง", "สถานะ", "ประเภท", "คำอธิบาย", "วันที่เพิ่ม"
  ]]);
  sheet.getRange(1, 1, 1, 5)
    .setFontWeight("bold")
    .setBackground("#4285F4")
    .setFontColor("#FFFFFF")
    .setHorizontalAlignment("center");

  // Default rows
  const now = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  const defaults = [
    ["/ค้นหา",     "ON", "USER",  "ค้นหาในฐานข้อมูล (สถานะหมาย)", now],
    ["/สอน",       "ON", "ADMIN", "เพิ่มข้อมูลให้บอทเรียนรู้", now],
    ["/แก้ไข",     "ON", "ADMIN", "แก้ไขคำตอบในฐานข้อมูล", now],
    ["/ลบ",        "ON", "ADMIN", "ลบข้อมูลในฐานข้อมูล", now],
    ["/รายการ",    "ON", "ADMIN", "ดู Q&A 10 อันดับล่าสุด", now],
    ["/แจ้งเตือน", "ON", "ADMIN", "Broadcast แจ้งเตือนสมาชิก", now],
    ["/สถิติ",     "ON", "ADMIN", "ดูสถิติการใช้งานระบบ", now],
    ["/จำนวนรวม",  "ON", "ADMIN", "ดูจำนวนรวม (alias /สถิติ)", now],
    ["/บอท",       "ON", "ADMIN", "เปิด/ปิดบอทชั่วคราว", now],
    ["/ช่วยเหลือ", "ON", "USER",  "แสดงคำสั่งที่ใช้ได้", now],
    ["/ไอดีกลุ่ม", "ON", "USER",  "ดูไอดีของกลุ่ม/แชท", now]
  ];
  sheet.getRange(2, 1, defaults.length, 5).setValues(defaults);

  // Column widths + freeze header
  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 280);
  sheet.setColumnWidth(5, 160);
  sheet.setFrozenRows(1);

  // Data validation (dropdown)
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["ON", "OFF"]).setAllowInvalid(false).build();
  sheet.getRange(2, 2, 1000, 1).setDataValidation(statusRule);

  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(["USER", "ADMIN"]).setAllowInvalid(false).build();
  sheet.getRange(2, 3, 1000, 1).setDataValidation(typeRule);

  // ล้าง cache เพื่อให้อ่านใหม่
  _clearWhitelistCache();

  Logger.log("✅ Created GROUP_WHITELIST with " + defaults.length + " commands");
  return { ok: true, created: true, count: defaults.length };
}

/**
 * Unit test สำหรับ Whitelist
 */
function testGroupWhitelist() {
  Logger.log("=== Test Group Whitelist ===");
  _clearWhitelistCache();

  const wl = _getGroupWhitelist();
  Logger.log("Loaded: " + wl.length + " commands");
  Logger.log("List: " + JSON.stringify(wl));

  const cases = [
    // ควร ACCEPT
    ["/ค้นหา 123/1",        true,  "ค้นหามี space"],
    ["/ค้นหา",               true,  "ค้นหาเดี่ยว"],
    ["/สอน Q | A",          true,  "สอนเพิ่ม"],
    ["/แก้ไข K001 | xxx",    true,  "แก้ไข"],
    ["/ลบ K001",             true,  "ลบ"],
    ["/รายการ",              true,  "ดูรายการ"],
    ["/แจ้งเตือน hello",     true,  "broadcast"],
    ["/สถิติ",               true,  "สถิติ"],
    ["/บอท เปิด",            true,  "บอทเปิด"],
    ["/บอท ปิด",             true,  "บอทปิด"],
    ["/ช่วยเหลือ",           true,  "ช่วยเหลือ"],
    ["/ไอดีกลุ่ม",            true,  "ไอดีกลุ่ม"],
    // ควร REJECT
    ["สวัสดีครับ",           false, "ข้อความปกติ"],
    ["/abcdef",              false, "คำสั่งไม่รู้จัก"],
    ["/ค้นหาบ้าน",           false, "ติดกัน ไม่มี space"],
    ["",                     false, "ว่าง"],
    ["บอท /สอน Q | A",      false, "มี prefix บอท (handled แยก)"]
  ];

  let pass = 0, fail = 0;
  for (let i = 0; i < cases.length; i++) {
    const input = cases[i][0];
    const expected = cases[i][1];
    const desc = cases[i][2];
    const actual = _isWhitelistedCommand(input);
    if (actual === expected) {
      Logger.log("✅ PASS [" + desc + "]: '" + input + "' → " + actual);
      pass++;
    } else {
      Logger.log("❌ FAIL [" + desc + "]: '" + input + "' → expected " 
        + expected + " got " + actual);
      fail++;
    }
  }

  Logger.log("=== " + pass + "/" + (pass + fail) + " passed ===");
  return { pass: pass, fail: fail, total: pass + fail };
}
// ════════════════════════════════════════════════════════════
// 📖 Help Card (Flex Message) v10.4.5
// ────────────────────────────────────────────────────────────
// แสดงคำสั่งทั้งหมดในรูปแบบ Flex Card สวยๆ
// แสดงเฉพาะคำสั่งที่ user มีสิทธิ์ใช้ตามบทบาท
// ════════════════════════════════════════════════════════════

/**
 * สร้าง Flex Card คู่มือคำสั่ง
 * @param {string} userRole - "User" | "VIP" | "Admin"
 * @param {boolean} userIsAdmin - เป็น admin หรือไม่
 * @return {object} Flex Message
 */
function _buildHelpFlexCard(userRole, userIsAdmin) {
  const isVip = userRole === "VIP" || userIsAdmin;
  const sections = [];

  // ── Section 1: 🔍 ค้นหา (ทุกคน) ──────────────────
  sections.push(_buildHelpSection(
    "🔍 ค้นหา / สอบถาม",
    "#1976D2",
    [
      { cmd: "/ค้นหา [คำค้น]", desc: "ค้นหาในฐานข้อมูล" },
      { cmd: "/ไอดีกลุ่ม", desc: "ดู ID ของกลุ่ม/แชท" }
    ],
    [
      { label: "ลอง /ไอดีกลุ่ม", text: "/ไอดีกลุ่ม" }
    ]
  ));

  // ── Section 2: 📍 งานหมาย / พิกัด ──────────────────
  sections.push(_buildHelpSection(
    "📍 งานหมาย / พิกัด",
    "#059669",
    [
      { cmd: "ส่งรูปภาพ", desc: "บันทึกรูปหลักฐานตาม PHOTO_MAX_WIDTH" },
      { cmd: "ส่ง Location จาก LINE", desc: "บันทึกพิกัดจากปุ่มแชร์ตำแหน่ง" },
      { cmd: "138 ม 10 ท่าแค", desc: "บันทึกเลขที่ในกลุ่มส่งหมาย" },
      { cmd: "พิกัด 14.80550,100.61440", desc: "บันทึกพิกัดจากข้อความ" },
      { cmd: "VJMG+FJ4 ตำบล ท่าแค", desc: "บันทึก Plus Code/ตำแหน่ง" }
    ],
    []
  ));

  // ── Section 3: ⚖️ บัญชีนัดความ (VIP+) ─────────────
  if (isVip) {
    sections.push(_buildHelpSection(
      "⚖️ บัญชีนัดความ",
      "#7C3AED",
      [
        { cmd: "บัญชีนัดความ วันนี้", desc: "คดีของวันนี้" },
        { cmd: "บัญชีนัดความ พรุ่งนี้", desc: "คดีของพรุ่งนี้" },
        { cmd: "บัญชีนัดความ [วันที่]", desc: "เช่น 17/4/68" }
      ],
      [
        { label: "📅 วันนี้", text: "บัญชีนัดความ วันนี้" },
        { label: "⏭️ พรุ่งนี้", text: "บัญชีนัดความ พรุ่งนี้" }
      ]
    ));
  }

  // ── Section 4: 📚 จัดการ Q&A (Admin) ──────────────
  if (userIsAdmin) {
    sections.push(_buildHelpSection(
      "📚 จัดการความรู้ (Admin)",
      "#F57C00",
      [
        { cmd: "/สอน Q | A", desc: "เพิ่มคำถาม-คำตอบ" },
        { cmd: "/แก้ไข ID | A", desc: "แก้คำตอบ" },
        { cmd: "/ลบ ID", desc: "ลบ Q&A" },
        { cmd: "/รายการ", desc: "ดู Q&A 10 ล่าสุด" }
      ],
      [
        { label: "📋 ดูรายการ", text: "/รายการ" }
      ]
    ));
  }

  // ── Section 5: 📊 สถิติ + ระบบ (Admin) ────────────
  if (userIsAdmin) {
    sections.push(_buildHelpSection(
      "📊 สถิติ + ระบบ (Admin)",
      "#388E3C",
      [
        { cmd: "/สถิติ", desc: "ดูสถิติระบบ" },
        { cmd: "/แจ้งเตือน [ข้อความ]", desc: "Broadcast" },
        { cmd: "/บอท เปิด / ปิด", desc: "เปิด/ปิดบอท" }
      ],
      [
        { label: "📊 ดูสถิติ", text: "/สถิติ" }
      ]
    ));
  }

  // ── Section 6: 🆘 ลงทะเบียน VIP (User) ────────────
  if (!isVip && !userIsAdmin) {
    sections.push(_buildHelpSection(
      "🆘 ลงทะเบียน VIP",
      "#C2185B",
      [
        { cmd: "[รหัสลับ]", desc: "พิมพ์ใน DM ส่วนตัว" },
        { cmd: "(ติดต่อ Admin)", desc: "ขอรหัสจากผู้ดูแล" }
      ],
      []
    ));
  }

  // ── Footer ──────────────────────────────────────
  const roleLabel = userIsAdmin ? "👑 Admin" :
                    isVip ? "⭐ VIP" : "👤 User";

  return {
    type: "flex",
    altText: "📖 คู่มือคำสั่งบอท (สำหรับ " + roleLabel + ")",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1A237E",
        paddingAll: "16px",
        contents: [
          {
            type: "text",
            text: "📖 คู่มือคำสั่งบอท",
            color: "#FFFFFF",
            weight: "bold",
            size: "xl"
          },
          {
            type: "box",
            layout: "horizontal",
            margin: "xs",
            contents: [
              {
                type: "text",
                text: "Bot v10.5",
                color: "#C5CAE9",
                size: "xs",
                flex: 1
              },
              {
                type: "text",
                text: roleLabel,
                color: "#FFD54F",
                size: "xs",
                weight: "bold",
                align: "end"
              }
            ]
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "💡 พิมพ์คำสั่ง หรือกดปุ่มเพื่อทดลอง",
            size: "xs",
            color: "#5F6368",
            align: "center",
            margin: "none"
          },
          { type: "separator", color: "#E0E0E0" }
        ].concat(sections)
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "10px",
        backgroundColor: "#F5F5F5",
        contents: [
          {
            type: "text",
            text: "🟢 ค้นหาในกลุ่ม: ขึ้นต้นด้วย 'บอท' หรือ '/'",
            size: "xxs",
            color: "#5F6368",
            align: "center"
          },
          {
            type: "text",
            text: "🟢 กลุ่มส่งหมาย: รูป/พิกัด/เลขที่รับอัตโนมัติ",
            size: "xxs",
            color: "#5F6368",
            align: "center",
            margin: "xs"
          }
        ]
      }
    }
  };
}

/**
 * Helper: สร้าง section ของแต่ละหมวด
 */
function _buildHelpSection(title, color, commands, buttons) {
  const contents = [
    {
      type: "text",
      text: title,
      weight: "bold",
      size: "sm",
      color: color
    }
  ];

  // เพิ่ม commands
  commands.forEach(function(c) {
    contents.push({
      type: "box",
      layout: "vertical",
      margin: "xs",
      paddingStart: "6px",
      borderColor: color,
      borderWidth: "2px",
      contents: [
        {
          type: "text",
          text: c.cmd,
          size: "xs",
          weight: "bold",
          color: "#202124",
          wrap: true
        },
        {
          type: "text",
          text: c.desc,
          size: "xxs",
          color: "#5F6368",
          margin: "none",
          wrap: true
        }
      ]
    });
  });

  // เพิ่มปุ่ม
  if (buttons && buttons.length > 0) {
    const buttonElems = buttons.map(function(b) {
      return {
        type: "button",
        action: {
          type: "message",
          label: b.label,
          text: b.text
        },
        style: "secondary",
        height: "sm",
        flex: 1
      };
    });
    contents.push({
      type: "box",
      layout: "horizontal",
      spacing: "xs",
      margin: "sm",
      contents: buttonElems
    });
  }

  contents.push({ type: "separator", color: "#EEEEEE", margin: "md" });

  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    margin: "md",
    contents: contents
  };
}

/**
 * ส่ง Help Flex Card
 */
function _buildHelpFlexCardCurrent_(userRole, userIsAdmin) {
  const isVip = userRole === "VIP" || userIsAdmin;
  const sections = [];

  sections.push(_buildHelpSection(
    "🔍 ค้นหา / สอบถาม",
    "#1976D2",
    [
      { cmd: "ค้นหา", desc: "แสดงรายการฐานที่ค้นได้" },
      { cmd: "ค้นหา ฐาน", desc: "แสดงรายการฐานข้อมูลที่เชื่อมไว้" },
      { cmd: "ค้นหา [คำค้น]", desc: "ค้นทุกฐานที่เปิดใช้งานและผู้ใช้มีสิทธิ์" },
      { cmd: "ค้นหา [ชื่อฐาน] [คำค้น]", desc: "ค้นเฉพาะฐาน เช่น พิกัด บ้านเลขที่ ผู้ใหญ่บ้าน" },
      { cmd: "บอท ค้นหา [คำค้น]", desc: "ใช้ในกลุ่มทั่วไป โดย prefix เปลี่ยนได้จาก SEARCH_GROUP_PREFIX" },
      { cmd: "/ไอดีกลุ่ม", desc: "ดู User ID, Group ID หรือ Room ID ของแชทนี้" }
    ],
    [{ label: "ลอง /ไอดีกลุ่ม", text: "/ไอดีกลุ่ม" }]
  ));

  sections.push(_buildHelpSection(
    "📍 งานหมาย / พิกัด",
    "#059669",
    [
      { cmd: "ส่งรูปภาพ", desc: "บันทึกรูปหลักฐานตาม PHOTO_MAX_WIDTH เมื่อ PHOTO_SAVE_STATUS เปิด" },
      { cmd: "ส่ง Location จาก LINE", desc: "บันทึกพิกัดจากปุ่มแชร์ตำแหน่ง" },
      { cmd: "138 ม 10 ท่าแค", desc: "บันทึกเลขที่/หมู่/ตำบลในกลุ่มส่งหมาย" },
      { cmd: "พิกัด 14.80550,100.61440", desc: "บันทึกพิกัดจากข้อความ" },
      { cmd: "VJMG+FJ4 ตำบล ท่าแค", desc: "บันทึก Plus Code หรือข้อความตำแหน่ง" },
      { cmd: "Google Maps link", desc: "บันทึกพิกัดจากลิงก์แผนที่" }
    ],
    []
  ));

  if (isVip) {
    sections.push(_buildHelpSection(
      "⚖️ บัญชีนัดความ",
      "#7C3AED",
      [
        { cmd: "บัญชีนัดความ วันนี้", desc: "ค้นคดีของวันนี้" },
        { cmd: "บัญชีนัด พรุ่งนี้", desc: "ค้นคดีของวันถัดไป" },
        { cmd: "บัญชีนัด มะรืน", desc: "ค้นคดีอีก 2 วัน" },
        { cmd: "บัญชีนัด อีก 3 วัน", desc: "ค้นตามจำนวนวันที่ระบุ" },
        { cmd: "บัญชีนัด 17/4/68", desc: "ค้นวันที่เฉพาะ รองรับ พ.ศ./ค.ศ." },
        { cmd: "บัญชีนัดความ วันนี้ หน้า 2", desc: "ดูหน้าถัดไปเมื่อผลลัพธ์มีหลายหน้า" }
      ],
      [
        { label: "📅 วันนี้", text: "บัญชีนัดความ วันนี้" },
        { label: "⏭️ พรุ่งนี้", text: "บัญชีนัดความ พรุ่งนี้" }
      ]
    ));
  }

  sections.push(_buildHelpSection(
    "💻 ศูนย์ประสานงานคดีออนไลน์",
    "#0891B2",
    [
      { cmd: "เข้าออนไลน์ บ1", desc: "แจ้งเข้าร่วมพิจารณาคดีออนไลน์/บัลลังก์ที่ระบุ" },
      { cmd: "เข้าไม่ได้", desc: "ขอคำแนะนำกรณีลิงก์ กล้อง ไมค์ หรือเสียงมีปัญหา" },
      { cmd: "คำสาบาน / การเข้าใช้งาน", desc: "แสดงคำแนะนำเตรียมตัวเข้าห้องพิจารณาคดีอิเล็กทรอนิกส์" },
      { cmd: "ติดต่อเจ้าหน้าที่", desc: "ขอช่องทางแจ้งเจ้าหน้าที่ศูนย์ประสานงานคดี" }
    ],
    []
  ));

  if (userIsAdmin) {
    sections.push(_buildHelpSection(
      "📚 จัดการความรู้ (Admin)",
      "#F57C00",
      [
        { cmd: "/สอน Q | A", desc: "เพิ่มคำถาม-คำตอบในฐานความรู้" },
        { cmd: "/แก้ไข ID | A", desc: "แก้คำตอบของรายการเดิม" },
        { cmd: "/ลบ ID", desc: "ลบ Q&A ตาม ID" },
        { cmd: "/รายการ", desc: "ดู Q&A 10 รายการล่าสุด" }
      ],
      [{ label: "📋 ดูรายการ", text: "/รายการ" }]
    ));

    sections.push(_buildHelpSection(
      "📊 ระบบ (Admin)",
      "#388E3C",
      [
        { cmd: "/สถิติ", desc: "ดูสถิติระบบ" },
        { cmd: "/จำนวนรวม", desc: "ดูสถิติรวมแบบเดียวกับ /สถิติ" },
        { cmd: "/แจ้งเตือน [ข้อความ]", desc: "Broadcast ถึงสมาชิก" },
        { cmd: "/บอท เปิด", desc: "เปิด BOT_STATUS" },
        { cmd: "/บอท ปิด", desc: "ปิด BOT_STATUS ชั่วคราว" }
      ],
      [{ label: "📊 ดูสถิติ", text: "/สถิติ" }]
    ));
  }

  if (!isVip && !userIsAdmin) {
    sections.push(_buildHelpSection(
      "🆘 ลงทะเบียน VIP",
      "#C2185B",
      [
        { cmd: "[รหัสลับ]", desc: "พิมพ์รหัสในแชทส่วนตัวเท่านั้น" },
        { cmd: "(ติดต่อ Admin)", desc: "ขอรหัสจากผู้ดูแลระบบ" }
      ],
      []
    ));
  }

  const roleLabel = userIsAdmin ? "👑 Admin" : isVip ? "⭐ VIP" : "👤 User";
  return {
    type: "flex",
    altText: "📖 คู่มือคำสั่งบอท v10.5 (" + roleLabel + ")",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1A237E",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "📖 คู่มือคำสั่งบอท", color: "#FFFFFF", weight: "bold", size: "xl" },
          {
            type: "box",
            layout: "horizontal",
            margin: "xs",
            contents: [
              { type: "text", text: "Bot v10.5", color: "#C5CAE9", size: "xs", flex: 1 },
              { type: "text", text: roleLabel, color: "#FFD54F", size: "xs", weight: "bold", align: "end" }
            ]
          }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        spacing: "md",
        contents: [
          { type: "text", text: "💡 พิมพ์คำสั่ง หรือกดปุ่มเพื่อทดลอง", size: "xs", color: "#5F6368", align: "center", margin: "none" },
          { type: "separator", color: "#E0E0E0" }
        ].concat(sections)
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "10px",
        backgroundColor: "#F5F5F5",
        contents: [
          { type: "text", text: "🟢 กลุ่มทั่วไป: ใช้ 'บอท ค้นหา ...' หรือ prefix ที่ตั้งไว้", size: "xxs", color: "#5F6368", align: "center", wrap: true },
          { type: "text", text: "🟢 กลุ่มส่งหมาย: รูป/พิกัด/เลขที่รับอัตโนมัติเมื่ออยู่ใน MISSION_GROUP_IDS", size: "xxs", color: "#5F6368", align: "center", margin: "xs", wrap: true },
          { type: "text", text: "🟢 ศูนย์ประสานงานคดีออนไลน์ตอบเฉพาะห้องใน ONLINE_COURT_GROUP_IDS และอยู่ในวันเวลาให้บริการ", size: "xxs", color: "#5F6368", align: "center", margin: "xs", wrap: true }
        ]
      }
    }
  };
}

function _buildHelpTextCurrent_(userRole, userIsAdmin) {
  const isVip = userRole === "VIP" || userIsAdmin;
  let msg = "📖 คู่มือคำสั่งบอท v10.5\n";
  msg += "━━━━━━━━━━━━━━\n\n";
  msg += "🔍 ค้นหา\n";
  msg += "• ค้นหา / ค้นหา ฐาน\n";
  msg += "• ค้นหา [คำค้น]\n";
  msg += "• ค้นหา [ชื่อฐาน] [คำค้น]\n";
  msg += "• บอท ค้นหา [คำค้น] (ใช้ในกลุ่มทั่วไป)\n";
  msg += "• /ไอดีกลุ่ม\n\n";
  msg += "📍 งานหมาย / พิกัด\n";
  msg += "• ส่งรูปภาพ\n";
  msg += "• ส่ง Location จาก LINE\n";
  msg += "• 138 ม 10 ท่าแค\n";
  msg += "• พิกัด 14.80550,100.61440\n";
  msg += "• VJMG+FJ4 ตำบล ท่าแค\n";
  msg += "• Google Maps link\n\n";
  if (isVip) {
    msg += "⚖️ บัญชีนัดความ (VIP+)\n";
    msg += "• บัญชีนัดความ วันนี้\n";
    msg += "• บัญชีนัด พรุ่งนี้ / มะรืน / อีก 3 วัน\n";
    msg += "• บัญชีนัด 17/4/68\n";
    msg += "• บัญชีนัดความ วันนี้ หน้า 2\n\n";
  }
  msg += "💻 ศูนย์ประสานงานคดีออนไลน์\n";
  msg += "• เข้าออนไลน์ บ1\n";
  msg += "• เข้าไม่ได้\n";
  msg += "• คำสาบาน / การเข้าใช้งาน\n";
  msg += "• ติดต่อเจ้าหน้าที่\n\n";
  if (userIsAdmin) {
    msg += "📚 Admin\n";
    msg += "• /สอน Q | A\n";
    msg += "• /แก้ไข ID | A\n";
    msg += "• /ลบ ID\n";
    msg += "• /รายการ\n";
    msg += "• /สถิติ หรือ /จำนวนรวม\n";
    msg += "• /แจ้งเตือน ข้อความ\n";
    msg += "• /บอท เปิด / /บอท ปิด\n\n";
  }
  msg += "━━━━━━━━━━━━━━\n";
  msg += "💡 กลุ่มทั่วไปใช้ 'บอท ค้นหา ...'\n";
  msg += "📍 กลุ่มส่งหมายรับรูป/พิกัด/เลขที่อัตโนมัติเมื่ออยู่ใน MISSION_GROUP_IDS\n";
  msg += "💻 ศูนย์ประสานงานคดีตอบเฉพาะห้องที่ตั้ง ONLINE_COURT_GROUP_IDS และอยู่ในเวลาที่กำหนด";
  return msg;
}

function _helpInfoTile_(icon, title, lines, color) {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderColor: color,
    borderWidth: "2px",
    cornerRadius: "8px",
    paddingAll: "8px",
    spacing: "xs",
    contents: [
      { type: "text", text: icon, size: "lg", align: "center" },
      { type: "text", text: title, size: "xs", weight: "bold", color: color, align: "center", wrap: true }
    ].concat(lines.map(function(line) {
      return { type: "text", text: line, size: "xxs", color: "#4B5563", align: "center", wrap: true };
    }))
  };
}

function _helpInfoRow_(left, right) {
  const contents = right ? [left, right] : [left];
  return { type: "box", layout: "horizontal", spacing: "6px", contents: contents };
}

function _helpQuickButton_(label, text, color) {
  return {
    type: "button",
    style: "secondary",
    height: "sm",
    color: color || "#E5E7EB",
    action: { type: "message", label: label, text: text }
  };
}

function _buildHelpFlexInfographicCard_(userRole, userIsAdmin) {
  const isVip = userRole === "VIP" || userIsAdmin;
  const roleLabel = userIsAdmin ? "👑 Admin" : isVip ? "⭐ VIP" : "👤 User";

  const tiles = [
    _helpInfoTile_("🔍", "ค้นหา", ["ค้นหา [คำค้น]", "กลุ่ม: บอท ค้นหา ..."], "#1976D2"),
    _helpInfoTile_("📍", "งานหมาย", ["รูป + Location", "เลขที่/พิกัด/Maps"], "#059669"),
    _helpInfoTile_("⚖️", "บัญชีนัด", ["วันนี้ / พรุ่งนี้", "วันที่ / หน้า 2"], "#7C3AED"),
    _helpInfoTile_("💻", "ศูนย์คดีออนไลน์", ["ศูนย์ประสานงานคดี", "ติดต่อเจ้าหน้าที่"], "#0891B2")
  ];

  if (userIsAdmin) {
    tiles.push(_helpInfoTile_("🛠️", "Admin", ["/สอน /รายการ", "/สถิติ /บอท เปิด"], "#F57C00"));
  } else if (!isVip) {
    tiles.push(_helpInfoTile_("🔐", "VIP", ["พิมพ์รหัสในแชทส่วนตัว", "ขอรหัสจาก Admin"], "#C2185B"));
  }

  const tileRows = [
    _helpInfoRow_(tiles[0], tiles[1]),
    _helpInfoRow_(tiles[2], tiles[3])
  ];
  if (tiles[4]) tileRows.push(_helpInfoRow_(tiles[4], null));

  const buttons = [
    _helpQuickButton_("ค้นหา ฐาน", "ค้นหา ฐาน", "#DBEAFE"),
    _helpQuickButton_("ไอดีกลุ่ม", "/ไอดีกลุ่ม", "#DCFCE7")
  ];
  if (isVip) buttons.push(_helpQuickButton_("บัญชีนัดวันนี้", "บัญชีนัดความ วันนี้", "#EDE9FE"));
  if (userIsAdmin) buttons.push(_helpQuickButton_("สถิติ", "/สถิติ", "#FFEDD5"));

  return {
    type: "flex",
    altText: "📖 คู่มือคำสั่งบอทแบบย่อ v10.5",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#1A237E",
        paddingAll: "12px",
        spacing: "xs",
        contents: [
          { type: "text", text: "📖 คู่มือคำสั่งบอท", color: "#FFFFFF", weight: "bold", size: "lg" },
          { type: "text", text: "สรุปสั้นแบบใช้งานทันที • Bot v10.5 • " + roleLabel, color: "#C5CAE9", size: "xs", wrap: true }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#F8FAFC",
        paddingAll: "10px",
        spacing: "6px",
        contents: tileRows.concat([
          { type: "separator", margin: "sm", color: "#E5E7EB" },
          { type: "text", text: "คำสั่งหลัก", size: "xs", color: "#64748B", weight: "bold", align: "center", margin: "sm" },
          {
            type: "box",
            layout: "vertical",
            spacing: "xs",
            contents: [
              { type: "text", text: "ค้นหา 89/9  |  บอท ค้นหา 89/9", size: "xxs", color: "#334155", align: "center", wrap: true },
              { type: "text", text: "บัญชีนัดความ วันนี้  |  เข้าออนไลน์ บ1", size: "xxs", color: "#334155", align: "center", wrap: true },
              { type: "text", text: "ส่ง Location จาก LINE  |  /ไอดีกลุ่ม", size: "xxs", color: "#334155", align: "center", wrap: true }
            ]
          }
        ])
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "8px",
        spacing: "xs",
        contents: [
          { type: "box", layout: "horizontal", spacing: "xs", contents: buttons.slice(0, 2) }
        ].concat(buttons.length > 2 ? [
          { type: "box", layout: "horizontal", spacing: "xs", contents: buttons.slice(2) }
        ] : []).concat([
          { type: "text", text: "ดูคู่มือเต็มได้ใน Dashboard > คู่มือใช้งาน", size: "xxs", color: "#6B7280", align: "center", wrap: true }
        ])
      }
    }
  };
}

function _buildHelpTextCompact_(userRole, userIsAdmin) {
  const isVip = userRole === "VIP" || userIsAdmin;
  let msg = "📖 คู่มือคำสั่งบอท v10.5\n";
  msg += "🔍 ค้นหา: ค้นหา [คำค้น] / บอท ค้นหา [คำค้น]\n";
  msg += "📍 งานหมาย: ส่งรูป, ส่ง Location, พิกัด, Google Maps link\n";
  if (isVip) msg += "⚖️ บัญชีนัด: บัญชีนัดความ วันนี้ / พรุ่งนี้ / หน้า 2\n";
  msg += "💻 คดีออนไลน์: เข้าออนไลน์ บ1 / เข้าไม่ได้ / ติดต่อเจ้าหน้าที่\n";
  msg += "🆔 ดู ID: /ไอดีกลุ่ม";
  if (userIsAdmin) msg += "\n🛠️ Admin: /สอน, /รายการ, /สถิติ, /บอท เปิด, /บอท ปิด";
  return msg;
}

function sendHelpCard(replyToken, userRole, userId) {
  const userIsAdmin = isAdmin(userId);
  const flex = _buildHelpFlexInfographicCard_(userRole, userIsAdmin);

  try {
    const res = _linePost("https://api.line.me/v2/bot/message/reply", {
      replyToken: replyToken,
      messages: [{
        type: "flex",
        altText: flex.altText,
        contents: flex.contents
      }]
    });
    if (res.responseCode !== 200) {
      Logger.log("⚠️ Help flex failed: HTTP " + res.responseCode);
      // Fallback to text
      safeSendReply(replyToken, _buildHelpTextCompact_(userRole, userIsAdmin));
    }
  } catch (e) {
    Logger.log("❌ sendHelpCard error: " + e.message);
    safeSendReply(replyToken, _buildHelpTextCompact_(userRole, userIsAdmin));
  }
}

/**
 * Fallback: text version
 */
function _buildHelpText(userRole, userIsAdmin) {
  const isVip = userRole === "VIP" || userIsAdmin;
  let msg = "📖 คู่มือคำสั่งบอท\n";
  msg += "━━━━━━━━━━━━━━\n\n";

  msg += "🔍 ค้นหา\n";
  msg += "• /ค้นหา [คำค้น]\n";
  msg += "• /ไอดีกลุ่ม\n\n";

  msg += "📍 งานหมาย / พิกัด\n";
  msg += "• ส่งรูปภาพ\n";
  msg += "• ส่ง Location จาก LINE\n";
  msg += "• 138 ม 10 ท่าแค\n";
  msg += "• พิกัด 14.80550,100.61440\n";
  msg += "• VJMG+FJ4 ตำบล ท่าแค\n\n";

  if (isVip) {
    msg += "⚖️ บัญชีนัดความ (VIP+)\n";
    msg += "• บัญชีนัดความ วันนี้\n";
    msg += "• บัญชีนัดความ [วันที่]\n\n";
  }

  if (userIsAdmin) {
    msg += "📚 Admin\n";
    msg += "• /สอน Q | A\n";
    msg += "• /แก้ไข ID | A\n";
    msg += "• /ลบ ID\n";
    msg += "• /รายการ\n";
    msg += "• /สถิติ\n";
    msg += "• /แจ้งเตือน ข้อความ\n";
    msg += "• /บอท เปิด/ปิด\n\n";
  }

  msg += "━━━━━━━━━━━━━━\n";
  msg += "💡 ค้นหาในกลุ่ม: ขึ้นต้นด้วย 'บอท' หรือ '/'\n";
  msg += "📍 กลุ่มส่งหมาย: รูป/พิกัด/เลขที่รับอัตโนมัติ";

  return msg;
}

/**
 * Test Help Card
 */
function testHelpCard() {
  Logger.log("=== Test Help Card ===");
  const cardUser = _buildHelpFlexCard("User", false);
  Logger.log("User card sections: " + cardUser.contents.body.contents.length);
  const cardVip = _buildHelpFlexCard("VIP", false);
  Logger.log("VIP card sections: " + cardVip.contents.body.contents.length);
  const cardAdmin = _buildHelpFlexCard("Admin", true);
  Logger.log("Admin card sections: " + cardAdmin.contents.body.contents.length);
  return { ok: true };
}
/**
 * 🧪 ทดสอบ getLineQuotaInfo (แสดงผลใน Logs)
 */
function testQuotaInfo() {
  Logger.log("=== 🧪 Test LINE Quota ===");
  const info = getLineQuotaInfo();
  Logger.log("📦 ผลลัพธ์ดิบ:");
  Logger.log(JSON.stringify(info, null, 2));
  
  if (!info.success) {
    Logger.log("❌ ERROR: " + info.error);
    return info;
  }

  Logger.log("");
  Logger.log("══════════════════════════════");
  Logger.log("📊 LINE API Quota สรุป");
  Logger.log("══════════════════════════════");
  Logger.log("📦 Plan: " + info.plan);
  Logger.log("📊 ทั้งหมด: " + info.total + " ข้อความ/เดือน");
  Logger.log("✉️ ใช้ไป: " + info.used + " ข้อความ");
  Logger.log("✅ เหลือ: " + info.remaining + " ข้อความ");
  Logger.log("📈 ใช้ไป: " + info.percent + "%");
  Logger.log("🚦 สถานะ: " + info.status);
  Logger.log("📅 รีเซ็ต: " + info.resetDate);
  Logger.log("⏰ อีก: " + info.daysLeft + " วัน");
  Logger.log("══════════════════════════════");

  return info;
}

// ════════════════════════════════════════════════════════════
// 🧪 Phase 2: Smoke Test System v10.5
// ────────────────────────────────────────────────────────────
// ตรวจระบบทั้งหมดในจุดเดียว — กดครั้งเดียวรู้ทุกอย่าง
// ════════════════════════════════════════════════════════════

const SMOKE_TEST_VERSION = "v10.5";

/**
 * 🚀 Main: รัน Smoke Test ทั้ง 8 ด้าน
 */
function runFullSmokeTest() {
  const startTime = new Date().getTime();
  Logger.log("🧪 ═══ SMOKE TEST START ═══");

  const tests = [
    { id: "spreadsheet", name: "📊 Spreadsheet",  fn: _smokeTest1_Spreadsheet  },
    { id: "config",      name: "⚙️ Config",        fn: _smokeTest2_Config       },
    { id: "lineapi",     name: "📱 LINE API",      fn: _smokeTest3_LineAPI      },
    { id: "admin",       name: "👑 Admin Config",  fn: _smokeTest4_AdminConfig  },
    { id: "whitelist",   name: "🛡️ Whitelist",     fn: _smokeTest5_Whitelist    },
    { id: "court",       name: "⚖️ Court Sheet",   fn: _smokeTest6_CourtSheet   },
    { id: "pikad",       name: "📍 Pikad Trigger", fn: _smokeTest7_PikadTrigger },
    { id: "quota",       name: "📊 LINE Quota",    fn: _smokeTest8_LineQuota    }
  ];

  const results = [];
  let passed = 0, failed = 0, warning = 0;

  tests.forEach(function(test) {
    const t0 = new Date().getTime();
    let result;
    try {
      result = test.fn();
    } catch (e) {
      result = { ok: false, msg: "Exception: " + e.message, fixable: false };
    }
    const elapsed = new Date().getTime() - t0;

    const item = {
      id: test.id,
      name: test.name,
      ok: result.ok || false,
      level: result.level || (result.ok ? "ok" : "error"),
      msg: result.msg || "",
      detail: result.detail || "",
      fixable: result.fixable || false,
      fixId: result.fixId || null,
      elapsed: elapsed
    };
    results.push(item);

    if (item.ok) passed++;
    else if (item.level === "warning") warning++;
    else failed++;

    Logger.log((item.ok ? "✅" : "❌") + " " + item.name + " (" + elapsed + " ms): " + item.msg);
  });

  const totalElapsed = new Date().getTime() - startTime;
  const total = results.length;
  const score = Math.round((passed / total) * 100);

  let status = "perfect", statusMsg = "🎉 ระบบสมบูรณ์", badge = "🟢";
  if (failed > 0) { status = "error"; statusMsg = "⚠️ มีปัญหา " + failed + " รายการ"; badge = "🔴"; }
  else if (warning > 0) { status = "warning"; statusMsg = "🟡 มีคำเตือน " + warning + " รายการ"; badge = "🟡"; }

  return {
    success: true,
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss"),
    elapsed: totalElapsed,
    total: total,
    passed: passed,
    failed: failed,
    warning: warning,
    score: score,
    status: status,
    statusMsg: statusMsg,
    badge: badge,
    fixableCount: results.filter(function(r){ return !r.ok && r.fixable; }).length,
    items: results
  };
}

// ════════════════════════════════════════════════════════════
// Test 1: Spreadsheet
// ════════════════════════════════════════════════════════════
function _smokeTest1_Spreadsheet() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    return {
      ok: true,
      msg: "เชื่อมสำเร็จ",
      detail: ss.getName() + " (" + ss.getSheets().length + " sheets)"
    };
  } catch (e) {
    return {
      ok: false, level: "error",
      msg: "เชื่อม Spreadsheet ไม่ได้",
      detail: e.message,
      fixable: false
    };
  }
}

// ════════════════════════════════════════════════════════════
// Test 2: Config
// ════════════════════════════════════════════════════════════
function _smokeTest2_Config() {
  const requiredKeys = ["BOT_STATUS", "MSG_FALLBACK", "ADMIN_LINE_IDS", "VIP_SECRET_CODE", "NOTIFY_STATUS"];
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.CONFIG);
    if (!sheet) {
      return {
        ok: false, level: "error",
        msg: "ไม่พบ Sheet ตั้งค่า",
        detail: "ต้องสร้างใหม่",
        fixable: true, fixId: "fix_config_sheet_missing"
      };
    }
    const data = sheet.getDataRange().getValues();
    const existing = data.slice(1).map(function(r){ return r[0]; });
    const missing = requiredKeys.filter(function(k){ return existing.indexOf(k) < 0; });
    if (missing.length > 0) {
      return {
        ok: false, level: "warning",
        msg: "ขาด " + missing.length + " keys",
        detail: missing.join(", "),
        fixable: true, fixId: "fix_config_keys_missing"
      };
    }
    return { ok: true, msg: "Config ครบ", detail: existing.length + " keys" };
  } catch (e) {
    return { ok: false, level: "error", msg: "อ่าน Config ไม่ได้", detail: e.message, fixable: false };
  }
}

// ════════════════════════════════════════════════════════════
// Test 3: LINE API
// ════════════════════════════════════════════════════════════
function _smokeTest3_LineAPI() {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get("smoke_line_api_info_v1");
    if (cached) return JSON.parse(cached);

    const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/info", {
      method: "get",
      headers: getLineAuthHeaders_(),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 200) {
      const info = JSON.parse(res.getContentText());
      const okResult = { ok: true, msg: "Bot online", detail: info.displayName || "OK" };
      cache.put("smoke_line_api_info_v1", JSON.stringify(okResult), 600);
      return okResult;
    }
    return {
      ok: false, level: "error",
      msg: "LINE API HTTP " + code,
      detail: code === 401 ? "Token หมดอายุ" : "ตรวจ Token",
      fixable: false
    };
  } catch (e) {
    return { ok: false, level: "error", msg: "เชื่อม LINE API ไม่ได้", detail: e.message, fixable: false };
  }
}

// ════════════════════════════════════════════════════════════
// Test 4: Admin Config
// ════════════════════════════════════════════════════════════
function _smokeTest4_AdminConfig() {
  try {
    const adminIds = getAdminIds();
    if (!adminIds || adminIds.length === 0) {
      return {
        ok: false, level: "error",
        msg: "ไม่มี Admin",
        detail: "กรุณาตั้ง ADMIN_LINE_IDS ใน Sheet ตั้งค่า",
        fixable: false
      };
    }
    return {
      ok: true,
      msg: "มี Admin " + adminIds.length + " คน",
      detail: adminIds.length === 1 ? "1 admin configured" : adminIds.length + " IDs"
    };
  } catch (e) {
    return { ok: false, level: "error", msg: e.message, fixable: false };
  }
}

// ════════════════════════════════════════════════════════════
// Test 5: Whitelist
// ════════════════════════════════════════════════════════════
function _smokeTest5_Whitelist() {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.GROUP_WHITELIST);
    if (!sheet) {
      return {
        ok: false, level: "warning",
        msg: "ไม่พบ Sheet GROUP_WHITELIST",
        detail: "ใช้ default whitelist (ไม่กระทบ)",
        fixable: true, fixId: "fix_whitelist_missing"
      };
    }
    const lr = sheet.getLastRow();
    if (lr < 2) {
      return {
        ok: false, level: "warning",
        msg: "Whitelist ว่าง",
        detail: "ใช้ default",
        fixable: true, fixId: "fix_whitelist_empty"
      };
    }
    const wl = _getGroupWhitelist();
    return {
      ok: true,
      msg: wl.length + " คำสั่ง active",
      detail: "Cache TTL " + _WHITELIST_CACHE_TTL + "s"
    };
  } catch (e) {
    return { ok: false, level: "error", msg: e.message, fixable: false };
  }
}

// ════════════════════════════════════════════════════════════
// Test 6: Court Sheet
// ════════════════════════════════════════════════════════════
function _smokeTest6_CourtSheet() {
  try {
    const status = getConfig("COURT_STATUS");
    if (status !== "ON") {
      return { ok: true, msg: "ระบบปิด", detail: "ไม่ต้องตรวจ" };
    }
    const sheetId = getConfig("COURT_SHEET_ID");
    if (!sheetId) {
      return {
        ok: false, level: "warning",
        msg: "ไม่ได้ตั้ง COURT_SHEET_ID",
        detail: "ระบบเปิดแต่ไม่มี Sheet",
        fixable: false
      };
    }
    const sheetName = getConfig("COURT_SHEET_NAME") || "Database";
    return {
      ok: true,
      msg: "ตั้งค่าแล้ว",
      detail: sheetName + " — ตรวจสิทธิ์แยกด้วย checkCourtSheetAccess"
    };
  } catch (e) {
    return { ok: false, level: "warning", msg: "Court Sheet error", detail: e.message, fixable: false };
  }
}

// ════════════════════════════════════════════════════════════
// Test 7: PikadSession Trigger
// ════════════════════════════════════════════════════════════
function _smokeTest7_PikadTrigger() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const found = triggers.filter(function(t){
      const n = t.getHandlerFunction();
      return n === "closePikadExpiredSessions" || 
             n === "_pikadCleanup" || 
             n === "pikadSessionCleanup";
    });
    if (found.length === 0) {
      return {
        ok: false, level: "warning",
        msg: "ไม่มี Pikad Trigger",
        detail: "Cleanup ไม่ทำงานอัตโนมัติ",
        fixable: true, fixId: "fix_pikad_trigger_missing"
      };
    }
    return { 
      ok: true, 
      msg: "Trigger ทำงาน", 
      detail: found[0].getHandlerFunction() + " (" + found.length + " trigger)" 
    };
  } catch (e) {
    return { ok: false, level: "error", msg: e.message, fixable: false };
  }
}

// ════════════════════════════════════════════════════════════
// Test 8: LINE Quota
// ════════════════════════════════════════════════════════════
function _smokeTest8_LineQuota() {
  try {
    const info = getLineQuotaInfo();
    if (!info || !info.success) {
      return {
        ok: false, level: "warning",
        msg: "ดึง Quota ไม่ได้",
        detail: (info && info.error) || "Unknown",
        fixable: false
      };
    }
    if (info.status === "exceeded") {
      return {
        ok: false, level: "error",
        msg: "Quota หมด!",
        detail: info.used + "/" + info.total,
        fixable: false
      };
    }
    if (info.status === "warning") {
      return {
        ok: false, level: "warning",
        msg: "เหลือน้อย " + info.percent + "%",
        detail: info.remaining + "/" + info.total,
        fixable: false
      };
    }
    return {
      ok: true,
      msg: info.remaining + "/" + info.total,
      detail: info.plan + " • อีก " + info.daysLeft + " วัน"
    };
  } catch (e) {
    return { ok: false, level: "warning", msg: e.message, fixable: false };
  }
}

// ════════════════════════════════════════════════════════════
// 🧪 Test Function (รันใน Apps Script editor)
// ════════════════════════════════════════════════════════════
function testSmokeTestBackend() {
  Logger.log("🧪 === Test Smoke Test Backend ===");
  const result = runFullSmokeTest();
  Logger.log("");
  Logger.log("══════════════════════════════════");
  Logger.log("📊 SMOKE TEST RESULT");
  Logger.log("══════════════════════════════════");
  Logger.log("Status: " + result.statusMsg);
  Logger.log("Score: " + result.score + "% (" + result.passed + "/" + result.total + ")");
  Logger.log("Failed: " + result.failed + " | Warning: " + result.warning + " | Fixable: " + result.fixableCount);
  Logger.log("Time: " + result.elapsed + " ms");
  Logger.log("══════════════════════════════════");
  result.items.forEach(function(item, idx) {
    const icon = item.ok ? "✅" : (item.level === "warning" ? "🟡" : "❌");
    Logger.log("");
    Logger.log((idx + 1) + ". " + icon + " " + item.name);
    Logger.log("   " + item.msg + " | " + item.detail);
    if (item.fixable) Logger.log("   🔧 ซ่อมได้: " + item.fixId);
  });
  return result;
}

// ════════════════════════════════════════════════════════════
// 🔧 Phase 2.5: Auto-Fix System v10.5
// ────────────────────────────────────────────────────────────
// ซ่อมปัญหาที่ Smoke Test เจอแบบอัตโนมัติ — กดปุ่มเดียวซ่อม
// ════════════════════════════════════════════════════════════

/**
 * 🔧 Main: ซ่อมตาม fixId ที่ Smoke Test คืนมา
 */
function autoFixIssue(fixId) {
  Logger.log("🔧 Auto-Fix: " + fixId);
  
  const fixers = {
    "fix_config_sheet_missing":    _autoFixConfigSheetMissing,
    "fix_config_keys_missing":     _autoFixConfigKeysMissing,
    "fix_whitelist_missing":       _autoFixWhitelistMissing,
    "fix_whitelist_empty":         _autoFixWhitelistEmpty,
    "fix_pikad_trigger_missing":   _autoFixPikadTriggerMissing,
    "fix_cache_stale":             _autoFixCacheStale
  };

  const fixer = fixers[fixId];
  if (!fixer) {
    return { success: false, msg: "ไม่รู้จัก fixId: " + fixId };
  }

  try {
    const result = fixer();
    Logger.log("✅ Fix result: " + JSON.stringify(result));
    return result;
  } catch (e) {
    Logger.log("❌ Fix error: " + e.message);
    return { success: false, msg: "ซ่อมล้มเหลว: " + e.message };
  }
}

/**
 * Fix 1: สร้าง Sheet ตั้งค่า ถ้าหาย
 */
function _autoFixConfigSheetMissing() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEETS.CONFIG);
    if (sheet) {
      return { success: true, msg: "Sheet ตั้งค่ามีอยู่แล้ว", action: "no_action" };
    }
    sheet = ss.insertSheet(SHEETS.CONFIG);
    sheet.appendRow(["คีย์", "ค่า", "คำอธิบาย"]);
    sheet.getRange(1, 1, 1, 3)
      .setFontWeight("bold")
      .setBackground("#1e3a8a")
      .setFontColor("#fff");
    initializeConfig(ss);
    return {
      success: true,
      msg: "✅ สร้าง Sheet ตั้งค่า + Config defaults สำเร็จ",
      action: "created"
    };
  } catch (e) {
    return { success: false, msg: e.message };
  }
}

/**
 * Fix 2: เพิ่ม Config keys ที่ขาด
 */
function _autoFixConfigKeysMissing() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    initializeConfig(ss);
    return {
      success: true,
      msg: "✅ เพิ่ม Config keys ที่ขาดสำเร็จ",
      action: "added"
    };
  } catch (e) {
    return { success: false, msg: e.message };
  }
}

/**
 * Fix 3: สร้าง Sheet GROUP_WHITELIST
 */
function _autoFixWhitelistMissing() {
  try {
    const result = setupGroupWhitelistSheet();
    if (result && result.ok) {
      _clearWhitelistCache();
      return {
        success: true,
        msg: "✅ สร้าง GROUP_WHITELIST + ใส่ค่า default 11 คำสั่ง",
        action: "created",
        count: result.count
      };
    }
    return { success: false, msg: "setupGroupWhitelistSheet ไม่ทำงาน" };
  } catch (e) {
    return { success: false, msg: e.message };
  }
}

/**
 * Fix 4: เติม Whitelist ถ้าว่าง
 */
function _autoFixWhitelistEmpty() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.GROUP_WHITELIST);
    if (!sheet) return _autoFixWhitelistMissing();
    
    const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    const defaults = [
      ["/ค้นหา",     "ON", "USER",  "ค้นหาในฐานข้อมูล", now],
      ["/สอน",       "ON", "ADMIN", "เพิ่มข้อมูลให้บอท", now],
      ["/แก้ไข",     "ON", "ADMIN", "แก้ไขคำตอบ", now],
      ["/ลบ",        "ON", "ADMIN", "ลบข้อมูล", now],
      ["/รายการ",    "ON", "ADMIN", "ดู Q&A 10 ล่าสุด", now],
      ["/แจ้งเตือน", "ON", "ADMIN", "Broadcast", now],
      ["/สถิติ",     "ON", "ADMIN", "ดูสถิติ", now],
      ["/จำนวนรวม",  "ON", "ADMIN", "= /สถิติ", now],
      ["/บอท",       "ON", "ADMIN", "เปิด/ปิดบอท", now],
      ["/ช่วยเหลือ", "ON", "USER",  "แสดงคำสั่ง", now],
      ["/ไอดีกลุ่ม", "ON", "USER",  "ดูไอดีกลุ่ม", now]
    ];
    sheet.getRange(2, 1, defaults.length, 5).setValues(defaults);
    _clearWhitelistCache();
    return {
      success: true,
      msg: "✅ เติม Whitelist defaults 11 คำสั่ง",
      action: "filled",
      count: defaults.length
    };
  } catch (e) {
    return { success: false, msg: e.message };
  }
}

/**
 * Fix 5: สร้าง Pikad Trigger
 */
function _autoFixPikadTriggerMissing() {
  try {
    if (typeof setupPikadSessionTrigger === "function") {
      const result = setupPikadSessionTrigger();
      return {
        success: true,
        msg: "✅ สร้าง Pikad Trigger สำเร็จ",
        action: "created",
        detail: JSON.stringify(result)
      };
    }
    return {
      success: false,
      msg: "ไม่พบฟังก์ชัน setupPikadSessionTrigger (ตรวจ PikadSession.gs)"
    };
  } catch (e) {
    return { success: false, msg: e.message };
  }
}

/**
 * Fix 6: ล้าง Cache
 */
function _autoFixCacheStale() {
  try {
    if (typeof _clearWhitelistCache === "function") _clearWhitelistCache();
    try {
      CacheService.getScriptCache().removeAll(["_groupWhitelist_v1"]);
    } catch(e) {}
    return {
      success: true,
      msg: "✅ ล้าง cache ทั้งหมดสำเร็จ",
      action: "cleared"
    };
  } catch (e) {
    return { success: false, msg: e.message };
  }
}

/**
 * 🧪 Test Auto-Fix Functions
 */
function testAutoFix() {
  Logger.log("🧪 === Test Auto-Fix Functions ===");
  
  const fixIds = [
    "fix_cache_stale",
    "fix_whitelist_missing",
    "fix_pikad_trigger_missing"
  ];
  
  fixIds.forEach(function(id) {
    Logger.log("");
    Logger.log("Testing: " + id);
    const r = autoFixIssue(id);
    Logger.log("  Result: " + JSON.stringify(r));
  });
  
  Logger.log("");
  Logger.log("=== End Test ===");
  return { success: true, msg: "Test เสร็จ — ดู Logs" };
}

/**
 * 🔍 ดูชื่อ Trigger ทั้งหมด
 */
function listAllTriggers() {
  Logger.log("🔍 === All Triggers ===");
  const triggers = ScriptApp.getProjectTriggers();
  
  if (triggers.length === 0) {
    Logger.log("📭 ไม่มี Trigger เลย");
    return;
  }
  
  Logger.log("📊 รวม " + triggers.length + " triggers:");
  Logger.log("");
  
  triggers.forEach(function(t, idx) {
    const fn = t.getHandlerFunction();
    const type = t.getEventType();
    Logger.log((idx + 1) + ". " + fn);
    Logger.log("   Type: " + type);
    Logger.log("");
  });
}

// ════════════════════════════════════════════════════════════
// 🎛️ Phase 3: Master Switch System v10.5
// ────────────────────────────────────────────────────────────
// จัดการเปิด/ปิดทุกฟีเจอร์ของระบบในที่เดียว
// ════════════════════════════════════════════════════════════

/**
 * 📋 รายการ Switch ทั้งหมด — จัดกลุ่มตามหมวด
 */
function getMasterSwitches() {
  const switches = [
    // ────── 🤖 ระบบหลัก ──────
    {
      group: "🤖 ระบบหลัก",
      groupColor: "#3b82f6",
      items: [
        {
          key: "BOT_STATUS",
          label: "🤖 บอท",
          desc: "เปิด/ปิดบอททั้งหมด",
          critical: true
        },
        {
          key: "NOTIFY_STATUS",
          label: "🔔 ระบบแจ้งเตือน",
          desc: "เปิด/ปิด Broadcast + แจ้งเตือน"
        }
      ]
    },
    
    // ────── 🔍 ระบบค้นหา ──────
    {
      group: "🔍 ระบบค้นหา",
      groupColor: "#8b5cf6",
      items: [
        {
          key: "SEARCH_STATUS",
          label: "🔍 ค้นหาฐานข้อมูล",
          desc: "เปิด/ปิด /ค้นหา + Smart Search"
        },
        {
          key: "SEARCH_USE_FLEX",
          label: "🎴 Flex Message ผลค้นหา",
          desc: "ใช้ Flex Card หรือ Text"
        }
      ]
    },
    
    // ────── ⚖️ บัญชีนัดความ ──────
    {
      group: "⚖️ บัญชีนัดความ",
      groupColor: "#9333ea",
      items: [
        {
          key: "COURT_STATUS",
          label: "⚖️ บัญชีนัดความ",
          desc: "เปิด/ปิดระบบค้นหาคดี"
        },
        {
          key: "COURT_USE_FLEX",
          label: "🎴 Flex Card คดี",
          desc: "ใช้ Flex หรือ Text"
        }
      ]
    },
    
    // ────── 📍 พิกัด + รูป ──────
    {
      group: "📍 พิกัด + รูปภาพ",
      groupColor: "#10b981",
      items: [
        {
          key: "LOC_SAVE_MSG_STATUS",
          label: "📍 ตอบกลับเมื่อรับพิกัด",
          desc: "ส่งข้อความยืนยันเมื่อบันทึกพิกัด/หมาย"
        },
        {
          key: "PHOTO_SAVE_STATUS",
          label: "📸 ระบบรับรูปหลักฐาน",
          desc: "เปิด/ปิดการรับรูป"
        }
      ]
    },
    
    // ────── 📺 TV Notify ──────
    {
      group: "📺 TV Notify (สถานะหน้าจอ)",
      groupColor: "#06b6d4",
      items: [
        {
          key: "TV_NOTIFY_STATUS",
          label: "📺 แจ้งเตือนสถานะ TV",
          desc: "ตรวจ + แจ้งเมื่อ TV online/offline"
        },
        {
          key: "TV_NOTIFY_ON_ONLINE",
          label: "🟢 แจ้งเมื่อ TV ออนไลน์",
          desc: "ปิดถ้าไม่อยากรู้ตอน online"
        },
        {
          key: "TV_NOTIFY_ON_OFFLINE",
          label: "🔴 แจ้งเมื่อ TV ออฟไลน์",
          desc: "แจ้งเมื่อ TV หลุด"
        }
      ]
    },
    
    // ────── 📊 รายงาน ──────
    {
      group: "📊 รายงานอัตโนมัติ",
      groupColor: "#f59e0b",
      items: [
        {
          key: "SUMMARY_STATUS",
          label: "📊 สรุปสถิติอัตโนมัติ",
          desc: "ส่งสรุปทุกวัน/สัปดาห์/เดือน"
        },
        {
          key: "HEALTH_STATUS",
          label: "🩺 รายงานสุขภาพระบบ",
          desc: "Health check report"
        }
      ]
    }
  ];

  // ดึงค่าปัจจุบันจาก Config
  const result = switches.map(function(group) {
    return {
      group: group.group,
      groupColor: group.groupColor,
      items: group.items.map(function(item) {
        const value = getConfig(item.key) || "OFF";
        return {
          key: item.key,
          label: item.label,
          desc: item.desc,
          critical: item.critical || false,
          value: value,
          on: value === "ON"
        };
      })
    };
  });

  // นับสรุป
  let totalOn = 0, totalOff = 0;
  result.forEach(function(g) {
    g.items.forEach(function(i) {
      if (i.on) totalOn++;
      else totalOff++;
    });
  });

  return {
    success: true,
    groups: result,
    summary: {
      total: totalOn + totalOff,
      on: totalOn,
      off: totalOff
    },
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss")
  };
}

/**
 * 🔄 Toggle Switch (เปิด/ปิด)
 */
function toggleMasterSwitch(key) {
  try {
    const current = getConfig(key);
    const newValue = current === "ON" ? "OFF" : "ON";
    setConfig(key, newValue);
    
    // ล้าง cache ที่เกี่ยวข้อง
    try {
      if (key === "BOT_STATUS" || key.startsWith("SEARCH_")) {
        if (typeof _clearWhitelistCache === "function") _clearWhitelistCache();
      }
    } catch(e) {}
    
    Logger.log("🎛️ Toggled " + key + ": " + current + " → " + newValue);
    
    return {
      success: true,
      key: key,
      oldValue: current,
      newValue: newValue,
      msg: "✅ " + key + " = " + newValue
    };
  } catch (e) {
    return {
      success: false,
      msg: "❌ " + e.message
    };
  }
}

/**
 * 🔴 Emergency: ปิดทุกอย่างพร้อมกัน
 */
function emergencyShutdownAll() {
  const keysToShutdown = [
    "BOT_STATUS",
    "NOTIFY_STATUS",
    "SEARCH_STATUS",
    "COURT_STATUS",
    "PHOTO_SAVE_STATUS",
    "TV_NOTIFY_STATUS",
    "SUMMARY_STATUS",
    "HEALTH_STATUS"
  ];
  
  try {
    let count = 0;
    keysToShutdown.forEach(function(key) {
      const current = getConfig(key);
      if (current === "ON") {
        setConfig(key, "OFF");
        count++;
      }
    });
    
    Logger.log("🚨 Emergency shutdown: ปิด " + count + " ระบบ");
    
    return {
      success: true,
      count: count,
      msg: "🚨 ปิดระบบฉุกเฉิน — ปิด " + count + " ฟีเจอร์"
    };
  } catch (e) {
    return { success: false, msg: e.message };
  }
}

/**
 * 🟢 Emergency: เปิดระบบหลัก
 */
function emergencyEnableCore() {
  const coreKeys = [
    "BOT_STATUS",
    "NOTIFY_STATUS",
    "SEARCH_STATUS",
    "COURT_STATUS"
  ];
  
  try {
    let count = 0;
    coreKeys.forEach(function(key) {
      const current = getConfig(key);
      if (current !== "ON") {
        setConfig(key, "ON");
        count++;
      }
    });
    
    Logger.log("🚀 Emergency enable: เปิด " + count + " ระบบหลัก");
    
    return {
      success: true,
      count: count,
      msg: "🚀 เปิดระบบหลัก — เปิด " + count + " ฟีเจอร์"
    };
  } catch (e) {
    return { success: false, msg: e.message };
  }
}

/**
 * 🧪 Test Master Switch
 */
function testMasterSwitch() {
  Logger.log("🧪 === Test Master Switch ===");
  const data = getMasterSwitches();
  
  Logger.log("");
  Logger.log("📊 สรุป: เปิด " + data.summary.on + " | ปิด " + data.summary.off);
  Logger.log("");
  
  data.groups.forEach(function(group) {
    Logger.log(group.group);
    group.items.forEach(function(item) {
      const icon = item.on ? "🟢" : "🔴";
      Logger.log("  " + icon + " " + item.label + " = " + item.value);
    });
    Logger.log("");
  });
  
  Logger.log("=== End Test ===");
  return data;
}

// ════════════════════════════════════════════════════════════
// 🔄 Sync Member Names + Trigger Manager v10.5
// ────────────────────────────────────────────────────────────
// ปุ่มในหน้าทะเบียน + ตั้งเวลา auto-sync
// ════════════════════════════════════════════════════════════

/**
 * 🔄 Main: Sync ชื่อจาก LINE Profile API
 */
function syncMemberNamesFromLine() {
  Logger.log("🔄 === Sync Names from LINE ===");
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.MEMBERS);
  
  if (!sheet) return { success: false, msg: "❌ ไม่พบ sheet สมาชิก" };
  
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { success: false, msg: "📭 ไม่มีสมาชิก" };
  
  const headers = data[0];
  let colName = -1, colLineId = -1;
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").trim().toLowerCase();
    if (h === "ชื่อ" || h === "name") colName = i;
    if (h === "line user id" || h === "lineuserid" || h === "userid") colLineId = i;
  }
  
  if (colName < 0 || colLineId < 0) {
    return { success: false, msg: "❌ ไม่พบคอลัมน์ ชื่อ หรือ Line User ID" };
  }
  
  let updated = 0, kept = 0, failed = 0;
  
  for (let i = 1; i < data.length; i++) {
    const userId = data[i][colLineId];
    const currentName = String(data[i][colName] || "").trim();
    
    if (!userId || !String(userId).startsWith("U")) { kept++; continue; }
    
    const isDefault = !currentName || currentName.match(/^User_\d+$/);
    if (!isDefault) { kept++; continue; }
    
    try {
      const res = UrlFetchApp.fetch(
        "https://api.line.me/v2/bot/profile/" + userId,
        {
          method: "get",
          headers: getLineAuthHeaders_(),
          muteHttpExceptions: true
        }
      );
      
      if (res.getResponseCode() === 200) {
        const profile = JSON.parse(res.getContentText());
        if (profile.displayName) {
          sheet.getRange(i + 1, colName + 1).setValue(profile.displayName);
          updated++;
          Logger.log("✅ " + userId.substring(0, 12) + "... → " + profile.displayName);
        } else { kept++; }
      } else {
        failed++;
      }
      Utilities.sleep(150);
    } catch(e) {
      failed++;
    }
  }
  
  // บันทึกเวลา sync ล่าสุด
  try {
    setConfig("MEMBER_SYNC_LAST", Utilities.formatDate(
      new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm:ss"
    ));
    setConfig("MEMBER_SYNC_LAST_RESULT", "อัพเดต " + updated + " | ข้าม " + kept + " | ผิดพลาด " + failed);
  } catch(e) {}
  
  return {
    success: true,
    total: data.length - 1,
    updated: updated,
    kept: kept,
    failed: failed,
    msg: "✅ อัพเดต " + updated + " | ข้าม " + kept + " | ผิดพลาด " + failed
  };
}

/**
 * 📊 ดูสถานะ Sync ปัจจุบัน
 */
function getMemberSyncStatus() {
  try {
    const lastSync = getConfig("MEMBER_SYNC_LAST") || "ยังไม่เคย sync";
    const lastResult = getConfig("MEMBER_SYNC_LAST_RESULT") || "-";
    const schedule = getConfig("MEMBER_SYNC_SCHEDULE") || "off";
    
    // นับสมาชิกที่ยังเป็น User_XX
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.MEMBERS);
    let pendingCount = 0, totalCount = 0;
    
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      let colName = -1;
      for (let i = 0; i < headers.length; i++) {
        const h = String(headers[i] || "").trim().toLowerCase();
        if (h === "ชื่อ" || h === "name") colName = i;
      }
      
      if (colName >= 0) {
        for (let i = 1; i < data.length; i++) {
          totalCount++;
          const name = String(data[i][colName] || "").trim();
          if (!name || name.match(/^User_\d+$/)) pendingCount++;
        }
      }
    }
    
    // ตรวจ trigger
    const triggers = ScriptApp.getProjectTriggers().filter(function(t) {
      return t.getHandlerFunction() === "syncMemberNamesFromLine";
    });
    const hasTrigger = triggers.length > 0;
    
    return {
      success: true,
      lastSync: lastSync,
      lastResult: lastResult,
      schedule: schedule,
      hasTrigger: hasTrigger,
      pendingCount: pendingCount,
      totalCount: totalCount
    };
  } catch (e) {
    return { success: false, msg: e.message };
  }
}

/**
 * ⏰ ตั้งเวลา Auto-Sync
 * @param {string} schedule - "off" | "weekly" | "monthly"
 */
function setMemberSyncSchedule(schedule) {
  try {
    // ลบ trigger เก่า
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (t.getHandlerFunction() === "syncMemberNamesFromLine") {
        ScriptApp.deleteTrigger(t);
      }
    });
    
    let msg = "";
    
    if (schedule === "weekly") {
      // ทุกอาทิตย์ 03:00
      ScriptApp.newTrigger("syncMemberNamesFromLine")
        .timeBased()
        .onWeekDay(ScriptApp.WeekDay.SUNDAY)
        .atHour(3)
        .create();
      msg = "✅ ตั้ง Sync รายสัปดาห์ (อาทิตย์ 03:00)";
    } else if (schedule === "monthly") {
      // วันที่ 1 ของเดือน 03:00
      ScriptApp.newTrigger("syncMemberNamesFromLine")
        .timeBased()
        .onMonthDay(1)
        .atHour(3)
        .create();
      msg = "✅ ตั้ง Sync รายเดือน (วันที่ 1, 03:00)";
    } else {
      // off
      msg = "🔴 ปิด Auto-Sync แล้ว";
    }
    
    setConfig("MEMBER_SYNC_SCHEDULE", schedule);
    return { success: true, msg: msg, schedule: schedule };
  } catch (e) {
    return { success: false, msg: "❌ " + e.message };
  }
}

/**
 * 🧪 Test
 */
function testMemberSyncStatus() {
  Logger.log("🧪 === Test Member Sync Status ===");
  const status = getMemberSyncStatus();
  Logger.log("Last Sync: " + status.lastSync);
  Logger.log("Last Result: " + status.lastResult);
  Logger.log("Schedule: " + status.schedule);
  Logger.log("Has Trigger: " + status.hasTrigger);
  Logger.log("Pending (User_XX): " + status.pendingCount + "/" + status.totalCount);
}

/**
 * 🔍 Debug — ตรวจ getSystemSettings ส่งอะไรมา
 */
function debugSystemSettings() {
  Logger.log("🔍 === Debug getSystemSettings ===");
  Logger.log("");
  
  try {
    const settings = getSystemSettings();
    
    if (!settings) {
      Logger.log("❌ getSystemSettings คืน null/undefined!");
      return;
    }
    
    Logger.log("✅ มีค่า return ทั้งหมด " + Object.keys(settings).length + " keys");
    Logger.log("");
    Logger.log("📋 รายการ:");
    
    Object.keys(settings).sort().forEach(function(key) {
      const val = settings[key];
      const display = (val === null) ? "NULL" : 
                      (val === undefined) ? "UNDEFINED" :
                      (val === "") ? "(empty string)" :
                      String(val).substring(0, 40);
      Logger.log("  " + key + " = " + display);
    });
    
    Logger.log("");
    Logger.log("════════════════════════════════════");
    
    // ตรวจ keys สำคัญที่ Dashboard เรียก
    const expected = ["VIP_SECRET_CODE", "BOT_STATUS", "POLITE_PREFIX", "POLITE_SUFFIX"];
    Logger.log("📊 ตรวจ keys สำคัญ:");
    expected.forEach(function(k) {
      const has = settings.hasOwnProperty(k) && settings[k] !== undefined;
      Logger.log("  " + (has ? "✅" : "❌") + " " + k + " = " + (settings[k] || "ไม่มี"));
    });
    
  } catch(e) {
    Logger.log("❌ Error: " + e.message);
  }
}

function checkToken() {
  const t = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  Logger.log(t ? ('✅ อ่านได้ ยาว ' + t.length + ' ตัวอักษร') : '❌ อ่านไม่ได้ (ว่าง/key ผิด)');
}
