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

function _printHubOn_() {
  return String(getConfig("PRINT_HUB_STATUS") || "OFF").toUpperCase() === "ON";
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
    PRINT_HUB_SESSION_TTL_SEC_
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
  return String(text || "").trim().replace(/\s+/g, " ");
}

function _printHubDetectIntentDeterministic_(text) {
  var t = _printHubNormalize_(text).toLowerCase();
  if (!t) return { intent: "NONE" };

  var confirm = t.match(/^(?:ยืนยัน(?:พิมพ์)?|ตกลงพิมพ์|พิมพ์เลย)\s+([a-z0-9_-]+)$/i);
  if (confirm) return { intent: "PRINT_CONFIRM", jobId: confirm[1] };

  var cancel = t.match(/^(?:ยกเลิก(?:พิมพ์)?|ไม่พิมพ์|ลบงานพิมพ์)\s+([a-z0-9_-]+)$/i);
  if (cancel) return { intent: "PRINT_CANCEL", jobId: cancel[1] };

  var reprint = t.match(/^(?:พิมพ์ซ้ำ|ปริ้นซ้ำ)\s+([a-z0-9_-]+)$/i);
  if (reprint) return { intent: "PRINT_REPRINT", jobId: reprint[1] };

  if (/^(?:สถานะปริ้นฮับ|สถานะพิมพ์|เครื่องพิมพ์พร้อม|พิมพ์ได้ไหม|ปริ้นได้ไหม|คอมปริ้นฮับ)/i.test(t)) {
    return { intent: "PRINT_HUB_STATUS" };
  }
  if (/^(?:งานพิมพ์|คิวพิมพ์|ประวัติพิมพ์|หาไฟล์พิมพ์|ค้นหาไฟล์พิมพ์)/i.test(t)) {
    return { intent: "PRINT_HISTORY", query: t.replace(/^(?:งานพิมพ์|คิวพิมพ์|ประวัติพิมพ์|หาไฟล์พิมพ์|ค้นหาไฟล์พิมพ์)\s*/i, "") };
  }

  var keys = _printHubKeywords_();
  for (var i = 0; i < keys.length; i++) {
    if (t === keys[i] || t.indexOf(keys[i]) === 0 || t.indexOf("ช่วย" + keys[i]) >= 0 ||
        t.indexOf("ฝาก" + keys[i]) >= 0 || t.indexOf("ขอ" + keys[i]) >= 0) {
      return { intent: "PRINT_START" };
    }
  }
  if (/(พิมพ์|ปริ้น|ปรินต์|print)/i.test(t) && /(ไฟล์|เอกสาร|pdf|รูป|เครื่อง)/i.test(t)) {
    return { intent: "PRINT_START" };
  }
  return { intent: "NONE" };
}

function _printHubDetectIntentAI_(text) {
  if (String(getConfig("PRINT_HUB_NL_STATUS") || "ON").toUpperCase() !== "ON") return { intent: "NONE" };
  if (typeof _callGeminiAPI_ !== "function") return { intent: "NONE" };
  var prompt = [
    "จำแนก intent ของข้อความต่อไปนี้สำหรับระบบ PrintHub เท่านั้น",
    "ตอบเพียงหนึ่งบรรทัดจาก: PRINT_START, PRINT_HUB_STATUS, PRINT_HISTORY, NONE",
    "ห้ามตอบคำอธิบาย ห้ามสร้างสถานะ ห้ามอนุมานว่าเครื่องออนไลน์",
    "ข้อความ: " + _printHubNormalize_(text).substring(0, 500)
  ].join("\n");
  try {
    var r = _callGeminiAPI_(prompt, null, "คุณเป็น intent classifier เท่านั้น ตอบเฉพาะ label ที่กำหนด");
    var label = r && r.ok ? String(r.text || r.answer || "").trim().toUpperCase() : "";
    if (["PRINT_START","PRINT_HUB_STATUS","PRINT_HISTORY"].indexOf(label) >= 0) return { intent: label };
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
  if (String(getConfig("PRINT_HUB_AI_REPLY") || "ON").toUpperCase() !== "ON") return baseText;
  if (typeof _callGeminiAPI_ !== "function") return baseText;
  try {
    var factsText = JSON.stringify(facts || {});
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
          { type:"button", style:"primary", color:"#16A34A", action:{ type:"message", label:"✅ ยืนยันพิมพ์", text:"ยืนยันพิมพ์ " + id } },
          { type:"button", style:"secondary", action:{ type:"message", label:"❌ ยกเลิก", text:"ยกเลิกพิมพ์ " + id } }
        ]
      }
    }
  };
}

function _printHubStart_(messageText, user, userId, sourceId, isGroup, replyToken) {
  if (!_printHubAllowed_(user, userId)) {
    _printHubReply_(replyToken,
      _printHubReplyConfig_("PRINT_HUB_DENIED_REPLY", "🔒 ระบบสั่งพิมพ์สำหรับเจ้าหน้าที่ VIP/Admin เท่านั้นครับ"),
      { allowed:false }, userId);
    return { handled:true, route:"print-denied" };
  }
  if (!_printHubSourceAllowed_(isGroup)) return { handled:false };

  var status = _printHubBridge_("line_status", { lineUserId:userId, sourceId:sourceId });
  var facts = { allowed:true, agentOnline:!!(status && status.agentOnline), printer:status && status.printer || "" };
  _savePrintHubSession_(sourceId, userId, { state:"WAITING_FILE", isGroup:!!isGroup, userName:user.name });

  var base = facts.agentOnline
    ? _printHubReplyConfig_("PRINT_HUB_START_REPLY", "🖨️ ได้ครับ Print Hub พร้อมใช้งาน รองรับ PDF และรูปภาพ JPG/PNG ขนาด A4 ส่งไฟล์มาได้เลยครับ เมื่อรับไฟล์แล้วระบบจะให้ยืนยันก่อนพิมพ์")
    : _printHubReplyConfig_("PRINT_HUB_OFFLINE_REPLY", "🖨️ ได้ครับ ขณะนี้คอม Print Hub ยังออฟไลน์ แต่ส่ง PDF หรือรูปภาพ A4 มาได้เลยครับ ระบบจะเก็บไฟล์ไว้ และเมื่อ Print Hub ออนไลน์จะแจ้งให้ยืนยันก่อนพิมพ์");
  _printHubReply_(replyToken, base, facts, userId);
  return { handled:true, route:"print-start" };
}

function _handlePrintHubText_(messageText, user, userId, sourceId, isGroup, replyToken) {
  if (!_printHubOn_()) return { handled:false };
  if (!_printHubSourceAllowed_(isGroup)) return { handled:false };

  var detected = _printHubDetectIntent_(messageText);
  if (detected.intent === "NONE") return { handled:false };

  if (!_printHubAllowed_(user, userId)) {
    _printHubReply_(replyToken,
      _printHubReplyConfig_("PRINT_HUB_DENIED_REPLY", "🔒 ระบบสั่งพิมพ์สำหรับเจ้าหน้าที่ VIP/Admin เท่านั้นครับ"),
      { allowed:false }, userId);
    return { handled:true, route:"print-denied" };
  }

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
    _printHubReply_(replyToken, result && result.ok ? okText : "⚠️ " + String(result && result.msg || "ดำเนินการไม่สำเร็จ"),
      { ok:!!(result && result.ok), action:action, jobId:detected.jobId, agentOnline:!!(result && result.agentOnline) }, userId);
    return { handled:true, route:detected.intent === "PRINT_CONFIRM" ? "print-confirm" : "print-cancel" };
  }

  if (detected.intent === "PRINT_HISTORY") {
    var hist = _printHubBridge_("line_history", {
      lineUserId:userId, sourceId:sourceId, query:String(detected.query || "").substring(0, 120), limit:8
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
    var rp = _printHubBridge_("line_reprint", { jobId:detected.jobId, lineUserId:userId, sourceId:sourceId });
    _printHubReply_(replyToken,
      rp && rp.ok ? "✅ เตรียมไฟล์สำหรับพิมพ์ซ้ำแล้วครับ ระบบจะขอยืนยันก่อนพิมพ์" : "⚠️ " + String(rp && rp.msg || "พิมพ์ซ้ำไม่สำเร็จ"),
      {ok:!!(rp && rp.ok), jobId:rp && rp.jobId || detected.jobId}, userId);
    if (rp && rp.ok && rp.agentOnline && rp.job) sendUniversalReply(replyToken, _printHubConfirmFlex_(rp.job));
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
    copies:Number(getConfig("PRINT_HUB_DEFAULT_COPIES") || 1), paperSize:"A4"
  });
}

function _handlePrintHubMedia_(event, message, user, userId, sourceId, isGroup, replyToken) {
  if (!_printHubOn_() || !_printHubAllowed_(user, userId) || !_printHubSourceAllowed_(isGroup)) return { handled:false };
  var session = _getPrintHubSession_(sourceId, userId);
  if (!session || session.state !== "WAITING_FILE") return { handled:false };

  var type = String(message.type || "");
  if (type !== "file" && type !== "image") return { handled:false };

  var fileName = type === "file" ? String(message.fileName || "document.pdf") : ("LINE_image_" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss") + ".jpg");
  var mime = type === "file" ? String(message.contentProvider && message.contentProvider.type || "") : "image/jpeg";
  if (type === "file" && !/\.pdf$/i.test(fileName)) {
    _printHubReply_(replyToken,
      _printHubReplyConfig_("PRINT_HUB_UNSUPPORTED_REPLY", "⚠️ ระบบพิมพ์ผ่าน LINE รองรับ PDF และรูปภาพ JPG/PNG ในขณะนี้ครับ"),
      {fileName:fileName, supported:false}, userId);
    return { handled:true, route:"print-file-unsupported" };
  }

  try {
    var blob = _printHubDownloadLineBlob_(message.id);
    if (type === "file") mime = blob.getContentType() || "application/pdf";
    var result = _printHubUploadBlob_(blob, {
      userId:userId, sourceId:sourceId, isGroup:isGroup, userName:user.name, fileName:fileName, mimeType:mime
    });
    if (!result || !result.ok) {
      _printHubReply_(replyToken, "⚠️ รับไฟล์ไม่ได้: " + String(result && result.msg || "Print Hub ไม่ตอบกลับ"),
        {ok:false,fileName:fileName}, userId);
      return { handled:true, route:"print-upload-error" };
    }

    _clearPrintHubSession_(sourceId, userId);
    var facts = {jobId:result.jobId,fileName:fileName,agentOnline:!!result.agentOnline,status:result.status || ""};
    if (result.agentOnline) {
      _printHubReply_(replyToken,
        _printHubReplyConfig_("PRINT_HUB_RECEIVED_REPLY", "✅ รับไฟล์ไว้แล้วครับ Print Hub ออนไลน์ กรุณายืนยันก่อนพิมพ์"),
        facts, userId);
      sendUniversalReply(replyToken, _printHubConfirmFlex_({
        jobId:result.jobId, fileName:fileName, copies:Number(getConfig("PRINT_HUB_DEFAULT_COPIES") || 1)
      }));
    } else {
      _printHubReply_(replyToken,
        _printHubReplyConfig_("PRINT_HUB_WAIT_REPLY",
          "✅ รับไฟล์ไว้ในคิวแล้วครับ\nขณะนี้คอม Print Hub ยังออฟไลน์อยู่ เมื่อ Print Hub ออนไลน์ ระบบจะแจ้งให้คุณยืนยันอีกครั้งก่อนพิมพ์ครับ"),
        facts, userId);
    }
    return { handled:true, route:"print-media" };
  } catch (e) {
    _printHubReply_(replyToken, "⚠️ เกิดข้อผิดพลาดในการรับไฟล์พิมพ์", {error:true}, userId);
    return { handled:true, route:"print-media-error" };
  }
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
  pending.events.forEach(function(ev) {
    var target = String(ev.sourceId || ev.lineUserId || "");
    if (!target) return;
    var ok = false;
    try {
      if (ev.type === "CONFIRM" && ev.job) {
        var flex = _printHubConfirmFlex_(ev.job);
        var r = _linePost("https://api.line.me/v2/bot/message/push", {
          to:target, messages:[{type:"flex", altText:flex.altText, contents:flex.contents}]
        });
        ok = r && r.responseCode === 200;
      } else {
        var msg = "";
        if (ev.type === "PRINTING") msg = "🖨️ กำลังพิมพ์ " + String(ev.fileName || "เอกสาร") + " ครับ";
        else if (ev.type === "DONE") msg = _printHubReplyConfig_("PRINT_HUB_COMPLETED_REPLY", "✅ พิมพ์เอกสารเรียบร้อยแล้วครับ");
        else if (ev.type === "ERROR") msg = _printHubReplyConfig_("PRINT_HUB_FAILED_REPLY", "⚠️ งานพิมพ์ไม่สำเร็จ กรุณาตรวจสอบ Print Hub ครับ");
        if (msg) {
          var p = _linePush(target, _printHubFactsReply_(msg, {
            status:ev.type, fileName:ev.fileName || "", jobId:ev.jobId || "", error:ev.error || ""
          }));
          ok = p && p.responseCode === 200;
        }
      }
    } catch (e) {}
    if (ok) {
      _printHubBridge_("line_mark_notified", { eventId:ev.eventId, jobId:ev.jobId, type:ev.type });
      sent++;
    }
  });
  return {ok:true, sent:sent};
}

function installPrintHubNotificationTrigger() {
  var exists = ScriptApp.getProjectTriggers().some(function(t) {
    return t.getHandlerFunction() === "processPrintHubNotifications_";
  });
  if (!exists) ScriptApp.newTrigger("processPrintHubNotifications_").timeBased().everyMinutes(1).create();
  return {ok:true, created:!exists};
}
