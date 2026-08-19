/**
 * GeneralInfoAdmin.js
 * เมนูข้อมูลทั่วไปแบบการ์ด และหน้าจัดการ Admin
 *
 * ชีตที่ใช้:
 *   1) ข้อมูลทั่วไป_CARDS
 *      card_id | title | subtitle | mode | source_sheet | source_range |
 *      save_key | default_value | enabled | sort_order | icon | updated_at
 *   2) ข้อมูลทั่วไป_SAVED
 *      save_key | value | updated_at | updated_by
 *
 * mode ที่รองรับ:
 *   READ_SHEET  = อ่านค่าจากชีตและช่วงเซลล์ที่กำหนด
 *   SAVE_VALUE  = อ่านค่าที่ Admin บันทึกให้การ์ดนั้น
 *   READ_SAVED  = อ่านค่าจากตารางค่าที่บันทึก โดยใช้ save_key
 */

var GENERAL_INFO_CARDS_SHEET_NAME_ = "ข้อมูลทั่วไป_CARDS";
var GENERAL_INFO_SAVED_SHEET_NAME_ = "ข้อมูลทั่วไป_SAVED";
var GENERAL_INFO_CARD_HEADERS_ = [
  "card_id", "title", "subtitle", "mode", "source_sheet", "source_range",
  "save_key", "default_value", "enabled", "sort_order", "icon", "updated_at"
];
var GENERAL_INFO_SAVED_HEADERS_ = ["save_key", "value", "updated_at", "updated_by"];

function _generalInfoSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function _generalInfoEnsureSheet_(name, headers) {
  var ss = _generalInfoSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    var current = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn() || headers.length)).getValues()[0];
    var missing = headers.some(function(h, i) { return String(current[i] || "").trim() !== h; });
    if (missing) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function setupGeneralInfoAdminSheets() {
  try {
    _generalInfoEnsureSheet_(GENERAL_INFO_CARDS_SHEET_NAME_, GENERAL_INFO_CARD_HEADERS_);
    _generalInfoEnsureSheet_(GENERAL_INFO_SAVED_SHEET_NAME_, GENERAL_INFO_SAVED_HEADERS_);
    return { success: true, message: "สร้าง/ตรวจสอบชีต General Info แล้ว" };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

function _generalInfoText_(value, maxLen) {
  var text = String(value === null || value === undefined ? "" : value);
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  return text.substring(0, maxLen || 4000);
}

function _generalInfoBool_(value, fallback) {
  var raw = String(value === null || value === undefined ? "" : value).trim().toUpperCase();
  if (!raw) return fallback !== false;
  return ["ON", "TRUE", "1", "YES", "ใช้งาน", "เปิด"].indexOf(raw) >= 0;
}

function _generalInfoMode_(value) {
  var raw = String(value || "READ_SAVED").trim().toUpperCase();
  if (["READ_SHEET", "SHEET", "อ่านชีต", "อ่านข้อมูลจากชีต"].indexOf(raw) >= 0) return "READ_SHEET";
  if (["SAVE_VALUE", "SAVE", "บันทึกค่า"].indexOf(raw) >= 0) return "SAVE_VALUE";
  return "READ_SAVED";
}

function _generalInfoRows_() {
  var sheet = _generalInfoEnsureSheet_(GENERAL_INFO_CARDS_SHEET_NAME_, GENERAL_INFO_CARD_HEADERS_);
  if (sheet.getLastRow() <= 1) return [];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, GENERAL_INFO_CARD_HEADERS_.length).getDisplayValues();
  return values.map(function(row, index) {
    return {
      rowNumber: index + 2,
      card_id: _generalInfoText_(row[0], 80),
      title: _generalInfoText_(row[1], 120),
      subtitle: _generalInfoText_(row[2], 240),
      mode: _generalInfoMode_(row[3]),
      source_sheet: _generalInfoText_(row[4], 120),
      source_range: _generalInfoText_(row[5], 120),
      save_key: _generalInfoText_(row[6], 120),
      default_value: _generalInfoText_(row[7], 4000),
      enabled: _generalInfoBool_(row[8], true),
      sort_order: Number(row[9]) || (index + 1),
      icon: _generalInfoText_(row[10] || "📌", 20),
      updated_at: _generalInfoText_(row[11], 40)
    };
  }).filter(function(card) { return !!card.card_id; })
    .sort(function(a, b) { return a.sort_order - b.sort_order; });
}

function getGeneralInfoCards() {
  try {
    setupGeneralInfoAdminSheets();
    return { success: true, cards: _generalInfoRows_() };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e), cards: [] };
  }
}

function _generalInfoFindRowByKey_(sheet, key, keyColumn) {
  if (!sheet || sheet.getLastRow() <= 1) return 0;
  var values = sheet.getRange(2, keyColumn, sheet.getLastRow() - 1, 1).getDisplayValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === key) return i + 2;
  }
  return 0;
}

function saveGeneralInfoCards(payload) {
  try {
    var cards = payload && Array.isArray(payload.cards) ? payload.cards : [];
    if (cards.length > 50) return { success: false, error: "รองรับการ์ดไม่เกิน 50 ใบ" };
    var sheet = _generalInfoEnsureSheet_(GENERAL_INFO_CARDS_SHEET_NAME_, GENERAL_INFO_CARD_HEADERS_);
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    var saved = [];
    cards.forEach(function(raw, index) {
      raw = raw || {};
      var id = _generalInfoText_(raw.card_id || raw.id, 80).trim();
      var title = _generalInfoText_(raw.title, 120).trim();
      if (!id || !title) return;
      var row = [
        id,
        title,
        _generalInfoText_(raw.subtitle, 240),
        _generalInfoMode_(raw.mode),
        _generalInfoText_(raw.source_sheet, 120),
        _generalInfoText_(raw.source_range, 120),
        _generalInfoText_(raw.save_key || id, 120),
        _generalInfoText_(raw.default_value, 4000),
        _generalInfoBool_(raw.enabled, true) ? "ON" : "OFF",
        Number(raw.sort_order) || (index + 1),
        _generalInfoText_(raw.icon || "📌", 20),
        now
      ];
      var existing = _generalInfoFindRowByKey_(sheet, id, 1);
      if (existing) sheet.getRange(existing, 1, 1, row.length).setValues([row]);
      else sheet.appendRow(row);
      saved.push(id);
    });
    SpreadsheetApp.flush();
    return { success: true, saved: saved.length, keys: saved };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

function saveGeneralInfoValues(payload) {
  try {
    var values = payload && Array.isArray(payload.values) ? payload.values : [];
    if (values.length > 100) return { success: false, error: "รองรับค่าที่บันทึกไม่เกิน 100 รายการต่อครั้ง" };
    var sheet = _generalInfoEnsureSheet_(GENERAL_INFO_SAVED_SHEET_NAME_, GENERAL_INFO_SAVED_HEADERS_);
    var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    var saved = [];
    values.forEach(function(raw) {
      raw = raw || {};
      var key = _generalInfoText_(raw.save_key || raw.key, 120).trim();
      if (!key) return;
      var row = [key, _generalInfoText_(raw.value, 4000), now, _generalInfoText_(raw.updated_by || "Dashboard", 120)];
      var existing = _generalInfoFindRowByKey_(sheet, key, 1);
      if (existing) sheet.getRange(existing, 1, 1, row.length).setValues([row]);
      else sheet.appendRow(row);
      saved.push(key);
    });
    SpreadsheetApp.flush();
    return { success: true, saved: saved.length, keys: saved };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

function getGeneralInfoSavedValues() {
  try {
    var sheet = _generalInfoEnsureSheet_(GENERAL_INFO_SAVED_SHEET_NAME_, GENERAL_INFO_SAVED_HEADERS_);
    if (sheet.getLastRow() <= 1) return { success: true, values: [] };
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, GENERAL_INFO_SAVED_HEADERS_.length).getDisplayValues();
    return {
      success: true,
      values: rows.map(function(row) {
        return {
          save_key: _generalInfoText_(row[0], 120),
          value: _generalInfoText_(row[1], 4000),
          updated_at: _generalInfoText_(row[2], 40),
          updated_by: _generalInfoText_(row[3], 120)
        };
      }).filter(function(item) { return !!item.save_key; })
    };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e), values: [] };
  }
}

function _generalInfoReadSaved_(saveKey) {
  var key = String(saveKey || "").trim();
  if (!key) return "";
  var sheet = _generalInfoEnsureSheet_(GENERAL_INFO_SAVED_SHEET_NAME_, GENERAL_INFO_SAVED_HEADERS_);
  var row = _generalInfoFindRowByKey_(sheet, key, 1);
  return row ? _generalInfoText_(sheet.getRange(row, 2).getDisplayValue(), 4000) : "";
}

function _generalInfoReadSheet_(sheetName, rangeA1) {
  var name = String(sheetName || "").trim();
  if (!name) return "";
  var sheet = _generalInfoSpreadsheet_().getSheetByName(name);
  if (!sheet) return "ไม่พบชีต: " + name;
  var range = String(rangeA1 || "").trim() ? sheet.getRange(String(rangeA1).trim()) : sheet.getDataRange();
  var values = range.getDisplayValues();
  return _generalInfoText_(values.map(function(row) { return row.join(" | "); }).join("\n").trim(), 4000);
}

function getGeneralInfoCardContent(cardId) {
  try {
    var card = _generalInfoRows_().filter(function(item) { return item.card_id === String(cardId || "").trim(); })[0];
    if (!card) return { success: false, error: "ไม่พบการ์ด" };
    var content = "";
    if (card.mode === "READ_SHEET") content = _generalInfoReadSheet_(card.source_sheet, card.source_range);
    else content = _generalInfoReadSaved_(card.save_key) || card.default_value || "ยังไม่มีข้อมูลที่บันทึก";
    return { success: true, card: card, content: content };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

function _generalInfoMenuEnabled_() {
  return String(getConfig("GENERAL_INFO_STATUS") || "ON").trim().toUpperCase() !== "OFF";
}

function _generalInfoKeywords_() {
  return String(getConfig("GENERAL_INFO_MENU_KEYWORDS") || "ข้อมูลทั่วไป").split(/[,|\n]+/)
    .map(function(s) { return s.trim(); }).filter(Boolean);
}

function _generalInfoStripPrefix_(text) {
  return String(text || "").trim().replace(/^#?\s*บอท\s*/i, "").trim();
}

function _generalInfoMatch_(text) {
  var clean = _generalInfoStripPrefix_(text);
  var keywords = _generalInfoKeywords_();
  for (var i = 0; i < keywords.length; i++) {
    var key = keywords[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var re = new RegExp("^" + key + "(?:\\s+(.+))?$", "i");
    var m = clean.match(re);
    if (m) return { matched: true, argument: String(m[1] || "").trim() };
  }
  return { matched: false, argument: "" };
}

function _buildGeneralInfoMenuFlex_() {
  var cards = _generalInfoRows_().filter(function(card) { return card.enabled; }).slice(0, 10);
  var bubbles = cards.map(function(card, index) {
    return {
      type: "bubble",
      size: "micro",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#0f766e", paddingAll: "14px",
        contents: [{ type: "text", text: String(card.icon || "📌"), size: "xl", align: "center" }]
      },
      body: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "14px",
        contents: [
          { type: "text", text: String(index + 1) + ". " + card.title, weight: "bold", size: "sm", wrap: true, color: "#134e4a" },
          { type: "text", text: card.subtitle || "แตะเพื่อดูข้อมูล", size: "xs", wrap: true, color: "#64748b" }
        ]
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "10px",
        contents: [{ type: "button", style: "primary", color: "#0f766e", action: { type: "message", label: "เปิดข้อมูล", text: "ข้อมูลทั่วไป " + card.card_id } }]
      }
    };
  });
  if (!bubbles.length) {
    bubbles = [{ type: "bubble", body: { type: "box", layout: "vertical", contents: [{ type: "text", text: "ยังไม่มีการ์ดข้อมูลทั่วไป", wrap: true }] } }];
  }
  return { type: "flex", altText: "ข้อมูลทั่วไป", contents: { type: "carousel", contents: bubbles } };
}

function _handleGeneralInfoMessage_(messageText, userId, userName, groupId, replyToken, isGroup) {
  if (!_generalInfoMenuEnabled_()) return false;
  var match = _generalInfoMatch_(messageText);
  if (!match.matched) return false;
  var cards = _generalInfoRows_().filter(function(card) { return card.enabled; });
  if (!match.argument) {
    sendUniversalReply(replyToken, _buildGeneralInfoMenuFlex_());
    return true;
  }
  var card = cards.filter(function(item, index) {
    return item.card_id === match.argument || String(index + 1) === match.argument;
  })[0];
  if (!card) {
    safeSendReply(replyToken, "ไม่พบการ์ดข้อมูลทั่วไป: " + match.argument);
    return true;
  }
  var result = getGeneralInfoCardContent(card.card_id);
  if (!result.success) safeSendReply(replyToken, "ไม่สามารถอ่านข้อมูลได้: " + result.error);
  else safeSendReply(replyToken, "📌 " + card.title + "\n\n" + (result.content || "ยังไม่มีข้อมูล"));
  return true;
}

function _shouldHandleGeneralInfoText_(messageText, groupId) {
  return _generalInfoMatch_(messageText).matched;
}
