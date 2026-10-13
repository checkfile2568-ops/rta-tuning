/**
 * PrintHubLine.js
 * LINE adapter for PrintHub.
 *
 * Safety boundaries:
 * - VIP/Admin only.
 * - Does not print directly. All execution is delegated to PrintHub.
 * - AI may classify/rephrase, but never decides permission or job state.
 * - Secret PRINT_HUB_BRIDGE_TOKEN lives in Script Properties only.
 * - Feature defaults OFF so adding this file alone changes no live behavior.
 */

var PRINT_HUB_SESSION_TTL_SEC_ = 10 * 60;
var PRINT_HUB_UPLOAD_CHUNK_BYTES_ = 1024 * 1024;
var PRINT_HUB_MAX_AI_TEXT_ = 1200;
var PRINT_HUB_DEFAULT_MAX_FILE_MB_ = 10;
var PRINT_HUB_MAX_NOTIFY_ATTEMPTS_ = 5;
var PRINT_HUB_BRIDGE_ERROR_CODES_ = ["NO_URL", "NO_TOKEN", "FETCH_ERROR", "BAD_RESPONSE"];

function _printHubOn_() {
  return String(getConfig("PRINT_HUB_STATUS") || "OFF").toUpperCase() === "ON";
}

function _printHubSessionTtlSec_() {
  var minutes = Number(getConfig("PRINT_HUB_SESSION_MINUTES") || 30);
  if (!isFinite(minutes) || minutes <= 0) minutes = 30;
  return Math.min(Math.round(minutes * 60), 6 * 60 * 60);
}

function _printHubMaxFileBytes_() {
  var mb = Number(getConfig("PRINT_HUB_MAX_FILE_MB") || PRINT_HUB_DEFAULT_MAX_FILE_MB_);
  if (!isFinite(mb) || mb <= 0) mb = PRINT_HUB_DEFAULT_MAX_FILE_MB_;
  return Math.round(mb * 1024 * 1024);
}

function _printHubOfflineRejects_() {
  return String(getConfig("PRINT_HUB_OFFLINE_MODE") || "HOLD").toUpperCase() === "REJECT";
}

function _printHubHistoryOn_() {
  return String(getConfig("PRINT_HUB_HISTORY_STATUS") || "ON").toUpperCase() === "ON";
}

function _printHubAllowedExtensions_() {
  var raw = String(getConfig("PRINT_HUB_FILE_TYPES") || "pdf,jpg,jpeg,png");
  var list = raw.split(",").map(function(x) {
    return x.trim().toLowerCase().replace(/^\./, "");
  }).filter(Boolean);
  return list.length ? list : ["pdf", "jpg", "jpeg", "png"];
}

/**
 * Distinguishes a bridge configuration/transport failure from a genuinely offline agent.
 * Returning OFFLINE for an unconfigured bridge would tell the user their file is safely
 * queued when nothing received it, so the two cases must never be collapsed.
 */
function _printHubBridgeFailed_(res) {
  if (!res) return true;
  if (res.ok === true) return false;
  var code = String(res.code || "");
  if (PRINT_HUB_BRIDGE_ERROR_CODES_.indexOf(code) >= 0) return true;
  return code.indexOf("HTTP_") === 0;
}

function _printHubConfigErrorText_(res) {
  var detail = res && res.code === "NO_URL" ? "ยังไม่ได้ตั้งค่า URL ของ Print Hub"
    : res && res.code === "NO_TOKEN" ? "ยังไม่ได้ตั้งค่า Bridge Token ของ Print Hub"
    : "ติดต่อ Print Hub ไม่ได้";
  return _printHubReplyConfig_("PRINT_HUB_CONFIG_ERROR_REPLY",
    "⚠️ ขออภัยครับ ระบบสั่งพิมพ์ผ่าน LINE ยังเชื่อมต่อ Print Hub ไม่ได้ (" + detail +
    ") จึงยังรับไฟล์ไว้ไม่ได้ กรุณาแจ้งผู้ดูแลระบบครับ");
}

function _printHubAllowed_(user, userId) {
  if (!user || String(user.status || "").toLowerCase() === "blocked") return false;
  var role = String(user.role || "").trim().toUpperCase();
  var admin = typeof isAdmin === "function" && isAdmin(userId);
  return admin || role === "VIP";
}

function _printHubSourceAllowed_(isGroup) {
  var key = isGroup ? "PRINT_HUB_GROUP_STATUS" : "PRINT_HUB_PRIVATE_STATUS";
  return String(getConfig(key) || "ON").toUpperCase() === "ON";
}

function _printHubSessionKey_(sourceId, userId) {
  return "printHubSession:" + String(sourceId || "private") + ":" + String(userId || "");
}

function _getPrintHubSession_(sourceId, userId) {
  try {
    var raw = CacheService.getScriptCache().get(_printHubSessionKey_(sourceId, userId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function _savePrintHubSession_(sourceId, userId, data) {
  data = data || {};
  data.userId = userId;
  data.sourceId = sourceId;
  data.updatedAt = new Date().toISOString();
  CacheService.getScriptCache().put(
    _printHubSessionKey_(sourceId, userId),
    JSON.stringify(data),
    _printHubSessionTtlSec_()
  );
  return data;
}

function _clearPrintHubSession_(sourceId, userId) {
  try { CacheService.getScriptCache().remove(_printHubSessionKey_(sourceId, userId)); } catch (e) {}
}

function _printHubKeywords_() {
  var raw = String(getConfig("PRINT_HUB_KEYWORDS") || "พิมพ์,ปริ้น,ปรินต์,print");
  return raw.split(",").map(function(x) { return x.trim().toLowerCase(); }).filter(Boolean);
}

function _printHubNormalize_(text) {
  return String(text || "").trim().replace(/\s+/g, " ")
    // Group messages normally arrive already stripped of the bot prefix, but when another
    // handler claims the prefix branch first the raw text still carries it. Strip it here so
    // confirmation buttons keep working whatever GEMINI_QA_GROUP_PREFIX is set to.
    .replace(/^#?บอท\S*\s+/i, "");
}

/**
 * Search/knowledge commands must keep reaching their own handlers. PrintHub runs ahead of
 * them in the webhook, so anything that looks like a lookup is handed straight back.
 */
function _printHubLooksLikeSearch_(text) {
  var t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  var keyword = String((typeof getConfig === "function" && getConfig("SEARCH_KEYWORD")) || "ค้นหา").trim().toLowerCase();
  if (keyword && t.indexOf(keyword) === 0) return true;
  return /^(?:\/|ค้นหา|ค้น|ขอข้อมูล|สอบถาม|บัญชีนัดความ|บัญชีนัด|นัดความ|นัด)/.test(t);
}

function _printHubDetectIntentDeterministic_(text) {
  var raw = _printHubNormalize_(text);
  var t = raw.toLowerCase();
  if (!t) return { intent: "NONE" };

  var confirm = raw.match(/^(?:ยืนยัน(?:พิมพ์)?|ตกลงพิมพ์|พิมพ์เลย)\s+([a-z0-9_-]+)$/i);
  if (confirm) return { intent: "PRINT_CONFIRM", jobId: confirm[1] };

  var cancel = raw.match(/^(?:ยกเลิก(?:พิมพ์)?|ไม่พิมพ์|ลบงานพิมพ์)\s+([a-z0-9_-]+)$/i);
  if (cancel) return { intent: "PRINT_CANCEL", jobId: cancel[1] };

  var reprint = raw.match(/^(?:พิมพ์ซ้ำ|ปริ้นซ้ำ)\s+([a-z0-9_-]+)$/i);
  if (reprint) return { intent: "PRINT_REPRINT", jobId: reprint[1] };

  var received = raw.match(/^(?:รับเอกสารครบ|ได้รับเอกสารครบ|เอกสารครบ)\s+([a-z0-9_-]+)$/i);
  if (received) return { intent: "PRINT_RECEIVED", jobId: received[1], receivedOk:true };
  var receiveProblem = raw.match(/^(?:เอกสารมีปัญหา|เอกสารไม่ครบ|พิมพ์ไม่ครบ)\s+([a-z0-9_-]+)$/i);
  if (receiveProblem) return { intent: "PRINT_RECEIVED", jobId: receiveProblem[1], receivedOk:false };

  if (/^(?:สถานะปริ้นฮับ|สถานะพิมพ์|เครื่องพิมพ์พร้อม|พิมพ์ได้ไหม|ปริ้นได้ไหม|คอมปริ้นฮับ)/i.test(t)) {
    return { intent: "PRINT_HUB_STATUS" };
  }
  if (/^(?:งานพิมพ์|คิวพิมพ์|ประวัติพิมพ์|หาไฟล์พิมพ์|ค้นหาไฟล์พิมพ์)/i.test(t)) {
    return { intent: "PRINT_HISTORY", query: t.replace(/^(?:งานพิมพ์|คิวพิมพ์|ประวัติพิมพ์|หาไฟล์พิมพ์|ค้นหาไฟล์พิมพ์)\s*/i, "") };
  }

  // Everything below is a loose match, so lookup commands are released back to search/KB first.
  if (_printHubLooksLikeSearch_(t)) return { intent: "NONE" };

  // Verb-first only: the print word must open the request (optionally after a polite lead-in).
  // "ขอเอกสารพิมพ์คำพิพากษา" is a records request, not a print request, and must not be taken.
  var keys = _printHubKeywords_();
  var lead = t.replace(/^(?:ช่วย|ฝาก|ขอ|รบกวน|กรุณา|อยาก|ต้องการ|สั่ง)\s*/, "");
  for (var i = 0; i < keys.length; i++) {
    if (!keys[i]) continue;
    if (t === keys[i] || lead === keys[i] || lead.indexOf(keys[i]) === 0) {
      return { intent: "PRINT_START" };
    }
  }
  return { intent: "NONE" };
}

function _printHubDetectIntentAI_(text) {
  if (String(getConfig("PRINT_HUB_NL_STATUS") || "ON").toUpperCase() !== "ON") return { intent: "NONE" };
  var candidate = _printHubNormalize_(text);
  // Privacy/cost guard: AI classification runs only when the text already looks print-related.
  // It must never become a second catch-all ahead of the existing GeminiQA router.
  if (!/(พิมพ์|ปริ้น|ปรินต์|print|เครื่องพิมพ์|งานพิมพ์|คิวพิมพ์|ไฟล์.{0,12}(เครื่อง|ออกกระดาษ))/i.test(candidate)) {
    return { intent: "NONE" };
  }
  if (_printHubLooksLikeSearch_(candidate)) return { intent: "NONE" };
  if (typeof _callGeminiAPI_ !== "function") return { intent: "NONE" };
  var prompt = [
    "จำแนก intent ของข้อความต่อไปนี้สำหรับระบบ PrintHub เท่านั้น",
    "ตอบเพียงหนึ่งบรรทัดจาก: PRINT_START, PRINT_HUB_STATUS, PRINT_HISTORY, NONE",
    "ห้ามตอบคำอธิบาย ห้ามสร้างสถานะ ห้ามอนุมานว่าเครื่องออนไลน์",
    "ข้อความ: " + _printHubNormalize_(text).substring(0, 500)
  ].join("\n");
  try {
    var r = _callGeminiAPI_(prompt, null, "คุณเป็น intent classifier เท่านั้น ตอบเฉพาะ label ที่กำหนด");
    // _callGeminiAPI_ forces a JSON response schema, so the label arrives inside `answer` and
    // may carry extra words. Match the label defensively instead of requiring an exact string.
    var label = r && r.ok ? String(r.text || r.answer || "").trim().toUpperCase() : "";
    var known = ["PRINT_HUB_STATUS", "PRINT_HISTORY", "PRINT_START"];
    for (var k = 0; k < known.length; k++) {
      if (label.indexOf(known[k]) >= 0) return { intent: known[k] };
    }
  } catch (e) {}
  return { intent: "NONE" };
}

function _printHubDetectIntent_(text) {
  var d = _printHubDetectIntentDeterministic_(text);
  return d.intent !== "NONE" ? d : _printHubDetectIntentAI_(text);
}

function _printHubBridgeConfig_() {
  var url = String(getConfig("PRINT_HUB_WEBAPP_URL") || "").trim();
  var token = PropertiesService.getScriptProperties().getProperty("PRINT_HUB_BRIDGE_TOKEN") || "";
  return { url: url, token: token };
}

function _printHubBridge_(action, payload) {
  var cfg = _printHubBridgeConfig_();
  if (!cfg.url) return { ok: false, code: "NO_URL", msg: "ยังไม่ได้ตั้งค่า URL ของ Print Hub" };
  if (!cfg.token) return { ok: false, code: "NO_TOKEN", msg: "ยังไม่ได้ตั้งค่า PRINT_HUB_BRIDGE_TOKEN" };
  var body = payload || {};
  body.action = action;
  body.token = cfg.token;
  try {
    var res = UrlFetchApp.fetch(cfg.url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
      followRedirects: true
    });
    var code = res.getResponseCode();
    var text = res.getContentText();
    var json;
    try { json = JSON.parse(text || "{}"); } catch (e) { json = { ok:false, msg:"BAD_RESPONSE" }; }
    if (code < 200 || code >= 300) {
      return { ok:false, code:"HTTP_" + code, msg:String(json.msg || "Print Hub ตอบกลับผิดพลาด") };
    }
    return json || { ok:false, msg:"EMPTY_RESPONSE" };
  } catch (e) {
    return { ok:false, code:"FETCH_ERROR", msg:String(e && e.message || e) };
  }
}

function _printHubFactsReply_(baseText, facts) {
  baseText = String(baseText || "");
  // Errors and document-specific details remain deterministic and are not sent to Gemini.
  if (facts && (facts.error || facts.sensitive)) return baseText;
  if (String(getConfig("PRINT_HUB_AI_REPLY") || "ON").toUpperCase() !== "ON") return baseText;
  if (typeof _callGeminiAPI_ !== "function") return baseText;
  try {
    var rawFacts = facts || {};
    var safeFacts = {
      allowed: rawFacts.allowed,
      agentOnline: rawFacts.agentOnline,
      status: rawFacts.status,
      ok: rawFacts.ok,
      action: rawFacts.action,
      found: rawFacts.found
    };
    var factsText = JSON.stringify(safeFacts);
    var p = [
      "เรียบเรียงข้อความตอบผู้ใช้ LINE เป็นภาษาไทยสุภาพ เป็นธรรมชาติ กระชับ",
      "ใช้ข้อเท็จจริงที่ให้มาเท่านั้น ห้ามสร้างสถานะ ห้ามบอกว่าพิมพ์เสร็จถ้า status ไม่ใช่ DONE/COMPLETED",
      "ห้ามเปลี่ยนชื่อไฟล์ jobId จำนวนชุด หรือสถานะ online/offline",
      "ข้อความพื้นฐาน: " + baseText.substring(0, PRINT_HUB_MAX_AI_TEXT_),
      "ข้อเท็จจริง: " + factsText.substring(0, 2000)
    ].join("\n");
    var r = _callGeminiAPI_(p, null, "ห้ามเดาข้อมูลระบบ ใช้เฉพาะ facts ที่ได้รับ");
    var out = r && r.ok ? String(r.text || r.answer || "").trim() : "";
    return out ? out.substring(0, 4500) : baseText;
  } catch (e) {
    return baseText;
  }
}

function _printHubReply_(replyToken, baseText, facts, userId) {
  var text = _printHubFactsReply_(baseText, facts);
  if (typeof fixedWebhookSafeReply_ === "function") return fixedWebhookSafeReply_(replyToken, text, userId);
  if (typeof safeSendReply === "function") return safeSendReply(replyToken, text);
}

function _printHubReplyConfig_(key, fallback) {
  return String(getConfig(key) || fallback);
}

function _printHubConfirmFlex_(job) {
  var name = String(job.fileName || job.file || "ไฟล์เอกสาร").substring(0, 120);
  var id = String(job.jobId || job.id || "");
  var groupPrefix = (job.isGroup || String(job.sourceType || "").toLowerCase() === "group") ? "บอท " : "";
  return {
    type: "flex",
    altText: "Print Hub ออนไลน์แล้ว กรุณายืนยันการพิมพ์",
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#ECFDF5", paddingAll: "14px",
        contents: [{ type:"text", text:"🟢 Print Hub ออนไลน์แล้ว", weight:"bold", color:"#065F46", wrap:true }]
      },
      body: {
        type:"box", layout:"vertical", paddingAll:"16px",
        contents:[
          { type:"text", text:"พบงานพิมพ์ที่ฝากไว้", weight:"bold", color:"#111827" },
          { type:"text", text:"📄 " + name, size:"sm", color:"#374151", margin:"md", wrap:true },
          { type:"text", text:"A4 · " + Number(job.copies || 1) + " ชุด", size:"xs", color:"#6B7280", margin:"sm" },
          { type:"text", text:"ต้องการพิมพ์ไฟล์นี้ตอนนี้หรือไม่?", size:"sm", color:"#111827", margin:"lg", wrap:true }
        ]
      },
      footer: {
        type:"box", layout:"vertical", spacing:"sm", paddingAll:"12px",
        contents:[
          { type:"button", style:"primary", color:"#16A34A", action:{ type:"message", label:"✅ ยืนยันพิมพ์", text:groupPrefix + "ยืนยันพิมพ์ " + id } },
          { type:"button", style:"secondary", action:{ type:"message", label:"❌ ยกเลิก", text:groupPrefix + "ยกเลิกพิมพ์ " + id } }
        ]
      }
    }
  };
}

function _printHubReceivedFlex_(job) {
  var name = String(job.fileName || job.file || "ไฟล์เอกสาร").substring(0, 120);
  var id = String(job.jobId || job.id || "");
  var groupPrefix = (job.isGroup || String(job.sourceType || "").toLowerCase() === "group") ? "บอท " : "";
  return {
    type:"flex",
    altText:"Print Hub ส่งงานเข้าเครื่องพิมพ์แล้ว กรุณาตรวจรับเอกสาร",
    contents:{
      type:"bubble", size:"kilo",
      header:{type:"box",layout:"vertical",backgroundColor:"#EFF6FF",paddingAll:"14px",
        contents:[{type:"text",text:"🖨️ ส่งงานเข้าเครื่องพิมพ์แล้ว",weight:"bold",color:"#1E40AF",wrap:true}]},
      body:{type:"box",layout:"vertical",paddingAll:"16px",contents:[
        {type:"text",text:"📄 " + name,size:"sm",color:"#374151",wrap:true},
        {type:"text",text:"กรุณาตรวจเอกสารที่เครื่องพิมพ์ แล้วแจ้งผลครับ",size:"sm",color:"#111827",margin:"lg",wrap:true}
      ]},
      footer:{type:"box",layout:"vertical",spacing:"sm",paddingAll:"12px",contents:[
        {type:"button",style:"primary",color:"#16A34A",action:{type:"message",label:"✅ ได้รับครบแล้ว",text:groupPrefix + "รับเอกสารครบ " + id}},
        {type:"button",style:"secondary",action:{type:"message",label:"⚠️ ไม่ครบ/มีปัญหา",text:groupPrefix + "เอกสารมีปัญหา " + id}}
      ]}
    }
  };
}

function _printHubStart_(messageText, user, userId, sourceId, isGroup, replyToken) {
  if (!_printHubAllowed_(user, userId)) return _printHubDeny_(replyToken, userId, isGroup);
  if (!_printHubSourceAllowed_(isGroup)) return { handled:false };

  var status = _printHubBridge_("line_status", { lineUserId:userId, sourceId:sourceId });
  // A bridge that is unreachable or unconfigured is NOT an offline printer. Opening a file
  // session here would promise the user a queue that does not exist.
  if (_printHubBridgeFailed_(status)) {
    _printHubReply_(replyToken, _printHubConfigErrorText_(status), { error:true }, userId);
    _printHubLog_(userId, user.name, "สั่งพิมพ์ผ่าน LINE (เชื่อมต่อ Print Hub ไม่ได้)", "Error");
    return { handled:true, route:"print-config-error" };
  }

  var facts = { allowed:true, agentOnline:!!(status && status.agentOnline), printer:status && status.printer || "" };

  // Admin may choose to refuse files while the agent is down rather than hold them.
  if (!facts.agentOnline && _printHubOfflineRejects_()) {
    _printHubReply_(replyToken,
      _printHubReplyConfig_("PRINT_HUB_REJECT_REPLY",
        "⚪ ขณะนี้คอม Print Hub ออฟไลน์ และระบบตั้งค่าให้ยังไม่รับไฟล์ไว้ครับ กรุณาส่งใหม่อีกครั้งเมื่อเครื่องออนไลน์"),
      facts, userId);
    return { handled:true, route:"print-offline-reject" };
  }

  _savePrintHubSession_(sourceId, userId, { state:"WAITING_FILE", isGroup:!!isGroup, userName:user.name });

  var base = facts.agentOnline
    ? _printHubReplyConfig_("PRINT_HUB_START_REPLY", "🖨️ ได้ครับ Print Hub พร้อมใช้งาน รองรับ PDF และรูปภาพ JPG/PNG ขนาด A4 ส่งไฟล์มาได้เลยครับ เมื่อรับไฟล์แล้วระบบจะให้ยืนยันก่อนพิมพ์")
    : _printHubReplyConfig_("PRINT_HUB_OFFLINE_REPLY", "🖨️ ได้ครับ ขณะนี้คอม Print Hub ยังออฟไลน์ แต่ส่ง PDF หรือรูปภาพ A4 มาได้เลยครับ ระบบจะเก็บไฟล์ไว้ และเมื่อ Print Hub ออนไลน์จะแจ้งให้ยืนยันก่อนพิมพ์");
  _printHubReply_(replyToken, base, facts, userId);
  _printHubLog_(userId, user.name, "เริ่มสั่งพิมพ์ผ่าน LINE", "Success");
  return { handled:true, route:"print-start" };
}

/**
 * In groups the bot shares the floor with search/KB/GeminiQA, so a refusal here would
 * replace an answer a non-VIP used to get. Stay silent there and let the original
 * handlers continue; only private chat gets the explicit refusal.
 */
function _printHubDeny_(replyToken, userId, isGroup) {
  if (isGroup) return { handled:false };
  _printHubReply_(replyToken,
    _printHubReplyConfig_("PRINT_HUB_DENIED_REPLY", "🔒 ระบบสั่งพิมพ์สำหรับเจ้าหน้าที่ VIP/Admin เท่านั้นครับ"),
    { allowed:false }, userId);
  return { handled:true, route:"print-denied" };
}

function _printHubLog_(userId, userName, action, result) {
  try {
    if (typeof logActivity === "function") {
      logActivity(userId, userName || "", action, "PrintHub", result || "Success", 0);
    }
  } catch (e) {}
}

function _printHubPushTarget_(sourceId, userId, isGroup) {
  return String((isGroup ? sourceId : userId) || userId || "");
}

function _printHubPushFlex_(target, flex) {
  if (!target || !flex) return null;
  return _linePost("https://api.line.me/v2/bot/message/push", {
    to: target,
    messages: [{ type:"flex", altText:String(flex.altText || "Print Hub"), contents:flex.contents }]
  });
}

function _handlePrintHubText_(messageText, user, userId, sourceId, isGroup, replyToken) {
  if (!_printHubOn_()) return { handled:false };
  if (!_printHubSourceAllowed_(isGroup)) return { handled:false };

  var detected = _printHubDetectIntent_(messageText);
  if (detected.intent === "NONE") return { handled:false };

  if (!_printHubAllowed_(user, userId)) return _printHubDeny_(replyToken, userId, isGroup);

  if (detected.intent === "PRINT_START") return _printHubStart_(messageText, user, userId, sourceId, isGroup, replyToken);

  if (detected.intent === "PRINT_HUB_STATUS") {
    var st = _printHubBridge_("line_status", { lineUserId:userId, sourceId:sourceId });
    var online = !!(st && st.agentOnline);
    var baseStatus = online
      ? "🟢 Print Hub ออนไลน์และพร้อมรับการยืนยันงานพิมพ์ครับ"
      : "⚪ ขณะนี้คอม Print Hub ยังออฟไลน์ครับ งานที่ฝากไว้จะยังไม่ถูกพิมพ์";
    _printHubReply_(replyToken, baseStatus, {agentOnline:online, printer:st && st.printer || ""}, userId);
    return { handled:true, route:"print-status" };
  }

  if (detected.intent === "PRINT_CONFIRM" || detected.intent === "PRINT_CANCEL") {
    var action = detected.intent === "PRINT_CONFIRM" ? "line_confirm" : "line_cancel";
    var result = _printHubBridge_(action, { jobId:detected.jobId, lineUserId:userId, sourceId:sourceId });
    var okText;
    if (detected.intent === "PRINT_CONFIRM") {
      okText = result && result.agentOnline
        ? "🖨️ ยืนยันแล้วครับ กำลังส่งงานเข้าคิวพิมพ์"
        : "✅ รับการยืนยันแล้วครับ แต่ Print Hub ออฟไลน์อีกครั้ง ระบบจะรอจนออนไลน์และแจ้งให้ทราบ";
    } else {
      okText = "❌ ยกเลิกงานพิมพ์และลบไฟล์ที่ฝากไว้แล้วครับ";
    }
    if (_printHubBridgeFailed_(result)) {
      _printHubReply_(replyToken, _printHubConfigErrorText_(result), { error:true }, userId);
      _printHubLog_(userId, user.name, action + " " + detected.jobId + " (เชื่อมต่อไม่ได้)", "Error");
      return { handled:true, route:"print-config-error" };
    }
    _printHubReply_(replyToken, result && result.ok ? okText : "⚠️ " + String(result && result.msg || "ดำเนินการไม่สำเร็จ"),
      { ok:!!(result && result.ok), action:action, jobId:detected.jobId, agentOnline:!!(result && result.agentOnline) }, userId);
    _printHubLog_(userId, user.name,
      (detected.intent === "PRINT_CONFIRM" ? "ยืนยันพิมพ์ " : "ยกเลิกพิมพ์ ") + detected.jobId,
      result && result.ok ? "Success" : "Error");
    return { handled:true, route:detected.intent === "PRINT_CONFIRM" ? "print-confirm" : "print-cancel" };
  }

  if (detected.intent === "PRINT_RECEIVED") {
    var rr = _printHubBridge_("line_received", {
      jobId:detected.jobId, lineUserId:userId, sourceId:sourceId, ok:detected.receivedOk === true
    });
    var rrText = rr && rr.ok
      ? (detected.receivedOk ? _printHubReplyConfig_("PRINT_HUB_COMPLETED_REPLY", "✅ พิมพ์เอกสารเรียบร้อยแล้วครับ") :
          "⚠️ รับแจ้งแล้วครับ ระบบบันทึกว่างานพิมพ์มีปัญหาและจะไม่สั่งพิมพ์ซ้ำอัตโนมัติ")
      : "⚠️ " + String(rr && rr.msg || "บันทึกผลรับเอกสารไม่สำเร็จ");
    _printHubReply_(replyToken, rrText, {ok:!!(rr && rr.ok), status:detected.receivedOk ? "DONE" : "ERROR"}, userId);
    _printHubLog_(userId, user.name, "ตรวจรับงานพิมพ์ " + detected.jobId,
      rr && rr.ok && detected.receivedOk ? "Success" : "Error");
    return { handled:true, route:"print-received" };
  }

  if (detected.intent === "PRINT_HISTORY") {
    if (!_printHubHistoryOn_()) return { handled:false };
    var hist = _printHubBridge_("line_history", {
      lineUserId:userId, sourceId:sourceId, query:String(detected.query || "").substring(0, 120), limit:8,
      includeDownloadLink:String(getConfig("PRINT_HUB_DOWNLOAD_STATUS") || "OFF").toUpperCase() === "ON"
    });
    if (!hist || !hist.ok || !hist.jobs || !hist.jobs.length) {
      _printHubReply_(replyToken, "ไม่พบไฟล์พิมพ์ที่ตรงกับคำค้นครับ", {found:0}, userId);
      return { handled:true, route:"print-history" };
    }
    var rows = hist.jobs.map(function(j, idx) {
      return (idx + 1) + ". " + j.fileName + " — " + (j.status || "") + "\n   " + (j.jobId || "");
    });
    fixedWebhookSafeReply_(replyToken, "📁 พบไฟล์พิมพ์ " + hist.jobs.length + " รายการ\n\n" + rows.join("\n\n") +
      "\n\nพิมพ์ซ้ำได้ด้วย: พิมพ์ซ้ำ <เลขงาน>", userId);
    return { handled:true, route:"print-history" };
  }

  if (detected.intent === "PRINT_REPRINT") {
    if (!_printHubHistoryOn_()) return { handled:false };
    var rp = _printHubBridge_("line_reprint", { jobId:detected.jobId, lineUserId:userId, sourceId:sourceId });
    if (rp && rp.ok && rp.agentOnline && rp.job) {
      rp.job.isGroup = !!isGroup;
      rp.job.sourceType = isGroup ? "group" : "private";
      sendUniversalReply(replyToken, _printHubConfirmFlex_(rp.job));
    } else {
      _printHubReply_(replyToken,
        rp && rp.ok ? "✅ เตรียมไฟล์สำหรับพิมพ์ซ้ำแล้วครับ ระบบจะขอยืนยันก่อนพิมพ์เมื่อ Print Hub ออนไลน์" : "⚠️ " + String(rp && rp.msg || "พิมพ์ซ้ำไม่สำเร็จ"),
        {ok:!!(rp && rp.ok), jobId:rp && rp.jobId || detected.jobId}, userId);
    }
    _printHubLog_(userId, user.name, "สั่งพิมพ์ซ้ำ " + detected.jobId, rp && rp.ok ? "Success" : "Error");
    return { handled:true, route:"print-reprint" };
  }

  return { handled:false };
}

function _printHubDownloadLineBlob_(messageId) {
  var res = UrlFetchApp.fetch("https://api-data.line.me/v2/bot/message/" + encodeURIComponent(messageId) + "/content", {
    headers: getLineAuthHeaders_(),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error("LINE_CONTENT_HTTP_" + res.getResponseCode());
  return res.getBlob();
}

function _printHubUploadBlob_(blob, meta) {
  var start = _printHubBridge_("line_upload_start", {
    lineUserId:meta.userId, sourceId:meta.sourceId, sourceType:meta.isGroup ? "group" : "private",
    userName:meta.userName, fileName:meta.fileName, mimeType:meta.mimeType,
    copies:Number(getConfig("PRINT_HUB_DEFAULT_COPIES") || 1), paperSize:"A4"
  });
  if (!start || !start.ok || !start.uploadId) return start || {ok:false,msg:"เริ่มอัปโหลดไม่ได้"};

  var bytes = blob.getBytes();
  for (var offset = 0, part = 0; offset < bytes.length; offset += PRINT_HUB_UPLOAD_CHUNK_BYTES_, part++) {
    var chunk = bytes.slice(offset, Math.min(bytes.length, offset + PRINT_HUB_UPLOAD_CHUNK_BYTES_));
    var up = _printHubBridge_("line_upload_chunk", {
      uploadId:start.uploadId, part:part, data:Utilities.base64Encode(chunk), lineUserId:meta.userId
    });
    if (!up || !up.ok) return up || {ok:false,msg:"อัปโหลดไฟล์ไม่สำเร็จ"};
  }
  return _printHubBridge_("line_submit", {
    uploadId:start.uploadId, parts:Math.max(1, Math.ceil(bytes.length / PRINT_HUB_UPLOAD_CHUNK_BYTES_)),
    lineUserId:meta.userId, sourceId:meta.sourceId, sourceType:meta.isGroup ? "group" : "private",
    userName:meta.userName, fileName:meta.fileName, mimeType:meta.mimeType,
    copies:Number(getConfig("PRINT_HUB_DEFAULT_COPIES") || 1), paperSize:"A4",
    retentionDays:Number(getConfig("PRINT_HUB_RETENTION_DAYS") || 7),
    deleteOnCancel:String(getConfig("PRINT_HUB_DELETE_ON_CANCEL") || "ON").toUpperCase() === "ON"
  });
}

function _handlePrintHubMedia_(event, message, user, userId, sourceId, isGroup, replyToken) {
  if (!_printHubOn_() || !_printHubAllowed_(user, userId) || !_printHubSourceAllowed_(isGroup)) return { handled:false };
  var session = _getPrintHubSession_(sourceId, userId);
  if (!session || session.state !== "WAITING_FILE") return { handled:false };

  var type = String(message.type || "");
  if (type !== "file" && type !== "image") return { handled:false };

  var fileName = type === "file" ? String(message.fileName || "document.pdf") : ("LINE_image_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss") + ".jpg");
  var ext = String(fileName.split(".").pop() || "").toLowerCase();
  var mime = type === "file" ? _printHubMimeFromExt_(ext) : "image/jpeg";
  var target = _printHubPushTarget_(sourceId, userId, isGroup);

  if (type === "file" && _printHubAllowedExtensions_().indexOf(ext) < 0) {
    _printHubReply_(replyToken,
      _printHubReplyConfig_("PRINT_HUB_UNSUPPORTED_REPLY", "⚠️ ระบบพิมพ์ผ่าน LINE รองรับ PDF และรูปภาพ JPG/PNG ในขณะนี้ครับ"),
      {fileName:fileName, supported:false}, userId);
    return { handled:true, route:"print-file-unsupported" };
  }

  // Oversized files cannot be chunked through two Apps Script hops inside one execution,
  // so they are refused before any download instead of dying mid-upload with no reply.
  var maxBytes = _printHubMaxFileBytes_();
  var declaredSize = Number(message.fileSize || 0);
  if (declaredSize > 0 && declaredSize > maxBytes) {
    _printHubReply_(replyToken,
      "⚠️ ไฟล์นี้ใหญ่เกินกว่าที่ระบบพิมพ์ผ่าน LINE รองรับครับ (จำกัด " +
      Math.round(maxBytes / (1024 * 1024)) + " MB) กรุณาแบ่งไฟล์หรือลดขนาดก่อนส่งใหม่",
      {ok:false, supported:false}, userId);
    return { handled:true, route:"print-file-too-large" };
  }

  // The reply token expires long before a multi-megabyte chunked upload finishes, so the
  // acknowledgement is sent first and every later result is delivered by push. The ack skips
  // the AI rephrase on purpose: it must go out before the download starts eating the clock.
  fixedWebhookSafeReply_(replyToken,
    _printHubReplyConfig_("PRINT_HUB_RECEIVING_REPLY", "📥 กำลังรับไฟล์เข้าระบบพิมพ์ครับ สักครู่จะแจ้งผลให้ทราบ"),
    userId);

  try {
    var blob = _printHubDownloadLineBlob_(message.id);
    var actualBytes = blob.getBytes().length;
    if (actualBytes > maxBytes) {
      _linePush(target, "⚠️ ไฟล์ " + fileName + " ใหญ่เกินกว่าที่ระบบรองรับครับ (จำกัด " +
        Math.round(maxBytes / (1024 * 1024)) + " MB) ยังไม่ได้ส่งเข้าคิวพิมพ์");
      _printHubLog_(userId, user.name, "ไฟล์พิมพ์ใหญ่เกินกำหนด: " + fileName, "Error");
      return { handled:true, route:"print-file-too-large" };
    }
    if (type === "file") mime = blob.getContentType() || mime;

    var result = _printHubUploadBlob_(blob, {
      userId:userId, sourceId:sourceId, isGroup:isGroup, userName:user.name, fileName:fileName, mimeType:mime
    });
    if (_printHubBridgeFailed_(result)) {
      _linePush(target, _printHubConfigErrorText_(result));
      _printHubLog_(userId, user.name, "ส่งไฟล์พิมพ์ไม่สำเร็จ (เชื่อมต่อ Print Hub ไม่ได้): " + fileName, "Error");
      return { handled:true, route:"print-config-error" };
    }
    if (!result || !result.ok) {
      _linePush(target, "⚠️ รับไฟล์ไม่ได้: " + String(result && result.msg || "Print Hub ไม่ตอบกลับ"));
      _printHubLog_(userId, user.name, "ส่งไฟล์พิมพ์ไม่สำเร็จ: " + fileName, "Error");
      return { handled:true, route:"print-upload-error" };
    }

    _clearPrintHubSession_(sourceId, userId);
    var facts = {jobId:result.jobId,fileName:fileName,agentOnline:!!result.agentOnline,status:result.status || ""};
    if (result.agentOnline) {
      _printHubPushFlex_(target, _printHubConfirmFlex_({
        jobId:result.jobId, fileName:fileName, copies:Number(getConfig("PRINT_HUB_DEFAULT_COPIES") || 1),
        isGroup:!!isGroup, sourceType:isGroup ? "group" : "private"
      }));
    } else {
      _linePush(target, _printHubFactsReply_(
        _printHubReplyConfig_("PRINT_HUB_WAIT_REPLY",
          "✅ รับไฟล์ไว้ในคิวแล้วครับ\nขณะนี้คอม Print Hub ยังออฟไลน์อยู่ เมื่อ Print Hub ออนไลน์ ระบบจะแจ้งให้คุณยืนยันอีกครั้งก่อนพิมพ์ครับ"),
        facts));
    }
    _printHubLog_(userId, user.name, "ส่งไฟล์เข้าคิวพิมพ์: " + fileName, "Success");
    return { handled:true, route:"print-media" };
  } catch (e) {
    _linePush(target, "⚠️ เกิดข้อผิดพลาดในการรับไฟล์พิมพ์ กรุณาลองใหม่อีกครั้งครับ");
    _printHubLog_(userId, user.name, "รับไฟล์พิมพ์ผิดพลาด: " + String(e && e.message || e), "Error");
    return { handled:true, route:"print-media-error" };
  }
}

function _printHubMimeFromExt_(ext) {
  var map = { pdf:"application/pdf", jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png" };
  return map[String(ext || "").toLowerCase()] || "application/octet-stream";
}

/**
 * Poll pending PrintHub events. Intended for a 1-minute time trigger after deployment.
 * This function is inert until PRINT_HUB_STATUS=ON and bridge credentials are configured.
 */
function processPrintHubNotifications_() {
  if (!_printHubOn_()) return {ok:true, skipped:"OFF"};
  var pending = _printHubBridge_("line_pending", { limit:30 });
  if (!pending || !pending.ok || !pending.events) return pending || {ok:false};

  var sent = 0;
  var dropped = 0;
  pending.events.forEach(function(ev) {
    var target = String(ev.sourceId || ev.lineUserId || "");
    if (!target) {
      if (_printHubGiveUpOnEvent_(ev)) dropped++;
      return;
    }
    var ok = false;
    try {
      if (ev.type === "CONFIRM" && ev.job) {
        ev.job.sourceType = ev.sourceType || ev.job.sourceType || "";
        ev.job.isGroup = String(ev.sourceType || "").toLowerCase() === "group";
        var flex = _printHubConfirmFlex_(ev.job);
        var r = _linePost("https://api.line.me/v2/bot/message/push", {
          to:target, messages:[{type:"flex", altText:flex.altText, contents:flex.contents}]
        });
        ok = r && r.responseCode === 200;
      } else {
        var msg = "";
        if (ev.type === "PRINTING") msg = "🖨️ กำลังพิมพ์ " + String(ev.fileName || "เอกสาร") + " ครับ";
        else if (ev.type === "SENT" && ev.job) {
          ev.job.sourceType = ev.sourceType || ev.job.sourceType || "";
          ev.job.isGroup = String(ev.sourceType || "").toLowerCase() === "group";
          var recvFlex = _printHubReceivedFlex_(ev.job);
          var sentRes = _linePost("https://api.line.me/v2/bot/message/push", {
            to:target, messages:[{type:"flex", altText:recvFlex.altText, contents:recvFlex.contents}]
          });
          ok = sentRes && sentRes.responseCode === 200;
        }
        else if (ev.type === "DONE") msg = _printHubReplyConfig_("PRINT_HUB_COMPLETED_REPLY", "✅ พิมพ์เอกสารเรียบร้อยแล้วครับ");
        else if (ev.type === "ERROR") msg = _printHubReplyConfig_("PRINT_HUB_FAILED_REPLY", "⚠️ งานพิมพ์ไม่สำเร็จ กรุณาตรวจสอบ Print Hub ครับ");
        if (!ok && msg) {
          var p = _linePush(target, _printHubFactsReply_(msg, {
            status:ev.type, fileName:ev.fileName || "", jobId:ev.jobId || "", error:ev.error || ""
          }));
          ok = p && p.responseCode === 200;
        }
      }
    } catch (e) {}
    if (ok) {
      _printHubBridge_("line_mark_notified", { eventId:ev.eventId, jobId:ev.jobId, type:ev.type });
      _printHubClearAttempts_(ev);
      sent++;
    } else if (_printHubGiveUpOnEvent_(ev)) {
      dropped++;
    }
  });
  return {ok:true, sent:sent, dropped:dropped};
}

function _printHubAttemptKey_(ev) {
  return "printHubNotifyTry:" + String((ev && (ev.eventId || ev.jobId)) || "");
}

/**
 * An event that can never be delivered — unknown type, missing payload, no target — used to
 * stay pending forever and be re-fetched every minute. Count the failures and retire it.
 */
function _printHubGiveUpOnEvent_(ev) {
  if (!ev || !(ev.eventId || ev.jobId)) return false;
  var key = _printHubAttemptKey_(ev);
  var cache = CacheService.getScriptCache();
  var tries = Number(cache.get(key) || 0) + 1;
  if (tries >= PRINT_HUB_MAX_NOTIFY_ATTEMPTS_) {
    _printHubBridge_("line_mark_notified", {
      eventId:ev.eventId, jobId:ev.jobId, type:ev.type, result:"SKIPPED", attempts:tries
    });
    cache.remove(key);
    _printHubLog_("", "system", "ข้ามการแจ้งเตือนงานพิมพ์ที่ส่งไม่สำเร็จ: " + String(ev.eventId || ev.jobId), "Error");
    return true;
  }
  cache.put(key, String(tries), 6 * 60 * 60);
  return false;
}

function _printHubClearAttempts_(ev) {
  try { CacheService.getScriptCache().remove(_printHubAttemptKey_(ev)); } catch (e) {}
}

function installPrintHubNotificationTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === "processPrintHubNotifications_";
  });
  if (!exists) ScriptApp.newTrigger("processPrintHubNotifications_").timeBased().everyMinutes(1).create();
  return {ok:true, created:!exists};
}
