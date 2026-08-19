/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  📍 PikadSession.gs v1.0 — Master Build v10.2                    ║
 * ║  ระบบ LINE Bot ศาลจังหวัดลพบุรี                                  ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  วัตถุประสงค์:                                                    ║
 * ║    • Session-based merge พิกัด/รูป/เลขบ้าน ภายใน X นาที           ║
 * ║    • ตอบกลับด้วย Flex Message พร้อมปุ่มลิงก์ไประบบพิกัด          ║
 * ║    • หลัง X นาที → บันทึกตามที่มี (ปล่อยว่าง)                     ║
 * ║                                                                   ║
 * ║  ฟังก์ชันหลัก:                                                    ║
 * ║    • setupPikadSession()         — ตั้งค่าครั้งแรก                ║
 * ║    • setupPikadSessionTrigger()  — ตั้ง trigger auto-close        ║
 * ║    • saveOrUpdateLocationData()  — บันทึก/merge พิกัด (override) ║
 * ║    • saveOrUpdateHouseNumber()   — บันทึก/merge เลขบ้าน           ║
 * ║    • linkPhotoToSession()        — ผูกรูปกับ session              ║
 * ║    • buildPikadSessionFlex()     — สร้าง Flex Message             ║
 * ║    • sendPikadSessionReply()     — ส่ง Flex ตอบกลับ              ║
 * ║    • closePikadExpiredSessions() — auto-close session             ║
 * ║                                                                   ║
 * ║  วิธีใช้:                                                         ║
 * ║    1. เพิ่มไฟล์นี้ใน Apps Script (File → New → Script)            ║
 * ║    2. Save                                                        ║
 * ║    3. Run setupPikadSession()                                     ║
 * ║    4. ใส่ PIKAD_SYSTEM_URL ใน Sheet ตั้งค่า                       ║
 * ║    5. Run setupPikadSessionTrigger()                              ║
 * ║                                                                   ║
 * ║  หมายเหตุ:                                                        ║
 * ║    ⚠️ ฟังก์ชัน saveOrUpdateLocationData/saveOrUpdateHouseNumber  ║
 * ║       จะ OVERRIDE ของเดิมใน Code.gs โดยอัตโนมัติ                ║
 * ║       (Apps Script ใช้ฟังก์ชันที่ define หลังสุด)                 ║
 * ║                                                                   ║
 * ║  ทดสอบ:                                                           ║
 * ║    • Run testPikadSessionFlow() — ทดสอบ flow เต็ม                 ║
 * ║    • Run testPikadFlexVariants() — ทดสอบ Flex รูปแบบต่างๆ          ║
 * ║    • Run testPikadAutoClose() — ทดสอบ auto-close                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */


/* ══════════════════════════════════════════════════════════════
 * PART 1: SETUP
 * ══════════════════════════════════════════════════════════════ */

/**
 * 🔧 ติดตั้งค่าครั้งแรก
 */
function setupPikadSession() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const configSheet = ss.getSheetByName(SHEETS.CONFIG);
    if (!configSheet) return { success: false, error: "ไม่พบ Sheet ตั้งค่า" };

    const data = configSheet.getDataRange().getValues();
    const existing = {};
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) existing[data[i][0]] = i + 1;
    }

    const added = [];
    if (!existing.PIKAD_SYSTEM_URL) {
      configSheet.appendRow([
        "PIKAD_SYSTEM_URL",
        "",
        "🗺️ URL ของระบบพิกัดและค้นหาแผนที่ (จบด้วย /exec)"
      ]);
      added.push("✅ PIKAD_SYSTEM_URL (ต้องใส่ค่า)");
    }
    if (!existing.PIKAD_SESSION_MINUTES) {
      configSheet.appendRow([
        "PIKAD_SESSION_MINUTES",
        "2",
        "⏱ เวลา session merge (นาที) - ไม่เกิน 2 นาที"
      ]);
      added.push("✅ PIKAD_SESSION_MINUTES = 2");
    }

    const triggerResult = setupPikadSessionTrigger();
    const msg = "🎉 Setup Pikad Session สำเร็จ\n\n" + (added.length ? added.join("\n") : "✓ มีอยู่แล้ว")
      + "\n\n📋 ต่อไป:\n"
      + "1. ใส่ PIKAD_SYSTEM_URL ใน Sheet ตั้งค่า\n"
      + "2. Deploy ใหม่\n"
      + "3. Trigger: " + (triggerResult && triggerResult.success ? "พร้อมใช้" : "ตรวจสอบอีกครั้ง");
    Logger.log(msg);
    return { success: true, message: msg };
  } catch (e) {
    return { success: false, error: e.message };
  }
}


/**
 * ⏰ ตั้ง trigger ให้ auto-close session ที่หมดอายุทุก 1 นาที
 */
function setupPikadSessionTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "closePikadExpiredSessions") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("closePikadExpiredSessions")
    .timeBased().everyMinutes(1).create();
  const msg = "✅ ตั้ง trigger ปิด session ที่หมดอายุทุก 1 นาทีสำเร็จ";
  Logger.log(msg);
  return { success: true, message: msg };
}

function _withPikadLock_(timeoutMs, callback) {
  if (typeof _withScriptLock_ === "function") {
    return _withScriptLock_(timeoutMs || 5000, callback);
  }
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

function _ensurePikadStatusColumn_(sheet) {
  if (!sheet) return;
  if (sheet.getLastColumn() < 9) {
    sheet.getRange(1, 9).setValue("Session Status")
      .setFontWeight("bold").setBackground("#1e3a8a").setFontColor("#ffffff");
  }
}

function _getPikadSessionMinutes_() {
  const n = parseInt(getConfig("PIKAD_SESSION_MINUTES"), 10);
  if (!n || n < 1) return 2;
  return Math.min(n, 2);
}


/* ══════════════════════════════════════════════════════════════
 * PART 2: SESSION LOGIC (แทนที่ 3 ฟังก์ชันเดิม)
 * ══════════════════════════════════════════════════════════════ */

/**
 * 🗓️ หา session ที่ยัง active ของ user
 * @private
 * @returns {number} row index (1-based) หรือ -1 ถ้าไม่มี
 */
function _findActiveSession(userId, groupId) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
  if (!sheet || sheet.getLastRow() < 2) return -1;

  const sessionMin = _getPikadSessionMinutes_();
  const cutoff = new Date(Date.now() - sessionMin * 60 * 1000);

  const data = sheet.getDataRange().getValues();
  const photoLocMap = _buildPhotoLocIdMap_();
  const useGroupSession = groupId && typeof _isMissionGroup === "function" && _isMissionGroup(groupId);
  // หาล่าสุดก่อน (ย้อนจากล่างขึ้นบน)
  for (let i = data.length - 1; i > 0; i--) {
    if (useGroupSession) {
      if (String(data[i][7] || "") !== String(groupId)) continue;
    } else if (data[i][2] !== userId) {
      continue;
    }
    if (String(data[i][8] || "").indexOf("[EXPIRED]") >= 0) continue;
    // ตรวจว่ายังไม่ complete (มีฟิลด์ใดว่าง) และยังไม่หมดอายุ
    const rowTime = new Date(data[i][1]);
    if (isNaN(rowTime.getTime())) continue;
    if (rowTime < cutoff) return -1; // session หมดอายุ → ไม่รวม
    // ถ้ามีฟิลด์ใดว่าง → ถือว่ายัง active
    const houseNum = String(data[i][3] || "").trim();
    const lat = String(data[i][4] || "").trim();
    const photoLinked = _isPhotoLinkedToRow(sheet, i + 1, photoLocMap);
    if (!houseNum || !lat || !photoLinked) {
      return i + 1; // row index 1-based
    }
    // ถ้าครบแล้ว → ไม่ต้อง merge
    return -1;
  }
  return -1;
}


/**
 * 🔍 ตรวจว่า row นี้มีรูปแนบแล้วหรือยัง
 * @private
 */
function _isPhotoLinkedToRow(locSheet, rowIndex, photoLocMap) {
  try {
    const locId = String(locSheet.getRange(rowIndex, 1).getValue());
    if (photoLocMap) return !!photoLocMap[locId];
    return _isPhotoLocIdLinked_(locId);
  } catch (e) { return false; }
}

function _isPhotoLocIdLinked_(locId) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const pSheet = ss.getSheetByName(SHEETS.PHOTOS);
    if (!pSheet || pSheet.getLastRow() < 2) return false;
    const pData = pSheet.getDataRange().getValues();
    for (let i = pData.length - 1; i > 0; i--) {
      if (_getPhotoLocIdFromRow_(pData[i]) === String(locId)) return true;
    }
    return false;
  } catch (e) { return false; }
}

function _buildPhotoLocIdMap_() {
  const result = {};
  try {
    const pSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.PHOTOS);
    if (!pSheet || pSheet.getLastRow() < 2) return result;
    const pData = pSheet.getDataRange().getValues();
    for (let i = 1; i < pData.length; i++) {
      const locId = _getPhotoLocIdFromRow_(pData[i]);
      if (locId) result[locId] = true;
    }
  } catch (e) {}
  return result;
}

function _getPhotoLocIdFromRow_(row) {
  // v10.4.8: col H = Loc ID. Fallback col G keeps old rows readable.
  return String(row[7] || row[6] || "").trim();
}

function _samePikadText_(a, b) {
  return String(a || "").trim().replace(/\s+/g, " ") ===
         String(b || "").trim().replace(/\s+/g, " ");
}

function _samePikadNumber_(a, b) {
  const n1 = Number(a);
  const n2 = Number(b);
  if (isNaN(n1) || isNaN(n2)) return _samePikadText_(a, b);
  return Math.abs(n1 - n2) < 0.000001;
}


/**
 * 📍 บันทึก/Merge พิกัด (แทนที่ saveOrUpdateLocationData เดิม)
 * @returns {object} { rowIndex, isNew, status }
 */
function saveOrUpdateLocationData(userId, lat, lng, address, groupId) {
  return _withPikadLock_(5000, function() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
  if (!sheet) return { rowIndex: -1, isNew: false };
  _ensurePikadStatusColumn_(sheet);

  const now = new Date();
  const timeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  // หา session ที่ยัง active
  const activeRow = _findActiveSession(userId, groupId);
  if (activeRow > 0) {
    // มี session อยู่ → update เฉพาะที่ว่าง
    const existing = sheet.getRange(activeRow, 1, 1, 8).getValues()[0];
    if (!existing[4]) { // lat ว่าง → update
      sheet.getRange(activeRow, 5).setValue(lat);
      sheet.getRange(activeRow, 6).setValue(lng);
      sheet.getRange(activeRow, 7).setValue(address || "");
      if (groupId && !existing[7]) sheet.getRange(activeRow, 8).setValue(groupId);
      return { rowIndex: activeRow, isNew: false, status: _getSessionStatus(sheet, activeRow) };
    }
    if (_samePikadNumber_(existing[4], lat) && _samePikadNumber_(existing[5], lng)) {
      return { rowIndex: activeRow, isNew: false, duplicate: true, status: _getSessionStatus(sheet, activeRow) };
    }
    // ถ้า lat มีอยู่แล้ว → สร้าง row ใหม่ (อันเก่าไม่ touch)
  }

  // สร้าง row ใหม่
  const newId = "LOC" + now.getTime();
  sheet.appendRow([newId, timeStr, userId, "", lat, lng, address || "", groupId || ""]);
  const newRow = sheet.getLastRow();
  return { rowIndex: newRow, isNew: true, status: _getSessionStatus(sheet, newRow) };
  });
}


/**
 * 🏠 บันทึก/Merge เลขที่บ้าน (แทนที่ saveOrUpdateHouseNumber เดิม)
 * @returns {object} { rowIndex, isNew, status }
 */
function saveOrUpdateHouseNumber(userId, houseNum, groupId) {
  return _withPikadLock_(5000, function() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
  if (!sheet) return { rowIndex: -1, isNew: false };
  _ensurePikadStatusColumn_(sheet);

  const now = new Date();
  const timeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  const activeRow = _findActiveSession(userId, groupId);
  if (activeRow > 0) {
    const existing = sheet.getRange(activeRow, 1, 1, 8).getValues()[0];
    if (!existing[3]) { // houseNum ว่าง → update
      sheet.getRange(activeRow, 4).setValue(houseNum);
      if (groupId && !existing[7]) sheet.getRange(activeRow, 8).setValue(groupId);
      return { rowIndex: activeRow, isNew: false, status: _getSessionStatus(sheet, activeRow) };
    }
    if (_samePikadText_(existing[3], houseNum)) {
      return { rowIndex: activeRow, isNew: false, duplicate: true, status: _getSessionStatus(sheet, activeRow) };
    }
  }

  // สร้าง row ใหม่
  const newId = "LOC" + now.getTime();
  sheet.appendRow([newId, timeStr, userId, houseNum, "", "", "", groupId || ""]);
  const newRow = sheet.getLastRow();
  return { rowIndex: newRow, isNew: true, status: _getSessionStatus(sheet, newRow) };
  });
}


/**
 * 📸 ผูกรูปกับ session (เรียกหลังบันทึกรูป)
 * @returns {object} { rowIndex, photoLinked, status }
 */
function linkPhotoToSession(userId, photoUrl, photoRowId, groupId) {
  return _withPikadLock_(5000, function() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
  if (!sheet) return { rowIndex: -1, photoLinked: false };
  _ensurePikadStatusColumn_(sheet);

  const now = new Date();
  const timeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  const activeRow = _findActiveSession(userId, groupId);
  let targetRow;

  if (activeRow > 0) {
    // มี session → ตรวจว่ามีรูปแล้วหรือยัง
    if (_isPhotoLinkedToRow(sheet, activeRow)) {
      // มีรูปแล้ว → สร้าง session ใหม่
      const newId = "LOC" + now.getTime();
      sheet.appendRow([newId, timeStr, userId, "", "", "", "", groupId || ""]);
      targetRow = sheet.getLastRow();
    } else {
      targetRow = activeRow;
    }
  } else {
    // ไม่มี session → สร้างใหม่
    const newId = "LOC" + now.getTime();
    sheet.appendRow([newId, timeStr, userId, "", "", "", "", groupId || ""]);
    targetRow = sheet.getLastRow();
  }

  // ผูก Photo row → ใส่ LocID ใน column H ของ Photos sheet (ไม่ทับ Group ID)
  try {
    const locId = sheet.getRange(targetRow, 1).getValue();
    const pSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.PHOTOS);
    if (pSheet && photoRowId) {
      if (pSheet.getLastColumn() < 8) {
        pSheet.getRange(1, 8).setValue("Loc ID")
          .setFontWeight("bold").setBackground("#1e3a8a").setFontColor("#ffffff");
      }
      const pData = pSheet.getDataRange().getValues();
      for (let i = pData.length - 1; i > 0; i--) {
        if (pData[i][0] === photoRowId) {
          pSheet.getRange(i + 1, 8).setValue(locId); // Column H = Loc ID
          break;
        }
      }
    }
  } catch (e) { Logger.log("linkPhoto error: " + e.message); }

  return { rowIndex: targetRow, photoLinked: true, status: _getSessionStatus(sheet, targetRow) };
  });
}


/**
 * 📊 ตรวจสถานะของ session (มีอะไรบ้าง, หมดอายุเมื่อไหร่)
 * @private
 * @returns {object} { hasCoord, hasPhoto, hasHouseNum, locId, row, expiresIn, expiresAt, complete, lat, lng, houseNum, photoUrl }
 */
function _getSessionStatus(sheet, rowIndex) {
  const row = sheet.getRange(rowIndex, 1, 1, 8).getValues()[0];
  const locId = row[0];
  const timeStr = row[1];
  const rowTime = new Date(timeStr);

  const sessionMin = _getPikadSessionMinutes_();
  const expiresAt = new Date(rowTime.getTime() + sessionMin * 60 * 1000);
  const expiresInMs = expiresAt.getTime() - Date.now();
  const expiresInSec = Math.max(0, Math.round(expiresInMs / 1000));

  const hasHouseNum = !!String(row[3] || "").trim();
  const hasCoord = !!String(row[4] || "").trim();
  const hasPhoto = _isPhotoLinkedToRow(sheet, rowIndex);

  // หา photoUrl ถ้ามี
  let photoUrl = "";
  if (hasPhoto) {
    try {
      const pSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.PHOTOS);
      if (pSheet) {
        const pData = pSheet.getDataRange().getValues();
        for (let i = pData.length - 1; i > 0; i--) {
          if (_getPhotoLocIdFromRow_(pData[i]) === String(locId)) { photoUrl = String(pData[i][5] || ""); break; }
        }
      }
    } catch (e) {}
  }

  return {
    locId: locId,
    row: rowIndex,
    hasCoord: hasCoord,
    hasPhoto: hasPhoto,
    hasHouseNum: hasHouseNum,
    complete: hasCoord && hasPhoto && hasHouseNum,
    houseNum: String(row[3] || ""),
    lat: row[4] || "",
    lng: row[5] || "",
    address: String(row[6] || ""),
    photoUrl: photoUrl,
    expiresInSec: expiresInSec,
    expiresAt: Utilities.formatDate(expiresAt, Session.getScriptTimeZone(), "HH:mm:ss"),
    sessionMin: sessionMin
  };
}


/* ══════════════════════════════════════════════════════════════
 * PART 3: FLEX REPLY BUILDERS
 * ══════════════════════════════════════════════════════════════ */

/**
 * 🎨 สร้าง Flex Message ตอบหลังบันทึกพิกัด/รูป/เลขบ้าน
 * @param {string} eventType - "coord" | "photo" | "house"
 * @param {object} status - จาก _getSessionStatus
 */
function buildPikadSessionFlex(eventType, status) {
  const pikadUrl = getConfig("PIKAD_SYSTEM_URL") || "";

  // เลือกสี + ข้อความตามสถานะ
  let headerColor, emoji, title, subTitle;
  if (status.complete) {
    headerColor = "#10B981"; // เขียว
    emoji = "✅";
    title = "บันทึกครบถ้วน!";
    subTitle = "All data saved";
  } else {
    headerColor = "#F59E0B"; // เหลือง — ยังรอ
    emoji = eventType === "coord" ? "📍" : eventType === "photo" ? "📸" : "🏠";
    title = eventType === "coord" ? "รับพิกัดแล้ว"
          : eventType === "photo" ? "รับรูปแล้ว"
          : "รับเลขที่บ้านแล้ว";
    subTitle = "เหลือเวลา " + _formatDuration(status.expiresInSec);
  }

  // Checklist
  const checklist = [
    { label: "พิกัด", has: status.hasCoord, icon: "📍" },
    { label: "รูปถ่าย", has: status.hasPhoto, icon: "📸" },
    { label: "เลขที่บ้าน", has: status.hasHouseNum, icon: "🏠" }
  ];

  const checklistBoxes = checklist.map(item => ({
    type: "box",
    layout: "horizontal",
    margin: "sm",
    contents: [
      {
        type: "text",
        text: item.has ? "✅" : "☐",
        size: "sm",
        flex: 0,
        color: item.has ? "#10B981" : "#9CA3AF"
      },
      {
        type: "text",
        text: item.icon + " " + item.label,
        size: "sm",
        flex: 1,
        margin: "sm",
        color: item.has ? "#1F2937" : "#9CA3AF",
        decoration: item.has ? "none" : "none"
      },
      {
        type: "text",
        text: item.has ? _getItemValue(item.label, status) : "รอ...",
        size: "xs",
        flex: 0,
        color: item.has ? "#10B981" : "#9CA3AF",
        align: "end"
      }
    ]
  }));

  // ──── Body contents ────
  const bodyContents = [
    {
      type: "text",
      text: status.complete ? "ข้อมูลครบแล้ว ✨" : "รอข้อมูลเพิ่ม (ภายใน " + status.sessionMin + " นาที):",
      size: "xs",
      color: "#6B7280",
      margin: "md"
    },
    {
      type: "box",
      layout: "vertical",
      margin: "md",
      spacing: "xs",
      contents: checklistBoxes
    }
  ];

  // ถ้ามีพิกัด → แสดง
  if (status.hasCoord) {
    bodyContents.push(
      { type: "separator", margin: "md", color: "#E5E7EB" },
      {
        type: "box",
        layout: "horizontal",
        margin: "sm",
        contents: [
          { type: "text", text: "📌 Lat,Lng", size: "xs", color: "#9CA3AF", flex: 0 },
          { type: "text", text: Number(status.lat).toFixed(5) + ", " + Number(status.lng).toFixed(5), size: "xs", color: "#374151", flex: 1, align: "end" }
        ]
      }
    );
  }

  // ──── Footer buttons ────
  const footerContents = [];

  // ปุ่มเปิดแผนที่ (Google Maps)
  if (status.hasCoord) {
    footerContents.push({
      type: "button",
      style: "link",
      height: "sm",
      action: {
        type: "uri",
        label: "🗺️ ดูบน Google Maps",
        uri: "https://www.google.com/maps?q=" + status.lat + "," + status.lng
      }
    });
  }

  // ปุ่มเข้าระบบพิกัด
  if (pikadUrl) {
    const params = [];
    if (status.hasCoord) params.push("lat=" + status.lat, "lng=" + status.lng);
    if (status.hasHouseNum) params.push("house=" + encodeURIComponent(status.houseNum));
    const fullUrl = pikadUrl + (params.length ? "?" + params.join("&") : "");

    footerContents.push({
      type: "button",
      style: "primary",
      height: "sm",
      color: headerColor,
      action: {
        type: "uri",
        label: status.complete ? "📍 เปิดระบบพิกัด" : "🗺️ เปิดแผนที่",
        uri: fullUrl
      }
    });
  }

  // ──── Build bubble ────
  const bubble = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: headerColor,
      paddingAll: "14px",
      contents: [
        {
          type: "text",
          text: emoji + "  " + title,
          weight: "bold",
          color: "#FFFFFF",
          size: "md"
        },
        {
          type: "text",
          text: subTitle,
          color: "#FFFFFF",
          size: "xs",
          margin: "xs",
          opacity: "0.85"
        }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "14px",
      backgroundColor: "#FFFFFF",
      contents: bodyContents
    }
  };

  if (footerContents.length > 0) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      paddingAll: "10px",
      paddingTop: "0px",
      spacing: "sm",
      contents: footerContents
    };
  }

  return {
    type: "flex",
    altText: emoji + " " + title + (status.complete ? " (ครบ)" : " · เหลือ " + _formatDuration(status.expiresInSec)),
    contents: bubble
  };
}


/**
 * @private
 */
function _getItemValue(label, status) {
  if (label === "พิกัด" && status.hasCoord)
    return String(Number(status.lat).toFixed(4)) + "°";
  if (label === "รูปถ่าย" && status.hasPhoto)
    return "บันทึกแล้ว";
  if (label === "เลขที่บ้าน" && status.hasHouseNum)
    return String(status.houseNum).substring(0, 20);
  return "";
}


/**
 * @private
 */
function _formatDuration(totalSec) {
  if (totalSec <= 0) return "หมดอายุ";
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return m + ":" + String(s).padStart(2, "0") + " นาที";
  return s + " วินาที";
}


/* ══════════════════════════════════════════════════════════════
 * PART 4: SEND FLEX REPLY (ตัวช่วยสำหรับเรียกจาก doPost)
 * ══════════════════════════════════════════════════════════════ */

/**
 * 📤 ส่ง Flex ตอบกลับหลังจัดการพิกัด/รูป/เลขบ้าน
 * ใช้แทน sendLineReply(replyToken, "📌 บันทึกข้อมูลแล้ว")
 *
 * @param {string} replyToken
 * @param {string} eventType - "coord" | "photo" | "house"
 * @param {number} rowIndex - จาก saveOrUpdateLocationData/HouseNumber/linkPhoto
 */
function sendPikadSessionReply(replyToken, eventType, rowIndex) {
  const saveMsg =
    getConfig("LOC_SAVE_MSG_TEXT") ||
    getConfig("LOCATION_REPLY_MSG") ||
    "บันทึกข้อมูลแล้ว";

  try {
    if (!replyToken) {
      Logger.log("sendPikadSessionReply skipped: missing replyToken eventType=" + eventType + " rowIndex=" + rowIndex);
      return { sent: false, skipped: true, reason: "missing_replyToken" };
    }

    const replyStatus = String(getConfig("LOC_SAVE_MSG_STATUS") || "ON").toUpperCase();
    if (replyStatus === "OFF") {
      Logger.log("sendPikadSessionReply skipped: LOC_SAVE_MSG_STATUS=OFF");
      return { sent: false, skipped: true, reason: "LOC_SAVE_MSG_STATUS_OFF" };
    }

    // ถ้าผู้ใช้ปิด Flex ใน config → ส่งแค่ text
    const useFlex = String(getConfig("PIKAD_USE_FLEX") || "ON").trim().toUpperCase() === "ON";
    Logger.log("sendPikadSessionReply start: eventType=" + eventType + " rowIndex=" + rowIndex + " useFlex=" + useFlex);

    if (!useFlex) {
      const textRes = _linePost("https://api.line.me/v2/bot/message/reply", {
        replyToken: replyToken,
        messages: [{ type: "text", text: saveMsg }]
      });
      Logger.log("Pikad text reply HTTP " + textRes.responseCode + " Body: " + (textRes.body || ""));
      return textRes;
    }

    // ดึงสถานะ
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
    if (!sheet || rowIndex <= 0) {
      const fallbackRes = _linePost("https://api.line.me/v2/bot/message/reply", {
        replyToken: replyToken,
        messages: [{ type: "text", text: saveMsg }]
      });
      Logger.log("Pikad fallback text reply HTTP " + fallbackRes.responseCode + " reason=missing_sheet_or_row Body: " + (fallbackRes.body || ""));
      return fallbackRes;
    }

    const status = _getSessionStatus(sheet, rowIndex);
    Logger.log("Pikad status: complete=" + !!status.complete +
      " hasCoord=" + !!status.hasCoord +
      " hasPhoto=" + !!status.hasPhoto +
      " hasHouseNum=" + !!status.hasHouseNum);
    const flex = buildPikadSessionFlex(eventType, status);

    const flexRes = _linePost("https://api.line.me/v2/bot/message/reply", {
      replyToken: replyToken,
      messages: [flex]
    });
    Logger.log("Pikad flex reply HTTP " + flexRes.responseCode + " Body: " + (flexRes.body || ""));
    if (flexRes.responseCode !== 200) {
      Logger.log("Pikad flex failed, trying text fallback");
      try {
        const fallbackTextRes = _linePost("https://api.line.me/v2/bot/message/reply", {
          replyToken: replyToken,
          messages: [{ type: "text", text: saveMsg }]
        });
        Logger.log("Pikad fallback after flex HTTP " + fallbackTextRes.responseCode + " Body: " + (fallbackTextRes.body || ""));
      } catch (fallbackErr) {
        Logger.log("Pikad fallback after flex error: " + fallbackErr.message);
      }
    }
    return flexRes;
  } catch (e) {
    Logger.log("sendPikadSessionReply error: " + e.message);
    try {
      const errFallbackRes = _linePost("https://api.line.me/v2/bot/message/reply", {
        replyToken: replyToken,
        messages: [{ type: "text", text: saveMsg }]
      });
      Logger.log("Pikad error fallback HTTP " + errFallbackRes.responseCode + " Body: " + (errFallbackRes.body || ""));
      return errFallbackRes;
    } catch (e2) {
      Logger.log("sendPikadSessionReply fallback error: " + e2.message);
      return { sent: false, error: e.message, fallbackError: e2.message };
    }
  }
}


/* ══════════════════════════════════════════════════════════════
 * PART 5: AUTO-CLOSE EXPIRED SESSIONS
 * ══════════════════════════════════════════════════════════════ */

/**
 * ⏰ ปิด session ที่หมดอายุ (เรียกจาก trigger ทุก 1 นาที)
 * - Session ที่เกินเวลาที่ตั้งไว้ (ไม่เกิน 2 นาที) + ยังไม่ครบ → mark เป็น expired
 * - ไม่แก้ข้อมูลจริง (ปล่อยที่มีไว้ตามเดิม)
 */
function closePikadExpiredSessions() {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
    if (!sheet || sheet.getLastRow() < 2) return;
    _ensurePikadStatusColumn_(sheet);

    const sessionMin = _getPikadSessionMinutes_();
    const cutoff = new Date(Date.now() - sessionMin * 60 * 1000);
    const lookbackCutoff = new Date(Date.now() - Math.max(sessionMin + 30, 30) * 60 * 1000);

    const data = sheet.getDataRange().getValues();
    const photoLocMap = _buildPhotoLocIdMap_();
    let expired = 0;

    for (let i = 1; i < data.length; i++) {
      const rowTime = new Date(data[i][1]);
      if (isNaN(rowTime.getTime())) continue;
      if (rowTime < lookbackCutoff) continue;
      if (rowTime >= cutoff) continue; // ยังไม่หมด

      const groupId = String(data[i][7] || "");
      const sessionStatus = String(data[i][8] || "");
      if (sessionStatus.indexOf("[EXPIRED]") >= 0) continue; // ปิดแล้ว

      const houseNum = String(data[i][3] || "").trim();
      const lat = String(data[i][4] || "").trim();
      const hasPhoto = _isPhotoLinkedToRow(sheet, i + 1, photoLocMap);

      // ถ้ายังขาดบาง field → mark expired
      if (!houseNum || !lat || !hasPhoto) {
        sheet.getRange(i + 1, 9).setValue("[EXPIRED]");
        expired++;
      }
    }

    if (expired > 0) Logger.log("⏰ Closed " + expired + " expired sessions");
    return { closed: expired };
  } catch (e) {
    Logger.log("closePikadExpiredSessions error: " + e.message);
    return { error: e.message };
  }
}


/* ══════════════════════════════════════════════════════════════
 * PART 6: TEST FUNCTIONS
 * ══════════════════════════════════════════════════════════════ */

/**
 * 🧪 ทดสอบ session flow ทั้งหมด (รันใน editor)
 */
function testPikadSessionFlow() {
  const testUserId = "TEST_USER_" + Date.now();
  const results = [];

  try {
    // Step 1: ส่งพิกัด
    const r1 = saveOrUpdateLocationData(testUserId, 14.80550, 100.61440, "ทดสอบ", "");
    results.push({ step: "coord", rowIndex: r1.rowIndex, status: r1.status });

    Utilities.sleep(500);

    // Step 2: ส่งเลขบ้าน
    const r2 = saveOrUpdateHouseNumber(testUserId, "123/1", "");
    results.push({ step: "house", rowIndex: r2.rowIndex, status: r2.status });

    // ตรวจว่าเป็น row เดียวกัน (session merge ทำงาน)
    const merged = r1.rowIndex === r2.rowIndex;
    Logger.log("✅ Merge: " + (merged ? "OK" : "FAIL"));

    Utilities.sleep(500);

    // Step 3: Build Flex
    const flex = buildPikadSessionFlex("house", r2.status);
    Logger.log("✅ Flex built: " + flex.altText);

    return { success: true, merged: merged, results: results, flex: flex };
  } catch (e) {
    return { success: false, error: e.message, results: results };
  }
}


/**
 * 🧪 ทดสอบ Flex รูปแบบต่างๆ (รันเพื่อดู altText)
 */
function testPikadFlexVariants() {
  const variants = [
    {
      name: "เฉพาะพิกัด",
      status: {
        locId: "TEST1", hasCoord: true, hasPhoto: false, hasHouseNum: false,
        complete: false, lat: 14.80550, lng: 100.61440, houseNum: "", photoUrl: "",
        expiresInSec: 165, expiresAt: "23:45:00", sessionMin: 3
      },
      eventType: "coord"
    },
    {
      name: "พิกัด+รูป",
      status: {
        locId: "TEST2", hasCoord: true, hasPhoto: true, hasHouseNum: false,
        complete: false, lat: 14.80550, lng: 100.61440, houseNum: "", photoUrl: "https://test",
        expiresInSec: 120, expiresAt: "23:45:00", sessionMin: 3
      },
      eventType: "photo"
    },
    {
      name: "ครบ 3 อย่าง",
      status: {
        locId: "TEST3", hasCoord: true, hasPhoto: true, hasHouseNum: true,
        complete: true, lat: 14.80550, lng: 100.61440, houseNum: "123/1", photoUrl: "https://test",
        expiresInSec: 60, expiresAt: "23:45:00", sessionMin: 3
      },
      eventType: "house"
    }
  ];

  const results = variants.map(v => {
    const flex = buildPikadSessionFlex(v.eventType, v.status);
    return { name: v.name, altText: flex.altText, ok: !!flex.contents };
  });

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}


/**
 * 🧪 ทดสอบ auto-close (รันเพื่อดูว่ามี session หมดอายุไหม)
 */
function testPikadAutoClose() {
  const result = closePikadExpiredSessions();
  Logger.log("Auto close result: " + JSON.stringify(result));
  return result;
}
