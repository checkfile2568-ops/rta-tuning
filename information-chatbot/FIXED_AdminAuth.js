/*
 * FIXED_AdminAuth.js
 *
 * ชั้นตรวจสิทธิ์ Dashboard ฉบับแก้ไข
 * - รองรับ adminKey/key เดิมเพื่อไม่ทำลาย flow หน้า GitHub
 * - ไม่ใช้ WEB_ADMIN_KEY ของ Main Chatbot และไม่ตั้งค่า fallback ที่เป็นคีย์จริง
 * - ตรวจสิทธิ์ซ้ำใน server function ที่อ่าน/เขียนข้อมูล
 * - ไม่บันทึก key, token หรือ password ลง log
 * - จำกัด debugSettings ให้เป็น masked payload เท่านั้น
 */

function fixedAdminAuthText_(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function fixedAdminAuthTrim_(value) {
  return fixedAdminAuthText_(value).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

function fixedAdminAuthConstantTimeEquals_(left, right) {
  var a = fixedAdminAuthText_(left);
  var b = fixedAdminAuthText_(right);
  var maxLength = Math.max(a.length, b.length);
  var difference = a.length ^ b.length;
  for (var i = 0; i < maxLength; i++) {
    difference |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return difference === 0;
}

function fixedAdminAuthConfiguredKey_() {
  // Information Chatbot ใช้ค่า WEB_ADMIN_KEY ในชีตตั้งค่าของระบบนี้เป็นแหล่งหลัก
  // เพื่อให้ Admin เปลี่ยนคีย์จากระบบที่สร้างใหม่ได้ โดยไม่ผูกกับ Main Chatbot
  try {
    if (typeof getConfig === "function") {
      var configKey = fixedAdminAuthTrim_(getConfig("WEB_ADMIN_KEY"));
      if (configKey) return configKey;
    }
  } catch (ignoreConfig) {
  }

  // ใช้ Script Property เฉพาะกรณีไม่มีค่าในชีต เช่น การกู้คืนหรือการตั้งค่าเริ่มต้น
  var propertyKey = "";
  try {
    propertyKey = fixedAdminAuthTrim_(PropertiesService.getScriptProperties().getProperty("WEB_ADMIN_KEY"));
  } catch (ignore) {
  }
  if (propertyKey) return propertyKey;

  return "";
}

function fixedAdminAuthAllowedEmails_() {
  var raw = "";
  try {
    raw = PropertiesService.getScriptProperties().getProperty("WEB_ADMIN_EMAILS") || "";
  } catch (ignore) {
  }
  if (!raw) {
    try {
      if (typeof getConfig === "function") raw = getConfig("WEB_ADMIN_EMAILS") || "";
    } catch (ignoreConfig) {
    }
  }
  return fixedAdminAuthText_(raw).split(/[,;\n\r]+/).map(function(email) {
    return fixedAdminAuthTrim_(email).toLowerCase();
  }).filter(Boolean);
}

function fixedAdminAuthRequestKey_(request) {
  if (typeof request === "string" || typeof request === "number") return fixedAdminAuthTrim_(request);
  if (!request || typeof request !== "object") return "";
  return fixedAdminAuthTrim_(request.adminKey || request.key || request.webAdminKey);
}

function fixedAdminAuthRequestSessionToken_(request) {
  if (!request || typeof request !== "object") return "";
  return fixedAdminAuthTrim_(request.sessionToken || request.dashboardSessionToken);
}

function fixedAdminAuthSessionCacheKey_(token) {
  return "FIXED_DASH_SESSION_" + fixedAdminAuthTrim_(token);
}

function fixedAdminAuthIssueSessionToken_(request) {
  var token = Utilities.getUuid().replace(/-/g, "");
  var cache = CacheService.getScriptCache();
  cache.put(fixedAdminAuthSessionCacheKey_(token), "AUTHORIZED", 1800);
  return token;
}

function fixedAdminAuthSessionIsValid_(request) {
  var token = fixedAdminAuthRequestSessionToken_(request);
  if (!token || token.length < 20 || token.length > 128) return false;
  try {
    return CacheService.getScriptCache().get(fixedAdminAuthSessionCacheKey_(token)) === "AUTHORIZED";
  } catch (ignore) {
    return false;
  }
}

function fixedAdminAuthCurrentEmail_() {
  try {
    return fixedAdminAuthTrim_(Session.getActiveUser().getEmail()).toLowerCase();
  } catch (error) {
    return "";
  }
}

function fixedAdminAuthResult_(allowed, method, action) {
  return {
    authorized: !!allowed,
    method: method || "none",
    action: action || "",
    checkedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
  };
}

function fixedAdminAuthCheck_(request, action) {
  if (fixedAdminAuthSessionIsValid_(request)) {
    return fixedAdminAuthResult_(true, "session", action);
  }

  var requestKey = fixedAdminAuthRequestKey_(request);
  var configuredKey = fixedAdminAuthConfiguredKey_();
  if (requestKey && configuredKey && fixedAdminAuthConstantTimeEquals_(requestKey, configuredKey)) {
    return fixedAdminAuthResult_(true, "adminKey", action);
  }

  var activeEmail = fixedAdminAuthCurrentEmail_();
  var allowedEmails = fixedAdminAuthAllowedEmails_();
  if (activeEmail && allowedEmails.indexOf(activeEmail) >= 0) {
    return fixedAdminAuthResult_(true, "email", action);
  }

  return fixedAdminAuthResult_(false, "none", action);
}

function isDashboardRequestAuthorized_FIXED(request, action) {
  return fixedAdminAuthCheck_(request, action).authorized;
}

function requireDashboardAuthorization_FIXED(request, action) {
  var result = fixedAdminAuthCheck_(request, action);
  if (!result.authorized) {
    throw new Error("ไม่อนุญาตให้ดำเนินการ: " + fixedAdminAuthText_(action || "dashboard action"));
  }
  return result;
}

function fixedAdminAuthRequestFromDoGet_(e) {
  var params = e && e.parameter ? e.parameter : {};
  return {
    adminKey: params.adminKey || params.key || ""
  };
}

function fixedAdminAuthMaskKey_(key) {
  var normalized = fixedAdminAuthText_(key).toUpperCase();
  return normalized.indexOf("TOKEN") >= 0 ||
    normalized.indexOf("SECRET") >= 0 ||
    normalized.indexOf("PASSWORD") >= 0 ||
    normalized.indexOf("PASSCODE") >= 0 ||
    normalized.indexOf("ADMIN_KEY") >= 0 ||
    normalized === "WEB_ADMIN_KEY" ||
    normalized.indexOf("ACCESS_KEY") >= 0 ||
    normalized.indexOf("PRIVATE_KEY") >= 0 ||
    normalized.indexOf("CHANNEL_SECRET") >= 0;
}

function fixedAdminAuthMaskValue_(key, value) {
  if (fixedAdminAuthMaskKey_(key)) return "[MASKED]";
  if (Array.isArray(value)) return value.map(function(item) { return fixedAdminAuthMaskValue_(key, item); });
  if (value && typeof value === "object") {
    var objectResult = {};
    Object.keys(value).forEach(function(childKey) {
      objectResult[childKey] = fixedAdminAuthMaskValue_(childKey, value[childKey]);
    });
    return objectResult;
  }
  return value;
}

function getMaskedSettingsPayload_FIXED(request) {
  requireDashboardAuthorization_FIXED(request, "debug settings");

  var payload = {};
  try {
    if (typeof getSettingsPayload20260511 === "function") {
      payload = getSettingsPayload20260511();
    } else if (typeof getSystemSettings === "function") {
      payload = getSystemSettings();
    }
  } catch (error) {
    return { success: false, error: "อ่าน settings ไม่สำเร็จ" };
  }

  return {
    success: true,
    masked: true,
    settings: fixedAdminAuthMaskValue_("ROOT", payload)
  };
}

function fixedAdminAuthLoginHtml_() {
  return HtmlService.createHtmlOutputFromFile("Login")
    .setTitle("Information Chatbot | เข้าสู่ระบบ Admin")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no");
}

function fixedAdminAuthDeniedHtml_() {
  return HtmlService.createHtmlOutput(
    "<!doctype html><html lang=\"th\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Access denied</title>" +
    "<style>body{font-family:Sarabun,Segoe UI,Tahoma,sans-serif;background:#f8fafc;color:#1f2937;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.box{max-width:680px;background:#fff;border:1px solid #e5e7eb;border-left:6px solid #dc2626;border-radius:12px;padding:24px 28px;box-shadow:0 12px 30px rgba(15,23,42,.08)}h1{font-size:22px;margin:0 0 12px;color:#991b1b}p{line-height:1.7;margin:8px 0}</style></head><body><div class=\"box\"><h1>ไม่อนุญาตให้ดำเนินการ</h1><p>คำขอนี้เป็นการเข้าถึงส่วนตรวจสอบภายในที่ต้องมีสิทธิ์ Admin</p><p>กรุณาใช้หน้าเข้าสู่ระบบของ Information Chatbot และรหัส Admin ของระบบนี้เท่านั้น</p></div></body></html>"
  ).setTitle("Information Chatbot | ไม่อนุญาต");
}

function fixedAdminAuthDashboardBootstrap_(sessionToken) {
  var tokenJson = JSON.stringify(fixedAdminAuthText_(sessionToken)).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return "<script>(function(){\\n" +
    "var token=" + tokenJson + ";\\n" +
    "var raw=google.script.run;\\n" +
    "function makeProxy(state){return new Proxy({}, {get:function(target,prop){\\n" +
      "if(prop==='withSuccessHandler') return function(fn){return makeProxy({success:fn,failure:state.failure,userObject:state.userObject});};\\n" +
      "if(prop==='withFailureHandler') return function(fn){return makeProxy({success:state.success,failure:fn,userObject:state.userObject});};\\n" +
      "if(prop==='withUserObject') return function(obj){return makeProxy({success:state.success,failure:state.failure,userObject:obj});};\\n" +
      "if(prop==='then') return undefined;\\n" +
      "return function(){var args=Array.prototype.slice.call(arguments);var runner=raw;\\n" +
        "if(state.success) runner=runner.withSuccessHandler(state.success);\\n" +
        "if(state.failure) runner=runner.withFailureHandler(state.failure);\\n" +
        "if(state.userObject) runner=runner.withUserObject(state.userObject);\\n" +
        "return runner.secureDashboardCall_FIXED(String(prop),args,{sessionToken:token});};\\n" +
    "}});}\\n" +
    "google.script.run=makeProxy({success:null,failure:null,userObject:null});\\n" +
  "})();</script>";
}

function fixedAdminAuthDashboardOutput_(sessionToken) {
  var html = HtmlService.createHtmlOutputFromFile("Dashboard").getContent();
  var bootstrap = fixedAdminAuthDashboardBootstrap_(sessionToken);
  var marker = "</head>";
  if (html.indexOf(marker) >= 0) html = html.replace(marker, bootstrap + marker);
  else html = bootstrap + html;
  return HtmlService.createHtmlOutput(html)
    .setTitle("Information Chatbot | Admin Console")
    .setWidth(1200)
    .setHeight(800)
    .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1.0, user-scalable=no")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doGet_FIXED(e) {
  var params = e && e.parameter ? e.parameter : {};
  var request = fixedAdminAuthRequestFromDoGet_(e);
  var authorized = fixedAdminAuthCheck_(request, "dashboard page").authorized;

  if (params.debugSettings === "1" || params.debugSettings === "true") {
    if (!authorized) return fixedAdminAuthDeniedHtml_();
    var masked = getMaskedSettingsPayload_FIXED(request);
    var json = JSON.stringify(masked, null, 2)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
    return HtmlService.createHtmlOutput("<pre style=\"white-space:pre-wrap;font-family:monospace\">" + json + "</pre>")
      .setTitle("Masked settings");
  }

  if (!authorized) return fixedAdminAuthLoginHtml_();
  var sessionToken = fixedAdminAuthIssueSessionToken_(request);
  return fixedAdminAuthDashboardOutput_(sessionToken);
}

/*
 * ใช้เป็น guard ต้นฟังก์ชัน mutating ที่เรียกจาก Dashboard เช่น:
 * requireDashboardAuthorization_FIXED(request, "save config");
 * โดย request ต้องถูกส่งเข้ามาจาก client เป็น {adminKey: storedKey}
 * และไม่ควรเชื่อค่า email ที่ client ส่งมา
 */
function assertFixedDashboardMutation_(request, action) {
  return requireDashboardAuthorization_FIXED(request, action || "mutation");
}
