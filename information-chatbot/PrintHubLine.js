/**
 * PrintHubLine.js
 * LINE -> PrintHub bridge (VIP/Admin only)
 *
 * Safe defaults:
 * - disabled until PRINT_HUB_LINE_STATUS=ON
 * - group messages still pass the existing group gate ("บอท ...")
 * - PDF/JPG/PNG only
 * - every uploaded job waits for user confirmation before it can become QUEUED
 * - PC Agent offline => keep WAIT_AGENT; when heartbeat returns, LINE asks for confirmation
 * - AI may only rephrase verified state; it never decides permission or print status
 */

var PRINT_HUB_LINE_SHEET_ = "PRINT_HUB_LINE";
var PRINT_HUB_LINE_HEADERS_ = [
  "ID","สร้างเมื่อ","อัปเดตเมื่อ","Job ID","Line User ID","ชื่อผู้ใช้","Source ID","Group",
  "ชื่อไฟล์","MIME","สถานะ","Agent Online","แจ้งออนไลน์แล้ว","สถานะแจ้งล่าสุด","Error"
];

function _printHubCfg_(key, fallback) {
  try {
    var value = getConfig(key);
    if (value !== null && value !== undefined && String(value) !== "") return String(value);
  } catch (e) {}
  return fallback;
}

function _printHubOn_(key, fallback) {
  return String(_printHubCfg_(key, fallback ? "ON" : "OFF")).toUpperCase() === "ON";
}

function _printHubEnabled_() {
  return _printHubOn_("PRINT_HUB_LINE_STATUS", false);
}

function _printHubAllowed_(user, userId) {
  var role = String(user && user.role || "").trim().toUpperCase();
  return role === "VIP" || (typeof isAdmin === "function" && isAdmin(userId));
}

function _printHubSourceAllowed_(sourceId, isGroup) {
  var raw = String(_printHubCfg_("PRINT_HUB_ALLOWED_SOURCES", "all")).trim();
  if (!raw || raw.toLowerCase() === "all") return true;
  if (typeof _isSourceAllowed === "function") return _isSourceAllowed(raw, sourceId, isGroup);
  var parts = raw.split(/[\n,]/).map(function(v){ return String(v || "").trim(); }).filter(Boolean);
  if (isGroup && parts.indexOf("groups") >= 0) return true;
  if (!isGroup && parts.indexOf("private") >= 0) return true;
  return parts.indexOf(String(sourceId || "")) >= 0;
}

function _printHubSessionKey_(userId, sourceId) {
  return "phs:" + String(userId || "") + ":" + String(sourceId || "");
}

function _printHubGetSession_(userId, sourceId) {
  try {
    var raw = CacheService.getScriptCache().get(_printHubSessionKey_(userId, sourceId));
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function _printHubSaveSession_(userId, sourceId, data) {
  var mins = Math.max(2, Math.min(30, parseInt(_printHubCfg_("PRINT_HUB_SESSION_MINUTES", "10"), 10) || 10));
  CacheService.getScriptCache().put(_printHubSessionKey_(userId, sourceId), JSON.stringify(data || {}), mins * 60);
}

function _printHubClearSession_(userId, sourceId) {
  try { CacheService.getScriptCache().remove(_printHubSessionKey_(userId, sourceId)); } catch (e) {}
}

function _printHubBridgeUrl_() {
  return String(_printHubCfg_("PRINT_HUB_API_URL",
    "https://script.google.com/macros/s/AKfycbyrbE6zq601rV5UZBPFdXarm2xFLp3_x__LOhSI5ikG1AQ7oUFNdiyEMnS1ElWu7T4Y/exec")).trim();
}

function _printHubBridgeToken_() {
  try { return String(PropertiesService.getScriptProperties().getProperty("PRINT_HUB_BRIDGE_TOKEN") || "").trim(); }
  catch (e) { return ""; }
}

function _printHubBridgeCall_(action, payload) {
  var url = _printHubBridgeUrl_();
  var token = _printHubBridgeToken_();
  if (!url) return { ok:false, code:"NO_URL", msg:"ยังไม่ได้ตั้ง PRINT_HUB_API_URL" };
  if (!token) return { ok:false, code:"NO_TOKEN", msg:"ยังไม่ได้ตั้ง PRINT_HUB_BRIDGE_TOKEN ใน Script Properties" };
  var body = payload || {};
  body.action = action;
  body.token = token;
  try {
    var res = UrlFetchApp.fetch(url, {
      method:"post",
      contentType:"application/json",
      payload:JSON.stringify(body),
      muteHttpExceptions:true,
      followRedirects:true
    });
    var text = res.getContentText() || "";
    var data;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300 || !data) {
      return { ok:false, code:"HTTP_"+res.getResponseCode(), msg:"เชื่อมต่อ Print Hub ไม่สำเร็จ" };
    }
    return data;
  } catch (e) {
    return { ok:false, code:"FETCH_ERROR", msg:String(e && e.message || e) };
  }
}

function _printHubAgentStatus_() {
  var r = _printHubBridgeCall_("line_status", {});
  if (!r || !r.ok) return { online:false, printer:"", error:r && r.msg || "เชื่อมต่อไม่ได้" };
  var a = r.agent || {};
  return {
    online: !!a.online,
    printer: String(a.printer || ""),
    lastSeen: String(a.lastSeen || ""),
    host: String(a.host || "")
  };
}

function _printHubEnsureSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(PRINT_HUB_LINE_SHEET_);
  if (!sh) {
    sh = ss.insertSheet(PRINT_HUB_LINE_SHEET_);
    sh.getRange(1,1,1,PRINT_HUB_LINE_HEADERS_.length).setValues([PRINT_HUB_LINE_HEADERS_]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function _printHubTrack_(job) {
  var sh = _printHubEnsureSheet_();
  sh.appendRow([
    "PHL"+Date.now()+"_"+Utilities.getUuid().substring(0,6),
    new Date(), new Date(), job.jobId || "", job.userId || "", job.userName || "",
    job.sourceId || "", job.isGroup ? "Y":"N", job.fileName || "", job.mime || "",
    job.status || "", job.agentOnline ? "Y":"N", "N", "", ""
  ]);
}

function _printHubFindTrackRow_(jobId) {
  var sh = _printHubEnsureSheet_();
  var n = sh.getLastRow()-1;
  if (n < 1) return { sheet:sh, row:-1, values:null };
  var vals = sh.getRange(2,1,n,PRINT_HUB_LINE_HEADERS_.length).getValues();
  for (var i=vals.length-1;i>=0;i--) {
    if (String(vals[i][3]) === String(jobId)) return { sheet:sh, row:i+2, values:vals[i] };
  }
  return { sheet:sh, row:-1, values:null };
}

function _printHubTrackUpdate_(jobId, patch) {
  var hit = _printHubFindTrackRow_(jobId);
  if (hit.row < 0) return false;
  var map = { status:11, agentOnline:12, notifiedOnline:13, lastNotice:14, error:15 };
  hit.sheet.getRange(hit.row,3).setValue(new Date());
  Object.keys(patch || {}).forEach(function(k){
    if (!map[k]) return;
    var v = patch[k];
    if (k === "agentOnline" || k === "notifiedOnline") v = v ? "Y":"N";
    hit.sheet.getRange(hit.row,map[k]).setValue(v);
  });
  return true;
}

function _printHubJobIdFromText_(text) {
  var m = String(text || "").match(/\b([A-Z]{1,8}[A-Z0-9_-]*\d[A-Z0-9_-]*)\b/i);
  return m ? m[1] : "";
}

function _printHubDetectIntent_(text) {
  var t = String(text || "").trim().toLowerCase();
  if (!t) return { intent:"" };
  var jobId = _printHubJobIdFromText_(text);
  if (/^(ยืนยันพิมพ์|พิมพ์เลย|ตกลงพิมพ์)\b/i.test(t)) return { intent:"CONFIRM", jobId:jobId };
  if (/^(ยกเลิกพิมพ์|ยกเลิกงานพิมพ์|ไม่พิมพ์)\b/i.test(t)) return { intent:"CANCEL", jobId:jobId };
  if (/^(ได้รับเอกสารแล้ว|รับเอกสารแล้ว|เอกสารออกแล้ว)\b/i.test(t)) return { intent:"RECEIVED", jobId:jobId };
  if (/^(เอกสารไม่ออก|พิมพ์ไม่ครบ|มีปัญหางานพิมพ์)\b/i.test(t)) return { intent:"PROBLEM", jobId:jobId };
  if (/(งานพิมพ์|พิมพ์).*(ถึงไหน|สถานะ|เรียบร้อย|หรือยัง)|^(สถานะงานพิมพ์|คิวพิมพ์)/i.test(t))
    return { intent:"STATUS", jobId:jobId };
  if (/(หา|ค้น|ย้อนหลัง).*(ไฟล์|เอกสาร).*(พิมพ์|ปริ้น)|(ไฟล์|เอกสาร).*(ที่เคย|เมื่อวาน|ย้อนหลัง).*(พิมพ์|ปริ้น)/i.test(t))
    return { intent:"SEARCH", jobId:jobId };
  if (/(พิมพ์ซ้ำ|ปริ้นซ้ำ)/i.test(t)) return { intent:"REPRINT", jobId:jobId };
  if (/(พิมพ์|ปริ้น|print)/i.test(t) && /(ช่วย|ขอ|ฝาก|ไฟล์|เอกสาร|หน่อย|จะ|ต้องการ|ส่ง|พิมพ์|ปริ้น|print)/i.test(t))
    return { intent:"START", jobId:jobId };
  return { intent:"" };
}

function _printHubAiIntent_(text) {
  if (!_printHubOn_("PRINT_HUB_NATURAL_LANGUAGE", true)) return "";
  if (!/(พิมพ์|ปริ้น|print|เครื่องพิมพ์|ไฟล์|เอกสาร)/i.test(String(text || ""))) return "";
  if (typeof _callGeminiAPI_ !== "function") return "";
  var sys = "คุณเป็น intent classifier ของระบบ Print Hub เท่านั้น ตอบในช่อง answer เป็นค่าเดียวจาก PRINT_START, PRINT_STATUS, PRINT_SEARCH, PRINT_REPRINT, NONE ห้ามอธิบาย ห้ามสร้างสถานะหรือสิทธิ์";
  var r = _callGeminiAPI_("จัดประเภทข้อความนี้: "+String(text || "").substring(0,800), null, sys);
  if (!r || !r.ok) return "";
  var a = String(r.answer || "").trim().toUpperCase();
  var map = { PRINT_START:"START", PRINT_STATUS:"STATUS", PRINT_SEARCH:"SEARCH", PRINT_REPRINT:"REPRINT" };
  return map[a] || "";
}

function _printHubNaturalReply_(facts, fallback) {
  if (!_printHubOn_("PRINT_HUB_AI_REPLY", false) || typeof _callGeminiAPI_ !== "function") return fallback;
  var style = _printHubCfg_("PRINT_HUB_REPLY_STYLE", "สุภาพ เป็นธรรมชาติ กระชับ");
  var sys = "เรียบเรียงข้อความตอบ LINE ภาษาไทยให้"+style+
    " โดยยึดข้อเท็จจริงที่ให้เท่านั้น ห้ามเปลี่ยนสถานะ ห้ามบอกว่าพิมพ์เสร็จถ้ายังไม่ DONE ห้ามเพิ่มข้อมูลที่ไม่มี";
  var r = _callGeminiAPI_("ข้อเท็จจริง:\n"+String(facts || "")+"\n\nข้อความตั้งต้น:\n"+String(fallback || ""), null, sys);
  return r && r.ok && r.answer ? r.answer : fallback;
}

function _printHubReply_(replyToken, text) {
  if (typeof safeSendReply === "function") return safeSendReply(replyToken, text);
  if (typeof sendUniversalReply === "function") return sendUniversalReply(replyToken, text);
}

function _printHubPush_(to, message) {
  if (!to || !LINE_CHANNEL_ACCESS_TOKEN) return false;
  var msg = typeof message === "string" ? { type:"text", text:String(message).substring(0,5000) } : message;
  try {
    var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/push", {
      method:"post",
      contentType:"application/json",
      headers:{ Authorization:"Bearer "+LINE_CHANNEL_ACCESS_TOKEN },
      payload:JSON.stringify({ to:to, messages:[msg] }),
      muteHttpExceptions:true
    });
    return res.getResponseCode() >= 200 && res.getResponseCode() < 300;
  } catch (e) { return false; }
}

function _printHubConfirmFlex_(jobId, fileName, intro) {
  return {
    type:"flex",
    altText:"ยืนยันงานพิมพ์ "+fileName,
    contents:{
      type:"bubble",
      header:{type:"box",layout:"vertical",backgroundColor:"#0B2447",contents:[
        {type:"text",text:"🖨️ Print Hub พร้อมพิมพ์",color:"#FFFFFF",weight:"bold",size:"lg"}
      ]},
      body:{type:"box",layout:"vertical",spacing:"md",contents:[
        {type:"text",text:intro || "Print Hub ออนไลน์แล้ว กรุณายืนยันก่อนพิมพ์",wrap:true},
        {type:"text",text:"📄 "+String(fileName || jobId),wrap:true,weight:"bold"},
        {type:"text",text:"งาน: "+jobId,size:"xs",color:"#6B7280"}
      ]},
      footer:{type:"box",layout:"horizontal",spacing:"sm",contents:[
        {type:"button",style:"primary",action:{type:"message",label:"✅ ยืนยันพิมพ์",text:"ยืนยันพิมพ์ "+jobId}},
        {type:"button",style:"secondary",action:{type:"message",label:"❌ ยกเลิก",text:"ยกเลิกพิมพ์ "+jobId}}
      ]}
    }
  };
}

function _printHubReceiveFlex_(jobId, fileName) {
  return {
    type:"flex", altText:"ตรวจรับเอกสาร "+fileName,
    contents:{type:"bubble",
      body:{type:"box",layout:"vertical",spacing:"md",contents:[
        {type:"text",text:"🖨️ ส่งงานเข้าเครื่องพิมพ์แล้ว",weight:"bold",size:"lg",wrap:true},
        {type:"text",text:"📄 "+String(fileName || jobId),wrap:true},
        {type:"text",text:"กรุณาตรวจเอกสารที่เครื่อง แล้วแจ้งผลเพื่อปิดงานครับ",wrap:true,color:"#4B5563"}
      ]},
      footer:{type:"box",layout:"vertical",spacing:"sm",contents:[
        {type:"button",style:"primary",action:{type:"message",label:"✅ ได้รับเอกสารแล้ว",text:"ได้รับเอกสารแล้ว "+jobId}},
        {type:"button",style:"secondary",action:{type:"message",label:"⚠️ เอกสารมีปัญหา",text:"มีปัญหางานพิมพ์ "+jobId}}
      ]}
    }
  };
}

function _printHubEnsurePollTrigger_() {
  try {
    var found = ScriptApp.getProjectTriggers().some(function(t){ return t.getHandlerFunction() === "pollPrintHubLineJobs_"; });
    if (!found) ScriptApp.newTrigger("pollPrintHubLineJobs_").timeBased().everyMinutes(1).create();
  } catch (e) {}
}

function _printHubOpenSession_(messageText, user, userId, sourceId, isGroup, replyToken) {
  if (!_printHubAllowed_(user, userId)) {
    _printHubReply_(replyToken, _printHubCfg_("PRINT_HUB_DENIED_REPLY","🔒 ระบบสั่งพิมพ์สำหรับ VIP/Admin เท่านั้นครับ"));
    return true;
  }
  if (!_printHubSourceAllowed_(sourceId, isGroup)) return false;
  _printHubEnsurePollTrigger_();
  var agent = _printHubAgentStatus_();
  _printHubSaveSession_(userId, sourceId, { step:"WAIT_FILE", at:Date.now() });
  var base = agent.online
    ? _printHubCfg_("PRINT_HUB_READY_REPLY","🖨️ ได้ครับ Print Hub ออนไลน์อยู่\nรองรับไฟล์ PDF และรูปภาพ JPG/PNG ขนาด A4\nส่งไฟล์มาได้เลยครับ เมื่อรับไฟล์แล้วระบบจะถามยืนยันอีกครั้งก่อนพิมพ์")
    : _printHubCfg_("PRINT_HUB_OFFLINE_REPLY","🖨️ ได้ครับ ขณะนี้คอม Print Hub ยังออฟไลน์\nส่งไฟล์ PDF หรือรูปภาพ JPG/PNG มาได้ ระบบจะเก็บงานไว้ และเมื่อ Print Hub ออนไลน์จะแจ้งให้ยืนยันก่อนพิมพ์ครับ");
  var facts = "สิทธิ์ผ่าน; agentOnline="+agent.online+"; ขั้นตอน=รอไฟล์; ต้องยืนยันก่อนพิมพ์";
  _printHubReply_(replyToken, _printHubNaturalReply_(facts, base));
  return true;
}

function _printHubMimeFromName_(name, fallback) {
  var n = String(name || "").toLowerCase();
  if (/\.pdf$/.test(n)) return "application/pdf";
  if (/\.png$/.test(n)) return "image/png";
  if (/\.jpe?g$/.test(n)) return "image/jpeg";
  return String(fallback || "application/octet-stream");
}

function _printHubDownloadLineContent_(messageId, fileName, mimeHint) {
  var res = UrlFetchApp.fetch("https://api-data.line.me/v2/bot/message/"+messageId+"/content", {
    method:"get", headers:getLineAuthHeaders_(), muteHttpExceptions:true
  });
  if (res.getResponseCode() !== 200) return { ok:false, msg:"ดาวน์โหลดไฟล์จาก LINE ไม่สำเร็จ" };
  var blob = res.getBlob();
  var bytes = blob.getBytes();
  var maxMb = Math.max(1, Math.min(30, parseInt(_printHubCfg_("PRINT_HUB_MAX_MB","20"),10)||20));
  if (bytes.length > maxMb*1024*1024) return { ok:false, msg:"ไฟล์ใหญ่เกิน "+maxMb+" MB" };
  var mime = _printHubMimeFromName_(fileName, mimeHint || blob.getContentType());
  if (["application/pdf","image/jpeg","image/png"].indexOf(mime) < 0)
    return { ok:false, msg:_printHubCfg_("PRINT_HUB_UNSUPPORTED_REPLY","⚠️ รองรับเฉพาะ PDF และรูปภาพ JPG/PNG ในขณะนี้ครับ") };
  return { ok:true, bytes:bytes, mime:mime };
}

function _printHubUploadBytes_(payload) {
  var start = _printHubBridgeCall_("line_upload_start", {
    ownerId:payload.userId, ownerName:payload.userName, sourceId:payload.sourceId
  });
  if (!start || !start.ok || !start.uploadId) return start || {ok:false,msg:"เริ่มอัปโหลดไม่ได้"};
  var chunk = 600*1024;
  for (var i=0,part=0;i<payload.bytes.length;i+=chunk,part++) {
    var p = _printHubBridgeCall_("line_upload_chunk", {
      uploadId:start.uploadId, index:part,
      data:Utilities.base64Encode(payload.bytes.slice(i,Math.min(i+chunk,payload.bytes.length)))
    });
    if (!p || !p.ok) return p || {ok:false,msg:"อัปโหลดไม่สำเร็จ"};
  }
  return _printHubBridgeCall_("line_submit", {
    uploadId:start.uploadId,
    ownerId:payload.userId, ownerName:payload.userName, sourceId:payload.sourceId,
    fileName:payload.fileName, mime:payload.mime, copies:1, duplex:false, range:"", paperSize:"A4"
  });
}

function _printHubHandleIncomingContent_(message, user, userId, sourceId, isGroup, replyToken, forcedImage) {
  if (!_printHubEnabled_()) return false;
  var session = _printHubGetSession_(userId, sourceId);
  if (!session || session.step !== "WAIT_FILE") return false;
  if (!_printHubAllowed_(user, userId) || !_printHubSourceAllowed_(sourceId, isGroup)) return false;

  var fileName = forcedImage ? ("LINE_"+Utilities.formatDate(new Date(), Session.getScriptTimeZone(),"yyyyMMdd_HHmmss")+".jpg")
                             : String(message.fileName || "document.pdf");
  var got = _printHubDownloadLineContent_(message.id, fileName, forcedImage ? "image/jpeg" : "");
  if (!got.ok) { _printHubReply_(replyToken, got.msg); return true; }

  var up = _printHubUploadBytes_({
    bytes:got.bytes, mime:got.mime, fileName:fileName,
    userId:userId, userName:user && user.name || "", sourceId:sourceId
  });
  if (!up || !up.ok) {
    _printHubReply_(replyToken, "❌ ส่งไฟล์เข้า Print Hub ไม่สำเร็จ\n"+String(up && up.msg || "กรุณาลองใหม่"));
    return true;
  }

  _printHubClearSession_(userId, sourceId);
  var status = String(up.status || (up.agent && up.agent.online ? "WAIT_CONFIRM":"WAIT_AGENT"));
  _printHubTrack_({
    jobId:up.jobId,userId:userId,userName:user && user.name || "",sourceId:sourceId,isGroup:isGroup,
    fileName:fileName,mime:got.mime,status:status,agentOnline:!!(up.agent && up.agent.online)
  });

  if (up.agent && up.agent.online) {
    _printHubTrackUpdate_(up.jobId,{status:"WAIT_CONFIRM",agentOnline:true,notifiedOnline:true,lastNotice:"WAIT_CONFIRM"});
    if (typeof sendUniversalReply === "function") sendUniversalReply(replyToken,
      _printHubConfirmFlex_(up.jobId,fileName,"รับไฟล์แล้วครับ และ Print Hub ออนไลน์อยู่ กรุณายืนยันก่อนพิมพ์"));
    else _printHubReply_(replyToken,"✅ รับไฟล์แล้วครับ\nPrint Hub ออนไลน์อยู่ กรุณาพิมพ์: ยืนยันพิมพ์ "+up.jobId);
  } else {
    var msg = _printHubCfg_("PRINT_HUB_QUEUED_OFFLINE_REPLY",
      "✅ รับไฟล์ไว้ในคิวแล้วครับ\nขณะนี้คอม Print Hub ยังออฟไลน์ เมื่อออนไลน์ระบบจะแจ้งให้ยืนยันพิมพ์อีกครั้งครับ");
    _printHubReply_(replyToken, _printHubNaturalReply_("รับไฟล์สำเร็จ; agentOnline=false; งาน="+up.jobId+"; ห้ามพิมพ์จนกว่าจะยืนยัน",msg));
  }
  return true;
}

function handlePrintHubFileMessage_(message, user, userId, sourceId, isGroup, replyToken) {
  return _printHubHandleIncomingContent_(message,user,userId,sourceId,isGroup,replyToken,false);
}

function handlePrintHubImageMessage_(message, user, userId, sourceId, isGroup, replyToken) {
  return _printHubHandleIncomingContent_(message,user,userId,sourceId,isGroup,replyToken,true);
}

function _printHubAction_(intent, user, userId, sourceId, isGroup, replyToken, jobId, rawText) {
  if (!_printHubAllowed_(user,userId)) {
    _printHubReply_(replyToken,_printHubCfg_("PRINT_HUB_DENIED_REPLY","🔒 ระบบสั่งพิมพ์สำหรับ VIP/Admin เท่านั้นครับ"));
    return true;
  }
  if (!jobId && ["CONFIRM","CANCEL","RECEIVED","PROBLEM","REPRINT"].indexOf(intent) >= 0) {
    _printHubReply_(replyToken,"กรุณาระบุเลขงานพิมพ์ด้วยครับ");
    return true;
  }
  var r;
  if (intent === "CONFIRM") {
    r = _printHubBridgeCall_("line_confirm",{jobId:jobId,ownerId:userId});
    if (r && r.ok) {
      _printHubTrackUpdate_(jobId,{status:"QUEUED",agentOnline:true,lastNotice:"QUEUED"});
      _printHubReply_(replyToken,_printHubNaturalReply_("ผู้ใช้ยืนยันแล้ว; งาน="+jobId+"; status=QUEUED","🖨️ ยืนยันแล้วครับ ส่งงานเข้าคิวพิมพ์เรียบร้อย"));
    } else _printHubReply_(replyToken,"⚠️ ยังยืนยันพิมพ์ไม่ได้ครับ\n"+String(r && r.msg || ""));
    return true;
  }
  if (intent === "CANCEL") {
    r = _printHubBridgeCall_("line_cancel",{jobId:jobId,ownerId:userId});
    if (r && r.ok) {
      _printHubTrackUpdate_(jobId,{status:"CANCELLED",lastNotice:"CANCELLED"});
      _printHubReply_(replyToken,"❌ ยกเลิกงานพิมพ์และลบไฟล์ที่เก็บไว้แล้วครับ");
    } else _printHubReply_(replyToken,"⚠️ ยกเลิกไม่ได้ครับ\n"+String(r && r.msg || ""));
    return true;
  }
  if (intent === "RECEIVED") {
    r = _printHubBridgeCall_("line_receive",{jobId:jobId,ownerId:userId,ok:true});
    if (r && r.ok) {
      _printHubTrackUpdate_(jobId,{status:"DONE",lastNotice:"DONE"});
      _printHubReply_(replyToken,_printHubCfg_("PRINT_HUB_COMPLETED_REPLY","✅ พิมพ์เอกสารเรียบร้อยแล้วครับ"));
    } else _printHubReply_(replyToken,"⚠️ ปิดงานไม่ได้ครับ\n"+String(r && r.msg || ""));
    return true;
  }
  if (intent === "PROBLEM") {
    r = _printHubBridgeCall_("line_receive",{jobId:jobId,ownerId:userId,ok:false,note:"ผู้ใช้แจ้งผ่าน LINE ว่าเอกสารมีปัญหา"});
    if (r && r.ok) {
      _printHubTrackUpdate_(jobId,{status:"ERROR",lastNotice:"ERROR",error:"ผู้ใช้แจ้งว่าเอกสารมีปัญหา"});
      _printHubReply_(replyToken,"⚠️ บันทึกปัญหาแล้วครับ ระบบจะไม่พิมพ์ซ้ำเอง กรุณาตรวจที่เครื่องพิมพ์ก่อน");
    } else _printHubReply_(replyToken,"⚠️ บันทึกสถานะไม่ได้ครับ");
    return true;
  }
  if (intent === "REPRINT") {
    r = _printHubBridgeCall_("line_reprint",{jobId:jobId,ownerId:userId});
    if (r && r.ok) {
      _printHubTrack_({jobId:r.jobId,userId:userId,userName:user&&user.name||"",sourceId:sourceId,isGroup:isGroup,
        fileName:r.fileName||"",mime:r.mime||"",status:r.status||"WAIT_CONFIRM",agentOnline:!!(r.agent&&r.agent.online)});
      _printHubReply_(replyToken,"✅ สร้างงานพิมพ์ซ้ำแล้วครับ เลขงาน "+r.jobId+"\nระบบยังรอการยืนยันก่อนพิมพ์");
    } else _printHubReply_(replyToken,"⚠️ พิมพ์ซ้ำไม่ได้ครับ\n"+String(r && r.msg || ""));
    return true;
  }
  if (intent === "STATUS") {
    r = _printHubBridgeCall_("line_job",{jobId:jobId,ownerId:userId});
    if (!jobId) r = _printHubBridgeCall_("line_latest",{ownerId:userId});
    if (!r || !r.ok || !r.job) { _printHubReply_(replyToken,"ยังไม่พบงานพิมพ์ที่กำลังติดตามครับ"); return true; }
    var j=r.job;
    _printHubReply_(replyToken,"🖨️ สถานะงาน "+j.id+"\n📄 "+j.file+"\nสถานะ: "+j.status+
      (r.agent ? "\nPrint Hub: "+(r.agent.online?"ออนไลน์":"ออฟไลน์") : ""));
    return true;
  }
  if (intent === "SEARCH") {
    r = _printHubBridgeCall_("line_search",{ownerId:userId,query:String(rawText||"").substring(0,200),limit:8});
    if (!r || !r.ok || !r.jobs || !r.jobs.length) { _printHubReply_(replyToken,"ไม่พบไฟล์พิมพ์ที่ตรงกับคำค้นครับ"); return true; }
    var lines=["🔎 พบไฟล์พิมพ์ "+r.jobs.length+" รายการ"];
    r.jobs.forEach(function(j,i){ lines.push((i+1)+". "+j.file+" · "+j.status+" · "+j.id); });
    lines.push("ต้องการพิมพ์ซ้ำ พิมพ์: พิมพ์ซ้ำ <เลขงาน>");
    _printHubReply_(replyToken,lines.join("\n"));
    return true;
  }
  return false;
}

function handlePrintHubText_(messageText, user, userId, sourceId, isGroup, replyToken) {
  if (!_printHubEnabled_()) return false;
  if (!_printHubSourceAllowed_(sourceId,isGroup)) return false;
  var d = _printHubDetectIntent_(messageText);
  if (!d.intent) d.intent = _printHubAiIntent_(messageText);
  if (!d.intent) return false;
  if (d.intent === "START") return _printHubOpenSession_(messageText,user,userId,sourceId,isGroup,replyToken);
  return _printHubAction_(d.intent,user,userId,sourceId,isGroup,replyToken,d.jobId,_printHubDetectIntent_(messageText).jobId ? messageText : messageText);
}

function pollPrintHubLineJobs_() {
  if (!_printHubEnabled_()) return;
  var sh = _printHubEnsureSheet_();
  var n = sh.getLastRow()-1;
  if (n < 1) return;
  var rows = sh.getRange(2,1,n,PRINT_HUB_LINE_HEADERS_.length).getValues();
  rows.forEach(function(r,idx){
    var local = String(r[10] || "");
    if (["DONE","CANCELLED","EXPIRED"].indexOf(local) >= 0) return;
    var jobId=String(r[3]||""), userId=String(r[4]||""), sourceId=String(r[6]||"");
    if (!jobId || !userId) return;
    var remote = _printHubBridgeCall_("line_job",{jobId:jobId,ownerId:userId});
    if (!remote || !remote.ok || !remote.job) return;
    var j=remote.job, agent=remote.agent||{};
    var notice=String(r[13]||"");
    var to=sourceId || userId;

    if (local === "WAIT_AGENT" && agent.online && notice !== "WAIT_CONFIRM") {
      _printHubPush_(to,_printHubConfirmFlex_(jobId,j.file,"Print Hub ออนไลน์แล้วครับ พบงานที่ฝากไว้ กรุณายืนยันก่อนพิมพ์"));
      _printHubTrackUpdate_(jobId,{status:"WAIT_CONFIRM",agentOnline:true,notifiedOnline:true,lastNotice:"WAIT_CONFIRM"});
      return;
    }
    if (j.status === "PRINTING" && notice !== "PRINTING") {
      if (_printHubOn_("PRINT_HUB_NOTIFY_PRINTING",true)) _printHubPush_(to,"🖨️ กำลังพิมพ์ "+j.file+" ครับ");
      _printHubTrackUpdate_(jobId,{status:"PRINTING",agentOnline:!!agent.online,lastNotice:"PRINTING"});
      return;
    }
    if (j.status === "SENT" && notice !== "SENT") {
      _printHubPush_(to,_printHubReceiveFlex_(jobId,j.file));
      _printHubTrackUpdate_(jobId,{status:"SENT",agentOnline:!!agent.online,lastNotice:"SENT"});
      return;
    }
    if (j.status === "ERROR" && notice !== "ERROR") {
      _printHubPush_(to,"⚠️ งานพิมพ์ "+j.file+" มีปัญหา\n"+String(j.err||"กรุณาตรวจสอบเครื่องพิมพ์"));
      _printHubTrackUpdate_(jobId,{status:"ERROR",agentOnline:!!agent.online,lastNotice:"ERROR",error:String(j.err||"")});
      return;
    }
    if (j.status === "DONE" && notice !== "DONE") {
      _printHubPush_(to,_printHubCfg_("PRINT_HUB_COMPLETED_REPLY","✅ พิมพ์เอกสารเรียบร้อยแล้วครับ"));
      _printHubTrackUpdate_(jobId,{status:"DONE",agentOnline:!!agent.online,lastNotice:"DONE"});
      return;
    }
  });
}
