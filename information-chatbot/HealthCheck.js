/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  🏥 HealthCheck.gs v2.0 — Master Build v10.4.2                   ║
 * ║  🔧 v2.0 Fixes:                                                   ║
 * ║     • VIP_PWD → VIP_SECRET_CODE (5 จุด)                          ║
 * ║     • "permission_audit" → SHEETS.PERMISSION_AUDIT (4 จุด)       ║
 * ║                                                                   ║
 * ║  ⚠️ ต้องใช้คู่กับ Code_v10.4.2.gs ที่มี SHEETS.PERMISSION_AUDIT  ║
 * ║                                                                   ║
 * ║  ระบบ LINE Bot ศาลจังหวัดลพบุรี                                  ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  วัตถุประสงค์:                                                    ║
 * ║    🔧 แก้ปัญหา 3: ไม่มั่นใจว่าสิทธิ์ทำงานถูกต้อง                  ║
 * ║                                                                   ║
 * ║  ฟังก์ชันหลัก:                                                    ║
 * ║    • runMasterHealthCheck()  — ตรวจ 10 ด้านของระบบ                ║
 * ║    • checkUserPermission()   — ทดสอบสิทธิ์ของ user                ║
 * ║    • quickDiagnostic()       — ตรวจเร็ว (6 จุด)                   ║
 * ║    • exportHealthReport()    — สร้างรายงานสำหรับ Dashboard        ║
 * ║                                                                   ║
 * ║  วิธีใช้:                                                         ║
 * ║    1. เพิ่มไฟล์นี้ใน Apps Script (File → New → Script)            ║
 * ║    2. Save                                                        ║
 * ║    3. Run runMasterHealthCheck() ดูผลใน Logger                    ║
 * ║                                                                   ║
 * ║  ทดสอบ:                                                           ║
 * ║    • Run runMasterHealthCheck()  — ตรวจครบทุกด้าน                ║
 * ║    • Run quickDiagnostic()       — ตรวจเร็ว                       ║
 * ║    • Run testPermissionForCurrentUser() — สิทธิ์ของพี่             ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */


/* ════════════════════════════════════════════════════════════════════
 *  PART 1: PERMISSION HELPERS
 *  - Centralized permission checking (consistent across whole app)
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🔐 ตรวจว่า role ของ user คือ VIP หรือไม่ (case-insensitive + trim)
 * @param {Object} user - object จาก getUserByLineId()
 * @returns {boolean}
 */
function isVIP(user) {
  if (!user) return false;
  const role = String(user.role || "").trim().toUpperCase();
  return role === "VIP";
}

function getHealthCheckTestUserId_() {
  try {
    const admins = getAdminIds();
    if (admins && admins.length) return admins[0];
  } catch (e) {}
  return "TEST_USER_ID";
}


/**
 * 🔐 ตรวจว่า user สามารถใช้ "ค้นหา" ได้หรือไม่
 * @param {Object} user
 * @param {string} userId
 * @returns {boolean}
 */
function canSearch(user, userId) {
  return isVIP(user) || isAdmin(userId);
}


/**
 * 🔐 ตรวจว่า user สามารถใช้ "บัญชีนัดความ" ได้หรือไม่
 * @param {Object} user
 * @param {string} userId
 * @returns {boolean}
 */
function canUseCourt(user, userId) {
  const accessLevel = String(getConfig("COURT_ACCESS") || "vip").toLowerCase().trim();
  if (accessLevel === "admin") return isAdmin(userId);
  if (accessLevel === "vip") return isVIP(user) || isAdmin(userId);
  return true; // public
}


/**
 * 🔐 ตรวจว่า user สามารถใช้ "/แจ้งเตือน" ได้หรือไม่
 * @param {string} userId
 * @returns {boolean}
 */
function canBroadcast(userId) {
  return isAdmin(userId);
}


/**
 * 🔐 ตรวจว่า user สามารถสอน KB ได้หรือไม่
 * @param {string} userId
 * @returns {boolean}
 */
function canTeachKB(userId) {
  return isAdmin(userId);
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 2: USER PERMISSION TESTER
 *  - ทดสอบสิทธิ์ของ user แต่ละคน
 *  - ใช้ใน Dashboard "Permission Tester"
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🧪 ตรวจสิทธิ์ของ user คนหนึ่ง
 * @param {string} lineUserId
 * @returns {Object} ผลละเอียด
 */
function checkUserPermission(lineUserId) {
  if (!lineUserId) {
    return { success: false, error: "❌ กรุณาใส่ Line User ID" };
  }

  const lineUserIdTrim = String(lineUserId).trim();
  if (!lineUserIdTrim) {
    return { success: false, error: "❌ Line User ID ว่าง" };
  }

  try {
    // 1. หา user ใน Sheet
    const user = getUserByLineId(lineUserIdTrim);

    // 2. ตรวจ Admin
    const isAdminResult = isAdmin(lineUserIdTrim);
    const adminIds = getAdminIds();

    // 3. ถ้าไม่เจอ user
    if (!user) {
      return {
        success: true,
        userId: lineUserIdTrim,
        registered: false,
        isAdmin: isAdminResult,
        canDoWhat: {
          chat: true,
          knowledgeBase: true,
          search: isAdminResult,
          court: isAdminResult,
          broadcast: isAdminResult,
          teach: isAdminResult,
          adminCommands: isAdminResult
        },
        warnings: ["⚠️ ยังไม่ได้ลงทะเบียน — ต้องส่งรหัส VIP ใน Private Chat ก่อน"],
        recommendation: "ส่งรหัส VIP_SECRET_CODE = " + (getConfig("VIP_SECRET_CODE") || "ตั้งใน Sheet ตั้งค่า") + " ใน private chat"
      };
    }

    // 4. ตรวจ role
    const isVIPResult = isVIP(user);
    const isUser = String(user.role).toUpperCase() === "USER";
    const isActive = String(user.status).toLowerCase() === "active" ||
                     String(user.status).toLowerCase() === "ใช้งาน";

    // 5. รวบรวม warnings
    const warnings = [];
    if (!isActive) warnings.push("⚠️ Status ไม่ใช่ Active: " + user.status);
    if (isAdminResult && !isVIPResult) warnings.push("⚠️ เป็น Admin แต่ role ไม่ใช่ VIP — ควรอัปเดต");
    if (!isAdminResult && adminIds.length === 0) warnings.push("⚠️ ระบบไม่มี Admin เลย — กรุณาเพิ่ม");

    return {
      success: true,
      userId: lineUserIdTrim,
      registered: true,
      name: user.name || "(ไม่มีชื่อ)",
      role: user.role,
      status: user.status,
      isAdmin: isAdminResult,
      isVIP: isVIPResult,
      isUser: isUser,
      isActive: isActive,
      canDoWhat: {
        chat: true,
        knowledgeBase: true,
        search: canSearch(user, lineUserIdTrim),
        court: canUseCourt(user, lineUserIdTrim),
        broadcast: canBroadcast(lineUserIdTrim),
        teach: canTeachKB(lineUserIdTrim),
        adminCommands: isAdminResult
      },
      warnings: warnings.length ? warnings : null,
      adminIds: isAdminResult ? "เป็น Admin ✅" : "ไม่เป็น Admin (มี " + adminIds.length + " Admin)"
    };
  } catch (e) {
    return { success: false, error: "❌ Error: " + e.message };
  }
}


/**
 * 🧪 ทดสอบสิทธิ์ของ user ปัจจุบัน (ของพี่)
 */
function testPermissionForCurrentUser() {
  const myUserId = getHealthCheckTestUserId_();
  const result = checkUserPermission(myUserId);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 3: PERMISSION AUDIT LOG
 *  - บันทึกเมื่อ user พยายามทำสิ่งที่ไม่มีสิทธิ์
 *  - แสดงใน Dashboard
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 📝 Log permission denied event
 * @param {string} userId
 * @param {string} action - "search", "court", "broadcast", etc.
 * @param {string} reason
 */
function logPermissionDenied(userId, action, reason) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEETS.PERMISSION_AUDIT);
    if (!sheet) {
      sheet = ss.insertSheet(SHEETS.PERMISSION_AUDIT);
      sheet.appendRow(["Timestamp", "User ID", "Action", "Reason", "Role", "Status"]);
      sheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#1e3a8a").setFontColor("#ffffff");
      sheet.setColumnWidth(1, 160);
      sheet.setColumnWidth(2, 280);
      sheet.setColumnWidth(3, 100);
      sheet.setColumnWidth(4, 250);
      sheet.setColumnWidth(5, 80);
      sheet.setColumnWidth(6, 100);
    }

    const user = getUserByLineId(userId);
    sheet.appendRow([
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      userId,
      action,
      reason || "",
      user ? user.role : "ไม่ลงทะเบียน",
      user ? user.status : "-"
    ]);

    // เก็บไม่เกิน 1000 rows (เก่าสุดถูกลบ)
    const lr = sheet.getLastRow();
    if (lr > 1001) {
      sheet.deleteRows(2, lr - 1001);
    }
  } catch (e) {
    Logger.log("⚠️ logPermissionDenied error: " + e.message);
  }
}


/**
 * 📊 ดึง permission audit logs (สำหรับ Dashboard)
 * @param {number} limit
 * @returns {Array}
 */
function getPermissionAuditLogs(limit) {
  limit = parseInt(limit) || 50;
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.PERMISSION_AUDIT);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const data = sheet.getDataRange().getValues();
    return data.slice(1).reverse().slice(0, limit).map(r => ({
      timestamp: r[0] ? Utilities.formatDate(new Date(r[0]), Session.getScriptTimeZone(), "dd/MM HH:mm") : "",
      userId: r[1],
      action: r[2],
      reason: r[3],
      role: r[4],
      status: r[5]
    }));
  } catch (e) {
    return [];
  }
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 4: MASTER HEALTH CHECK
 *  - ตรวจระบบครบ 10 ด้าน
 *  - ใช้ใน Dashboard Health Status
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🏥 ตรวจระบบครบทุกด้าน
 * @returns {Object} { status, score, categories[] }
 */
function runMasterHealthCheck() {
  const startTime = Date.now();
  const categories = [];

  // ──────────────────────────────────────────────
  // 1. Spreadsheet & Sheets
  // ──────────────────────────────────────────────
  const cat1 = { name: "1. Google Spreadsheet", checks: [] };
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    cat1.checks.push({ name: "เปิด Spreadsheet ได้", ok: true });

    const requiredSheets = [
      SHEETS.MEMBERS, SHEETS.CONFIG, SHEETS.LOCATION,
      SHEETS.PHOTOS, SHEETS.KNOWLEDGE, SHEETS.ACTIVITY
    ];
    for (const name of requiredSheets) {
      const sheet = ss.getSheetByName(name);
      cat1.checks.push({
        name: "Sheet \"" + name + "\"",
        ok: !!sheet,
        detail: sheet ? "มี " + sheet.getLastRow() + " แถว" : "ไม่พบ"
      });
    }
  } catch (e) {
    cat1.checks.push({ name: "Spreadsheet", ok: false, detail: e.message });
  }
  categories.push(cat1);

  // ──────────────────────────────────────────────
  // 2. Configuration
  // ──────────────────────────────────────────────
  const cat2 = { name: "2. Configuration", checks: [] };
  const requiredConfigs = [
    { key: "BOT_STATUS", expected: "ON" },
    { key: "VIP_SECRET_CODE", expected: null }, // any non-empty
    { key: "ADMIN_LINE_IDS", expected: null },
    { key: "PIKAD_SYSTEM_URL", expected: null },
    { key: "PIKAD_SESSION_MINUTES", expected: null },
    { key: "COURT_STATUS", expected: null },
    { key: "COURT_SHEET_ID", expected: null },
    { key: "COURT_SHEET_NAME", expected: null }
  ];
  for (const cfg of requiredConfigs) {
    const val = getConfig(cfg.key);
    let ok = !!val;
    if (cfg.expected !== null && cfg.expected !== "") {
      ok = ok && (val === cfg.expected);
    }
    cat2.checks.push({
      name: cfg.key,
      ok: ok,
      detail: val ? (val.length > 30 ? val.substring(0, 30) + "..." : val) : "ว่าง"
    });
  }
  categories.push(cat2);

  // ──────────────────────────────────────────────
  // 3. LINE API
  // ──────────────────────────────────────────────
  const cat3 = { name: "3. LINE Bot API", checks: [] };
  try {
    const tokenSet = !!(typeof LINE_CHANNEL_ACCESS_TOKEN !== "undefined" && LINE_CHANNEL_ACCESS_TOKEN);
    cat3.checks.push({
      name: "LINE_CHANNEL_ACCESS_TOKEN",
      ok: tokenSet,
      detail: tokenSet ? "ตั้งแล้ว" : "ไม่ได้ตั้ง"
    });

    if (tokenSet) {
      // ทดสอบ API
      try {
        const res = UrlFetchApp.fetch("https://api.line.me/v2/bot/info", {
          method: "get",
          headers: { "Authorization": "Bearer " + LINE_CHANNEL_ACCESS_TOKEN },
          muteHttpExceptions: true
        });
        const code = res.getResponseCode();
        cat3.checks.push({
          name: "LINE API ทำงาน",
          ok: code === 200,
          detail: "HTTP " + code
        });
      } catch (e) {
        cat3.checks.push({ name: "LINE API ทำงาน", ok: false, detail: e.message });
      }
    }
  } catch (e) {
    cat3.checks.push({ name: "LINE", ok: false, detail: e.message });
  }
  categories.push(cat3);

  // ──────────────────────────────────────────────
  // 4. Triggers
  // ──────────────────────────────────────────────
  const cat4 = { name: "4. Triggers", checks: [] };
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const triggerNames = triggers.map(t => t.getHandlerFunction());

    cat4.checks.push({
      name: "warmUp",
      ok: true,
      detail: triggerNames.indexOf("warmUp") >= 0
        ? "ตั้งแล้ว"
        : "ยังไม่ตั้ง (Trigger ทางเลือก; รัน setupWarmUpTrigger หากต้องการกัน Cold Start)"
    });
    cat4.checks.push({
      name: "closePikadExpiredSessions",
      ok: triggerNames.indexOf("closePikadExpiredSessions") >= 0,
      detail: triggerNames.indexOf("closePikadExpiredSessions") >= 0 ? "ตั้งแล้ว" : "ยังไม่ตั้ง"
    });
    cat4.checks.push({
      name: "Total triggers",
      ok: true,
      detail: triggers.length + " trigger(s)"
    });
  } catch (e) {
    cat4.checks.push({ name: "Triggers", ok: false, detail: e.message });
  }
  categories.push(cat4);

  // ──────────────────────────────────────────────
  // 5. Permission System
  // ──────────────────────────────────────────────
  const cat5 = { name: "5. Permission System", checks: [] };
  try {
    const adminIds = getAdminIds();
    cat5.checks.push({
      name: "Admin IDs",
      ok: adminIds.length > 0,
      detail: adminIds.length + " Admin(s)"
    });

    const vipPwd = getConfig("VIP_SECRET_CODE");
    cat5.checks.push({
      name: "VIP Password",
      ok: !!vipPwd,
      detail: vipPwd ? "ตั้งแล้ว (***)" : "ไม่ได้ตั้ง"
    });

    // นับ user ในระบบ
    const memberSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.MEMBERS);
    if (memberSheet) {
      const lr = memberSheet.getLastRow();
      const count = lr > 1 ? lr - 1 : 0;
      const data = lr > 1 ? memberSheet.getRange(2, 1, lr - 1, 7).getValues() : [];
      const vipCount = data.filter(r => String(r[4]).trim().toUpperCase() === "VIP").length;
      cat5.checks.push({
        name: "Members",
        ok: count > 0,
        detail: count + " คน (VIP " + vipCount + ", User " + (count - vipCount) + ")"
      });
    }
  } catch (e) {
    cat5.checks.push({ name: "Permission", ok: false, detail: e.message });
  }
  categories.push(cat5);

  // ──────────────────────────────────────────────
  // 6. Knowledge Base
  // ──────────────────────────────────────────────
  const cat6 = { name: "6. Knowledge Base", checks: [] };
  try {
    const kbSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.KNOWLEDGE);
    if (kbSheet) {
      const lr = kbSheet.getLastRow();
      const count = lr > 1 ? lr - 1 : 0;
      cat6.checks.push({
        name: "Q&A entries",
        ok: count > 0,
        detail: count + " entries"
      });

      // ตรวจ active
      if (count > 0) {
        const data = kbSheet.getRange(2, 1, count, 7).getValues();
        const active = data.filter(r => {
          const s = String(r[5] || "").trim();
          return s === "Active" || s === "TRUE" || s === "ใช้งาน" || s === "1";
        }).length;
        cat6.checks.push({
          name: "Active entries",
          ok: active > 0,
          detail: active + " active"
        });
      }
    } else {
      cat6.checks.push({ name: "Knowledge Sheet", ok: false, detail: "ไม่พบ" });
    }
  } catch (e) {
    cat6.checks.push({ name: "KB", ok: false, detail: e.message });
  }
  categories.push(cat6);

  // ──────────────────────────────────────────────
  // 7. Court System (TV)
  // ──────────────────────────────────────────────
  const cat7 = { name: "7. Court System (บัญชีนัดความ)", checks: [] };
  try {
    const courtStatus = getConfig("COURT_STATUS");
    cat7.checks.push({
      name: "COURT_STATUS",
      ok: courtStatus === "ON",
      detail: courtStatus || "ว่าง"
    });

    if (courtStatus === "ON") {
      const courtId = getConfig("COURT_SHEET_ID");
      const sheetName = getConfig("COURT_SHEET_NAME") || "Database";
      if (courtId) {
        cat7.checks.push({
          name: "COURT_SHEET_ID",
          ok: true,
          detail: "ตั้งค่าแล้ว (" + sheetName + ") — ตรวจสิทธิ์แยกด้วย checkCourtSheetAccess"
        });
      } else {
        cat7.checks.push({ name: "COURT_SHEET_ID", ok: false, detail: "ไม่ได้ตั้ง" });
      }
    }
  } catch (e) {
    cat7.checks.push({ name: "Court", ok: false, detail: e.message });
  }
  categories.push(cat7);

  // ──────────────────────────────────────────────
  // 8. Pikad System
  // ──────────────────────────────────────────────
  const cat8 = { name: "8. Pikad System (พิกัด)", checks: [] };
  try {
    const pikadUrl = getConfig("PIKAD_SYSTEM_URL");
    cat8.checks.push({
      name: "PIKAD_SYSTEM_URL",
      ok: !!pikadUrl,
      detail: pikadUrl ? "ตั้งแล้ว" : "ว่าง"
    });

    const sessionMin = getConfig("PIKAD_SESSION_MINUTES");
    const effectiveSessionMin = (typeof _getPikadSessionMinutes_ === "function")
      ? _getPikadSessionMinutes_()
      : Math.min(parseInt(sessionMin, 10) || 2, 2);
    cat8.checks.push({
      name: "PIKAD_SESSION_MINUTES",
      ok: !!sessionMin,
      detail: sessionMin ? (sessionMin + " (ใช้งานจริง " + effectiveSessionMin + " นาที)") : "ว่าง"
    });

    // ตรวจฟังก์ชัน Pikad
    try {
      const result = typeof _findActiveSession === "function";
      cat8.checks.push({
        name: "Pikad functions loaded",
        ok: result,
        detail: result ? "พร้อมใช้" : "ไม่พบ — ต้องเพิ่ม PikadSession.gs"
      });
    } catch (e) {
      cat8.checks.push({ name: "Pikad functions", ok: false, detail: e.message });
    }
  } catch (e) {
    cat8.checks.push({ name: "Pikad", ok: false, detail: e.message });
  }
  categories.push(cat8);

  // ──────────────────────────────────────────────
  // 9. Smart Matching (KB + Search)
  // ──────────────────────────────────────────────
  const cat9 = { name: "9. Smart Matching", checks: [] };
  try {
    cat9.checks.push({
      name: "improvedKBSearch",
      ok: typeof improvedKBSearch === "function",
      detail: typeof improvedKBSearch === "function" ? "พร้อมใช้" : "ไม่พบ"
    });
    cat9.checks.push({
      name: "smartSearchAllDbs_v2",
      ok: typeof smartSearchAllDbs_v2 === "function",
      detail: typeof smartSearchAllDbs_v2 === "function" ? "พร้อมใช้" : "ไม่พบ"
    });
    cat9.checks.push({
      name: "detectDBHint",
      ok: typeof detectDBHint === "function",
      detail: typeof detectDBHint === "function" ? "พร้อมใช้" : "ไม่พบ"
    });
    cat9.checks.push({
      name: "Synonym table",
      ok: typeof SMART_SYNONYM_TABLE !== "undefined",
      detail: typeof SMART_SYNONYM_TABLE !== "undefined" ? Object.keys(SMART_SYNONYM_TABLE).length + " groups" : "ไม่พบ"
    });
  } catch (e) {
    cat9.checks.push({ name: "Smart Matching", ok: false, detail: e.message });
  }
  categories.push(cat9);

  // ──────────────────────────────────────────────
  // 10. Activity & Logging
  // ──────────────────────────────────────────────
  const cat10 = { name: "10. Logs & Statistics", checks: [] };
  try {
    const actSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.ACTIVITY);
    if (actSheet) {
      const lr = actSheet.getLastRow();
      cat10.checks.push({
        name: "Activity Log",
        ok: lr > 0,
        detail: (lr > 0 ? lr - 1 : 0) + " events"
      });
    }

    const notifySheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.NOTIFY_LOG);
    if (notifySheet) {
      const lr = notifySheet.getLastRow();
      cat10.checks.push({
        name: "Notify Log",
        ok: true,
        detail: (lr > 0 ? lr - 1 : 0) + " notifications"
      });
    }

    const auditSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.PERMISSION_AUDIT);
    if (auditSheet) {
      const lr = auditSheet.getLastRow();
      cat10.checks.push({
        name: "Permission Audit",
        ok: true,
        detail: (lr > 0 ? lr - 1 : 0) + " denied attempts"
      });
    }
  } catch (e) {
    cat10.checks.push({ name: "Logs", ok: false, detail: e.message });
  }
  categories.push(cat10);

  // ──────────────────────────────────────────────
  // คำนวณสรุป
  // ──────────────────────────────────────────────
  let totalChecks = 0;
  let passedChecks = 0;
  for (const cat of categories) {
    for (const check of cat.checks) {
      totalChecks++;
      if (check.ok) passedChecks++;
    }
  }

  const score = Math.round((passedChecks / totalChecks) * 100);
  let status, badge;
  if (score >= 90) { status = "Excellent"; badge = "🟢"; }
  else if (score >= 75) { status = "Good"; badge = "🟢"; }
  else if (score >= 60) { status = "Fair"; badge = "🟡"; }
  else if (score >= 40) { status = "Warning"; badge = "🟡"; }
  else { status = "Critical"; badge = "🔴"; }

  const result = {
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
    elapsed: Date.now() - startTime,
    status: status,
    badge: badge,
    score: score,
    passed: passedChecks,
    total: totalChecks,
    categories: categories
  };

  // Log สรุปสั้น ๆ
  Logger.log("🏥 Health Check: " + badge + " " + status + " (" + score + "%) — " +
             passedChecks + "/" + totalChecks + " checks passed in " + result.elapsed + "ms");

  return result;
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 5: QUICK DIAGNOSTIC
 *  - ตรวจเร็ว 6 จุดสำคัญ (สำหรับเรียกบ่อย)
 * ════════════════════════════════════════════════════════════════════ */

/**
 * ⚡ ตรวจเร็ว 6 จุด (ใช้ใน Dashboard ทุกครั้งโหลด)
 * @returns {Object}
 */
function quickDiagnostic() {
  const issues = [];
  const ok = [];

  try {
    // 1. Bot Status
    if (getConfig("BOT_STATUS") === "ON") ok.push("Bot ON");
    else issues.push({ severity: "error", msg: "Bot ปิดอยู่" });

    // 2. Admin
    const admins = getAdminIds();
    if (admins.length === 0) issues.push({ severity: "error", msg: "ยังไม่ได้ตั้ง Admin" });
    else ok.push("Admin " + admins.length + " คน");

    // 3. VIP Password
    if (!getConfig("VIP_SECRET_CODE")) issues.push({ severity: "warning", msg: "VIP_SECRET_CODE ว่าง" });
    else ok.push("VIP_SECRET_CODE ตั้งแล้ว");

    // 4. Pikad URL
    if (!getConfig("PIKAD_SYSTEM_URL")) issues.push({ severity: "warning", msg: "PIKAD_SYSTEM_URL ว่าง" });
    else ok.push("Pikad URL ตั้งแล้ว");

    // 5. Pikad Trigger
    const triggers = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
    if (triggers.indexOf("closePikadExpiredSessions") < 0) {
      issues.push({ severity: "warning", msg: "Pikad Trigger ยังไม่ตั้ง" });
    } else ok.push("Pikad Trigger OK");

    // 6. Warm-up
    if (triggers.indexOf("warmUp") < 0) {
      ok.push("warmUp ยังไม่ตั้ง (ทางเลือก)");
    } else ok.push("warmUp OK");
  } catch (e) {
    issues.push({ severity: "error", msg: "Error: " + e.message });
  }

  const errorCount = issues.filter(i => i.severity === "error").length;
  const warnCount = issues.filter(i => i.severity === "warning").length;

  let badge, status;
  if (errorCount > 0) { badge = "🔴"; status = "Critical"; }
  else if (warnCount > 0) { badge = "🟡"; status = "Warning"; }
  else { badge = "🟢"; status = "OK"; }

  return {
    badge: badge,
    status: status,
    okCount: ok.length,
    errorCount: errorCount,
    warningCount: warnCount,
    okList: ok,
    issues: issues,
    timestamp: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm:ss")
  };
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 6: KB & SEARCH TESTING (DETAILED)
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🧪 ทดสอบ Knowledge Base ด้วยคำถามตัวอย่าง
 */
function testKnowledgeBase() {
  if (typeof improvedKBSearch !== "function") {
    return { success: false, error: "❌ ต้องเพิ่ม SmartMatching.gs ก่อน" };
  }

  const testUserId = getHealthCheckTestUserId_();
  const tests = [
    "ลงทะเบียน",
    "การลงทะเบียน",
    "เวลาเปิดทำการ",
    "ค่าธรรมเนียม",
    "ติดต่อ"
  ];

  const results = [];
  for (const q of tests) {
    const start = Date.now();
    const ans = improvedKBSearch(q, "VIP", testUserId);
    results.push({
      query: q,
      found: !!ans,
      preview: ans ? String(ans).substring(0, 50) + "..." : "ไม่เจอ",
      ms: Date.now() - start
    });
  }

  Logger.log(JSON.stringify(results, null, 2));
  return { success: true, tests: results };
}


/**
 * 🧪 ทดสอบ Smart Search
 */
function testSmartSearch() {
  if (typeof smartSearchAllDbs_v2 !== "function") {
    return { success: false, error: "❌ ต้องเพิ่ม SmartMatching.gs ก่อน" };
  }

  const testUserId = getHealthCheckTestUserId_();
  const tests = [
    "พ123/2568",
    "พิกัด 123/1",
    "นาย สมชาย"
  ];

  const results = [];
  for (const q of tests) {
    const hint = detectDBHint(q);
    const start = Date.now();
    const result = smartSearchAllDbs_v2(q, "VIP", testUserId);
    results.push({
      query: q,
      hint: hint.hint,
      confidence: hint.confidence,
      found: !!result,
      ms: Date.now() - start
    });
  }

  Logger.log(JSON.stringify(results, null, 2));
  return { success: true, tests: results };
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 7: EXPORT FOR DASHBOARD
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 📊 Export health report สำหรับ Dashboard
 * @returns {Object}
 */
function exportHealthReport() {
  return {
    quick: quickDiagnostic(),
    full: runMasterHealthCheck()
  };
}


/**
 * 🎯 สรุปสถานะ HealthCheck
 */
function healthCheckStatus() {
  return {
    version: "1.0",
    functions: {
      permissionHelpers: ["isVIP", "canSearch", "canUseCourt", "canBroadcast", "canTeachKB"],
      tester: ["checkUserPermission", "testPermissionForCurrentUser"],
      audit: ["logPermissionDenied", "getPermissionAuditLogs"],
      health: ["runMasterHealthCheck", "quickDiagnostic", "exportHealthReport"],
      tests: ["testKnowledgeBase", "testSmartSearch"]
    }
  };
}
