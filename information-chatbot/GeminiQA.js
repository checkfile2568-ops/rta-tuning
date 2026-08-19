/**
 * GeminiQA.js
 * ระบบถาม-ตอบ Gemini สำหรับ Information Chatbot เท่านั้น
 *
 * หลักการความปลอดภัย:
 * 1) API key อยู่ใน Script Properties ชื่อ GEMINI_API_KEY เท่านั้น
 * 2) ตรวจสถานะ ผู้ใช้ และ source/group ก่อนเรียก API ทุกครั้ง
 * 3) กลุ่มต้องใช้ prefix ที่ผู้ดูแลกำหนด เช่น "บอทถาม"
 * 4) ไม่ให้ Gemini เรียกฟังก์ชันหรือเข้าถึง Spreadsheet/Drive โดยตรง
 * 5) ผลลัพธ์จาก Gemini ถูกบังคับเป็น JSON และแปลงกลับเป็นข้อความภาษาไทยก่อนตอบ LINE
 *
 * ชีตที่สร้างเมื่อใช้งาน:
 *   GeminiQA_AUDIT
 *     timestamp | user_id | user_name | source_id | is_group | question |
 *     status | answer | model | duration_ms | error
 */

var GEMINI_QA_MODEL_ = "gemini-2.0-flash";
var GEMINI_QA_API_BASE_ = "https://generativelanguage.googleapis.com/v1beta/models/";
var GEMINI_QA_AUDIT_SHEET_NAME_ = "GeminiQA_AUDIT";
var GEMINI_QA_AUDIT_HEADERS_ = [
  "timestamp", "user_id", "user_name", "source_id", "is_group", "question",
  "status", "answer", "model", "duration_ms", "error"
];
var GEMINI_QA_DEFAULT_PREFIX_ = "บอทถาม";
var GEMINI_QA_DEFAULT_MAX_TOKENS_ = 1024;
var GEMINI_QA_MAX_PROMPT_CHARS_ = 6000;
var GEMINI_QA_MAX_SYSTEM_PROMPT_CHARS_ = 8000;
var GEMINI_QA_DEFAULT_SYSTEM_PROMPT_ =
  "คุณคือผู้ช่วยตอบคำถามภาษาไทยของระบบ LINE Chatbot ศาลจังหวัดลพบุรี " +
  "ตอบสั้น กระชับ สุภาพ และเข้าใจง่าย ใช้ข้อมูลที่มีอยู่เท่านั้น " +
  "ห้ามแต่งข้อเท็จจริง ห้ามเปิดเผย API key รหัสผ่าน token ข้อมูลส่วนตัว หรือข้อมูลลับของระบบ " +
  "ห้ามอ้างว่าคำตอบเป็นคำสั่งศาลหรือคำวินิจฉัยทางกฎหมาย หากคำถามต้องใช้ข้อมูลปัจจุบัน " +
  "หรือไม่มีข้อมูลเพียงพอ ให้แจ้งอย่างตรงไปตรงมาว่าไม่สามารถยืนยันได้ และเสนอให้ติดต่อเจ้าหน้าที่ " +
  "ตอบเป็นภาษาไทยเสมอ";
var GEMINI_QA_DEFAULT_BLOCKED_TOPICS_ = "รหัสผ่าน,api key,token,ข้อมูลส่วนตัว,ข้อมูลลับ,คาดเดาผลคดี,ตัดสินคดี";

function _geminiQAConfig_(key, fallback) {
  try {
    if (typeof getConfig === "function") {
      var value = getConfig(key);
      if (value !== null && value !== undefined && String(value).trim() !== "") return value;
    }
  } catch (e) {
    Logger.log("GeminiQA config read error: " + e.message);
  }
  return fallback;
}

function _geminiQAText_(value, maxLen) {
  var text = String(value === null || value === undefined ? "" : value);
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return text.substring(0, maxLen || 4000);
}

function _geminiQACsv_(value, fallback) {
  var raw = String(value === null || value === undefined ? "" : value).trim();
  if (!raw) raw = String(fallback || "");
  return raw.split(/[,|\n]+/).map(function(item) {
    return _geminiQAText_(item, 200).trim();
  }).filter(Boolean);
}

function _geminiQABool_(value, fallback) {
  var raw = String(value === null || value === undefined ? "" : value).trim().toUpperCase();
  if (!raw) return fallback !== false;
  return ["ON", "TRUE", "1", "YES", "เปิด", "ใช้งาน", "ENABLED"].indexOf(raw) >= 0;
}

function _geminiQAClampTokens_(value) {
  var number = Number(value);
  if (!isFinite(number)) number = GEMINI_QA_DEFAULT_MAX_TOKENS_;
  return Math.max(256, Math.min(Math.floor(number), 4096));
}

function _geminiQAEnabled_() {
  return _geminiQABool_(_geminiQAConfig_("GEMINI_QA_STATUS", "OFF"), false);
}

function _isGeminiQAEnabled_() {
  return _geminiQAEnabled_();
}

function _geminiQAWildcardMatch_(value, list) {
  var target = String(value || "").trim();
  if (!target) return false;
  if (!list || !list.length) return false;
  for (var i = 0; i < list.length; i++) {
    var item = String(list[i] || "").trim();
    if (!item) continue;
    if (["*", "ALL", "ทุกคน", "ทั้งหมด"].indexOf(item.toUpperCase()) >= 0) return true;
    if (item === target) return true;
  }
  return false;
}

function _geminiQAAllowedUsers_() {
  var configured = _geminiQACsv_(_geminiQAConfig_("GEMINI_QA_ALLOWED_USERS", ""), "");
  if (configured.length) return configured;
  try {
    if (typeof getAdminIds === "function") return getAdminIds();
  } catch (e) {}
  return [];
}

function _geminiQAAllowedSources_() {
  return _geminiQACsv_(_geminiQAConfig_("GEMINI_QA_ALLOWED_SOURCES", ""), "");
}

function _isGeminiQAAllowed_(userId, sourceId, isGroup) {
  if (!_geminiQAEnabled_()) return false;
  var allowedUsers = _geminiQAAllowedUsers_();
  if (!_geminiQAWildcardMatch_(userId, allowedUsers)) return false;
  var allowedSources = _geminiQAAllowedSources_();
  if (allowedSources.length && !_geminiQAWildcardMatch_(sourceId, allowedSources)) return false;
  return true;
}

function _geminiQARegexEscape_(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function _geminiQAPrefix_() {
  return String(_geminiQAConfig_("GEMINI_QA_GROUP_PREFIX", GEMINI_QA_DEFAULT_PREFIX_) || GEMINI_QA_DEFAULT_PREFIX_).trim();
}

function _geminiQAStripGroupPrefix_(messageText) {
  var text = String(messageText || "").trim();
  var prefix = _geminiQAPrefix_();
  if (!prefix) return { matched: false, text: text };
  var pattern = new RegExp("^\\/?#?" + _geminiQARegexEscape_(prefix) + "(?:\\s+|$)([\\s\\S]*)$", "i");
  var match = text.match(pattern);
  return { matched: !!match, text: match ? String(match[1] || "").trim() : text };
}

function _shouldHandleGeminiQAText_(messageText, isGroup) {
  if (!_geminiQAEnabled_()) return false;
  if (isGroup) return _geminiQAStripGroupPrefix_(messageText).matched;
  var text = String(messageText || "").trim();
  if (!text || text.charAt(0) === "/") return false;
  return true;
}

function _geminiQATopicBlocked_(prompt) {
  var configured = _geminiQACsv_(
    _geminiQAConfig_("GEMINI_QA_BLOCKED_TOPICS", GEMINI_QA_DEFAULT_BLOCKED_TOPICS_),
    GEMINI_QA_DEFAULT_BLOCKED_TOPICS_
  );
  var text = String(prompt || "").toLowerCase();
  return configured.filter(function(topic) {
    return text.indexOf(String(topic).toLowerCase()) >= 0;
  });
}

function _geminiQATopicAllowed_(prompt) {
  var configured = _geminiQACsv_(_geminiQAConfig_("GEMINI_QA_ALLOWED_TOPICS", ""), "");
  if (!configured.length) return true;
  var text = String(prompt || "").toLowerCase();
  return configured.some(function(topic) {
    return text.indexOf(String(topic).toLowerCase()) >= 0;
  });
}

function _geminiQASystemPrompt_() {
  var adminPrompt = _geminiQAText_(_geminiQAConfig_("GEMINI_QA_SYSTEM_PROMPT", ""), GEMINI_QA_MAX_SYSTEM_PROMPT_CHARS_).trim();
  var policy = GEMINI_QA_DEFAULT_SYSTEM_PROMPT_;
  if (adminPrompt) policy += "\n\nนโยบายเพิ่มเติมจากผู้ดูแลระบบ:\n" + adminPrompt;
  var allowed = _geminiQACsv_(_geminiQAConfig_("GEMINI_QA_ALLOWED_TOPICS", ""), "");
  if (allowed.length) policy += "\n\nหัวข้อที่อนุญาตเพิ่มเติม: " + allowed.join(", ");
  return _geminiQAText_(policy, GEMINI_QA_MAX_SYSTEM_PROMPT_CHARS_);
}

function _geminiQAEnsureAuditSheet_() {
  var ss = typeof _getSS === "function" ? _getSS() : SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(GEMINI_QA_AUDIT_SHEET_NAME_);
  if (!sheet) sheet = ss.insertSheet(GEMINI_QA_AUDIT_SHEET_NAME_);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, GEMINI_QA_AUDIT_HEADERS_.length).setValues([GEMINI_QA_AUDIT_HEADERS_]);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < GEMINI_QA_AUDIT_HEADERS_.length) {
    sheet.getRange(1, 1, 1, GEMINI_QA_AUDIT_HEADERS_.length).setValues([GEMINI_QA_AUDIT_HEADERS_]);
  }
  return sheet;
}

function _geminiQAAuditEnabled_() {
  return _geminiQABool_(_geminiQAConfig_("GEMINI_QA_SAVE_HISTORY", "ON"), true);
}

function _geminiQAAppendAudit_(record) {
  if (!_geminiQAAuditEnabled_()) return;
  try {
    var lock = LockService.getScriptLock();
    lock.tryLock(2000);
    var sheet = _geminiQAEnsureAuditSheet_();
    var timestamp = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
    sheet.appendRow([
      timestamp,
      _geminiQAText_(record.userId, 120),
      _geminiQAText_(record.userName, 120),
      _geminiQAText_(record.sourceId, 120),
      record.isGroup ? "TRUE" : "FALSE",
      _geminiQAText_(record.question, 2000),
      _geminiQAText_(record.status, 40),
      _geminiQAText_(record.answer, 4000),
      _geminiQAText_(record.model || GEMINI_QA_MODEL_, 80),
      Number(record.durationMs) || 0,
      _geminiQAText_(record.error, 500)
    ]);
    try { lock.releaseLock(); } catch (ignore) {}
  } catch (e) {
    Logger.log("GeminiQA audit error: " + e.message);
  }
}

function _geminiQAApiKey_() {
  try {
    return String(PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "").trim();
  } catch (e) {
    Logger.log("GeminiQA Script Properties error: " + e.message);
    return "";
  }
}

function _geminiQAImagePart_(imageBase64) {
  if (!imageBase64) return null;
  var data = imageBase64;
  var mimeType = "image/jpeg";
  if (typeof imageBase64 === "object") {
    data = imageBase64.data || imageBase64.base64 || "";
    mimeType = imageBase64.mimeType || imageBase64.contentType || mimeType;
  }
  data = String(data || "").trim();
  var dataUrlMatch = data.match(/^data:([^;]+);base64,(.*)$/i);
  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1] || mimeType;
    data = dataUrlMatch[2];
  }
  if (!data) return null;
  return { inlineData: { mimeType: String(mimeType).substring(0, 80), data: data } };
}

function _geminiQABody_(prompt, imageBase64, systemPrompt) {
  var parts = [{ text: _geminiQAText_(prompt, GEMINI_QA_MAX_PROMPT_CHARS_) }];
  var imagePart = _geminiQAImagePart_(imageBase64);
  if (imagePart) parts.push(imagePart);
  return {
    systemInstruction: { parts: [{ text: _geminiQAText_(systemPrompt || _geminiQASystemPrompt_(), GEMINI_QA_MAX_SYSTEM_PROMPT_CHARS_) }] },
    contents: [{ role: "user", parts: parts }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: _geminiQAClampTokens_(_geminiQAConfig_("GEMINI_QA_MAX_TOKENS", GEMINI_QA_DEFAULT_MAX_TOKENS_)),
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          answer: { type: "STRING", description: "คำตอบภาษาไทยสำหรับผู้ใช้" },
          status: { type: "STRING", enum: ["ANSWER", "REFUSE", "NEED_CLARIFICATION"] },
          used_sources: { type: "ARRAY", items: { type: "STRING" } },
          confidence: { type: "NUMBER" }
        },
        required: ["answer", "status", "used_sources", "confidence"],
        propertyOrdering: ["answer", "status", "used_sources", "confidence"]
      }
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
    ]
  };
}

function _geminiQAParseResponse_(payload) {
  var parts = [];
  if (payload && payload.candidates && payload.candidates[0] && payload.candidates[0].content) {
    parts = payload.candidates[0].content.parts || [];
  }
  var raw = parts.map(function(part) { return part && part.text ? String(part.text) : ""; }).join("").trim();
  if (!raw) {
    var finish = payload && payload.candidates && payload.candidates[0] ? payload.candidates[0].finishReason : "";
    return { ok: false, error: "Gemini ไม่ส่งข้อความกลับ" + (finish ? " (" + finish + ")" : "") };
  }
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    parsed = {
      answer: raw,
      status: "ANSWER",
      used_sources: [],
      confidence: 0
    };
  }
  var answer = _geminiQAText_(parsed.answer || raw, 4000).trim();
  var status = ["ANSWER", "REFUSE", "NEED_CLARIFICATION"].indexOf(String(parsed.status || "ANSWER")) >= 0
    ? String(parsed.status || "ANSWER") : "ANSWER";
  var sources = Array.isArray(parsed.used_sources) ? parsed.used_sources.map(function(item) {
    return _geminiQAText_(item, 200);
  }).filter(Boolean).slice(0, 10) : [];
  var confidence = Number(parsed.confidence);
  if (!isFinite(confidence)) confidence = 0;
  return {
    ok: !!answer,
    answer: answer || "ยังไม่มีคำตอบที่ยืนยันได้",
    status: status,
    used_sources: sources,
    confidence: Math.max(0, Math.min(confidence, 1)),
    raw: raw
  };
}

function _callGeminiAPI_(prompt, imageBase64, systemPrompt) {
  var apiKey = _geminiQAApiKey_();
  if (!apiKey) return { ok: false, error: "ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Script Properties" };
  var endpoint = GEMINI_QA_API_BASE_ + GEMINI_QA_MODEL_ + ":generateContent?key=" + encodeURIComponent(apiKey);
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(_geminiQABody_(prompt, imageBase64, systemPrompt)),
    muteHttpExceptions: true
  };
  try {
    var response = UrlFetchApp.fetch(endpoint, options);
    var code = response.getResponseCode();
    var body = response.getContentText() || "";
    var payload;
    try { payload = JSON.parse(body); } catch (parseError) { payload = null; }
    if (code < 200 || code >= 300) {
      var apiMessage = payload && payload.error && payload.error.message ? payload.error.message : "HTTP " + code;
      return { ok: false, error: _geminiQAText_(apiMessage, 500), httpCode: code };
    }
    return _geminiQAParseResponse_(payload || {});
  } catch (e) {
    return { ok: false, error: _geminiQAText_(e && e.message ? e.message : String(e), 500) };
  }
}

function _geminiQASendText_(replyToken, text) {
  if (typeof safeSendReply === "function") return safeSendReply(replyToken, _geminiQAText_(text, 4500));
  if (typeof sendUniversalReply === "function") return sendUniversalReply(replyToken, _geminiQAText_(text, 4500));
  return null;
}

function handleGeminiQAMessage_(messageText, userId, userName, sourceId, isGroup, replyToken, imageBlob) {
  var started = Date.now();
  var rawText = String(messageText || "").trim();
  if (!_geminiQAEnabled_()) return { handled: false, reason: "gemini qa disabled" };

  var trigger = isGroup ? _geminiQAStripGroupPrefix_(rawText) : { matched: rawText.charAt(0) !== "/" && !!rawText, text: rawText };
  if (!trigger.matched) return { handled: false, reason: "not gemini qa text" };
  var prompt = _geminiQAText_(trigger.text, GEMINI_QA_MAX_PROMPT_CHARS_).trim();
  if (!prompt) {
    _geminiQASendText_(replyToken, "กรุณาพิมพ์คำถามหลังคำว่า " + _geminiQAPrefix_() + " เช่น " + _geminiQAPrefix_() + " เวลาทำการ");
    return { handled: true, reason: "empty prompt" };
  }

  var blocked = _geminiQATopicBlocked_(prompt);
  if (blocked.length || !_geminiQATopicAllowed_(prompt)) {
    var blockedMessage = "ขออภัย คำถามนี้อยู่นอกขอบเขตที่ผู้ดูแลระบบอนุญาต กรุณาติดต่อเจ้าหน้าที่หากต้องการข้อมูลเพิ่มเติม";
    _geminiQASendText_(replyToken, blockedMessage);
    _geminiQAAppendAudit_({
      userId: userId, userName: userName, sourceId: sourceId, isGroup: isGroup,
      question: prompt, status: "BLOCKED_POLICY", answer: blockedMessage,
      durationMs: Date.now() - started, error: blocked.join(",")
    });
    return { handled: true, status: "BLOCKED_POLICY" };
  }

  var allowed = _isGeminiQAAllowed_(userId, sourceId, isGroup);
  if (!allowed) {
    if (isGroup) {
      var denied = "ขออภัย บัญชีหรือห้องแชทนี้ยังไม่ได้รับอนุญาตให้ใช้ระบบถาม-ตอบ";
      _geminiQASendText_(replyToken, denied);
      _geminiQAAppendAudit_({
        userId: userId, userName: userName, sourceId: sourceId, isGroup: isGroup,
        question: prompt, status: "DENIED", answer: denied,
        durationMs: Date.now() - started, error: "allowlist"
      });
      return { handled: true, status: "DENIED" };
    }
    return { handled: false, reason: "gemini qa user/source not allowed" };
  }

  var imageBase64 = imageBlob;
  if (imageBlob && typeof imageBlob.getBytes === "function") {
    imageBase64 = {
      data: Utilities.base64Encode(imageBlob.getBytes()),
      mimeType: imageBlob.getContentType ? imageBlob.getContentType() : "image/jpeg"
    };
  }
  var result = _callGeminiAPI_(prompt, imageBase64, _geminiQASystemPrompt_());
  if (!result.ok) {
    var errorReply = "ระบบถาม-ตอบ AI ยังไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่ภายหลังหรือติดต่อผู้ดูแลระบบ";
    _geminiQASendText_(replyToken, errorReply);
    _geminiQAAppendAudit_({
      userId: userId, userName: userName, sourceId: sourceId, isGroup: isGroup,
      question: prompt, status: "ERROR", answer: errorReply,
      durationMs: Date.now() - started, error: result.error
    });
    return { handled: true, status: "ERROR", error: result.error };
  }

  var answer = result.answer || "ยังไม่มีคำตอบที่ยืนยันได้";
  _geminiQASendText_(replyToken, answer);
  _geminiQAAppendAudit_({
    userId: userId, userName: userName, sourceId: sourceId, isGroup: isGroup,
    question: prompt, status: result.status || "ANSWER", answer: answer,
    model: GEMINI_QA_MODEL_, durationMs: Date.now() - started, error: ""
  });
  return {
    handled: true,
    status: result.status || "ANSWER",
    answer: answer,
    confidence: result.confidence || 0,
    used_sources: result.used_sources || []
  };
}

function _geminiQASettingsObject_() {
  var status = _geminiQABool_(_geminiQAConfig_("GEMINI_QA_STATUS", "OFF"), false) ? "ON" : "OFF";
  var allowedUsers = String(_geminiQAConfig_("GEMINI_QA_ALLOWED_USERS", "") || "");
  var allowedSources = String(_geminiQAConfig_("GEMINI_QA_ALLOWED_SOURCES", "") || "");
  var groupPrefix = _geminiQAPrefix_();
  var systemPrompt = String(_geminiQAConfig_("GEMINI_QA_SYSTEM_PROMPT", "") || "");
  var maxTokens = _geminiQAClampTokens_(_geminiQAConfig_("GEMINI_QA_MAX_TOKENS", GEMINI_QA_DEFAULT_MAX_TOKENS_));
  var allowedTopics = String(_geminiQAConfig_("GEMINI_QA_ALLOWED_TOPICS", "") || "");
  var blockedTopics = String(_geminiQAConfig_("GEMINI_QA_BLOCKED_TOPICS", GEMINI_QA_DEFAULT_BLOCKED_TOPICS_) || "");
  var saveHistory = _geminiQABool_(_geminiQAConfig_("GEMINI_QA_SAVE_HISTORY", "ON"), true) ? "ON" : "OFF";
  var hasApiKey = !!_geminiQAApiKey_();
  return {
    success: true,
    // Upper-case keys are the canonical Dashboard contract.
    GEMINI_QA_STATUS: status,
    GEMINI_QA_ALLOWED_USERS: allowedUsers,
    GEMINI_QA_ALLOWED_SOURCES: allowedSources,
    GEMINI_QA_GROUP_PREFIX: groupPrefix,
    GEMINI_QA_SYSTEM_PROMPT: systemPrompt,
    GEMINI_QA_MAX_TOKENS: maxTokens,
    GEMINI_QA_ALLOWED_TOPICS: allowedTopics,
    GEMINI_QA_BLOCKED_TOPICS: blockedTopics,
    GEMINI_QA_SAVE_HISTORY: saveHistory,
    apiKeyConfigured: hasApiKey,
    // Lower-case aliases keep the RPC useful for older UI code.
    status: status,
    allowedUsers: allowedUsers,
    allowedSources: allowedSources,
    groupPrefix: groupPrefix,
    systemPrompt: systemPrompt,
    maxTokens: maxTokens,
    allowedTopics: allowedTopics,
    blockedTopics: blockedTopics,
    saveHistory: saveHistory,
    hasApiKey: hasApiKey,
    model: GEMINI_QA_MODEL_,
    auditSheet: GEMINI_QA_AUDIT_SHEET_NAME_
  };
}

function getGeminiQASettings() {
  try {
    return _geminiQASettingsObject_();
  } catch (e) {
    return { success: false, error: _geminiQAText_(e.message || String(e), 500) };
  }
}

function saveGeminiQASettings(payload) {
  try {
    payload = payload || {};
    var settings = payload.settings && typeof payload.settings === "object" ? payload.settings : payload;
    var textKeys = {
      GEMINI_QA_ALLOWED_USERS: settings.allowedUsers !== undefined ? settings.allowedUsers : settings.GEMINI_QA_ALLOWED_USERS,
      GEMINI_QA_ALLOWED_SOURCES: settings.allowedSources !== undefined ? settings.allowedSources : settings.GEMINI_QA_ALLOWED_SOURCES,
      GEMINI_QA_GROUP_PREFIX: settings.groupPrefix !== undefined ? settings.groupPrefix : settings.GEMINI_QA_GROUP_PREFIX,
      GEMINI_QA_SYSTEM_PROMPT: settings.systemPrompt !== undefined ? settings.systemPrompt : settings.GEMINI_QA_SYSTEM_PROMPT,
      GEMINI_QA_ALLOWED_TOPICS: settings.allowedTopics !== undefined ? settings.allowedTopics : settings.GEMINI_QA_ALLOWED_TOPICS,
      GEMINI_QA_BLOCKED_TOPICS: settings.blockedTopics !== undefined ? settings.blockedTopics : settings.GEMINI_QA_BLOCKED_TOPICS
    };
    Object.keys(textKeys).forEach(function(key) {
      if (textKeys[key] !== undefined) {
        var max = key === "GEMINI_QA_SYSTEM_PROMPT" ? GEMINI_QA_MAX_SYSTEM_PROMPT_CHARS_ : 4000;
        if (typeof setConfig === "function") setConfig(key, _geminiQAText_(textKeys[key], max).trim());
      }
    });
    var statusValue = settings.status !== undefined ? settings.status : settings.GEMINI_QA_STATUS;
    if (statusValue !== undefined && typeof setConfig === "function") {
      setConfig("GEMINI_QA_STATUS", _geminiQABool_(statusValue, false) ? "ON" : "OFF");
    }
    var historyValue = settings.saveHistory !== undefined ? settings.saveHistory : settings.GEMINI_QA_SAVE_HISTORY;
    if (historyValue !== undefined && typeof setConfig === "function") {
      setConfig("GEMINI_QA_SAVE_HISTORY", _geminiQABool_(historyValue, true) ? "ON" : "OFF");
    }
    var maxTokensValue = settings.maxTokens !== undefined ? settings.maxTokens : settings.GEMINI_QA_MAX_TOKENS;
    if (maxTokensValue !== undefined && typeof setConfig === "function") {
      setConfig("GEMINI_QA_MAX_TOKENS", String(_geminiQAClampTokens_(maxTokensValue)));
    }
    if (settings.apiKey !== undefined && String(settings.apiKey || "").trim()) {
      var apiKey = String(settings.apiKey).trim().replace(/[\r\n\s]/g, "");
      if (apiKey.length < 20 || apiKey.length > 300) return { success: false, error: "รูปแบบ API key ไม่ถูกต้อง" };
      PropertiesService.getScriptProperties().setProperty("GEMINI_API_KEY", apiKey);
    }
    if (settings.clearApiKey === true) PropertiesService.getScriptProperties().deleteProperty("GEMINI_API_KEY");
    SpreadsheetApp.flush();
    return _geminiQASettingsObject_();
  } catch (e) {
    return { success: false, error: _geminiQAText_(e.message || String(e), 500) };
  }
}

function getGeminiQAHistory(limit) {
  var max = Math.max(1, Math.min(Number(limit) || 50, 100));
  try {
    var sheet = _geminiQAEnsureAuditSheet_();
    if (sheet.getLastRow() <= 1) return { success: true, rows: [] };
    var firstRow = Math.max(2, sheet.getLastRow() - max + 1);
    var count = sheet.getLastRow() - firstRow + 1;
    var values = sheet.getRange(firstRow, 1, count, GEMINI_QA_AUDIT_HEADERS_.length).getDisplayValues();
    return {
      success: true,
      rows: values.reverse().map(function(row) {
        return {
          timestamp: row[0], userId: row[1], userName: row[2], sourceId: row[3],
          isGroup: row[4], question: row[5], status: row[6], answer: row[7],
          model: row[8], durationMs: row[9], error: row[10]
        };
      })
    };
  } catch (e) {
    return { success: false, error: _geminiQAText_(e.message || String(e), 500), rows: [] };
  }
}

function testGeminiQA(prompt) {
  var question = _geminiQAText_(prompt || "ทดสอบระบบถามตอบ กรุณาตอบว่า ระบบพร้อมใช้งาน", GEMINI_QA_MAX_PROMPT_CHARS_).trim();
  if (!question) question = "ทดสอบระบบถามตอบ กรุณาตอบว่า ระบบพร้อมใช้งาน";
  var result = _callGeminiAPI_(question, null, _geminiQASystemPrompt_());
  if (!result.ok) return { success: false, error: result.error };
  return {
    success: true,
    answer: result.answer,
    text: result.answer,
    status: result.status,
    confidence: result.confidence,
    usedSources: result.used_sources || [],
    model: GEMINI_QA_MODEL_
  };
}

function setupGeminiQASheet() {
  try {
    _geminiQAEnsureAuditSheet_();
    return { success: true, sheet: GEMINI_QA_AUDIT_SHEET_NAME_ };
  } catch (e) {
    return { success: false, error: _geminiQAText_(e.message || String(e), 500) };
  }
}
