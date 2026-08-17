/*
 * FIXED_TriggerControl.js
 *
 * ควบคุม Trigger แบบ explicit โดยไม่รันอัตโนมัติเมื่อเพิ่มไฟล์
 * เป้าหมาย:
 * - Court TV: checkTVStatusAndNotify ทุก 1 นาที เมื่อ TV_NOTIFY_STATUS=ON
 * - Scheduled Notify: runScheduledNotify_v2 ทุก 5 นาที เมื่อ NOTIFY_STATUS=ON
 * - Pikad expiry: closePikadExpiredSessions ทุก 1 นาที
 * - warm-up: warmUp ทุก 10 นาที
 * - ลบ runner เก่าที่ซ้ำ: runScheduledNotify และ checkAndNotify
 *
 * ฟังก์ชันนี้เขียนเฉพาะ Trigger ไม่แก้แถว/ค่าใน Spreadsheet
 */

var FIXED_TRIGGER_OLD_RUNNERS_ = [
  "runScheduledNotify",
  "checkAndNotify"
];

function fixedTriggerNames_() {
  return [
    "checkTVStatusAndNotify",
    "runScheduledNotify_v2",
    "closePikadExpiredSessions",
    "warmUp"
  ];
}

function fixedDeleteTriggerHandlers_(handlers) {
  var wanted = {};
  (handlers || []).forEach(function(handler) { wanted[String(handler)] = true; });
  var deleted = [];
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();
    if (wanted[handler]) {
      ScriptApp.deleteTrigger(trigger);
      deleted.push(handler);
    }
  });
  return deleted;
}

function fixedCreateMinuteTriggerIf_(handler, enabled) {
  if (!enabled) return false;
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(1).create();
  return true;
}

function fixedCreateFiveMinuteTriggerIf_(handler, enabled) {
  if (!enabled) return false;
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(5).create();
  return true;
}

function fixedCreateTenMinuteTriggerIf_(handler, enabled) {
  if (!enabled) return false;
  ScriptApp.newTrigger(handler).timeBased().everyMinutes(10).create();
  return true;
}

function setupFixedTriggers() {
  var deleted = fixedDeleteTriggerHandlers_(
    FIXED_TRIGGER_OLD_RUNNERS_.concat(fixedTriggerNames_())
  );
  var tvEnabled = typeof getConfig === "function" && String(getConfig("TV_NOTIFY_STATUS") || "OFF").toUpperCase() === "ON";
  var notifyEnabled = typeof getConfig === "function" && String(getConfig("NOTIFY_STATUS") || "OFF").toUpperCase() === "ON";
  var created = [];

  if (fixedCreateMinuteTriggerIf_("checkTVStatusAndNotify", tvEnabled)) {
    created.push("checkTVStatusAndNotify");
  }
  if (fixedCreateFiveMinuteTriggerIf_("runScheduledNotify_v2", notifyEnabled)) {
    created.push("runScheduledNotify_v2");
  }
  if (typeof closePikadExpiredSessions === "function" && fixedCreateMinuteTriggerIf_("closePikadExpiredSessions", true)) {
    created.push("closePikadExpiredSessions");
  }
  if (typeof warmUp === "function" && fixedCreateTenMinuteTriggerIf_("warmUp", true)) {
    created.push("warmUp");
  }

  return {
    success: true,
    deleted: deleted,
    created: created,
    settings: {
      TV_NOTIFY_STATUS: tvEnabled ? "ON" : "OFF",
      NOTIFY_STATUS: notifyEnabled ? "ON" : "OFF"
    },
    message: "ตั้ง Trigger หลักแล้ว กรุณาตรวจ auditFixedTriggers() ต่อ"
  };
}

function auditFixedTriggers() {
  var expected = {};
  var tvEnabled = typeof getConfig === "function" && String(getConfig("TV_NOTIFY_STATUS") || "OFF").toUpperCase() === "ON";
  var notifyEnabled = typeof getConfig === "function" && String(getConfig("NOTIFY_STATUS") || "OFF").toUpperCase() === "ON";
  expected.checkTVStatusAndNotify = tvEnabled;
  expected.runScheduledNotify_v2 = notifyEnabled;
  expected.closePikadExpiredSessions = typeof closePikadExpiredSessions === "function";
  expected.warmUp = typeof warmUp === "function";

  var actual = {};
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    var handler = trigger.getHandlerFunction();
    actual[handler] = (actual[handler] || 0) + 1;
  });

  var rows = [];
  Object.keys(expected).forEach(function(handler) {
    var count = actual[handler] || 0;
    rows.push({
      handler: handler,
      expected: expected[handler] ? "ON" : "OFF",
      actualCount: count,
      status: expected[handler] ? (count === 1 ? "OK" : "CHECK") : (count === 0 ? "OK" : "CHECK")
    });
  });
  FIXED_TRIGGER_OLD_RUNNERS_.forEach(function(handler) {
    rows.push({
      handler: handler,
      expected: "ABSENT",
      actualCount: actual[handler] || 0,
      status: (actual[handler] || 0) === 0 ? "OK" : "DUPLICATE"
    });
  });

  return {
    success: rows.every(function(row) { return row.status === "OK"; }),
    rows: rows,
    allHandlers: actual,
    checkedAt: new Date().toISOString()
  };
}
