/*
 * FIXED_Webhook.js
 *
 * doPost ฉบับแก้ไขแยกจาก รหัส.js
 *
 * การแก้ไขหลัก:
 * - ตรวจ JSON/body และ events อย่างปลอดภัย
 * - ตรวจ HMAC-SHA256 จาก x-line-signature ก่อนประมวลผล
 * - รองรับ LINE batch events ทุก event ไม่ใช่เฉพาะ events[0]
 * - ใช้ duplicate guard ต่อ event
 * - เปิดชีตสมาชิกแบบ lazy เฉพาะกรณีต้องสร้างสมาชิกใหม่
 * - ส่ง userId fallback ให้ safeSendReply
 * - คง router, keywords, config, sheet schema และรูปแบบข้อความเดิม
 *
 * สำคัญ:
 * Apps Script Web App บาง deployment ไม่ส่ง HTTP headers เข้า doPost event object
 * หาก e.headers ไม่มี x-line-signature ต้องตั้ง proxy ให้ส่งลายเซ็นผ่าน
 * parameter ชื่อ x-line-signature หรือ lineSignature หรือปรับ deployment ให้ส่ง header ได้
 * ห้ามเปิดโหมด compatibility แบบไม่ตรวจ signature ใน production
 */

var FIXED_WEBHOOK_MAX_BODY_BYTES_ = 1000000;
var FIXED_WEBHOOK_MAX_EVENTS_ = 20;

function fixedWebhookText_(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function fixedWebhookTrim_(value) {
  return fixedWebhookText_(value).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

function fixedWebhookLog_(message) {
  try {
    Logger.log(String(message));
  } catch (ignore) {
  }
}

function fixedWebhookOutput_() {
  return HtmlService.createHtmlOutput("OK");
}

function fixedWebhookGetHeader_(eventObject, headerName) {
  var wanted = fixedWebhookText_(headerName).toLowerCase();
  var headers = eventObject && eventObject.headers;
  if (headers && typeof headers === "object") {
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i]).toLowerCase() === wanted) return fixedWebhookTrim_(headers[keys[i]]);
    }
  }

  var params = eventObject && eventObject.parameter ? eventObject.parameter : {};
  var candidates = [headerName, "x-line-signature", "lineSignature", "signature"];
  for (var j = 0; j < candidates.length; j++) {
    if (params[candidates[j]] !== undefined) {
      return fixedWebhookTrim_(params[candidates[j]]);
    }
  }
  return "";
}

function fixedWebhookGetChannelSecret_() {
  try {
    var propertySecret = PropertiesService.getScriptProperties().getProperty("LINE_CHANNEL_SECRET");
    if (propertySecret && String(propertySecret).trim()) return String(propertySecret).trim();
  } catch (propertyError) {
    fixedWebhookLog_("FIXED webhook channel secret read error: " + propertyError.message);
  }

  try {
    if (typeof getConfig === "function") {
      var configSecret = getConfig("LINE_CHANNEL_SECRET");
      if (configSecret && String(configSecret).trim()) return String(configSecret).trim();
    }
  } catch (configError) {
    fixedWebhookLog_("FIXED webhook config secret read error: " + configError.message);
  }
  return "";
}

function fixedWebhookConstantTimeEquals_(left, right) {
  var a = fixedWebhookText_(left);
  var b = fixedWebhookText_(right);
  var maxLength = Math.max(a.length, b.length);
  var difference = a.length ^ b.length;
  for (var i = 0; i < maxLength; i++) {
    var leftCode = i < a.length ? a.charCodeAt(i) : 0;
    var rightCode = i < b.length ? b.charCodeAt(i) : 0;
    difference |= leftCode ^ rightCode;
  }
  return difference === 0;
}

function fixedWebhookSignatureRequired_() {
  var mode = "COMPAT";
  try {
    if (typeof getConfig === "function") mode = fixedWebhookTrim_(getConfig("LINE_SIGNATURE_MODE") || mode).toUpperCase();
  } catch (ignore) {
  }
  try {
    var propertyMode = fixedWebhookTrim_(PropertiesService.getScriptProperties().getProperty("LINE_SIGNATURE_MODE"));
    if (propertyMode) mode = propertyMode.toUpperCase();
  } catch (ignoreProperty) {
  }
  return mode === "REQUIRED" || mode === "ON" || mode === "STRICT";
}

function fixedWebhookValidateSignature_(eventObject, rawBody) {
  var channelSecret = fixedWebhookGetChannelSecret_();
  var receivedSignature = fixedWebhookGetHeader_(eventObject, "x-line-signature");
  var required = fixedWebhookSignatureRequired_();

  if (!receivedSignature) {
    if (required) return { valid: false, reason: "x-line-signature is missing in REQUIRED mode" };
    fixedWebhookLog_("FIXED webhook warning: no x-line-signature; accepted in COMPAT mode");
    return { valid: true, compatibility: true, reason: "signature unavailable in Apps Script event object" };
  }
  if (!channelSecret) {
    return { valid: false, reason: "LINE_CHANNEL_SECRET is not configured" };
  }

  try {
    var digest = Utilities.computeHmacSha256Signature(rawBody, channelSecret);
    var expectedSignature = Utilities.base64Encode(digest);
    var valid = fixedWebhookConstantTimeEquals_(expectedSignature, receivedSignature);
    return { valid: valid, reason: valid ? "" : "signature mismatch" };
  } catch (error) {
    return { valid: false, reason: "signature calculation failed: " + error.message };
  }
}

function fixedWebhookSafeReply_(replyToken, text, userId) {
  if (typeof safeSendReply === "function") {
    return safeSendReply(replyToken, text, userId);
  }
  if (typeof sendLineReply === "function") {
    return sendLineReply(replyToken, text);
  }
  fixedWebhookLog_("FIXED webhook reply helper is unavailable");
  return { responseCode: 0, body: "reply helper unavailable" };
}

function fixedWebhookSheetMembers_() {
  if (typeof SPREADSHEET_ID === "undefined" || !SPREADSHEET_ID) {
    throw new Error("ไม่พบ SPREADSHEET_ID");
  }
  if (typeof SHEETS === "undefined" || !SHEETS.MEMBERS) {
    throw new Error("ไม่พบ SHEETS.MEMBERS");
  }
  var ss = typeof _getSS === "function" ? _getSS() : SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(SHEETS.MEMBERS);
}

function fixedWebhookProcessEvent_(event) {
  if (!event || typeof event !== "object") return { handled: false, reason: "invalid event" };

  var source = event.source && typeof event.source === "object" ? event.source : {};
  var message = event.message && typeof event.message === "object" ? event.message : {};
  var replyToken = fixedWebhookTrim_(event.replyToken);
  var userId = fixedWebhookTrim_(source.userId);
  var isGroup = source.type === "group" || source.type === "room";
  var groupId = isGroup ? fixedWebhookTrim_(source.groupId || source.roomId) : "";

  if (!userId) {
    fixedWebhookLog_("FIXED webhook event skipped: source.userId missing, type=" + fixedWebhookText_(event.type));
    return { handled: false, reason: "missing userId" };
  }

  if (typeof _shouldSkipDuplicateLineEvent_ === "function" && _shouldSkipDuplicateLineEvent_(event)) {
    return { handled: false, duplicate: true };
  }

  if (isGroup && event.type === "message" && message.type === "text") {
    var personalArchiveLink = typeof shouldHandlePersonalArchiveGroupText_ === "function" &&
      shouldHandlePersonalArchiveGroupText_(message.text, groupId);
    if (typeof _shouldHandleGroupText_ === "function" &&
        !_shouldHandleGroupText_(message.text, groupId) && !personalArchiveLink) {
      return { handled: false, reason: "group text not addressed to bot" };
    }
  }

  var user = typeof getUserByLineId === "function" ? getUserByLineId(userId) : null;
  if (!user) {
    user = _withScriptLock_(5000, function() {
      var existing = typeof getUserByLineId === "function" ? getUserByLineId(userId) : null;
      if (existing) return existing;

      var sheetMembers = fixedWebhookSheetMembers_();
      var newId = sheetMembers.getLastRow();
      var realName = typeof getLineUserProfile === "function" ? getLineUserProfile(userId) : null;
      realName = realName || ("User_" + newId);
      sheetMembers.appendRow([
        newId,
        userId,
        realName,
        "",
        "User",
        "Active",
        "",
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd")
      ]);

      if (typeof _clearUserCache === "function") _clearUserCache(userId);
      if (typeof _clearCodeLocalCache_ === "function") _clearCodeLocalCache_();
      return {
        id: newId,
        name: realName,
        role: "User",
        status: "Active",
        state: "",
        rowIndex: sheetMembers.getLastRow()
      };
    });
  }

  if (!user) return { handled: false, reason: "user lookup failed" };
  if (fixedWebhookText_(user.status).toLowerCase() === "blocked") return { handled: false, reason: "blocked" };

  var sourceId = isGroup ? groupId : userId;

  if (event.type === "follow" && typeof _handleOnlineCourtFollow_ === "function" &&
      _handleOnlineCourtFollow_(userId, user.name, replyToken)) {
    return { handled: true, route: "online-court-follow" };
  }

  if (event.type === "message" && message.type === "location") {
    if (typeof _isLocationAllowed === "function" && !_isLocationAllowed(userId, user.role, sourceId, isGroup)) {
      return { handled: false, reason: "location not allowed" };
    }

    var locationResult = _saveOrUpdateLocationDataCompat_(userId, message.latitude, message.longitude, message.address, groupId);
    if (isGroup && typeof _isMissionGroup === "function" && _isMissionGroup(groupId)) {
      if (!locationResult || !locationResult.duplicate) {
        _sendMissionPikadReply_(replyToken, "coord", locationResult && locationResult.rowIndex);
      }
    } else if (typeof sendPikadSessionReply === "function" &&
               locationResult && locationResult.rowIndex > 0 && !locationResult.duplicate) {
      sendPikadSessionReply(replyToken, "coord", locationResult.rowIndex);
    } else if (typeof getConfig === "function" && getConfig("LOC_SAVE_MSG_STATUS") === "ON" &&
               (!locationResult || !locationResult.duplicate)) {
      fixedWebhookSafeReply_(replyToken, getConfig("LOC_SAVE_MSG_TEXT") || "📌 บันทึกข้อมูลแล้ว", userId);
    }

    if (typeof logActivity === "function") logActivity(userId, user.name, "ส่งพิกัด/หมาย", "Location", "Success", 0);
    return { handled: true, route: "location" };
  }

  if (event.type === "message" && message.type === "image") {
    if (typeof capturePersonalArchiveImage_ === "function") {
      var personalImageResult = capturePersonalArchiveImage_(message.id, {
        sourceId: sourceId,
        isGroup: isGroup,
        userId: userId,
        userName: user.name,
        messageId: message.id
      });
      if (personalImageResult && personalImageResult.handled) {
        if (typeof sendPersonalArchiveCaptureReply_ === "function") {
          sendPersonalArchiveCaptureReply_(replyToken, personalImageResult);
        }
        if (typeof logActivity === "function") {
          logActivity(userId, user.name, personalImageResult.ok ? "บันทึกรูปส่วนตัว" : "บันทึกรูปส่วนตัวไม่สำเร็จ", "PersonalArchive", personalImageResult.ok ? "Success" : "Error", 0);
        }
        return { handled: true, route: "personal-archive-image" };
      }
    }

    var missionPhotoAllowed = isGroup && typeof _isMissionGroup === "function" && _isMissionGroup(groupId);
    var photoEnabled = typeof getConfig === "function" && getConfig("PHOTO_SAVE_STATUS") === "ON";
    var photoAllowed = typeof _isPhotoAllowed !== "function" || _isPhotoAllowed(userId, user.role);
    var photoSourceAllowed = typeof _isPhotoSourceAllowed !== "function" || _isPhotoSourceAllowed(sourceId, isGroup);

    if (photoEnabled && (missionPhotoAllowed || photoAllowed) && photoSourceAllowed) {
      try {
        var photoResult = _downloadAndSavePhoto(message.id, userId, user.name, groupId);
        if (photoResult.ok) {
          try {
            if (typeof linkPhotoToSession === "function") {
              var linkResult = linkPhotoToSession(userId, photoResult.url, photoResult.photoRowId, groupId);
              if (isGroup && typeof _isMissionGroup === "function" && _isMissionGroup(groupId)) {
                _sendMissionPikadReply_(replyToken, "photo", linkResult && linkResult.rowIndex);
              } else if (typeof sendPikadSessionReply === "function" && linkResult && linkResult.rowIndex > 0) {
                sendPikadSessionReply(replyToken, "photo", linkResult.rowIndex);
              } else {
                fixedWebhookSafeReply_(replyToken, (getConfig("PHOTO_REPLY_MSG") || "📸 บันทึกรูปสำเร็จ") + "\n📄 " + photoResult.fileName, userId);
              }
            } else {
              fixedWebhookSafeReply_(replyToken, (getConfig("PHOTO_REPLY_MSG") || "📸 บันทึกรูปสำเร็จ") + "\n📄 " + photoResult.fileName, userId);
            }
          } catch (linkError) {
            fixedWebhookLog_("FIXED linkPhotoToSession error: " + linkError.message);
            fixedWebhookSafeReply_(replyToken, (getConfig("PHOTO_REPLY_MSG") || "📸 บันทึกรูปสำเร็จ") + "\n📄 " + photoResult.fileName, userId);
          }
        } else {
          fixedWebhookSafeReply_(replyToken, "⚠️ บันทึกรูปไม่สำเร็จ: " + photoResult.message, userId);
        }
        if (typeof logActivity === "function") {
          logActivity(userId, user.name, "ส่งรูปภาพ" + (photoResult.ok ? " ✅" : " ❌"), "Photo", photoResult.ok ? "Success" : "Error", 0);
        }
      } catch (photoError) {
        fixedWebhookLog_("FIXED photo save error: " + photoError.message);
        fixedWebhookSafeReply_(replyToken, "⚠️ เกิดข้อผิดพลาดในการบันทึกรูป", userId);
      }
    }
    return { handled: true, route: "image" };
  }

  if (event.type !== "message" || message.type !== "text") {
    return { handled: false, reason: "unsupported event type" };
  }

  var messageText = fixedWebhookTrim_(message.text);
  var isMissionGroup = isGroup && typeof _isMissionGroup === "function" && _isMissionGroup(groupId);
  var allowBareGroupSearch = false;

  if (typeof capturePersonalArchiveLink_ === "function") {
    var personalLinkResult = capturePersonalArchiveLink_(messageText, {
      sourceId: sourceId,
      isGroup: isGroup,
      userId: userId,
      userName: user.name,
      messageId: message.id
    });
    if (personalLinkResult && personalLinkResult.handled) {
      if (typeof sendPersonalArchiveCaptureReply_ === "function") {
        sendPersonalArchiveCaptureReply_(replyToken, personalLinkResult);
      }
      if (typeof logActivity === "function") {
        logActivity(userId, user.name, personalLinkResult.ok ? "บันทึกลิงก์ส่วนตัว" : "บันทึกลิงก์ส่วนตัวไม่สำเร็จ", "PersonalArchive", personalLinkResult.ok ? "Success" : "Error", 0);
      }
      return { handled: true, route: "personal-archive-link" };
    }
  }

  if (fixedWebhookText_(user.state) === "WAITING_NAME") {
    var memberSheetForVip = fixedWebhookSheetMembers_();
    if (messageText === "/ยกเลิก") {
      memberSheetForVip.getRange(user.rowIndex, 7).setValue("");
      fixedWebhookSafeReply_(replyToken, "ยกเลิกการลงทะเบียนแล้วครับ", userId);
      return { handled: true, route: "vip-cancel" };
    }
    memberSheetForVip.getRange(user.rowIndex, 3).setValue(messageText);
    memberSheetForVip.getRange(user.rowIndex, 5).setValue("VIP");
    memberSheetForVip.getRange(user.rowIndex, 7).setValue("");
    fixedWebhookSafeReply_(replyToken, getConfig("VIP_SUCCESS_MSG"), userId);
    if (typeof logActivity === "function") logActivity(userId, messageText, "ลงทะเบียน VIP", "VIP_REG", "Success", 0);
    return { handled: true, route: "vip-register" };
  }

  var secretCode = getConfig("VIP_SECRET_CODE");
  if (secretCode && messageText === secretCode && !isGroup) {
    var memberSheetForSecret = fixedWebhookSheetMembers_();
    memberSheetForSecret.getRange(user.rowIndex, 7).setValue("WAITING_NAME");
    fixedWebhookSafeReply_(replyToken, getConfig("VIP_PROMPT_MSG"), userId);
    return { handled: true, route: "vip-prompt" };
  }

  if (messageText === "/ไอดีกลุ่ม" || messageText === "บอท /ไอดีกลุ่ม" || messageText === "#บอท /ไอดีกลุ่ม") {
    var chatType = isGroup ? "กลุ่ม/ห้องแชท" : "แชทส่วนตัว";
    var chatId = isGroup ? groupId : userId;
    fixedWebhookSafeReply_(replyToken, "📌 ไอดี" + chatType + "นี้คือ:\n\n" + chatId + "\n\n💡 (ก๊อปปี้ไปใส่ในเว็บเพื่อตั้งเป้าหมายแจ้งเตือนได้เลย)", userId);
    return { handled: true, route: "chat-id" };
  }

  if (messageText === "/help" || messageText === "/ช่วยเหลือ" || messageText === "?" ||
      messageText === "บอท /help" || messageText === "บอท /ช่วยเหลือ" ||
      messageText === "#บอท /help" || messageText === "#บอท /ช่วยเหลือ") {
    sendHelpCard(replyToken, user.role, userId);
    if (typeof logActivity === "function") logActivity(userId, user.name, "ขอคู่มือ", "Help", "Success", 0);
    return { handled: true, route: "help" };
  }

  if (isGroup) {
    var trimmed = messageText.trim();
    var groupPrefix = (getConfig("SEARCH_GROUP_PREFIX") || "บอท").trim();
    var searchKeyword = (getConfig("SEARCH_KEYWORD") || "ค้นหา").trim();
    var groupSearchPattern = new RegExp("^/?(#?" + _escapeRegexLocal_(groupPrefix) + ")\\s+/?" + _escapeRegexLocal_(searchKeyword) + "(\\s|$)", "i");
    var bareSearchPattern = new RegExp("^/?" + _escapeRegexLocal_(searchKeyword) + "(\\s|$)", "i");

    if (groupSearchPattern.test(trimmed)) {
    } else if (typeof _shouldHandleGeminiQAText_ === "function" && _shouldHandleGeminiQAText_(trimmed, true)) {
      // Gemini QA ในกลุ่มต้องใช้ prefix ที่ Admin กำหนด เช่น "บอทถาม"
    } else if (isMissionGroup && bareSearchPattern.test(trimmed)) {
      allowBareGroupSearch = true;
    } else if (/^#บอท/i.test(trimmed)) {
      messageText = trimmed.substring(4).trim();
    } else if (/^บอท/i.test(trimmed)) {
      messageText = trimmed.substring(3).trim();
    } else if (/^(บัญชีนัดความ|บัญชีนัด|นัดความ|นัด)(\s|$)/.test(trimmed)) {
    } else if (typeof _isWhitelistedCommand === "function" && _isWhitelistedCommand(trimmed)) {
    } else if (isMissionGroup && typeof _looksLikeMissionCoordinateText === "function" && _looksLikeMissionCoordinateText(trimmed)) {
    } else if (isMissionGroup && typeof _looksLikeMissionHouseNumber === "function" && _looksLikeMissionHouseNumber(trimmed)) {
    } else if (typeof _shouldHandleOnlineCourtText_ === "function" && _shouldHandleOnlineCourtText_(trimmed, groupId)) {
    } else if (typeof _shouldHandleGeneralInfoText_ === "function" && _shouldHandleGeneralInfoText_(trimmed, groupId)) {
    } else {
      return { handled: false, reason: "group text not allowed" };
    }
  }

  if (isMissionGroup) {
    if (typeof _looksLikeMissionCoordinateText === "function" && _looksLikeMissionCoordinateText(messageText) &&
        _handleMissionCoordinateText_(messageText, userId, user.name, groupId, replyToken)) {
      return { handled: true, route: "mission-coordinate" };
    }
    if (typeof _looksLikeMissionHouseNumber === "function" && _looksLikeMissionHouseNumber(messageText) &&
        _handleMissionHouseText_(messageText, userId, user.name, groupId, replyToken)) {
      return { handled: true, route: "mission-house" };
    }
  }

  if (typeof routePersonalArchiveSearch_ === "function") {
    var personalSearchResult = routePersonalArchiveSearch_(messageText, user, userId, sourceId, isGroup, replyToken);
    if (personalSearchResult && personalSearchResult.handled) return { handled: true, route: "personal-search" };
  }

  if (typeof _handleOnlineCourtMessage_ === "function" &&
      _handleOnlineCourtMessage_(messageText, userId, user.name, groupId, replyToken, isGroup)) {
    return { handled: true, route: "online-court" };
  }

  if (typeof _handleGeneralInfoMessage_ === "function" &&
      _handleGeneralInfoMessage_(messageText, userId, user.name, groupId, replyToken, isGroup)) {
    return { handled: true, route: "general-info" };
  }

  if (typeof handleGeminiQAMessage_ === "function") {
    var geminiResult = handleGeminiQAMessage_(messageText, userId, user.name, sourceId, isGroup, replyToken, null);
    if (geminiResult && geminiResult.handled) return { handled: true, route: "gemini-qa" };
  }

  if (typeof routeSearchCommandV2 === "function") {
    var searchResult = routeSearchCommandV2(messageText, user, userId, isGroup, sourceId, replyToken, {
      allowBareGroupSearch: allowBareGroupSearch
    });
    if (searchResult && searchResult.handled) return { handled: true, route: "unified-search" };
  }

  var quickShortcut = _matchQuickDateShortcut(messageText);
  if (quickShortcut) {
    var quickResult = _searchCourtSchedule(quickShortcut, user.role, userId);
    if (quickResult) {
      _sendCourtReply(replyToken, quickResult);
      if (typeof logActivity === "function") logActivity(userId, user.name, "ค้นบัญชีนัดความลัด: " + messageText, "Court", "Success", 0);
      return { handled: true, route: "court-quick" };
    }
  }

  var courtMatch = messageText.match(/^(บัญชีนัดความ|บัญชีนัด|นัดความ|นัด)\s*(.+)$/);
  if (courtMatch) {
    var dateText = courtMatch[2].trim();
    var courtResult = _searchCourtSchedule(dateText, user.role, userId);
    if (courtResult) {
      _sendCourtReply(replyToken, courtResult);
      if (typeof logActivity === "function") logActivity(userId, user.name, "ค้นบัญชีนัดความ: " + dateText, "Court", "Success", 0);
      return { handled: true, route: "court" };
    }
  }

  if (typeof isAdmin === "function" && isAdmin(userId)) {
    var adminReply = handleAdminCommand(messageText, userId, replyToken);
    if (adminReply === "__HANDLED__") return { handled: true, route: "admin" };
  }

  var startTime = new Date().getTime();
  if (getConfig("BOT_STATUS") === "OFF") {
    fixedWebhookSafeReply_(replyToken, getConfig("MSG_FALLBACK"), userId);
    return { handled: true, route: "bot-off" };
  }

  var knowledgeResult = typeof _isPikadOnlyGroup_ === "function" && _isPikadOnlyGroup_(groupId)
    ? null
    : searchKnowledgeBase(messageText, user.role, userId);
  if (knowledgeResult) {
    var knowledgeTime = new Date().getTime() - startTime;
    if (knowledgeResult && typeof knowledgeResult === "object" && knowledgeResult.type === "flex") {
      sendUniversalReply(replyToken, knowledgeResult);
    } else {
      fixedWebhookSafeReply_(replyToken, formatPoliteResponse(knowledgeResult), userId);
    }
    if (typeof logActivity === "function") logActivity(userId, user.name, messageText, "KB Search", "Success", knowledgeTime);
    if (typeof updateDailyStats === "function") updateDailyStats(1, 1, knowledgeTime);
    return { handled: true, route: "knowledge-base" };
  }

  var houseNoRegex = /^[\d\s\/\-\.]+$/;
  var hasHouseKeyword = messageText.indexOf("บ้านเลขที่") >= 0 || messageText.indexOf("เลขที่บ้าน") >= 0;
  var hasMooKeyword = /^หมู่\s*\d/.test(messageText);
  var isShortNumber = houseNoRegex.test(messageText.trim()) && messageText.trim().length <= 20;
  var isHouseWithMoo = /^\d[\d\/\-\.]*\s*(หมู่|ม\.)\s*\d/.test(messageText.trim());
  var isHouseNoPattern = isShortNumber || hasHouseKeyword || hasMooKeyword || isHouseWithMoo;

  if (isHouseNoPattern || (typeof isWaitingForHouseNumber === "function" && isWaitingForHouseNumber(userId))) {
    var cleanHouseNum;
    var extractedAddress = "";
    if (isGroup && typeof _isMissionGroup === "function" && _isMissionGroup(groupId)) {
      var normalizedMission = _normalizeMissionAddress(messageText);
      cleanHouseNum = normalizedMission.houseNum;
      extractedAddress = normalizedMission.address;
    } else {
      cleanHouseNum = messageText.replace(/บ้านเลขที่/g, "").replace(/เลขที่บ้าน/g, "").trim();
    }

    if (typeof _isValidHouseNumber === "function" && !_isValidHouseNumber(cleanHouseNum)) {
      fixedWebhookLog_("FIXED reject invalid house number: " + cleanHouseNum);
      return { handled: false, reason: "invalid house number" };
    }

    var houseResult = _saveOrUpdateHouseNumberCompat_(userId, cleanHouseNum, groupId);
    if (extractedAddress && houseResult && houseResult.rowIndex > 0) {
      try {
        var locationSheet = (typeof _getSS === "function" ? _getSS() : SpreadsheetApp.openById(SPREADSHEET_ID)).getSheetByName(SHEETS.LOCATION);
        if (locationSheet) locationSheet.getRange(houseResult.rowIndex, 7).setValue(extractedAddress);
      } catch (addressError) {
        fixedWebhookLog_("FIXED save address error: " + addressError.message);
      }
    }

    if (isGroup && typeof _isMissionGroup === "function" && _isMissionGroup(groupId)) {
      if (!houseResult || !houseResult.duplicate) _sendMissionPikadReply_(replyToken, "house", houseResult && houseResult.rowIndex);
    } else if (typeof sendPikadSessionReply === "function" && houseResult && houseResult.rowIndex > 0 && !houseResult.duplicate) {
      sendPikadSessionReply(replyToken, "house", houseResult.rowIndex);
    } else if (getConfig("LOC_SAVE_MSG_STATUS") === "ON" && (!houseResult || !houseResult.duplicate)) {
      fixedWebhookSafeReply_(replyToken, getConfig("LOC_SAVE_MSG_TEXT") || "📌 บันทึกข้อมูลแล้ว", userId);
    }

    if (typeof updateDailyStats === "function") updateDailyStats(0, 0, 1);
    if (typeof logActivity === "function") logActivity(userId, user.name, "ส่งข้อมูล: " + cleanHouseNum, "Location", "Success", 0);
    return { handled: true, route: "house-number" };
  }

  if (getConfig("SEARCH_STATUS") === "ON" && !(typeof _isPikadOnlyGroup_ === "function" && _isPikadOnlyGroup_(groupId))) {
    var smartResult = _smartSearchAllDbs(messageText, user.role, userId);
    if (smartResult) {
      sendUniversalReply(replyToken, smartResult);
      if (typeof logActivity === "function") logActivity(userId, user.name, "ค้นหา: " + messageText, "SmartSearch", "Success", new Date().getTime() - startTime);
      return { handled: true, route: "smart-search" };
    }
  }

  var responseTime = new Date().getTime() - startTime;
  fixedWebhookSafeReply_(replyToken, formatPoliteResponse(getConfig("MSG_FALLBACK")), userId);
  if (typeof logActivity === "function") logActivity(userId, user.name, messageText, "Fallback", "Error", responseTime);
  if (typeof updateDailyStats === "function") updateDailyStats(1, 0, responseTime);
  return { handled: true, route: "fallback" };
}

function doPost(e) {
  var rawBody = "";
  try {
    if (!e || !e.postData || !e.postData.contents) {
      fixedWebhookLog_("FIXED doPost: missing postData");
      return fixedWebhookOutput_();
    }

    rawBody = fixedWebhookText_(e.postData.contents);
    var contentLength = Number(e.postData.length || e.contentLength || rawBody.length);
    if (contentLength > FIXED_WEBHOOK_MAX_BODY_BYTES_ || rawBody.length > FIXED_WEBHOOK_MAX_BODY_BYTES_) {
      fixedWebhookLog_("FIXED doPost: body too large");
      return fixedWebhookOutput_();
    }

    var signatureResult = fixedWebhookValidateSignature_(e, rawBody);
    if (!signatureResult.valid) {
      fixedWebhookLog_("FIXED doPost rejected webhook: " + signatureResult.reason);
      return fixedWebhookOutput_();
    }

    var contents;
    try {
      contents = JSON.parse(rawBody);
    } catch (parseError) {
      fixedWebhookLog_("FIXED doPost invalid JSON: " + parseError.message);
      return fixedWebhookOutput_();
    }

    if (!contents || !Array.isArray(contents.events)) {
      fixedWebhookLog_("FIXED doPost: events is not an array");
      return fixedWebhookOutput_();
    }
    if (contents.events.length > FIXED_WEBHOOK_MAX_EVENTS_) {
      fixedWebhookLog_("FIXED doPost: events batch exceeds limit " + FIXED_WEBHOOK_MAX_EVENTS_);
      return fixedWebhookOutput_();
    }

    var results = [];
    contents.events.forEach(function(event, index) {
      try {
        results.push(fixedWebhookProcessEvent_(event));
      } catch (eventError) {
        fixedWebhookLog_("FIXED event " + index + " error: " + eventError.message + "\n" + (eventError.stack || ""));
        results.push({ handled: false, error: eventError.message });
      }
    });

    return fixedWebhookOutput_();
  } catch (error) {
    fixedWebhookLog_("FIXED doPost error: " + error.message + "\n" + (error.stack || ""));
    return fixedWebhookOutput_();
  }
}
