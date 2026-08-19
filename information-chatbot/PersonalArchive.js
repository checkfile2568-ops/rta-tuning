/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  PersonalArchive.gs — ระบบบันทึกส่วนตัว (ลิงก์ + รูปภาพ)          ║
 * ║  แยกจากข้อมูลพิกัดและรูปภาพหลักฐานของระบบงานหมายทั้งหมด          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * การบีบอัดรูปจริง:
 * - ตั้ง PERSONAL_ARCHIVE_IMAGE_MODE = COMPRESSED
 * - ใส่ PERSONAL_ARCHIVE_COMPRESSOR_URL เป็น HTTPS endpoint ที่รับ
 *   request body เป็นรูป และคืน response body เป็นไฟล์รูปที่บีบอัดแล้ว
 * - ระบบจะไม่แอบใช้ thumbnail แทนไฟล์จริง หากยังไม่ตั้ง endpoint
 */

const PERSONAL_ARCHIVE_SHEET_NAME_ = "บันทึกส่วนตัว";
const PERSONAL_ARCHIVE_HEADERS_ = [
  "ID", "เวลา", "เดือนKey", "เดือน", "ประเภทแชท", "แหล่งข้อมูล (LINE ID)",
  "ผู้ส่ง (LINE ID)", "ชื่อผู้ส่ง", "ประเภทข้อมูล", "รายละเอียด", "URL ที่พบ",
  "Drive URL", "Drive File ID", "โหมดรูป", "ขนาดไฟล์ (bytes)", "สถานะรูป", "LINE Message ID"
];
const PERSONAL_ARCHIVE_MONTHS_ = [
  { name: "มกราคม", aliases: ["มกราคม", "ม.ค", "มค"] },
  { name: "กุมภาพันธ์", aliases: ["กุมภาพันธ์", "ก.พ", "กพ"] },
  { name: "มีนาคม", aliases: ["มีนาคม", "มี.ค", "มีค"] },
  { name: "เมษายน", aliases: ["เมษายน", "เม.ย", "เมย"] },
  { name: "พฤษภาคม", aliases: ["พฤษภาคม", "พ.ค", "พค"] },
  { name: "มิถุนายน", aliases: ["มิถุนายน", "มิ.ย", "มิย"] },
  { name: "กรกฎาคม", aliases: ["กรกฎาคม", "ก.ค", "กค"] },
  { name: "สิงหาคม", aliases: ["สิงหาคม", "ส.ค", "สค"] },
  { name: "กันยายน", aliases: ["กันยายน", "ก.ย", "กย"] },
  { name: "ตุลาคม", aliases: ["ตุลาคม", "ต.ค", "ตค"] },
  { name: "พฤศจิกายน", aliases: ["พฤศจิกายน", "พ.ย", "พย"] },
  { name: "ธันวาคม", aliases: ["ธันวาคม", "ธ.ค", "ธค"] }
];

function _personalArchiveConfigDefaults_() {
  return [
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
    ["PERSONAL_ARCHIVE_REPLY_STATUS", "OFF", "เปิด/ปิด ข้อความยืนยันหลังบันทึกส่วนตัว"]
  ];
}

/** สร้างชีตและ config ของระบบบันทึกส่วนตัว โดยไม่แตะชีตงานหมายเดิม */
function setupPersonalArchive() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const configSheet = ss.getSheetByName(SHEETS.CONFIG);
    if (!configSheet) return { success: false, error: "ไม่พบชีต ตั้งค่า" };

    const existing = {};
    const configRows = configSheet.getDataRange().getValues();
    for (let i = 1; i < configRows.length; i++) {
      existing[normalizeConfigKey_(configRows[i][0])] = true;
    }

    const addedConfigs = [];
    _personalArchiveConfigDefaults_().forEach(function(row) {
      if (!existing[normalizeConfigKey_(row[0])]) {
        configSheet.appendRow(row);
        addedConfigs.push(row[0]);
      }
    });

    const sheet = _ensurePersonalArchiveSheet_();
    if (typeof _clearConfigCache === "function") _clearConfigCache();
    if (typeof _clearCodeLocalCache_ === "function") _clearCodeLocalCache_();
    return {
      success: true,
      sheetName: sheet.getName(),
      addedConfigs: addedConfigs,
      message: "พร้อมใช้งานระบบบันทึกส่วนตัวแล้ว (สถานะเริ่มต้น: ปิด)"
    };
  } catch (e) {
    return { success: false, error: String(e && e.message || e) };
  }
}

function _ensurePersonalArchiveSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const name = (SHEETS && SHEETS.PERSONAL_ARCHIVE) || PERSONAL_ARCHIVE_SHEET_NAME_;
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, PERSONAL_ARCHIVE_HEADERS_.length).setValues([PERSONAL_ARCHIVE_HEADERS_]);
    sheet.getRange(1, 1, 1, PERSONAL_ARCHIVE_HEADERS_.length)
      .setFontWeight("bold")
      .setBackground("#0f766e")
      .setFontColor("#ffffff")
      .setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, 9);
    sheet.setColumnWidth(10, 360);
    sheet.setColumnWidth(11, 300);
    sheet.setColumnWidth(12, 300);
    return sheet;
  }

  const currentHeaderCount = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, currentHeaderCount).getValues()[0];
  PERSONAL_ARCHIVE_HEADERS_.forEach(function(header, index) {
    if (!headers[index]) sheet.getRange(1, index + 1).setValue(header);
  });
  sheet.getRange(1, 1, 1, PERSONAL_ARCHIVE_HEADERS_.length)
    .setFontWeight("bold")
    .setBackground("#0f766e")
    .setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  return sheet;
}

function _isPersonalArchiveEnabled_() {
  return String(getConfig("PERSONAL_ARCHIVE_STATUS") || "OFF").trim().toUpperCase() === "ON";
}

function _isPersonalArchiveSourceAllowed_(sourceId, isGroup) {
  if (!_isPersonalArchiveEnabled_()) return false;
  const allowed = String(getConfig("PERSONAL_ARCHIVE_ALLOWED_SOURCES") || "").trim();
  if (!allowed) return false;
  return _isSourceAllowed(allowed, sourceId, isGroup);
}

function _isPersonalArchiveSearchAllowed_(userId) {
  const raw = String(getConfig("PERSONAL_ARCHIVE_SEARCH_USER_IDS") || "admins").trim();
  const parts = raw.split(/[\n,]/).map(function(value) { return String(value || "").trim(); }).filter(Boolean);
  const lower = parts.map(function(value) { return value.toLowerCase(); });
  return (lower.indexOf("admins") >= 0 && isAdmin(userId)) || parts.indexOf(userId) >= 0;
}

function _isPersonalArchiveSearchSourceAllowed_(sourceId, isGroup) {
  const allowed = String(getConfig("PERSONAL_ARCHIVE_SEARCH_ALLOWED_SOURCES") || "private").trim();
  return _isSourceAllowed(allowed, sourceId, isGroup);
}

function _personalArchiveExtractUrls_(text) {
  const found = [];
  String(text || "").replace(/https?:\/\/[^\s<>"']+/gi, function(raw) {
    const url = String(raw || "").replace(/[\])}>,.;!?]+$/g, "");
    if (url && found.indexOf(url) < 0) found.push(url);
    return raw;
  });
  return found;
}

function _isPersonalArchiveLinkText_(text) {
  return _personalArchiveExtractUrls_(text).length > 0;
}

/** ใช้ใน guard ของข้อความกลุ่ม เพื่อให้ URL จากห้องที่ระบุไม่ถูกตัดทิ้ง */
function shouldHandlePersonalArchiveGroupText_(messageText, groupId) {
  return _isPersonalArchiveSourceAllowed_(groupId, true) && _isPersonalArchiveLinkText_(messageText);
}

function _personalArchiveChatType_(isGroup, groupId) {
  if (!isGroup) return "private";
  return String(groupId || "").indexOf("R") === 0 ? "room" : "group";
}

function _personalArchiveMonthKey_(date) {
  const d = date || new Date();
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
}

function _personalArchiveThaiMonth_(date) {
  const d = date || new Date();
  return PERSONAL_ARCHIVE_MONTHS_[d.getMonth()].name + " " + (d.getFullYear() + 543);
}

function _personalArchiveRecordId_() {
  return "PA" + new Date().getTime() + "_" + Utilities.getUuid().substring(0, 8);
}

function _personalArchiveShortText_(value, maxLen) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  const limit = maxLen || 220;
  return clean.length > limit ? clean.substring(0, limit - 1) + "…" : clean;
}

function _appendPersonalArchiveRecord_(payload) {
  const now = payload.now || new Date();
  const values = [
    _personalArchiveRecordId_(), now, _personalArchiveMonthKey_(now), _personalArchiveThaiMonth_(now),
    payload.chatType || "private", payload.sourceId || "", payload.userId || "", payload.userName || "",
    payload.recordType || "LINK", payload.detail || "", payload.urls || "", payload.driveUrl || "",
    payload.fileId || "", payload.imageMode || "", payload.sizeBytes || "", payload.imageStatus || "",
    payload.messageId || ""
  ];

  return _withScriptLock_(5000, function() {
    const sheet = _ensurePersonalArchiveSheet_();
    sheet.appendRow(values);
    return { id: values[0], rowIndex: sheet.getLastRow() };
  });
}

/** บันทึกข้อความที่มี URL เท่านั้น เพื่อไม่เก็บบทสนทนาทั่วไปเกินความจำเป็น */
function capturePersonalArchiveLink_(messageText, context) {
  const sourceId = context && context.sourceId;
  const isGroup = !!(context && context.isGroup);
  if (!_isPersonalArchiveSourceAllowed_(sourceId, isGroup)) return { handled: false };

  const urls = _personalArchiveExtractUrls_(messageText);
  if (!urls.length) return { handled: false };

  try {
    const saved = _appendPersonalArchiveRecord_({
      now: new Date(),
      chatType: _personalArchiveChatType_(isGroup, sourceId),
      sourceId: sourceId,
      userId: context.userId,
      userName: context.userName,
      recordType: "LINK",
      detail: _personalArchiveShortText_(messageText, 1000),
      urls: urls.join("\n"),
      messageId: context.messageId
    });
    return { handled: true, ok: true, recordId: saved.id, recordType: "LINK" };
  } catch (e) {
    Logger.log("Personal archive link error: " + (e && e.message || e));
    return { handled: true, ok: false, error: String(e && e.message || e) };
  }
}

function _personalArchiveExtension_(mimeType) {
  const type = String(mimeType || "").toLowerCase().split(";")[0];
  const map = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic" };
  return map[type] || "jpg";
}

function _personalArchiveImageFileName_(userName, blob) {
  const safeName = String(userName || "user").replace(/[\\/:*?"<>|\s]+/g, "").substring(0, 24) || "user";
  return "ส่วนตัว_" + _thaiDateShort(new Date()) + "_" + safeName + "." + _personalArchiveExtension_(blob.getContentType());
}

function _getOrCreatePersonalArchiveFolder_() {
  const existingId = String(getConfig("PERSONAL_ARCHIVE_FOLDER_ID") || "").trim();
  if (existingId) {
    try { return DriveApp.getFolderById(existingId); } catch (e) {}
  }

  const org = getConfig("COURT_NAME") || getConfig("ORGANIZATION_NAME") || "ศาลจังหวัดลพบุรี";
  const folder = DriveApp.createFolder(org + " - บันทึกส่วนตัว");
  // ตั้งใจไม่ใช้ ANYONE_WITH_LINK เพื่อให้ URL ที่หลุดออกไปเปิดไม่ได้โดยสาธารณะ
  setConfig("PERSONAL_ARCHIVE_FOLDER_ID", folder.getId());
  return folder;
}

function _personalArchiveCompressionSettings_() {
  const width = Math.max(320, Math.min(2400, Number(getConfig("PERSONAL_ARCHIVE_MAX_WIDTH") || 800) || 800));
  const quality = Math.max(50, Math.min(95, Number(getConfig("PERSONAL_ARCHIVE_JPEG_QUALITY") || 75) || 75));
  return {
    url: String(getConfig("PERSONAL_ARCHIVE_COMPRESSOR_URL") || "").trim(),
    token: String(getConfig("PERSONAL_ARCHIVE_COMPRESSOR_TOKEN") || "").trim(),
    width: width,
    quality: quality
  };
}

function _compressPersonalArchiveImage_(blob) {
  const settings = _personalArchiveCompressionSettings_();
  if (!settings.url) return { ok: false, reason: "ไม่ได้ย่อ: ยังไม่ได้ตั้ง URL บีบอัดรูป" };
  if (!/^https:\/\//i.test(settings.url)) return { ok: false, reason: "ไม่ได้ย่อ: URL บีบอัดต้องเป็น HTTPS" };

  try {
    const headers = {
      "X-Archive-Max-Width": String(settings.width),
      "X-Archive-Jpeg-Quality": String(settings.quality),
      "X-Archive-Source-Content-Type": String(blob.getContentType() || "image/jpeg")
    };
    if (settings.token) headers.Authorization = "Bearer " + settings.token;

    const response = UrlFetchApp.fetch(settings.url, {
      method: "post",
      payload: blob,
      headers: headers,
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) return { ok: false, reason: "ไม่ได้ย่อ: compressor HTTP " + status };

    const compactBlob = response.getBlob();
    const contentType = String(compactBlob.getContentType() || "").toLowerCase();
    if (contentType.indexOf("image/") !== 0) return { ok: false, reason: "ไม่ได้ย่อ: compressor ไม่ได้ส่งไฟล์รูปกลับมา" };

    const originalSize = blob.getBytes().length;
    const compactSize = compactBlob.getBytes().length;
    if (!compactSize || compactSize >= originalSize) {
      return { ok: false, reason: "ไม่ได้ย่อ: ผลลัพธ์มีขนาดไม่เล็กลง" };
    }
    return { ok: true, blob: compactBlob, sizeBytes: compactSize, reason: "บีบอัดแล้ว" };
  } catch (e) {
    return { ok: false, reason: "ไม่ได้ย่อ: " + String(e && e.message || e) };
  }
}

function capturePersonalArchiveImage_(messageId, context) {
  const sourceId = context && context.sourceId;
  const isGroup = !!(context && context.isGroup);
  if (!_isPersonalArchiveSourceAllowed_(sourceId, isGroup)) return { handled: false };

  try {
    const response = UrlFetchApp.fetch("https://api-data.line.me/v2/bot/message/" + messageId + "/content", {
      headers: getLineAuthHeaders_(),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      return { handled: true, ok: false, error: "ดาวน์โหลดรูปไม่ได้ HTTP " + response.getResponseCode() };
    }

    const originalBlob = response.getBlob();
    let storedBlob = originalBlob;
    let imageMode = "ORIGINAL";
    let imageStatus = "เก็บไฟล์ต้นฉบับ";
    const requestedMode = String(getConfig("PERSONAL_ARCHIVE_IMAGE_MODE") || "ORIGINAL").trim().toUpperCase();
    if (requestedMode === "COMPRESSED") {
      const compressed = _compressPersonalArchiveImage_(originalBlob);
      if (compressed.ok) {
        storedBlob = compressed.blob;
        imageMode = "COMPRESSED";
        imageStatus = compressed.reason;
      } else {
        imageMode = "ORIGINAL";
        imageStatus = compressed.reason;
      }
    }

    storedBlob.setName(_personalArchiveImageFileName_(context.userName, storedBlob));
    const folder = _getOrCreatePersonalArchiveFolder_();
    const file = folder.createFile(storedBlob);
    const saved = _appendPersonalArchiveRecord_({
      now: new Date(),
      chatType: _personalArchiveChatType_(isGroup, sourceId),
      sourceId: sourceId,
      userId: context.userId,
      userName: context.userName,
      recordType: "IMAGE",
      detail: storedBlob.getName(),
      driveUrl: file.getUrl(),
      fileId: file.getId(),
      imageMode: imageMode,
      sizeBytes: storedBlob.getBytes().length,
      imageStatus: imageStatus,
      messageId: messageId
    });
    return { handled: true, ok: true, recordId: saved.id, recordType: "IMAGE", imageMode: imageMode, imageStatus: imageStatus };
  } catch (e) {
    Logger.log("Personal archive image error: " + (e && e.message || e));
    return { handled: true, ok: false, error: String(e && e.message || e) };
  }
}

function sendPersonalArchiveCaptureReply_(replyToken, result) {
  if (String(getConfig("PERSONAL_ARCHIVE_REPLY_STATUS") || "OFF").toUpperCase() !== "ON") return;
  if (!result || !result.ok) {
    safeSendReply(replyToken, "⚠️ บันทึกส่วนตัวไม่สำเร็จ");
    return;
  }
  safeSendReply(replyToken, result.recordType === "IMAGE" ? "📸 บันทึกรูปส่วนตัวแล้ว" : "🔗 บันทึกลิงก์ส่วนตัวแล้ว");
}

function _personalArchiveParseSearch_(messageText, isGroup) {
  let working = String(messageText || "").trim();
  if (isGroup) {
    const prefix = String(getConfig("SEARCH_GROUP_PREFIX") || "บอท").trim();
    const prefixPattern = new RegExp("^/?#?" + _personalArchiveEscapeRegex_(prefix) + "\\s+", "i");
    const match = working.match(prefixPattern);
    if (!match) return { isSearch: false };
    working = working.substring(match[0].length).trim();
  }

  const command = working.match(/^\/?ค้นหา\s+ส่วนตัว\s*(.*)$/i);
  if (!command) return { isSearch: false };

  const rest = String(command[1] || "").trim().toLowerCase();
  const now = new Date();
  let monthIndex = now.getMonth();
  PERSONAL_ARCHIVE_MONTHS_.some(function(month, index) {
    const found = month.aliases.some(function(alias) { return rest.indexOf(alias.toLowerCase()) >= 0; });
    if (found) monthIndex = index;
    return found;
  });

  let buddhistYear = now.getFullYear() + 543;
  const yearMatch = rest.match(/(?:^|\s)(\d{2,4})(?:\s|$)/);
  if (yearMatch) {
    const entered = Number(yearMatch[1]);
    if (entered >= 0 && entered < 100) buddhistYear = 2500 + entered;
    else if (entered >= 1000 && entered < 2400) buddhistYear = entered + 543;
    else if (entered >= 2400) buddhistYear = entered;
  }
  const gregorianYear = buddhistYear - 543;
  return {
    isSearch: true,
    monthKey: gregorianYear + "-" + ("0" + (monthIndex + 1)).slice(-2),
    monthLabel: PERSONAL_ARCHIVE_MONTHS_[monthIndex].name + " " + buddhistYear
  };
}

function _personalArchiveEscapeRegex_(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _personalArchiveSearchRows_(monthKey, maxResults) {
  const sheet = _ensurePersonalArchiveSheet_();
  if (sheet.getLastRow() <= 1) return [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, PERSONAL_ARCHIVE_HEADERS_.length).getValues();
  const records = [];
  for (let i = values.length - 1; i >= 0 && records.length < maxResults; i--) {
    if (String(values[i][2] || "") !== monthKey) continue;
    records.push({
      id: values[i][0], time: values[i][1], sourceId: values[i][5], senderName: values[i][7],
      type: values[i][8], detail: values[i][9], urls: values[i][10], driveUrl: values[i][11],
      imageMode: values[i][13], sizeBytes: values[i][14], imageStatus: values[i][15]
    });
  }
  return records;
}

function _personalArchiveFormatTime_(value) {
  try { return Utilities.formatDate(new Date(value), Session.getScriptTimeZone(), "dd/MM/yy HH:mm"); } catch (e) { return "-"; }
}

function _personalArchiveFormatSearchReply_(parsed, records, userId) {
  if (!records.length) return "📁 บันทึกส่วนตัว " + parsed.monthLabel + "\n\nไม่พบข้อมูลในเดือนนี้";
  const lines = ["📁 บันทึกส่วนตัว " + parsed.monthLabel, "พบ " + records.length + " รายการล่าสุด"];
  records.forEach(function(record, index) {
    const meta = _personalArchiveFormatTime_(record.time) + (record.senderName ? " · " + record.senderName : "");
    if (String(record.type).toUpperCase() === "IMAGE") {
      const sizeKb = record.sizeBytes ? " · " + Math.max(1, Math.round(Number(record.sizeBytes) / 1024)) + " KB" : "";
      lines.push((index + 1) + ". 📸 รูปภาพ (" + (record.imageMode || "ORIGINAL") + sizeKb + ")\n   " + meta);
      if (isAdmin(userId) && record.driveUrl) lines.push("   Drive: " + record.driveUrl);
    } else {
      lines.push((index + 1) + ". 🔗 " + _personalArchiveShortText_(record.detail || record.urls, 180) + "\n   " + meta);
      if (record.urls) lines.push("   " + _personalArchiveShortText_(String(record.urls).split("\n")[0], 260));
    }
  });
  lines.push("\n💡 ค้นเฉพาะเดือนอื่น: ค้นหา ส่วนตัว สิงหาคม 2569");
  return lines.join("\n");
}

/** จัดการคำสั่งค้นหา เช่น "ค้นหา ส่วนตัวกรกฎาคม" เฉพาะ User ID ที่อนุญาต */
function routePersonalArchiveSearch_(messageText, user, userId, sourceId, isGroup, replyToken) {
  const parsed = _personalArchiveParseSearch_(messageText, isGroup);
  if (!parsed.isSearch) return { handled: false };

  if (!_isPersonalArchiveEnabled_()) {
    safeSendReply(replyToken, "🔕 ระบบบันทึกส่วนตัวยังปิดอยู่");
    return { handled: true };
  }
  if (!_isPersonalArchiveSearchAllowed_(userId)) {
    safeSendReply(replyToken, "🔒 คุณไม่มีสิทธิ์ค้นหาบันทึกส่วนตัว");
    return { handled: true };
  }
  if (!_isPersonalArchiveSearchSourceAllowed_(sourceId, isGroup)) {
    safeSendReply(replyToken, "🔒 ระบบบันทึกส่วนตัวอนุญาตให้ค้นจากแชท/ห้องที่กำหนดเท่านั้น");
    return { handled: true };
  }

  try {
    const records = _personalArchiveSearchRows_(parsed.monthKey, 8);
    safeSendReply(replyToken, _personalArchiveFormatSearchReply_(parsed, records, userId));
    try { logActivity(userId, user && user.name || "", "ค้นบันทึกส่วนตัว: " + parsed.monthKey, "PersonalArchiveSearch", "Success", 0); } catch (e) {}
    return { handled: true };
  } catch (e) {
    Logger.log("Personal archive search error: " + (e && e.message || e));
    safeSendReply(replyToken, "⚠️ ค้นหาบันทึกส่วนตัวไม่สำเร็จ");
    return { handled: true };
  }
}

function createPersonalArchiveFolder() {
  try {
    const folder = _getOrCreatePersonalArchiveFolder_();
    return { success: true, folderId: folder.getId(), folderName: folder.getName(), folderUrl: folder.getUrl(), message: "สร้าง/เชื่อมโฟลเดอร์บันทึกส่วนตัวแล้ว" };
  } catch (e) {
    return { success: false, error: String(e && e.message || e) };
  }
}

function checkPersonalArchiveFolder() {
  try {
    const folderId = String(getConfig("PERSONAL_ARCHIVE_FOLDER_ID") || "").trim();
    if (!folderId) return { success: false, status: "empty", message: "ยังไม่ได้สร้างโฟลเดอร์" };
    const folder = DriveApp.getFolderById(folderId);
    let count = 0;
    const files = folder.getFiles();
    while (files.hasNext() && count < 1000) { files.next(); count++; }
    return {
      success: true, status: "ok", folderId: folderId, folderName: folder.getName(), folderUrl: folder.getUrl(),
      fileCountLabel: files.hasNext() ? count + "+" : String(count)
    };
  } catch (e) {
    return { success: false, status: "broken", message: "โฟลเดอร์เดิมเข้าถึงไม่ได้" };
  }
}

function unlinkPersonalArchiveFolder() {
  setConfig("PERSONAL_ARCHIVE_FOLDER_ID", "");
  return { success: true, message: "ปลดการเชื่อมโฟลเดอร์แล้ว (ไฟล์เดิมไม่ถูกลบ)" };
}
