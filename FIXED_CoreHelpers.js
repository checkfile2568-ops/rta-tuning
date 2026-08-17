/*
 * FIXED_CoreHelpers.js
 *
 * ฉบับแก้ไขแยกจากโค้ดเดิมของ LINE Chatbot ศาลจังหวัดลพบุรี
 *
 * จุดประสงค์:
 * 1. แก้ getAdminIds ที่เรียก split กับค่าที่ไม่ใช่ string
 * 2. รวม LINE transport ที่มี retry สำหรับ 429/5xx
 * 3. เพิ่ม fallback push เมื่อ reply token ใช้ไม่ได้
 * 4. ตรวจผลการส่งจริงก่อนนับ Court TV sentCount
 * 5. คงชื่อชีต, config key, state key และรูปแบบข้อความเดิม
 *
 * คำเตือน:
 * ไฟล์นี้เป็นไฟล์แยกสำหรับ staging/review และยังไม่ควรนำไปวางทับ
 * production โดยตรง อ่าน FIXED_Guide_TH.md ก่อนติดตั้งทุกครั้ง
 */

var FIXED_CORE_ADMIN_CACHE_ = null;
var FIXED_CORE_ADMIN_CACHE_TIME_ = 0;
var FIXED_CORE_ADMIN_CACHE_TTL_ = 60000;

var FIXED_CORE_LINE_MAX_ATTEMPTS_ = 3;
var FIXED_CORE_LINE_BASE_DELAY_MS_ = 1000;

function fixedCoreNow_() {
  return new Date().getTime();
}

function fixedCoreText_(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function fixedCoreTrim_(value) {
  return fixedCoreText_(value).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

function fixedCoreHasHttpSuccess_(response) {
  if (!response) return false;
  var code = Number(response.responseCode);
  return code >= 200 && code < 300;
}

function fixedCoreLog_(message) {
  try {
    Logger.log(String(message));
  } catch (ignore) {
  }
}

function fixedCoreGetLineToken_() {
  try {
    if (typeof getLineChannelAccessToken_ === "function") {
      var tokenFromHelper = fixedCoreTrim_(getLineChannelAccessToken_());
      if (tokenFromHelper) return tokenFromHelper;
    }
  } catch (helperError) {
    fixedCoreLog_("FIXED token helper error: " + helperError.message);
  }

  try {
    var tokenFromProperties = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_ACCESS_TOKEN");
    return fixedCoreTrim_(tokenFromProperties);
  } catch (propertyError) {
    fixedCoreLog_("FIXED token property error: " + propertyError.message);
    return "";
  }
}

function fixedCoreConfig_(key, fallbackValue) {
  try {
    if (typeof getConfig === "function") {
      var value = getConfig(key);
      if (value !== null && value !== undefined && String(value) !== "") return value;
    }
  } catch (error) {
    fixedCoreLog_("FIXED config read error for " + key + ": " + error.message);
  }
  return fallbackValue;
}

function fixedCoreSpreadsheet_() {
  try {
    if (typeof _getSS === "function") return _getSS();
  } catch (cacheError) {
    fixedCoreLog_("FIXED spreadsheet cache error: " + cacheError.message);
  }

  if (typeof SPREADSHEET_ID === "undefined" || !SPREADSHEET_ID) {
    throw new Error("ไม่พบ SPREADSHEET_ID");
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function fixedCoreMembersLineIds_() {
  var ids = [];
  try {
    if (typeof SHEETS === "undefined" || !SHEETS.MEMBERS) return ids;
    var ss = fixedCoreSpreadsheet_();
    var sheet = ss.getSheetByName(SHEETS.MEMBERS);
    if (!sheet || sheet.getLastRow() < 2) return ids;

    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
    rows.forEach(function(row) {
      var lineId = fixedCoreTrim_(row[1]);
      var role = fixedCoreTrim_(row[4]);
      var status = fixedCoreTrim_(row[5]).toLowerCase();
      if (!lineId) return;
      if (status === "blocked" || status === "ปิดใช้งาน" || status === "ปิด") return;
      if (role.toLowerCase() === "user") ids.push(lineId);
    });
  } catch (error) {
    fixedCoreLog_("FIXED members lookup error: " + error.message);
  }
  return ids;
}

function fixedCoreAppendNotifyLog_(title, body, targets, recipientCount, status, source) {
  try {
    if (typeof _logNotify === "function") {
      _logNotify(title, body, targets, recipientCount, status, source);
      return;
    }
  } catch (logError) {
    fixedCoreLog_("FIXED _logNotify error: " + logError.message);
  }
  fixedCoreLog_("NOTIFY " + status + " | targets=" + targets + " | count=" + recipientCount + " | source=" + source);
}

/* แก้ type error ของ implementation เดิม และรองรับ string/array/ค่าว่าง */
function getAdminIds() {
  var now = fixedCoreNow_();
  if (FIXED_CORE_ADMIN_CACHE_ !== null && (now - FIXED_CORE_ADMIN_CACHE_TIME_) < FIXED_CORE_ADMIN_CACHE_TTL_) {
    return FIXED_CORE_ADMIN_CACHE_.slice();
  }

  var raw = fixedCoreConfig_("ADMIN_LINE_IDS", "");
  var ids;

  if (Array.isArray(raw)) {
    ids = raw;
  } else if (raw === null || raw === undefined) {
    ids = [];
  } else if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    ids = fixedCoreText_(raw).split(/[,;\n\r]+/);
  } else if (raw && Array.isArray(raw.ids)) {
    ids = raw.ids;
  } else {
    ids = [];
  }

  FIXED_CORE_ADMIN_CACHE_ = ids
    .map(function(value) { return fixedCoreTrim_(value); })
    .filter(function(value) { return value.length > 0; });
  FIXED_CORE_ADMIN_CACHE_TIME_ = now;
  return FIXED_CORE_ADMIN_CACHE_.slice();
}

function fixedCoreClearAdminIdsCache_() {
  FIXED_CORE_ADMIN_CACHE_ = null;
  FIXED_CORE_ADMIN_CACHE_TIME_ = 0;
}

/*
 * LINE transport มาตรฐานฉบับแก้ไข
 * - retry เฉพาะ network exception, 429 และ 5xx
 * - ไม่ retry 4xx อื่น เพราะมักเป็น payload/permission ผิด
 * - คืนรูปแบบ {responseCode, body} เหมือน implementation เดิม
 */
function _linePost(url, payload) {
  var token = fixedCoreGetLineToken_();
  if (!token) {
    fixedCoreLog_("FIXED _linePost: ไม่พบ LINE_CHANNEL_ACCESS_TOKEN");
    return { responseCode: 0, body: "LINE_CHANNEL_ACCESS_TOKEN is not configured" };
  }

  var lastCode = 0;
  var lastBody = "";

  for (var attempt = 0; attempt < FIXED_CORE_LINE_MAX_ATTEMPTS_; attempt++) {
    try {
      var response = UrlFetchApp.fetch(url, {
        method: "post",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json"
        },
        payload: JSON.stringify(payload || {}),
        muteHttpExceptions: true,
        followRedirects: true
      });

      lastCode = Number(response.getResponseCode());
      lastBody = fixedCoreText_(response.getContentText());

      if (lastCode >= 200 && lastCode < 300) {
        if (attempt > 0) {
          fixedCoreLog_("FIXED _linePost success after retry " + (attempt + 1));
        }
        return { responseCode: lastCode, body: lastBody };
      }

      var retryable = lastCode === 429 || lastCode >= 500;
      if (!retryable || attempt >= FIXED_CORE_LINE_MAX_ATTEMPTS_ - 1) {
        fixedCoreLog_("FIXED _linePost HTTP " + lastCode + ": " + lastBody.substring(0, 300));
        return { responseCode: lastCode, body: lastBody };
      }

      var delayMs = FIXED_CORE_LINE_BASE_DELAY_MS_ * Math.pow(3, attempt);
      fixedCoreLog_("FIXED _linePost retry " + (attempt + 1) + " after HTTP " + lastCode + " in " + delayMs + " ms");
      Utilities.sleep(delayMs);
    } catch (error) {
      lastCode = -1;
      lastBody = fixedCoreText_(error && error.message ? error.message : error);
      fixedCoreLog_("FIXED _linePost exception attempt " + (attempt + 1) + ": " + lastBody);
      if (attempt >= FIXED_CORE_LINE_MAX_ATTEMPTS_ - 1) {
        return { responseCode: lastCode, body: lastBody };
      }
      Utilities.sleep(FIXED_CORE_LINE_BASE_DELAY_MS_ * Math.pow(3, attempt));
    }
  }

  return { responseCode: lastCode, body: lastBody };
}

function sendLineReply(replyToken, text) {
  return _linePost("https://api.line.me/v2/bot/message/reply", {
    replyToken: replyToken,
    messages: [{ type: "text", text: fixedCoreText_(text) }]
  });
}

function _lineBroadcast(text) {
  return _linePost("https://api.line.me/v2/bot/message/broadcast", {
    messages: [{ type: "text", text: fixedCoreText_(text) }]
  });
}

function _linePush(userOrGroupId, text) {
  return _linePost("https://api.line.me/v2/bot/message/push", {
    to: fixedCoreText_(userOrGroupId),
    messages: [{ type: "text", text: fixedCoreText_(text) }]
  });
}

function _lineMulticast(ids, text) {
  var recipients = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (recipients.length === 0) return { responseCode: 400, body: "No multicast recipients" };

  var allSuccessful = true;
  var lastResponse = { responseCode: 200, body: "" };
  for (var start = 0; start < recipients.length; start += 500) {
    var response = _linePost("https://api.line.me/v2/bot/message/multicast", {
      to: recipients.slice(start, start + 500),
      messages: [{ type: "text", text: fixedCoreText_(text) }]
    });
    lastResponse = response;
    if (!fixedCoreHasHttpSuccess_(response)) allSuccessful = false;
  }

  return {
    responseCode: allSuccessful ? 200 : Number(lastResponse.responseCode || 400),
    body: fixedCoreText_(lastResponse.body)
  };
}

/* Reply token หมดอายุได้ จึง fallback ไป push เมื่อมี userId */
function safeSendReply(replyToken, text, userIdFallback) {
  if (!replyToken || text === null || text === undefined || fixedCoreText_(text) === "") {
    fixedCoreLog_("FIXED safeSendReply: missing replyToken or text");
    return { responseCode: 0, body: "Missing replyToken or text" };
  }

  var replyResponse;
  try {
    replyResponse = sendLineReply(replyToken, fixedCoreText_(text));
    if (fixedCoreHasHttpSuccess_(replyResponse)) return replyResponse;
  } catch (replyError) {
    fixedCoreLog_("FIXED safeSendReply reply exception: " + replyError.message);
    replyResponse = { responseCode: -1, body: replyError.message };
  }

  var fallbackId = fixedCoreTrim_(userIdFallback);
  if (fallbackId) {
    fixedCoreLog_("FIXED safeSendReply: reply failed HTTP " + replyResponse.responseCode + ", fallback push");
    try {
      var pushResponse = _linePush(fallbackId, fixedCoreText_(text));
      if (!fixedCoreHasHttpSuccess_(pushResponse)) {
        fixedCoreLog_("FIXED safeSendReply fallback push failed HTTP " + pushResponse.responseCode);
      }
      return pushResponse;
    } catch (pushError) {
      fixedCoreLog_("FIXED safeSendReply fallback push exception: " + pushError.message);
    }
  } else {
    fixedCoreLog_("FIXED safeSendReply: reply failed and no fallback userId");
  }

  return replyResponse;
}

/*
 * Notification dispatcher มาตรฐาน
 * คง target syntax เดิม: all, admins, members, vip และรหัสผู้รับ LINE ที่ขึ้นต้นด้วย U, C หรือ R
 */
function sendLineNotification(payload) {
  var p = payload || {};
  var title = fixedCoreText_(p.title);
  var body = fixedCoreText_(p.body);
  var message = title ? title + "\n\n" + body : body;
  var source = fixedCoreText_(p.source || "Manual");
  var targets = p.targets === undefined || p.targets === null ? ["all"] : p.targets;

  if (fixedCoreText_(fixedCoreConfig_("NOTIFY_STATUS", "ON")).toUpperCase() === "OFF") {
    return { success: false, error: "ปิดแจ้งเตือน", recipientCount: 0 };
  }
  if (!message.trim()) {
    return { success: false, error: "ข้อความว่าง", recipientCount: 0 };
  }

  if (!Array.isArray(targets)) {
    targets = fixedCoreText_(targets).split(/[,;\n\r]+/);
  }
  targets = targets.map(function(value) { return fixedCoreTrim_(value); }).filter(Boolean);
  if (targets.length === 0) targets = ["all"];

  if (targets.some(function(target) { return target.toLowerCase() === "all"; })) {
    var broadcastResponse = _lineBroadcast(message);
    var broadcastOk = fixedCoreHasHttpSuccess_(broadcastResponse);
    fixedCoreAppendNotifyLog_(title, body, "all", -1, broadcastOk ? "ส่งแล้ว (Broadcast)" : "ล้มเหลว HTTP " + broadcastResponse.responseCode, source);
    return {
      success: broadcastOk,
      recipientCount: -1,
      responseCode: broadcastResponse.responseCode,
      error: broadcastOk ? "" : fixedCoreText_(broadcastResponse.body).substring(0, 300)
    };
  }

  var memberRows = [];
  try {
    if (typeof SHEETS !== "undefined" && SHEETS.MEMBERS) {
      var memberSheet = fixedCoreSpreadsheet_().getSheetByName(SHEETS.MEMBERS);
      if (memberSheet && memberSheet.getLastRow() >= 2) {
        memberRows = memberSheet.getRange(2, 1, memberSheet.getLastRow() - 1, 7).getValues();
      }
    }
  } catch (memberError) {
    fixedCoreLog_("FIXED notification member lookup error: " + memberError.message);
  }

  var resolvedIds = [];
  targets.forEach(function(target) {
    var lower = target.toLowerCase();
    if (lower === "admins") {
      resolvedIds = resolvedIds.concat(getAdminIds());
    } else if (lower === "members") {
      resolvedIds = resolvedIds.concat(memberRows.filter(function(row) {
        return fixedCoreTrim_(row[4]).toLowerCase() === "user" && fixedCoreTrim_(row[5]).toLowerCase() !== "blocked";
      }).map(function(row) { return fixedCoreTrim_(row[1]); }));
    } else if (lower === "vip") {
      resolvedIds = resolvedIds.concat(memberRows.filter(function(row) {
        return fixedCoreTrim_(row[4]).toUpperCase() === "VIP" && fixedCoreTrim_(row[5]).toLowerCase() !== "blocked";
      }).map(function(row) { return fixedCoreTrim_(row[1]); }));
    } else {
      resolvedIds.push(target);
    }
  });

  resolvedIds = Array.from(new Set(resolvedIds.map(function(id) { return fixedCoreTrim_(id); }).filter(Boolean)));
  if (resolvedIds.length === 0) {
    fixedCoreAppendNotifyLog_(title, body, targets.join(","), 0, "ไม่พบเป้าหมาย — ตรวจ ADMIN_LINE_IDS หรือชื่อ target", source);
    return { success: false, error: "ไม่พบเป้าหมาย", recipientCount: 0 };
  }

  var userIds = resolvedIds.filter(function(id) { return id.indexOf("U") === 0; });
  var nonUserIds = resolvedIds.filter(function(id) { return id.indexOf("U") !== 0; });
  var failed = [];

  if (userIds.length > 0) {
    var multicastResponse = _lineMulticast(userIds, message);
    if (!fixedCoreHasHttpSuccess_(multicastResponse)) failed.push("multicast(" + userIds.length + ")");
  }

  nonUserIds.forEach(function(id) {
    var pushResponse = _linePush(id, message);
    if (!fixedCoreHasHttpSuccess_(pushResponse)) failed.push(id);
  });

  var success = failed.length === 0;
  var status = success ? "ส่งแล้ว" : "ส่งบางส่วน — ล้มเหลว: " + failed.slice(0, 3).join(", ") + (failed.length > 3 ? " และอีก " + (failed.length - 3) : "");
  fixedCoreAppendNotifyLog_(title, body, targets.join(","), resolvedIds.length, status, source);
  return { success: success, recipientCount: resolvedIds.length, failed: failed };
}

function fixedCoreTvStateKey_() {
  try {
    if (typeof TV_NOTIFY_STATE_KEY !== "undefined" && TV_NOTIFY_STATE_KEY) return String(TV_NOTIFY_STATE_KEY);
  } catch (ignore) {
  }
  return "tv_notify_last_states";
}

function fixedCoreReadTvState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(fixedCoreTvStateKey_());
  if (!raw) return null;
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    fixedCoreLog_("FIXED TV state JSON invalid: " + error.message);
    return null;
  }
}

function fixedCoreWriteTvState_(state) {
  PropertiesService.getScriptProperties().setProperty(fixedCoreTvStateKey_(), JSON.stringify(state || {}));
}

function fixedCoreTvDateText_(date) {
  try {
    if (typeof _thaiDateLong === "function") return _thaiDateLong(date);
  } catch (ignore) {
  }
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function fixedCoreSendTvNotify_(type, clientId, info, data, targets) {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var timeText = Utilities.formatDate(now, tz, "HH:mm") + " น.";
  var dateText = fixedCoreTvDateText_(now);
  var idText = fixedCoreText_(clientId);
  var shortId = idText.length > 18 ? idText.substring(0, 18) + " (ย่อ)" : (idText || "ไม่ทราบรหัส");
  var onlineCount = data && typeof data.onlineCount === "number" ? data.onlineCount : 0;
  var courtName = data && data.courtName ? fixedCoreText_(data.courtName) : "ศาลจังหวัดลพบุรี";
  var message;

  if (type === "online") {
    message = "🟢 หน้าจอ TV เริ่มออนไลน์\n" +
      "━━━━━━━━━━━━━\n" +
      "📺 เครื่อง: " + shortId + "\n" +
      "⏰ เวลา: " + timeText + " (" + dateText + ")\n" +
      "📊 รวมเครื่อง Online: " + onlineCount + " เครื่อง\n" +
      "🏛 " + courtName;
  } else {
    var firstTime = "-";
    if (info && info.firstSeen) {
      try {
        firstTime = Utilities.formatDate(new Date(info.firstSeen), tz, "HH:mm") + " น.";
      } catch (ignoreDate) {
      }
    }
    message = "🔴 หน้าจอ TV ขาดการเชื่อมต่อ\n" +
      "━━━━━━━━━━━━━\n" +
      "📺 เครื่อง: " + shortId + "\n" +
      "⏰ Online ตั้งแต่: " + firstTime + "\n" +
      "⏰ ขาดการเชื่อมต่อเมื่อ: " + timeText + " (" + dateText + ")\n" +
      "📊 รวมเครื่อง Online: " + onlineCount + " เครื่อง\n" +
      "🏛 " + courtName;
  }

  var result = sendLineNotification({ title: "", body: message, targets: targets, source: "CourtTV" });
  return {
    success: !!(result && result.success),
    result: result,
    message: message
  };
}

/*
 * Court TV state machine ฉบับแก้ไข
 * คงช่วงเวลา 06:00-18:00 และ FORCE_NOTIFY เดิม
 * แตกต่างตรง sentCount จะเพิ่มเมื่อ dispatcher สำเร็จเท่านั้น
 */
function checkTVStatusAndNotify() {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(3000);
    if (!locked) {
      fixedCoreLog_("FIXED TV notify skipped: another runner holds the lock");
      return { success: false, skipped: true, reason: "lock" };
    }

    if (fixedCoreText_(fixedCoreConfig_("TV_NOTIFY_STATUS", "OFF")).toUpperCase() !== "ON") {
      return { success: true, skipped: true, reason: "TV_NOTIFY_STATUS_OFF", sentCount: 0 };
    }
    if (typeof fetchCourtTVStatus !== "function") {
      throw new Error("ไม่พบ fetchCourtTVStatus");
    }

    var data = fetchCourtTVStatus();
    if (!data || data.error) {
      var fetchMessage = data && data.error ? data.error : "Court TV response ว่าง";
      fixedCoreLog_("FIXED TV notify fetch error: " + fetchMessage);
      try {
        if (typeof logActivity === "function") logActivity("system", "TV-NOTIFY", "Fetch TV status ผิดพลาด", "FETCH_FAIL", "Error", 0);
      } catch (activityError) {
        fixedCoreLog_("FIXED TV activity log error: " + activityError.message);
      }
      return { success: false, error: fetchMessage, sentCount: 0 };
    }

    var previousStates = fixedCoreReadTvState_();
    var withinWindow = typeof _isCourtTVNotifyWindow_ === "function" ? _isCourtTVNotifyWindow_() : true;
    var forceNotify = typeof _isForceNotifyOn_ === "function" ? _isForceNotifyOn_() : false;
    var allowNotify = withinWindow || forceNotify;
    var currentStates = {};
    (Array.isArray(data.tv) ? data.tv : []).forEach(function(item) {
      if (!item || !item.clientId) return;
      currentStates[item.clientId] = {
        online: !!item.online,
        firstSeen: item.firstSeen || "",
        lastSeen: item.lastSeen || ""
      };
    });

    if (!previousStates) {
      fixedCoreWriteTvState_(currentStates);
      fixedCoreLog_("FIXED TV notify initialized state without sending");
      return { success: true, initialized: true, sentCount: 0 };
    }

    var targets = fixedCoreTrim_(fixedCoreConfig_("TV_NOTIFY_TARGETS", ""));
    if (!targets) {
      fixedCoreWriteTvState_(currentStates);
      fixedCoreLog_("FIXED TV notify skipped: no targets");
      return { success: false, error: "ยังไม่ได้ตั้ง target", sentCount: 0 };
    }

    var notifyOnline = fixedCoreText_(fixedCoreConfig_("TV_NOTIFY_ON_ONLINE", "ON")).toUpperCase() !== "OFF";
    var notifyOffline = fixedCoreText_(fixedCoreConfig_("TV_NOTIFY_ON_OFFLINE", "ON")).toUpperCase() !== "OFF";
    var sentCount = 0;
    var failedCount = 0;

    function tryNotify_(type, id, info) {
      if (!allowNotify) return;
      var result = fixedCoreSendTvNotify_(type, id, info, data, targets);
      if (result.success) sentCount++;
      else failedCount++;
    }

    Object.keys(currentStates).forEach(function(clientId) {
      var current = currentStates[clientId];
      var previous = previousStates[clientId];
      if (!allowNotify) return;
      if (current.online && notifyOnline && (!previous || !previous.online)) {
        tryNotify_("online", clientId, current);
      } else if (previous && previous.online && !current.online && notifyOffline) {
        tryNotify_("offline", clientId, current);
      }
    });

    Object.keys(previousStates).forEach(function(clientId) {
      if (allowNotify && !currentStates[clientId] && previousStates[clientId] && previousStates[clientId].online && notifyOffline) {
        tryNotify_("offline", clientId, previousStates[clientId]);
      }
    });

    fixedCoreWriteTvState_(currentStates);
    fixedCoreLog_("FIXED TV notify complete: sent=" + sentCount + ", failed=" + failedCount + ", allow=" + allowNotify);
    return { success: failedCount === 0, sentCount: sentCount, failedCount: failedCount, allowNotify: allowNotify };
  } catch (error) {
    fixedCoreLog_("FIXED checkTVStatusAndNotify error: " + error.message + "\n" + (error.stack || ""));
    return { success: false, error: fixedCoreText_(error.message || error), sentCount: 0 };
  } finally {
    if (locked) lock.releaseLock();
  }
}
