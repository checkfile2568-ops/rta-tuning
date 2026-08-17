/*
 * FIXED_HealthCheck.js
 *
 * Health check ฉบับขยายแบบอ่านอย่างเดียว
 * ไม่สร้าง trigger, ไม่แก้ config, ไม่ reset state และไม่ส่งข้อความ LINE
 */

function fixedHealthText_(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function fixedHealthConfig_(key, fallbackValue) {
  try {
    if (typeof getConfig === "function") {
      var value = getConfig(key);
      if (value !== null && value !== undefined && fixedHealthText_(value) !== "") return value;
    }
  } catch (error) {
    return fallbackValue;
  }
  return fallbackValue;
}

function fixedHealthItem_(name, ok, value, detail, severity) {
  return {
    name: name,
    ok: !!ok,
    value: value === undefined ? "" : value,
    detail: detail || "",
    severity: severity || (ok ? "OK" : "WARN")
  };
}

function fixedHealthTriggerRows_() {
  var triggers = [];
  try {
    triggers = ScriptApp.getProjectTriggers();
  } catch (error) {
    return { success: false, error: error.message, rows: [] };
  }

  var rows = triggers.map(function(trigger) {
    var handler = "";
    var eventType = "";
    var source = "";
    try {
      handler = fixedHealthText_(trigger.getHandlerFunction());
      eventType = fixedHealthText_(trigger.getEventType());
      source = fixedHealthText_(trigger.getTriggerSource());
    } catch (error) {
      handler = "unknown";
    }
    return { handler: handler, eventType: eventType, source: source };
  });

  return { success: true, rows: rows };
}

function fixedHealthFindHandlers_(rows, handlers) {
  var result = {};
  handlers.forEach(function(handler) {
    result[handler] = rows.filter(function(row) { return row.handler === handler; }).length;
  });
  return result;
}

function fixedHealthReadRecentNotifyLog_(limit) {
  var maxRows = Math.max(1, Math.min(Number(limit) || 10, 50));
  try {
    if (typeof SPREADSHEET_ID === "undefined" || typeof SHEETS === "undefined" || !SHEETS.NOTIFY_LOG) {
      return { success: false, error: "ไม่พบ Spreadsheet constants", rows: [] };
    }
    var ss = typeof _getSS === "function" ? _getSS() : SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEETS.NOTIFY_LOG);
    if (!sheet || sheet.getLastRow() < 2) return { success: true, rows: [] };

    var firstRow = Math.max(2, sheet.getLastRow() - maxRows + 1);
    var rowCount = sheet.getLastRow() - firstRow + 1;
    var values = sheet.getRange(firstRow, 1, rowCount, Math.min(sheet.getLastColumn(), 9)).getDisplayValues();
    return {
      success: true,
      rows: values.reverse().map(function(row) {
        return {
          id: row[0] || "",
          time: row[1] || "",
          title: row[2] || "",
          bodyPreview: fixedHealthText_(row[3] || "").substring(0, 160),
          targets: row[4] || "",
          recipientCount: row[5] || "",
          status: row[6] || "",
          source: row[8] || ""
        };
      })
    };
  } catch (error) {
    return { success: false, error: error.message, rows: [] };
  }
}

function fixedHealthLineConfig_() {
  var tokenConfigured = false;
  var secretConfigured = false;
  try {
    tokenConfigured = !!PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_ACCESS_TOKEN");
    secretConfigured = !!PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_SECRET");
  } catch (ignore) {
  }
  return {
    tokenConfigured: tokenConfigured,
    secretConfigured: secretConfigured,
    notifyStatus: fixedHealthText_(fixedHealthConfig_("NOTIFY_STATUS", "")),
    tvNotifyStatus: fixedHealthText_(fixedHealthConfig_("TV_NOTIFY_STATUS", "")),
    forceNotify: fixedHealthText_(fixedHealthConfig_("FORCE_NOTIFY", "")),
    tvNotifyTargetsConfigured: !!fixedHealthText_(fixedHealthConfig_("TV_NOTIFY_TARGETS", "")),
    tvNotifyUrlConfigured: !!fixedHealthText_(fixedHealthConfig_("TV_NOTIFY_URL", ""))
  };
}

function fixedHealthStateSummary_() {
  var key = "tv_notify_last_states";
  try {
    if (typeof TV_NOTIFY_STATE_KEY !== "undefined" && TV_NOTIFY_STATE_KEY) key = String(TV_NOTIFY_STATE_KEY);
  } catch (ignore) {
  }

  try {
    var raw = PropertiesService.getScriptProperties().getProperty(key);
    if (!raw) return { configured: false, key: key, deviceCount: 0, onlineCount: 0 };
    var parsed = JSON.parse(raw);
    var ids = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed) : [];
    var online = ids.filter(function(id) { return parsed[id] && parsed[id].online; }).length;
    return { configured: true, key: key, deviceCount: ids.length, onlineCount: online };
  } catch (error) {
    return { configured: false, key: key, deviceCount: 0, onlineCount: 0, error: error.message };
  }
}

function runExtendedHealthCheck_FIXED() {
  var startedAt = new Date();
  var result = {
    success: true,
    readOnly: true,
    checkedAt: Utilities.formatDate(startedAt, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
    items: [],
    triggers: [],
    notificationLog: [],
    config: {},
    tvState: {},
    warnings: [],
    errors: []
  };

  try {
    if (typeof SPREADSHEET_ID === "undefined" || !SPREADSHEET_ID) {
      result.errors.push("ไม่พบ SPREADSHEET_ID");
    } else {
      try {
        var spreadsheet = typeof _getSS === "function" ? _getSS() : SpreadsheetApp.openById(SPREADSHEET_ID);
        result.items.push(fixedHealthItem_("Spreadsheet หลัก", !!spreadsheet, spreadsheet ? spreadsheet.getName() : "", "อ่านอย่างเดียว", spreadsheet ? "OK" : "ERROR"));
      } catch (spreadsheetError) {
        result.items.push(fixedHealthItem_("Spreadsheet หลัก", false, "", spreadsheetError.message, "ERROR"));
        result.errors.push(spreadsheetError.message);
      }
    }

    var triggerResult = fixedHealthTriggerRows_();
    result.triggers = triggerResult.rows;
    if (!triggerResult.success) {
      result.items.push(fixedHealthItem_("Script Triggers", false, "อ่านไม่ได้", triggerResult.error, "ERROR"));
      result.errors.push(triggerResult.error);
    } else {
      var requiredHandlers = [
        "checkTVStatusAndNotify",
        "runScheduledNotify_v2",
        "runScheduledNotify",
        "checkAndNotify",
        "closePikadExpiredSessions",
        "warmUp"
      ];
      var counts = fixedHealthFindHandlers_(triggerResult.rows, requiredHandlers);
      var tvCount = counts.checkTVStatusAndNotify;
      var v2Count = counts.runScheduledNotify_v2;
      var legacyScheduleCount = counts.runScheduledNotify;
      var legacyFlexCount = counts.checkAndNotify;
      var scheduleRunnerCount = v2Count + legacyScheduleCount + legacyFlexCount;

      result.items.push(fixedHealthItem_("Court TV Trigger", tvCount === 1, tvCount, tvCount === 1 ? "มี trigger เดียว" : "ควรมี 1 trigger checkTVStatusAndNotify", tvCount === 1 ? "OK" : "WARN"));
      result.items.push(fixedHealthItem_("Scheduled Notify Runner", scheduleRunnerCount === 1 && v2Count === 1, scheduleRunnerCount, scheduleRunnerCount === 1 && v2Count === 1 ? "ใช้ runScheduledNotify_v2 เพียงชุดเดียว" : "พบ runner ซ้ำหรือยังไม่ได้ใช้ v2 เป็นตัวหลัก", scheduleRunnerCount === 1 && v2Count === 1 ? "OK" : "WARN"));
      result.items.push(fixedHealthItem_("Pikad Expiry Trigger", counts.closePikadExpiredSessions === 1, counts.closePikadExpiredSessions, "ตรวจ trigger ปิด session หมดอายุ", counts.closePikadExpiredSessions === 1 ? "OK" : "WARN"));
      result.items.push(fixedHealthItem_("Warm-up Trigger", counts.warmUp <= 1, counts.warmUp, "ไม่ควรมี warmUp ซ้ำหลายชุด", counts.warmUp <= 1 ? "OK" : "WARN"));

      if (scheduleRunnerCount !== 1 || v2Count !== 1) {
        result.warnings.push("Scheduled notification runner ไม่เป็น runScheduledNotify_v2 เพียงหนึ่งชุด");
      }
      if (tvCount !== 1) result.warnings.push("Court TV Trigger ต้องตรวจให้เหลือหนึ่งชุด");
      if (counts.runScheduledNotify > 0 || counts.checkAndNotify > 0) result.warnings.push("ยังมี legacy scheduled runner trigger");
    }

    result.config = fixedHealthLineConfig_();
    result.items.push(fixedHealthItem_("LINE Channel Access Token", result.config.tokenConfigured, result.config.tokenConfigured ? "configured" : "missing", "ไม่แสดง token จริง", result.config.tokenConfigured ? "OK" : "ERROR"));
    result.items.push(fixedHealthItem_("LINE Channel Secret", result.config.secretConfigured, result.config.secretConfigured ? "configured" : "missing", "จำเป็นสำหรับ HMAC webhook", result.config.secretConfigured ? "OK" : "ERROR"));
    result.items.push(fixedHealthItem_("TV Notify URL", result.config.tvNotifyUrlConfigured, result.config.tvNotifyUrlConfigured ? "configured" : "missing", "อ่านจาก config เท่านั้น", result.config.tvNotifyUrlConfigured ? "OK" : "WARN"));
    result.items.push(fixedHealthItem_("TV Notify Targets", result.config.tvNotifyTargetsConfigured, result.config.tvNotifyTargetsConfigured ? "configured" : "missing", "อ่านจาก config เท่านั้น", result.config.tvNotifyTargetsConfigured ? "OK" : "WARN"));

    result.tvState = fixedHealthStateSummary_();
    result.items.push(fixedHealthItem_("Court TV State", !result.tvState.error, result.tvState.deviceCount + " devices, " + result.tvState.onlineCount + " online", result.tvState.error || "อ่าน Script Properties แบบ read-only", result.tvState.error ? "WARN" : "OK"));

    var logResult = fixedHealthReadRecentNotifyLog_(10);
    result.notificationLog = logResult.rows;
    result.items.push(fixedHealthItem_("Notification Log", logResult.success, logResult.rows.length + " recent rows", logResult.error || "อ่านรายการล่าสุดแบบ read-only", logResult.success ? "OK" : "WARN"));

    result.warnings.forEach(function() { result.success = false; });
    result.errors.forEach(function() { result.success = false; });
    result.finishedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    return result;
  } catch (error) {
    result.success = false;
    result.errors.push(error.message);
    result.finishedAt = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    return result;
  }
}

function quickDiagnostic_FIXED() {
  var report = runExtendedHealthCheck_FIXED();
  return {
    success: report.success,
    checkedAt: report.checkedAt,
    readOnly: report.readOnly,
    warnings: report.warnings,
    errors: report.errors,
    items: report.items
  };
}
