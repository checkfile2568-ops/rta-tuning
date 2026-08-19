/**
 * OnlineCourt.gs — ศูนย์ประสานงานคดีออนไลน์ (แยกออกจาก Code.gs)
 * โมดูลนี้ self-contained: เรียกผ่าน delegation 3 จุดใน Code.gs (typeof-guarded)
 *   - _handleOnlineCourtMessage_  (ข้อความเข้า)
 *   - _shouldHandleOnlineCourtText_ (ตัวกรองข้อความในกลุ่ม)
 *   - _handleOnlineCourtFollow_  (event แอดเพื่อน → ข้อความต้อนรับ)
 * ใช้ utility ร่วมจาก Code.gs: getConfig, safeSendReply, sendUniversalReply,
 *   logActivity, _getSettingsDefaultValues_ (Apps Script ใช้ global scope ร่วมกัน)
 */

function _splitOnlineCourtList_(raw, fallback) {
  const source = String(raw || fallback || "");
  return source.split(/[\n,;|]+/)
    .map(function(s) { return String(s || "").trim(); })
    .filter(Boolean);
}

function _getOnlineCourtDefault_(key) {
  const defaults = _getSettingsDefaultValues_ ? _getSettingsDefaultValues_() : {};
  return defaults[key] || "";
}

function _normalizeOnlineCourtMenuText_(text) {
  return String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function _onlineCourtConfiguredKeywordMatch_(messageText, key) {
  const text = _normalizeOnlineCourtMenuText_(messageText);
  if (!text) return false;
  const keywords = _splitOnlineCourtList_(getConfig(key), _getOnlineCourtDefault_(key));
  return keywords.some(function(keyword) {
    const clean = _normalizeOnlineCourtMenuText_(keyword);
    return clean && text === clean;
  });
}

function _isOnlineCourtCoreMenuText_(messageText) {
  const text = _normalizeOnlineCourtMenuText_(messageText);
  if (!text) return false;
  return text === _normalizeOnlineCourtMenuText_("ศูนย์ประสานงานคดี");
}

function _isOnlineCourtExcludedSource_(sourceId) {
  const source = String(sourceId || "").trim();
  if (!source) return false;
  const excluded = _splitOnlineCourtList_(getConfig("ONLINE_COURT_EXCLUDED_IDS"), _getOnlineCourtDefault_("ONLINE_COURT_EXCLUDED_IDS"));
  return excluded.some(function(id) {
    return String(id || "").trim() === source;
  });
}

function _getOnlineCourtScope_(raw) {
  const tokens = _splitOnlineCourtList_(raw, "");
  const scope = {
    all: false,
    groups: false,
    private: false,
    ids: [],
    raw: tokens
  };
  tokens.forEach(function(token) {
    const value = String(token || "").trim();
    const lower = value.toLowerCase();
    if (lower === "all") {
      scope.all = true;
    } else if (lower === "groups" || lower === "group" || lower === "rooms" || lower === "room") {
      scope.groups = true;
    } else if (lower === "private" || lower === "dm" || lower === "dms") {
      scope.private = true;
    } else if (value) {
      scope.ids.push(value);
    }
  });
  return scope;
}

function _isOnlineCourtScopeAllowed_(sourceId, isPrivate, rawScope) {
  if (String(getConfig("ONLINE_COURT_STATUS") || "OFF").toUpperCase() !== "ON") return false;
  if (_isOnlineCourtExcludedSource_(sourceId)) return false;
  const scope = _getOnlineCourtScope_(rawScope || getConfig("ONLINE_COURT_GROUP_IDS"));
  if (scope.all) return true;
  if (isPrivate) {
    if (scope.private) return true;
    return !!sourceId && scope.ids.indexOf(String(sourceId)) >= 0;
  }
  if (scope.groups) return true;
  return !!sourceId && scope.ids.indexOf(String(sourceId)) >= 0;
}

function _isOnlineCourtGroup_(groupId) {
  if (!groupId) return false;
  return _isOnlineCourtScopeAllowed_(groupId, false);
}

function _isOnlineCourtPrivateAllowed_(userId) {
  if (!userId) return false;
  return _isOnlineCourtScopeAllowed_(userId, true);
}

function _isOnlineCourtStatusOn_() {
  return String(getConfig("ONLINE_COURT_STATUS") || "OFF").toUpperCase() === "ON";
}

function _normalizeOnlineCourtDay_(token) {
  const text = String(token || "").trim().toUpperCase().replace(/\./g, "");
  const aliases = {
    "SUN": "SUN", "SUNDAY": "SUN", "อาทิตย์": "SUN", "วันอาทิตย์": "SUN",
    "MON": "MON", "MONDAY": "MON", "จันทร์": "MON", "วันจันทร์": "MON",
    "TUE": "TUE", "TUESDAY": "TUE", "อังคาร": "TUE", "วันอังคาร": "TUE",
    "WED": "WED", "WEDNESDAY": "WED", "พุธ": "WED", "วันพุธ": "WED",
    "THU": "THU", "THURSDAY": "THU", "พฤหัส": "THU", "พฤหัสบดี": "THU", "วันพฤหัสบดี": "THU",
    "FRI": "FRI", "FRIDAY": "FRI", "ศุกร์": "FRI", "วันศุกร์": "FRI",
    "SAT": "SAT", "SATURDAY": "SAT", "เสาร์": "SAT", "วันเสาร์": "SAT"
  };
  return aliases[text] || text;
}

function _parseOnlineCourtTime_(value, useLastTime) {
  const matches = String(value || "").match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(?:น\.?|นาฬิกา)?/g);
  if (!matches || matches.length === 0) return null;
  const selected = useLastTime ? matches[matches.length - 1] : matches[0];
  const m = selected.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  if (!m) return null;
  const hour = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const minute = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return hour * 60 + minute;
}

function _isOnlineCourtInSchedule_() {
  const _schedMode = String(getConfig("ONLINE_COURT_SCHEDULE_MODE") || _getOnlineCourtDefault_("ONLINE_COURT_SCHEDULE_MODE") || "office").toLowerCase();
  if (_schedMode === "24h" || _schedMode === "24" || _schedMode === "24hr" || _schedMode === "24hour" || _schedMode === "always") return true;
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const today = dayNames[now.getDay()];
  const daysRaw = getConfig("ONLINE_COURT_DAYS") || _getOnlineCourtDefault_("ONLINE_COURT_DAYS") || "MON,TUE,WED,THU,FRI";
  const daysText = String(daysRaw || "").trim().toUpperCase();
  if (daysText && daysText !== "ALL" && daysText !== "EVERYDAY" && daysText !== "ทุกวัน") {
    const allowedDays = _splitOnlineCourtList_(daysRaw, "")
      .map(_normalizeOnlineCourtDay_)
      .filter(Boolean);
    if (allowedDays.length > 0 && allowedDays.indexOf(today) < 0) return false;
  }
  const nowMinutes = _parseOnlineCourtTime_(Utilities.formatDate(now, tz, "HH:mm"));
  const startRaw = getConfig("ONLINE_COURT_START_TIME") || _getOnlineCourtDefault_("ONLINE_COURT_START_TIME") || "08.00 น.";
  const endRaw = getConfig("ONLINE_COURT_END_TIME") || _getOnlineCourtDefault_("ONLINE_COURT_END_TIME") || "16.30 น.";
  const startRawTimes = String(startRaw || "").match(/(\d{1,2})\s*[:.]\s*(\d{2})/g) || [];
  const startMinutes = _parseOnlineCourtTime_(startRaw, false);
  const endMinutes = startRawTimes.length >= 2
    ? _parseOnlineCourtTime_(startRaw, true)
    : _parseOnlineCourtTime_(endRaw, true);
  if (nowMinutes === null || startMinutes === null || endMinutes === null) return true;
  if (startMinutes <= endMinutes) return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
  return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
}

function _detectOnlineCourtBench_(messageText) {
  const text = String(messageText || "");
  for (let n = 1; n <= 8; n++) {
    const patterns = [
      new RegExp("บ\\s*\\.?\\s*" + n + "(?!\\d)", "i"),
      new RegExp("บัลลังก์\\s*(ที่\\s*)?" + n + "(?!\\d)", "i"),
      new RegExp("ห้อง\\s*(พิจารณาคดี\\s*)?(ที่\\s*)?" + n + "(?!\\d)", "i")
    ];
    if (patterns.some(function(re) { return re.test(text); })) return n;
  }
  return 0;
}

function _stripOnlineCourtBotPrefix_(messageText) {
  return String(messageText || "").trim().replace(/^#?\s*บอท\s*/i, "").trim();
}

function _detectOnlineCourtDirectMenuTopicNo_(messageText) {
  const raw = String(messageText || "").trim();
  const text = _normalizeOnlineCourtMenuText_(raw);
  const m = text.match(/^(?:หัวข้อ|ข้อ)?\s*([1-5])(?:\D|$)/);
  if (m) return parseInt(m[1], 10);
  if (_isOnlineCourtCoreMenuText_(raw)) return 0;
  return -1;
}

function _isOnlineCourtPrivateMenuRequest_(messageText) {
  return _isOnlineCourtCoreMenuText_(messageText);
}

function _isOnlineCourtGroupMenuRequest_(messageText, allowStrippedText) {
  const raw = String(messageText || "").trim();
  if (!raw) return false;
  const hasBotPrefix = /^#?\s*บอท\s*/i.test(raw);
  if (_isOnlineCourtCoreMenuText_(raw)) return true;
  const stripped = _stripOnlineCourtBotPrefix_(raw);
  if (stripped && stripped !== raw) {
    return _isOnlineCourtCoreMenuText_(stripped) ||
      _detectOnlineCourtDirectMenuTopicNo_(stripped) >= 0;
  }
  if (!allowStrippedText) return false;
  return _detectOnlineCourtDirectMenuTopicNo_(raw) >= 0;
}

function _shouldHandleOnlineCourtText_(messageText, groupId) {
  if (!_isOnlineCourtGroup_(groupId)) return false;
  if (!_isOnlineCourtInSchedule_()) return false;
  return _isOnlineCourtGroupMenuRequest_(messageText, false);
}

function _getOnlineCourtMode_() {
  return "register_then_menu";
}

function _getOnlineCourtTopic_(index) {
  const n = Math.max(1, Math.min(5, parseInt(index, 10) || 1));
  const title = getConfig("ONLINE_COURT_TOPIC_" + n + "_TITLE") ||
    _getOnlineCourtDefault_("ONLINE_COURT_TOPIC_" + n + "_TITLE") ||
    ("หัวข้อ " + n);
  const fallbackReplies = {
    1: getConfig("ONLINE_COURT_JOIN_REPLY") || _getOnlineCourtDefault_("ONLINE_COURT_JOIN_REPLY"),
    2: getConfig("ONLINE_COURT_OATH_REPLY") || _getOnlineCourtDefault_("ONLINE_COURT_OATH_REPLY"),
    3: getConfig("ONLINE_COURT_OATH_REPLY") || _getOnlineCourtDefault_("ONLINE_COURT_OATH_REPLY"),
    4: getConfig("ONLINE_COURT_PROBLEM_REPLY") || _getOnlineCourtDefault_("ONLINE_COURT_PROBLEM_REPLY"),
    5: getConfig("ONLINE_COURT_CONTACT_REPLY") || _getOnlineCourtDefault_("ONLINE_COURT_CONTACT_REPLY")
  };
  const reply = getConfig("ONLINE_COURT_TOPIC_" + n + "_REPLY") ||
    _getOnlineCourtDefault_("ONLINE_COURT_TOPIC_" + n + "_REPLY") ||
    fallbackReplies[n] ||
    "";
  return { index: n, title: String(title || "").trim(), reply: String(reply || "").trim() };
}

function _buildOnlineCourtMenuText_(session) {
  const title = getConfig("ONLINE_COURT_MENU_TITLE") || _getOnlineCourtDefault_("ONLINE_COURT_MENU_TITLE") || "ศูนย์ประสานงานคดีออนไลน์";
  const lines = [String(title || "").trim()];
  if (session && session.partyName) {
    const bits = ["ข้อมูลที่แจ้งไว้: " + session.partyName];
    if (session.caseNo) bits.push("เลขคดี " + session.caseNo);
    if (session.bench) bits.push("บัลลังก์/ห้อง " + session.bench);
    if (session.appointmentTime) bits.push("เวลานัด " + session.appointmentTime);
    lines.push(bits.join(" / "));
  }
  lines.push("");
  for (let i = 1; i <= 5; i++) {
    const topic = _getOnlineCourtTopic_(i);
    if (topic.title) lines.push(i + ". " + topic.title);
  }
  lines.push("");
  lines.push("พิมพ์เลขหัวข้อ 1-5 หรือพิมพ์ \"ศูนย์ประสานงานคดี\" เพื่อดูหัวข้ออีกครั้ง");
  return lines.join("\n");
}

function _onlineCourtFlexText_(text, maxLen) {
  const value = String(text || "").replace(/\s+\n/g, "\n").trim();
  const limit = maxLen || 900;
  if (value.length <= limit) return value;
  return value.substring(0, limit - 1) + "…";
}

function _extractOnlineCourtLinks_(text) {
  const links = [];
  const phones = [];
  let work = String(text || "");
  // 1) ดึง tel: ออกมาทำปุ่มโทร (ลบออกจากข้อความ เพราะไม่ใช่ข้อความสำหรับอ่าน)
  work = work.replace(/tel:\+?[0-9\-\s]{6,}/gi, function(m) {
    const num = m.replace(/^tel:/i, "").replace(/[\s\-]/g, "");
    if (num && phones.indexOf(num) < 0) phones.push(num);
    return "";
  });
  // 2) ดึง URL ทำปุ่มลิงก์ (คงเครื่องหมายวรรคตอนท้ายไว้ในข้อความ)
  work = work.replace(/https?:\/\/[^\s<>"']+/g, function(url) {
    let cleanUrl = String(url || "").replace(/[)\].,;!?]+$/g, "");
    const suffix = String(url || "").substring(cleanUrl.length);
    if (cleanUrl && links.indexOf(cleanUrl) < 0) links.push(cleanUrl);
    return suffix;
  });
  // 3) ดึงเบอร์โทรไทยจากข้อความ (ขึ้นต้น 0 ยาว 9-10 หลัก มีขีด/เว้นวรรคได้) — คงข้อความไว้ให้อ่าน
  const phoneRe = /(?:^|[^0-9])(0\d(?:[\s\-]?\d){7,8})(?![0-9])/g;
  let pm;
  while ((pm = phoneRe.exec(work)) !== null) {
    const num = String(pm[1]).replace(/[\s\-]/g, "");
    if (num.length >= 9 && num.length <= 10 && phones.indexOf(num) < 0) phones.push(num);
  }
  const cleanText = work.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleanText, links: links.slice(0, 3), phones: phones.slice(0, 2) };
}

function _onlineCourtLinkLabel_(url, topic, index) {
  const title = String((topic && topic.title) || "") + " " + String((topic && topic.reply) || "");
  if (/คำสาบาน|สาบานตน|สาบาน/.test(title)) return index > 1 ? ("เปิดคำสาบานตน " + index) : "เปิดดูคำสาบานตน";
  if (/drive\.google\.com/i.test(String(url || ""))) return index > 1 ? ("เปิดเอกสาร " + index) : "เปิดเอกสาร";
  return index > 1 ? ("เปิดลิงก์ " + index) : "เปิดลิงก์";
}

function _buildOnlineCourtMenuTopicBox_(topic, inGroup) {
  const actionText = (inGroup ? "บอท " : "") + String(topic.index);
  return {
    type: "box",
    layout: "horizontal",
    paddingAll: "12px",
    spacing: "sm",
    action: { type: "message", label: String(topic.index), text: actionText },
    contents: [
      {
        type: "text",
        text: String(topic.index) + ".",
        weight: "bold",
        color: "#7C3AED",
        size: "md",
        flex: 0
      },
      {
        type: "box",
        layout: "vertical",
        flex: 1,
        contents: [
          {
            type: "text",
            text: _onlineCourtFlexText_(topic.title || ("หัวข้อ " + topic.index), 80),
            weight: "bold",
            color: "#111827",
            size: "sm",
            wrap: true
          },
          {
            type: "text",
            text: "แตะเพื่อดูรายละเอียด หรือพิมพ์ " + actionText,
            color: "#6B7280",
            size: "xxs",
            margin: "xs",
            wrap: true
          }
        ]
      }
    ]
  };
}

function _buildOnlineCourtSessionSummaryFlex_(session) {
  if (!session || !session.partyName) return null;
  const items = ["ข้อมูลที่แจ้งไว้: " + session.partyName];
  if (session.caseNo) items.push("เลขคดี " + session.caseNo);
  if (session.bench) items.push("บัลลังก์/ห้อง " + session.bench);
  if (session.appointmentTime) items.push("เวลานัด " + session.appointmentTime);
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: "#F5F3FF",
    cornerRadius: "8px",
    paddingAll: "10px",
    margin: "md",
    contents: [{
      type: "text",
      text: _onlineCourtFlexText_(items.join(" / "), 220),
      color: "#4C1D95",
      size: "xs",
      wrap: true
    }]
  };
}

function _buildOnlineCourtMenuFlex_(session, inGroup, leadText) {
  const fallbackText = [leadText, _buildOnlineCourtMenuText_(session)].filter(Boolean).join("\n\n");
  const titleRaw = getConfig("ONLINE_COURT_MENU_TITLE") || _getOnlineCourtDefault_("ONLINE_COURT_MENU_TITLE") || "ศูนย์ประสานงานคดีออนไลน์";
  const titleLines = String(titleRaw || "").split(/\n+/).map(function(s) { return s.trim(); }).filter(Boolean);
  const title = titleLines[0] || "ศูนย์ประสานงานคดีออนไลน์";
  const subtitle = titleLines.slice(1).join(" ") || "กรุณาเลือกหัวข้อที่ต้องการสอบถาม";
  const bodyContents = [];

  if (leadText) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      backgroundColor: "#FEF3C7",
      cornerRadius: "8px",
      paddingAll: "10px",
      margin: "md",
      contents: [{
        type: "text",
        text: _onlineCourtFlexText_(leadText, 320),
        color: "#92400E",
        size: "xs",
        wrap: true
      }]
    });
  }

  const summary = _buildOnlineCourtSessionSummaryFlex_(session);
  if (summary) bodyContents.push(summary);

  for (let i = 1; i <= 5; i++) {
    bodyContents.push(_buildOnlineCourtMenuTopicBox_(_getOnlineCourtTopic_(i), inGroup));
    if (i < 5) bodyContents.push({ type: "separator", color: "#E5E7EB", margin: "none" });
  }

  return {
    type: "flex",
    altText: "ศูนย์ประสานงานคดีออนไลน์: เลือกหัวข้อสอบถาม",
    fallbackText: fallbackText,
    contents: {
      type: "bubble",
      size: "giga",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#4C1D95",
        paddingAll: "16px",
        spacing: "xs",
        contents: [
          { type: "text", text: "⚖️ " + _onlineCourtFlexText_(title, 80), color: "#FFFFFF", weight: "bold", size: "lg", wrap: true },
          { type: "text", text: _onlineCourtFlexText_(subtitle, 120), color: "#E9D5FF", size: "sm", wrap: true },
          { type: "text", text: inGroup ? "เรียกเมนูด้วยข้อความ ศูนย์ประสานงานคดี" : "ระบบถามข้อมูลก่อนแสดงเมนูบริการ", color: "#FDE68A", size: "xs", margin: "sm", wrap: true }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "0px",
        spacing: "none",
        contents: bodyContents
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [{
          type: "text",
          text: "พิมพ์เลขหัวข้อ 1-5 หรือพิมพ์ \"ศูนย์ประสานงานคดี\" เพื่อดูเมนูอีกครั้ง",
          size: "xs",
          color: "#6B7280",
          align: "center",
          wrap: true
        }]
      }
    }
  };
}

function _buildOnlineCourtTopicFlex_(topic, inGroup) {
  const menuText = "ศูนย์ประสานงานคดี";
  const fallbackText = topic.title + "\n\n" + topic.reply;
  const replyParts = _extractOnlineCourtLinks_(topic.reply || "");
  const bodyText = replyParts.text || (replyParts.links.length ? "กดปุ่มด้านล่างเพื่อเปิดเอกสารหรือดูรายละเอียดเพิ่มเติม" : "ยังไม่ได้ตั้งค่าข้อความตอบกลับ");
  const footerContents = [];
  // ปุ่มโทร (เขียว) — สร้างอัตโนมัติจากเบอร์ที่พบในข้อความตอบ
  (replyParts.phones || []).forEach(function(phone) {
    footerContents.push({
      type: "button",
      action: { type: "uri", label: (replyParts.phones.length > 1 ? ("📞 โทร " + phone) : "📞 โทรเจ้าหน้าที่"), uri: "tel:" + phone },
      style: "primary",
      color: "#059669",
      height: "sm",
      margin: footerContents.length ? "sm" : "none"
    });
  });
  // ปุ่มลิงก์/เอกสาร (น้ำเงิน) — สร้างอัตโนมัติจาก URL ที่พบในข้อความตอบ
  (replyParts.links || []).forEach(function(url, index) {
    footerContents.push({
      type: "button",
      action: { type: "uri", label: _onlineCourtLinkLabel_(url, topic, index + 1), uri: url },
      style: "primary",
      color: "#2563EB",
      height: "sm",
      margin: footerContents.length ? "sm" : "none"
    });
  });
  const _hasExtraBtn = footerContents.length > 0;
  // ปุ่มกลับไปเมนู (ม่วง)
  footerContents.push({
    type: "button",
    action: { type: "message", label: "≡ กลับไปเมนู", text: menuText },
    style: _hasExtraBtn ? "secondary" : "primary",
    color: "#7C3AED",
    height: "sm",
    margin: _hasExtraBtn ? "sm" : "none"
  });
  return {
    type: "flex",
    altText: "ศูนย์ประสานงานคดีออนไลน์: " + _onlineCourtFlexText_(topic.title, 60),
    fallbackText: fallbackText,
    contents: {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#4C1D95",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "⚖️ ศูนย์ประสานงานคดีออนไลน์", color: "#FFFFFF", weight: "bold", size: "md", wrap: true },
          { type: "text", text: String(topic.index) + ". " + _onlineCourtFlexText_(topic.title, 90), color: "#FDE68A", size: "sm", margin: "xs", wrap: true }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        contents: [{
          type: "text",
          text: _onlineCourtFlexText_(bodyText, 1000),
          color: "#111827",
          size: "sm",
          wrap: true
        }]
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: footerContents
      }
    }
  };
}

function _onlineCourtSessionKey_(userId) {
  return "onlineCourtSession:" + String(userId || "").slice(-40);
}

function _getOnlineCourtSession_(userId) {
  if (!userId) return {};
  try {
    const raw = CacheService.getScriptCache().get(_onlineCourtSessionKey_(userId));
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function _saveOnlineCourtSession_(userId, session) {
  if (!userId) return;
  const next = session || {};
  next.updatedAt = new Date().toISOString();
  CacheService.getScriptCache().put(_onlineCourtSessionKey_(userId), JSON.stringify(next), 21600);
}

function _parseOnlineCourtRegistrationInfo_(messageText) {
  const text = String(messageText || "").trim();
  const info = { raw: text };
  const caseMatch = text.match(/(?:คดี|เลขคดี)\s*[:：]?\s*([A-Za-z0-9ก-๙./-]{2,30})/i) ||
    text.match(/([A-Za-z]{1,4}\.?\s*\d+\/\d{2,4}|\d+\/\d{2,4})/);
  const benchMatch = text.match(/(?:บัลลังก์|ห้อง|บ)\s*[:：.]?\s*(\d{1,2})/i);
  const timeMatch = text.match(/(\d{1,2}\s*[:.]\s*\d{2}\s*(?:น\.?|นาฬิกา)?)/);
  if (caseMatch) info.caseNo = String(caseMatch[1] || "").trim();
  if (benchMatch) info.bench = String(benchMatch[1] || "").trim();
  if (timeMatch) info.appointmentTime = String(timeMatch[1] || "").trim();

  let nameText = text
    .replace(/(?:ชื่อ|ชื่อ-สกุล)\s*[:：]?/gi, "")
    .replace(/(?:คดี|เลขคดี)\s*[:：]?\s*[A-Za-z0-9ก-๙./-]{2,30}/gi, "")
    .replace(/(?:บัลลังก์|ห้อง|บ)\s*[:：.]?\s*\d{1,2}/gi, "")
    .replace(/\d{1,2}\s*[:.]\s*\d{2}\s*(?:น\.?|นาฬิกา)?/gi, "")
    .replace(/[|,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (nameText.length >= 2 && nameText.length <= 80) info.partyName = nameText;
  return info;
}

function _handleOnlineCourtMenuMode_(messageText, userId, userName, groupId, replyToken, inGroup, mode) {
  const topicNo = _detectOnlineCourtDirectMenuTopicNo_(inGroup ? _stripOnlineCourtBotPrefix_(messageText) : messageText);
  let session = inGroup ? {} : _getOnlineCourtSession_(userId);
  const waitingForInfo = !inGroup && session && session.step === "awaiting_info";
  const sessionReadyForTopic = !inGroup && session && (session.step === "menu" || !!session.partyName);
  const menuRequest = inGroup
    ? _isOnlineCourtGroupMenuRequest_(messageText, true)
    : (_isOnlineCourtPrivateMenuRequest_(messageText) || (sessionReadyForTopic && topicNo >= 1));
  if (!menuRequest && !waitingForInfo) {
    if (!inGroup) {
      _logOnlineCourtPrivateUsage_(userId, userName, messageText, "ไม่ตรงรูปแบบ", "", "ไม่เข้าเงื่อนไขเมนู", "ไม่ตอบ", messageText, "ข้อความส่วนตัวที่ไม่ตรงคำเรียกเมนู");
    }
    return false;
  }

  if (inGroup) {
    if (topicNo >= 1) {
      const topic = _getOnlineCourtTopic_(topicNo);
      sendUniversalReply(replyToken, _buildOnlineCourtTopicFlex_(topic, true));
      return true;
    }
    const groupReply = getConfig("ONLINE_COURT_GROUP_PRIVACY_REPLY") || _getOnlineCourtDefault_("ONLINE_COURT_GROUP_PRIVACY_REPLY") || "";
    sendUniversalReply(replyToken, _buildOnlineCourtMenuFlex_({}, true, groupReply));
    return true;
  }

  const requireName = true;
  if (mode === "register_then_menu" && requireName && !session.partyName) {
    if (session.step === "awaiting_info") {
      const info = _parseOnlineCourtRegistrationInfo_(messageText);
      if (info.partyName || info.caseNo || info.bench || info.appointmentTime) {
        session = Object.assign({}, session, info, {
          sourceType: "private",
          userName: userName || session.userName || "",
          step: "menu"
        });
        _saveOnlineCourtSession_(userId, session);
        _logOnlineCourtPrivateUsage_(userId, userName, messageText, "แจ้งข้อมูลเบื้องต้น", "ลงทะเบียนก่อนเมนู", "แสดงเมนู", "Flex Card", messageText, "บันทึก session ชั่วคราว");
        sendUniversalReply(replyToken, _buildOnlineCourtMenuFlex_(session, false, "รับทราบข้อมูลเบื้องต้นแล้วครับ/ค่ะ"));
        return true;
      }
    }
    const promptEvent = session.step === "awaiting_info" ? "ข้อมูลไม่ครบ" : "เริ่มเมนู";
    const promptResult = session.step === "awaiting_info" ? "ถามข้อมูลซ้ำ" : "ถามข้อมูลเบื้องต้น";
    session = Object.assign({}, session, {
      sourceType: "private",
      userName: userName || session.userName || "",
      step: "awaiting_info"
    });
    _saveOnlineCourtSession_(userId, session);
    _logOnlineCourtPrivateUsage_(userId, userName, messageText, promptEvent, "ถามข้อมูลก่อนแสดงเมนู", promptResult, "Text", messageText, "ยังไม่มีข้อมูลผู้ใช้งานใน session");
    sendUniversalReply(replyToken, _buildOnlineCourtRegisterFlex_(getConfig("ONLINE_COURT_REGISTER_PROMPT") || _getOnlineCourtDefault_("ONLINE_COURT_REGISTER_PROMPT")));
    return true;
  }

  if (topicNo >= 1) {
    const topic = _getOnlineCourtTopic_(topicNo);
    session.lastTopic = topicNo;
    session.step = "menu";
    _saveOnlineCourtSession_(userId, session);
    _logOnlineCourtPrivateUsage_(userId, userName, messageText, "เลือกหัวข้อ", topicNo + ". " + topic.title, "ตอบหัวข้อ", "Flex Card", messageText, "");
    sendUniversalReply(replyToken, _buildOnlineCourtTopicFlex_(topic, false));
    return true;
  }

  _logOnlineCourtPrivateUsage_(userId, userName, messageText, "เปิดเมนูซ้ำ", "เมนูหลัก", "แสดงเมนู", "Flex Card", messageText, "");
  sendUniversalReply(replyToken, _buildOnlineCourtMenuFlex_(session, false, ""));
  return true;
}

function _handleOnlineCourtMessage_(messageText, userId, userName, groupId, replyToken, isGroup) {
  // ตัดสินว่าเป็นกลุ่ม/ห้อง หรือแชทส่วนตัว (1 ต่อ 1)
  const inGroup = (typeof isGroup === "boolean") ? isGroup : !!groupId;
  const privateDirectStart = !inGroup && _isOnlineCourtCoreMenuText_(messageText);
  const privateSession = !inGroup ? _getOnlineCourtSession_(userId) : {};
  const privateSessionActive = !inGroup && privateSession && (privateSession.step === "awaiting_info" || privateSession.step === "menu" || !!privateSession.partyName);
  if (inGroup) {
    if (!_isOnlineCourtGroup_(groupId)) return false;
  } else {
    if (typeof _isOnlineCourtPrivateAllowed_ !== "function" || !_isOnlineCourtPrivateAllowed_(userId)) {
      if ((!privateDirectStart && !privateSessionActive) || !_isOnlineCourtStatusOn_() || _isOnlineCourtExcludedSource_(userId)) return false;
    }
  }
  if (!_isOnlineCourtInSchedule_() && !privateDirectStart && !privateSessionActive) return false;
  // โหมดเดียว: register → menu (ระบบ keyword เดิมถูกถอดออกทั้งหมดแล้ว)
  return _handleOnlineCourtMenuMode_(messageText, userId, userName, groupId, replyToken, inGroup, "register_then_menu");
}

function debugOnlineCourtDecision(payload) {
  try {
    payload = payload || {};
    const overrides = _normalizeOnlineCourtDebugConfig_(payload.config || {});
    const messageText = String(payload.messageText || "ศูนย์ประสานงานคดี").trim();
    const groupId = String(payload.groupId || "C_TEST_ONLINE_COURT").trim();
    const userId = String(payload.userId || "U_TEST_USER").trim();
    const status = String(_getOnlineCourtDebugConfig_("ONLINE_COURT_STATUS", overrides) || "OFF").toUpperCase();
    const scopeRaw = _getOnlineCourtDebugConfig_("ONLINE_COURT_GROUP_IDS", overrides) || "";
    const scope = _getOnlineCourtScope_(scopeRaw);
    const isStatusOn = status === "ON";
    const isPrivate = (payload.isPrivate === true) || (payload.mode === "private");
    const excludedIds = _splitOnlineCourtList_(_getOnlineCourtDebugConfig_("ONLINE_COURT_EXCLUDED_IDS", overrides), "");
    const excludedHit = excludedIds.indexOf(isPrivate ? userId : groupId) >= 0;
    const privateAllowed = isStatusOn && !excludedHit && (scope.all || scope.private || (!!userId && scope.ids.indexOf(userId) >= 0));
    const groupAllowed = isStatusOn && !excludedHit && (scope.all || scope.groups || (!!groupId && scope.ids.indexOf(groupId) >= 0));
    const accessAllowed = isPrivate ? privateAllowed : groupAllowed;
    const schedule = _getOnlineCourtDebugSchedule_(overrides);
    const intents = _parseOnlineCourtDebugIntents_(messageText, overrides);
    const mode = "register_then_menu";
    const groupHasBotPrefix = /^#?\s*บอท\s*/i.test(messageText);
    const menuText = isPrivate ? messageText : (groupHasBotPrefix ? messageText.replace(/^#?\s*บอท\s*/i, "").trim() : messageText);
    const normalizedMenuText = _normalizeOnlineCourtMenuText_(menuText);
    const topicMatch = normalizedMenuText.match(/^(?:หัวข้อ|ข้อ)?\s*([1-5])(?:\D|$)/);
    const topicNo = topicMatch ? parseInt(topicMatch[1], 10) : 0;
    const coreMenuHit = _isOnlineCourtCoreMenuText_(messageText) || _isOnlineCourtCoreMenuText_(menuText);
    const configuredMenuHit = isPrivate
      ? coreMenuHit
      : (coreMenuHit || (groupHasBotPrefix && topicNo > 0));
    const directPrivateStart = isPrivate && configuredMenuHit;
    const effectiveAccessAllowed = accessAllowed || (directPrivateStart && isStatusOn && !excludedHit);
    const effectiveScheduleOk = schedule.ok || directPrivateStart;
    const fallbackOn = false;
    const cooldown = _getOnlineCourtDebugCooldown_(isPrivate ? ("dm:" + userId) : groupId, userId, intents, overrides);
    const menuMode = true;
    const shouldHandle = isStatusOn && effectiveAccessAllowed && effectiveScheduleOk && configuredMenuHit;
    let reply = "";
    if (shouldHandle && !cooldown.active) {
      if (isPrivate) {
        reply = _getOnlineCourtDebugConfig_("ONLINE_COURT_REGISTER_PROMPT", overrides) || "";
      } else if (!topicNo) {
        reply = [
          _getOnlineCourtDebugConfig_("ONLINE_COURT_GROUP_PRIVACY_REPLY", overrides),
          _buildOnlineCourtDebugMenu_(overrides)
        ].filter(Boolean).join("\n\n");
      } else if (topicNo > 0) {
        reply = _getOnlineCourtDebugTopicReply_(topicNo, overrides);
      } else {
        reply = _buildOnlineCourtDebugMenu_(overrides);
      }
    }
    const reasons = [];

    if (!isStatusOn) reasons.push("ONLINE_COURT_STATUS ยังปิดอยู่");
    if (!effectiveAccessAllowed) reasons.push(isPrivate
      ? "แชทส่วนตัวยังไม่อยู่ในขอบเขตการตอบ (ใส่ private, all หรือ User ID นี้)"
      : "กลุ่ม/ห้องนี้ยังไม่อยู่ในขอบเขตการตอบ (ใส่ groups, all หรือ Group/Room ID นี้)");
    if (excludedHit) reasons.push("ID นี้อยู่ในรายการยกเว้นเมนูศูนย์ประสานงานคดี");
    if (!effectiveScheduleOk) reasons.push(schedule.reason || "อยู่นอกวัน/เวลาที่กำหนด");
    if (!configuredMenuHit) reasons.push(isPrivate
      ? "แชทส่วนตัวต้องส่งคำเรียกเมนู: ศูนย์ประสานงานคดี"
      : "กลุ่ม/ห้องต้องส่งคำเรียกเมนู: ศูนย์ประสานงานคดี");
    if (cooldown.active) reasons.push("ติด cooldown ของผู้ใช้/ประเภทคำถามนี้");
    if (shouldHandle && !cooldown.active && !reply) reasons.push("ผ่านเงื่อนไขแล้ว แต่ไม่มีข้อความตอบกลับ");
    if (reasons.length === 0) reasons.push("ผ่านทุกเงื่อนไข ระบบจริงควรตอบข้อความนี้");

    return {
      success: true,
      simulated: true,
      canReply: shouldHandle && !cooldown.active && !!reply,
      reply: reply,
      reasons: reasons,
      checks: {
        status: status,
        mode: mode,
        scope: scope,
        groupId: groupId,
        groupAllowed: groupAllowed,
        privateAllowed: privateAllowed,
        directPrivateStart: directPrivateStart,
        effectiveAccessAllowed: effectiveAccessAllowed,
        effectiveScheduleOk: effectiveScheduleOk,
        schedule: schedule,
        fallbackOn: fallbackOn,
        cooldown: cooldown
      },
      intents: intents,
      serverTime: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
    };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e), stack: e && e.stack ? e.stack : "" };
  }
}

function _normalizeOnlineCourtDebugConfig_(config) {
  const result = {};
  Object.keys(config || {}).forEach(function(key) {
    result[normalizeConfigKey_(key)] = normalizeOnOffConfigValue_(sanitizeConfigValue_(config[key]));
  });
  return result;
}

function _getOnlineCourtDebugConfig_(key, overrides) {
  const cleanKey = normalizeConfigKey_(key);
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, cleanKey)) return overrides[cleanKey];
  const value = getConfig(cleanKey);
  if (value !== null && value !== undefined && String(value) !== "") return value;
  return _getOnlineCourtDefault_(cleanKey);
}

function _onlineCourtDebugKeywordMatch_(messageText, key, overrides) {
  const text = _normalizeOnlineCourtMenuText_(messageText);
  if (!text) return false;
  const keywords = _splitOnlineCourtList_(_getOnlineCourtDebugConfig_(key, overrides), _getOnlineCourtDefault_(key));
  return keywords.some(function(keyword) {
    const clean = _normalizeOnlineCourtMenuText_(keyword);
    return clean && text === clean;
  });
}

function _getOnlineCourtDebugSchedule_(overrides) {
  const tz = Session.getScriptTimeZone();
  const now = new Date();
  const dayNames = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const today = dayNames[now.getDay()];
  const daysRaw = _getOnlineCourtDebugConfig_("ONLINE_COURT_DAYS", overrides) || "MON,TUE,WED,THU,FRI";
  const daysText = String(daysRaw || "").trim().toUpperCase();
  let dayOk = true;
  let allowedDays = [];
  if (daysText && daysText !== "ALL" && daysText !== "EVERYDAY" && daysText !== "ทุกวัน") {
    allowedDays = _splitOnlineCourtList_(daysRaw, "").map(_normalizeOnlineCourtDay_).filter(Boolean);
    dayOk = allowedDays.length === 0 || allowedDays.indexOf(today) >= 0;
  }

  const startRaw = _getOnlineCourtDebugConfig_("ONLINE_COURT_START_TIME", overrides) || "08.00 น.";
  const endRaw = _getOnlineCourtDebugConfig_("ONLINE_COURT_END_TIME", overrides) || "16.30 น.";
  const nowMinutes = _parseOnlineCourtTime_(Utilities.formatDate(now, tz, "HH:mm"));
  const startRawTimes = String(startRaw || "").match(/(\d{1,2})\s*[:.]\s*(\d{2})/g) || [];
  const startMinutes = _parseOnlineCourtTime_(startRaw, false);
  const endMinutes = startRawTimes.length >= 2 ? _parseOnlineCourtTime_(startRaw, true) : _parseOnlineCourtTime_(endRaw, true);
  let timeOk = true;
  if (nowMinutes !== null && startMinutes !== null && endMinutes !== null) {
    timeOk = startMinutes <= endMinutes
      ? nowMinutes >= startMinutes && nowMinutes <= endMinutes
      : nowMinutes >= startMinutes || nowMinutes <= endMinutes;
  }

  return {
    ok: dayOk && timeOk,
    dayOk: dayOk,
    timeOk: timeOk,
    today: today,
    allowedDays: allowedDays,
    daysRaw: daysRaw,
    start: startRaw,
    end: endRaw,
    now: Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss"),
    reason: !dayOk ? "วันนี้ไม่อยู่ใน ONLINE_COURT_DAYS" : (!timeOk ? "เวลาปัจจุบันอยู่นอกช่วงที่กำหนด" : "")
  };
}

function _onlineCourtDebugTextIncludesAny_(messageText, key, overrides) {
  const text = String(messageText || "").toLowerCase();
  const keywords = _splitOnlineCourtList_(_getOnlineCourtDebugConfig_(key, overrides), _getOnlineCourtDefault_(key));
  return keywords.some(function(keyword) {
    return keyword && text.indexOf(String(keyword).toLowerCase()) >= 0;
  });
}

function _parseOnlineCourtDebugIntents_(messageText, overrides) {
  const benchNo = _detectOnlineCourtBench_(messageText);
  const problem = _onlineCourtDebugTextIncludesAny_(messageText, "ONLINE_COURT_PROBLEM_KEYWORDS", overrides);
  const oath = _onlineCourtDebugTextIncludesAny_(messageText, "ONLINE_COURT_OATH_KEYWORDS", overrides);
  const contact = _onlineCourtDebugTextIncludesAny_(messageText, "ONLINE_COURT_CONTACT_KEYWORDS", overrides);
  const join = _onlineCourtDebugTextIncludesAny_(messageText, "ONLINE_COURT_JOIN_KEYWORDS", overrides) || benchNo > 0;
  const trigger = _onlineCourtDebugTextIncludesAny_(messageText, "ONLINE_COURT_TRIGGER_KEYWORDS", overrides) || join || problem || oath || contact;
  return { trigger: trigger, join: join, problem: problem, oath: oath, contact: contact, benchNo: benchNo };
}

function _getOnlineCourtDebugCooldown_(groupId, userId, intents, overrides) {
  const minutes = parseInt(_getOnlineCourtDebugConfig_("ONLINE_COURT_COOLDOWN_MINUTES", overrides) || "3", 10);
  if (!minutes || minutes <= 0) return { minutes: minutes || 0, active: false, key: "" };
  const intentKey = [
    intents.problem ? "problem" : "",
    intents.join ? "join" : "",
    intents.oath ? "oath" : "",
    intents.contact ? "contact" : "",
    intents.benchNo ? ("bench" + intents.benchNo) : "",
    intents.trigger ? "" : "fallback"
  ].filter(Boolean).join("-");
  const key = ["onlineCourt", String(groupId || "").slice(-18), String(userId || "").slice(-18), intentKey || "general"].join(":");
  return { minutes: minutes, active: !!CacheService.getScriptCache().get(key), key: key };
}

function _getOnlineCourtUsageSheetName_() {
  return (typeof SHEETS === "object" && SHEETS && SHEETS.ONLINE_COURT_USAGE) || "สถิติศูนย์ประสานงานคดี";
}

function _getOnlineCourtUsageHeaders_() {
  return ["ID", "เวลา", "เดือน", "User ID", "ชื่อผู้ใช้", "ข้อความที่พิมพ์", "ประเภทเหตุการณ์", "หัวข้อ", "ผลลัพธ์", "รูปแบบตอบ", "คำสั่ง/คำค้น", "หมายเหตุ"];
}

function _getOnlineCourtUsageSheetNameCandidates_() {
  const primary = _getOnlineCourtUsageSheetName_();
  const candidates = [
    primary,
    "สถิติศูนย์ประสานงานคดีออนไลน์",
    "สถิติการใช้งานศูนย์ประสานงานคดี",
    "สถิติการใช้งานศูนย์ประสานงานคดีออนไลน์",
    "ONLINE_COURT_USAGE",
    "OnlineCourtUsage",
    "OnlineCourt Usage"
  ];
  const seen = {};
  return candidates.filter(function(name) {
    const key = String(name || "").trim();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function _getOnlineCourtUsageSheets_(ss, options) {
  options = options || {};
  const sheets = [];
  const seen = {};
  _getOnlineCourtUsageSheetNameCandidates_().forEach(function(name) {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      const id = String(sheet.getSheetId ? sheet.getSheetId() : name);
      if (!seen[id]) {
        seen[id] = true;
        sheets.push({ name: name, sheet: sheet });
      }
    }
  });
  try {
    ss.getSheets().forEach(function(sheet) {
      const id = String(sheet.getSheetId ? sheet.getSheetId() : sheet.getName());
      if (seen[id]) return;
      if (_looksLikeOnlineCourtUsageSheet_(sheet) || (options.includeBlankAutoSheets && _isSafeBlankAutoSheet_(sheet))) {
        seen[id] = true;
        sheets.push({ name: sheet.getName(), sheet: sheet });
      }
    });
  } catch (e) {
    Logger.log("⚠️ _getOnlineCourtUsageSheets_ discovery skipped: " + (e && e.message ? e.message : e));
  }
  return sheets;
}

function _looksLikeOnlineCourtUsageSheet_(sheet) {
  if (!sheet || sheet.getLastRow() < 1) return false;
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const firstRow = sheet.getRange(1, 1, 1, Math.min(lastCol, 12)).getValues()[0].map(function(v) {
    return String(v || "").trim();
  });
  const headerHits = ["ID", "เวลา", "เดือน", "User ID", "ประเภทเหตุการณ์", "หัวข้อ"].filter(function(h) {
    return firstRow.indexOf(h) >= 0;
  }).length;
  if (headerHits >= 4) return true;
  if (sheet.getLastRow() < 2) return false;
  const sample = sheet.getRange(2, 1, Math.min(sheet.getLastRow() - 1, 5), Math.min(lastCol, 12)).getValues();
  return sample.some(function(row) {
    return /^OC\d+/.test(String(row[0] || "")) && _onlineCourtUsageMonthOf_(row[2]);
  });
}

function _isSafeBlankAutoSheet_(sheet) {
  if (!sheet || !/^ชีต\d+$/i.test(String(sheet.getName() || ""))) return false;
  const lr = sheet.getLastRow();
  const lc = sheet.getLastColumn();
  if (lr === 0 || lc === 0) return true;
  if (lr > 1 || lc > 1) return false;
  const value = sheet.getRange(1, 1).getValue();
  return String(value || "").trim() === "";
}

function _ensureOnlineCourtUsageSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheetName = _getOnlineCourtUsageSheetName_();
  let sheet = ss.getSheetByName(sheetName);
  const headers = _getOnlineCourtUsageHeaders_();
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    try { sheet.getRange(1, 3, sheet.getMaxRows(), 1).setNumberFormat("@"); } catch (e) {}
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#4C1D95").setFontColor("#ffffff").setHorizontalAlignment("center");
    return sheet;
  }
  const currentLastCol = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getRange(1, 1, 1, currentLastCol).getValues()[0];
  headers.forEach(function(header, i) {
    if (!current[i]) {
      sheet.getRange(1, i + 1).setValue(header).setFontWeight("bold").setBackground("#4C1D95").setFontColor("#ffffff").setHorizontalAlignment("center");
    }
  });
  return sheet;
}

function _maskOnlineCourtUsageText_(text) {
  return String(text || "")
    .replace(/(\d{3})\d{3,4}(\d{3})/g, "$1xxxx$2")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function _normalizeOnlineCourtUsageMonth_(month) {
  const raw = String(month || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const now = new Date();
  return Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM");
}

function _logOnlineCourtPrivateUsage_(userId, userName, messageText, eventType, topic, result, replyType, commandText, note) {
  try {
    if (String(getConfig("ONLINE_COURT_STATUS") || "OFF").toUpperCase() !== "ON") return;
    const now = new Date();
    const month = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM");
    const timeText = Utilities.formatDate(now, "Asia/Bangkok", "yyyy-MM-dd HH:mm:ss");
    _withScriptLock_(5000, function() {
      const sheet = _ensureOnlineCourtUsageSheet_();
      sheet.appendRow([
        "OC" + now.getTime() + "_" + Math.floor(Math.random() * 9999),
        timeText,
        month,
        String(userId || ""),
        String(userName || ""),
        _maskOnlineCourtUsageText_(messageText),
        String(eventType || ""),
        String(topic || ""),
        String(result || ""),
        String(replyType || ""),
        _maskOnlineCourtUsageText_(commandText || messageText),
        String(note || "")
      ]);
    });
  } catch (e) {
    Logger.log("⚠️ _logOnlineCourtPrivateUsage_ error: " + (e && e.message ? e.message : e));
  }
}


// แปลงค่าคอลัมน์ "เดือน" เป็น "yyyy-MM" ไม่ว่าจะเก็บเป็น Date object หรือข้อความ
function _onlineCourtUsageMonthOf_(cell) {
  if (cell instanceof Date || Object.prototype.toString.call(cell) === "[object Date]") {
    return Utilities.formatDate(cell, "Asia/Bangkok", "yyyy-MM");
  }
  const s = String(cell || "").trim();
  const m = s.match(/(\d{4})-(\d{2})/);
  if (m) return m[1] + "-" + m[2];
  const d = new Date(s);
  if (s && !isNaN(d.getTime())) return Utilities.formatDate(d, "Asia/Bangkok", "yyyy-MM");
  return s;
}

function _onlineCourtUsageTextValue_(cell, format) {
  if (cell instanceof Date || Object.prototype.toString.call(cell) === "[object Date]") {
    return Utilities.formatDate(cell, "Asia/Bangkok", format || "yyyy-MM-dd HH:mm:ss");
  }
  return String(cell == null ? "" : cell);
}

function getOnlineCourtUsageStats(month) {
  try {
    const targetMonth = _normalizeOnlineCourtUsageMonth_(month);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let usageSheets = _getOnlineCourtUsageSheets_(ss);
    if (!usageSheets.length) usageSheets = [{ name: _getOnlineCourtUsageSheetName_(), sheet: _ensureOnlineCourtUsageSheet_() }];
    const result = {
      success: true,
      month: targetMonth,
      total: 0,
      uniqueUsers: 0,
      menuStarts: 0,
      registrations: 0,
      topicViews: 0,
      unmatched: 0,
      topEvents: [],
      topTopics: [],
      recent: [],
      sheetNames: usageSheets.map(function(item) { return item.name; }),
      serverTime: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
    };

    const rows = [];
    usageSheets.forEach(function(item) {
      const sheet = item.sheet;
      const lr = sheet.getLastRow();
      if (lr <= 1) return;
      const values = sheet.getRange(2, 1, lr - 1, Math.max(12, sheet.getLastColumn())).getValues();
      values.forEach(function(row) {
        row._onlineCourtSheetName = item.name;
        rows.push(row);
      });
    });
    const users = {};
    const eventCounts = {};
    const topicCounts = {};
    const filtered = rows.filter(function(row) {
      return _onlineCourtUsageMonthOf_(row[2]) === targetMonth;
    });

    filtered.forEach(function(row) {
      result.total++;
      const userId = String(row[3] || "");
      if (userId) users[userId] = true;
      const eventType = String(row[6] || "-");
      const topic = String(row[7] || "-");
      eventCounts[eventType] = (eventCounts[eventType] || 0) + 1;
      if (topic && topic !== "-") topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      if (eventType === "เริ่มเมนู") result.menuStarts++;
      if (eventType === "แจ้งข้อมูลเบื้องต้น") result.registrations++;
      if (eventType === "เลือกหัวข้อ") result.topicViews++;
      if (eventType === "ไม่ตรงรูปแบบ") result.unmatched++;
    });

    result.uniqueUsers = Object.keys(users).length;
    result.topEvents = Object.keys(eventCounts).sort(function(a, b) {
      return eventCounts[b] - eventCounts[a];
    }).slice(0, 8).map(function(name) { return { name: name, count: eventCounts[name] }; });
    result.topTopics = Object.keys(topicCounts).sort(function(a, b) {
      return topicCounts[b] - topicCounts[a];
    }).slice(0, 8).map(function(name) { return { name: name, count: topicCounts[name] }; });
    result.recent = filtered.slice(-20).reverse().map(function(row) {
      return {
        time: _onlineCourtUsageTextValue_(row[1]),
        user: _onlineCourtUsageTextValue_(row[4]),
        message: _onlineCourtUsageTextValue_(row[5]),
        eventType: _onlineCourtUsageTextValue_(row[6]),
        topic: _onlineCourtUsageTextValue_(row[7]),
        result: _onlineCourtUsageTextValue_(row[8]),
        replyType: _onlineCourtUsageTextValue_(row[9])
      };
    });
    return result;
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

function saveOnlineCourtConfigs(c) {
  try {
    const allowed = {
      ONLINE_COURT_STATUS: true,
      ONLINE_COURT_WELCOME_STATUS: true,
      ONLINE_COURT_WELCOME_MSG: true,
      ONLINE_COURT_GROUP_IDS: true,
      ONLINE_COURT_EXCLUDED_IDS: true,
      ONLINE_COURT_PRIVATE_MENU_KEYWORDS: true,
      ONLINE_COURT_GROUP_MENU_KEYWORDS: true,
      ONLINE_COURT_MODE: true,
      ONLINE_COURT_SCHEDULE_MODE: true,
      ONLINE_COURT_REQUIRE_NAME: true,
      ONLINE_COURT_REGISTER_PROMPT: true,
      ONLINE_COURT_GROUP_PRIVACY_REPLY: true,
      ONLINE_COURT_MENU_TITLE: true,
      ONLINE_COURT_DAYS: true,
      ONLINE_COURT_START_TIME: true,
      ONLINE_COURT_END_TIME: true,
      ONLINE_COURT_FALLBACK_STATUS: true,
      ONLINE_COURT_COOLDOWN_MINUTES: true,
      ONLINE_COURT_TRIGGER_KEYWORDS: true,
      ONLINE_COURT_JOIN_KEYWORDS: true,
      ONLINE_COURT_PROBLEM_KEYWORDS: true,
      ONLINE_COURT_OATH_KEYWORDS: true,
      ONLINE_COURT_CONTACT_KEYWORDS: true,
      ONLINE_COURT_JOIN_REPLY: true,
      ONLINE_COURT_PROBLEM_REPLY: true,
      ONLINE_COURT_OATH_REPLY: true,
      ONLINE_COURT_CONTACT_REPLY: true,
      ONLINE_COURT_FALLBACK_REPLY: true,
      ONLINE_COURT_TOPIC_1_TITLE: true,
      ONLINE_COURT_TOPIC_1_REPLY: true,
      ONLINE_COURT_TOPIC_2_TITLE: true,
      ONLINE_COURT_TOPIC_2_REPLY: true,
      ONLINE_COURT_TOPIC_3_TITLE: true,
      ONLINE_COURT_TOPIC_3_REPLY: true,
      ONLINE_COURT_TOPIC_4_TITLE: true,
      ONLINE_COURT_TOPIC_4_REPLY: true,
      ONLINE_COURT_TOPIC_5_TITLE: true,
      ONLINE_COURT_TOPIC_5_REPLY: true
    };
    const saved = [];
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.CONFIG);
    if (!sheet) return { success: false, error: "ไม่พบชีตตั้งค่า" };
    const data = sheet.getDataRange().getValues();
    Object.keys(c || {}).forEach(function(key) {
      const cleanKey = normalizeConfigKey_(key);
      if (!allowed[cleanKey]) return;
      const nextValue = normalizeOnOffConfigValue_(sanitizeConfigValue_(c[key]));
      let found = false;
      for (let i = 1; i < data.length; i++) {
        if (normalizeConfigKey_(data[i][0]) !== cleanKey) continue;
        sheet.getRange(i + 1, 1).setValue(cleanKey);
        sheet.getRange(i + 1, 2).setValue(nextValue);
        found = true;
      }
      if (!found) sheet.appendRow([cleanKey, nextValue, ""]);
      saved.push(cleanKey);
    });
    SpreadsheetApp.flush();
    if (typeof _clearConfigCache === "function") _clearConfigCache();
    _clearCodeLocalCache_();
    const valuesAfter = getOnlineCourtSettings();
    return { success: true, saved: saved.length, keys: saved, valuesAfter: valuesAfter };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

function _buildOnlineCourtDebugMenu_(overrides) {
  const lines = [_getOnlineCourtDebugConfig_("ONLINE_COURT_MENU_TITLE", overrides) || "ศูนย์ประสานงานคดีออนไลน์"];
  lines.push("");
  for (let i = 1; i <= 5; i++) {
    lines.push(i + ". " + (_getOnlineCourtDebugConfig_("ONLINE_COURT_TOPIC_" + i + "_TITLE", overrides) || ("หัวข้อ " + i)));
  }
  return lines.join("\n");
}

function _getOnlineCourtDebugTopicReply_(topicNo, overrides) {
  const title = _getOnlineCourtDebugConfig_("ONLINE_COURT_TOPIC_" + topicNo + "_TITLE", overrides) || ("หัวข้อ " + topicNo);
  const reply = _getOnlineCourtDebugConfig_("ONLINE_COURT_TOPIC_" + topicNo + "_REPLY", overrides) || "";
  return [title, reply].filter(Boolean).join("\n\n");
}

function getOnlineCourtSettings() {
  if (typeof _clearConfigCache === "function") _clearConfigCache();
  _clearCodeLocalCache_();
  const keys = [
    "ONLINE_COURT_STATUS",
    "ONLINE_COURT_WELCOME_STATUS",
    "ONLINE_COURT_WELCOME_MSG",
    "ONLINE_COURT_GROUP_IDS",
    "ONLINE_COURT_EXCLUDED_IDS",
    "ONLINE_COURT_PRIVATE_MENU_KEYWORDS",
    "ONLINE_COURT_GROUP_MENU_KEYWORDS",
    "ONLINE_COURT_MODE",
    "ONLINE_COURT_SCHEDULE_MODE",
    "ONLINE_COURT_REQUIRE_NAME",
    "ONLINE_COURT_REGISTER_PROMPT",
    "ONLINE_COURT_GROUP_PRIVACY_REPLY",
    "ONLINE_COURT_MENU_TITLE",
    "ONLINE_COURT_DAYS",
    "ONLINE_COURT_START_TIME",
    "ONLINE_COURT_END_TIME",
    "ONLINE_COURT_FALLBACK_STATUS",
    "ONLINE_COURT_COOLDOWN_MINUTES",
    "ONLINE_COURT_TRIGGER_KEYWORDS",
    "ONLINE_COURT_JOIN_KEYWORDS",
    "ONLINE_COURT_PROBLEM_KEYWORDS",
    "ONLINE_COURT_OATH_KEYWORDS",
    "ONLINE_COURT_CONTACT_KEYWORDS",
    "ONLINE_COURT_JOIN_REPLY",
    "ONLINE_COURT_PROBLEM_REPLY",
    "ONLINE_COURT_OATH_REPLY",
    "ONLINE_COURT_CONTACT_REPLY",
    "ONLINE_COURT_FALLBACK_REPLY",
    "ONLINE_COURT_TOPIC_1_TITLE",
    "ONLINE_COURT_TOPIC_1_REPLY",
    "ONLINE_COURT_TOPIC_2_TITLE",
    "ONLINE_COURT_TOPIC_2_REPLY",
    "ONLINE_COURT_TOPIC_3_TITLE",
    "ONLINE_COURT_TOPIC_3_REPLY",
    "ONLINE_COURT_TOPIC_4_TITLE",
    "ONLINE_COURT_TOPIC_4_REPLY",
    "ONLINE_COURT_TOPIC_5_TITLE",
    "ONLINE_COURT_TOPIC_5_REPLY"
  ];
  const defaults = _getSettingsDefaultValues_();
  const result = {};
  keys.forEach(function(key) {
    const value = getConfig(key);
    result[key] = (value !== null && value !== undefined && String(value) !== "")
      ? value
      : (defaults[key] || "");
  });
  result._debug = {
    source: "getOnlineCourtSettings",
    serverTime: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
  };
  return result;
}

function saveOnlineCourtDraftTextConfigs(c) {
  try {
    const allowed = {
      ONLINE_COURT_PRIVATE_MENU_KEYWORDS: true,
      ONLINE_COURT_GROUP_MENU_KEYWORDS: true,
      ONLINE_COURT_TRIGGER_KEYWORDS: true,
      ONLINE_COURT_JOIN_KEYWORDS: true,
      ONLINE_COURT_PROBLEM_KEYWORDS: true,
      ONLINE_COURT_OATH_KEYWORDS: true,
      ONLINE_COURT_CONTACT_KEYWORDS: true,
      ONLINE_COURT_JOIN_REPLY: true,
      ONLINE_COURT_PROBLEM_REPLY: true,
      ONLINE_COURT_OATH_REPLY: true,
      ONLINE_COURT_CONTACT_REPLY: true,
      ONLINE_COURT_FALLBACK_REPLY: true,
      ONLINE_COURT_REGISTER_PROMPT: true,
      ONLINE_COURT_GROUP_PRIVACY_REPLY: true,
      ONLINE_COURT_MENU_TITLE: true,
      ONLINE_COURT_WELCOME_MSG: true,
      ONLINE_COURT_TOPIC_1_TITLE: true,
      ONLINE_COURT_TOPIC_1_REPLY: true,
      ONLINE_COURT_TOPIC_2_TITLE: true,
      ONLINE_COURT_TOPIC_2_REPLY: true,
      ONLINE_COURT_TOPIC_3_TITLE: true,
      ONLINE_COURT_TOPIC_3_REPLY: true,
      ONLINE_COURT_TOPIC_4_TITLE: true,
      ONLINE_COURT_TOPIC_4_REPLY: true,
      ONLINE_COURT_TOPIC_5_TITLE: true,
      ONLINE_COURT_TOPIC_5_REPLY: true
    };
    const saved = [];
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.CONFIG);
    if (!sheet) return { success: false, error: "ไม่พบชีตตั้งค่า" };
    const data = sheet.getDataRange().getValues();
    Object.keys(c || {}).forEach(function(key) {
      const cleanKey = normalizeConfigKey_(key);
      if (!allowed[cleanKey]) return;
      const nextValue = normalizeOnOffConfigValue_(sanitizeConfigValue_(c[key]));
      let found = false;
      for (let i = 1; i < data.length; i++) {
        if (normalizeConfigKey_(data[i][0]) !== cleanKey) continue;
        sheet.getRange(i + 1, 1).setValue(cleanKey);
        sheet.getRange(i + 1, 2).setValue(nextValue);
        found = true;
      }
      if (!found) sheet.appendRow([cleanKey, nextValue, ""]);
      saved.push(cleanKey);
    });
    SpreadsheetApp.flush();
    if (typeof _clearConfigCache === "function") _clearConfigCache();
    _clearCodeLocalCache_();
    return { success: true, saved: saved.length, keys: saved };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

function saveOnlineCourtRoomIds(payload) {
  try {
    payload = payload || {};
    const rawIds = _splitOnlineCourtList_(payload.ids || payload.lineId || payload.groupId || "", "")
      .map(function(id) { return String(id || "").trim(); })
      .filter(Boolean);
    if (!rawIds.length) return { success: false, error: "กรุณาใส่ขอบเขตหรือ Group ID / Room ID ก่อน" };

    const ids = rawIds.filter(function(id) { return /^[CR][A-Za-z0-9_-]{8,}$/.test(id); });
    const invalid = rawIds.filter(function(id) {
      const lower = String(id || "").toLowerCase();
      if (lower === "all" || lower === "groups" || lower === "group" || lower === "rooms" || lower === "room" || lower === "private" || lower === "dm" || lower === "dms") return false;
      if (/^U[A-Za-z0-9_-]{8,}$/.test(id)) return false;
      return !/^[CR][A-Za-z0-9_-]{8,}$/.test(id);
    });
    if (invalid.length) {
      return { success: false, error: "ขอบเขตต้องเป็น all/groups/private หรือ ID ที่ขึ้นต้นด้วย C/R/U: " + invalid.join(", ") };
    }

    const currentIds = _splitOnlineCourtList_(getConfig("ONLINE_COURT_GROUP_IDS"), "");
    if (!ids.length) {
      return {
        success: true,
        message: "ไม่มี Group/Room ID ใหม่ให้บันทึกเป็นห้อง",
        groupIds: currentIds,
        addedToConfig: [],
        savedRegistry: [],
        skippedRegistry: rawIds
      };
    }
    const merged = currentIds.slice();
    const addedToConfig = [];
    ids.forEach(function(id) {
      if (merged.indexOf(id) < 0) {
        merged.push(id);
        addedToConfig.push(id);
      }
    });
    setConfig("ONLINE_COURT_GROUP_IDS", merged.join("\n"));

    const savedRegistry = [];
    const skippedRegistry = [];
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let savedSheet = ss.getSheetByName(SHEETS.SAVED_IDS);
    if (!savedSheet) {
      savedSheet = ss.insertSheet(SHEETS.SAVED_IDS);
      savedSheet.appendRow(["ID", "ชื่อเรียก", "LINE ID", "วันที่บันทึก"]);
    }
    const existingData = savedSheet.getDataRange().getValues();
    ids.forEach(function(id, index) {
      const exists = existingData.slice(1).some(function(row) {
        return String(row[2] || "").trim() === id;
      });
      if (exists) {
        skippedRegistry.push(id);
        return;
      }
      const name = String(payload.name || "ศูนย์ประสานงานคดีออนไลน์").trim()
        + (ids.length > 1 ? " " + (index + 1) : "");
      savedSheet.appendRow([
        "ID" + new Date().getTime() + "_" + index,
        name,
        id,
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
      ]);
      savedRegistry.push(id);
    });

    SpreadsheetApp.flush();
    if (typeof _clearConfigCache === "function") _clearConfigCache();
    _clearCodeLocalCache_();
    return {
      success: true,
      message: "บันทึกไอดีห้องแล้ว",
      groupIds: merged,
      addedToConfig: addedToConfig,
      savedRegistry: savedRegistry,
      skippedRegistry: skippedRegistry
    };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}


// ════════════════════════════════════════════════════════════
// 👋 ข้อความต้อนรับเมื่อแอดเพื่อน (follow event) + ปุ่มเข้าสู่เมนู
// ════════════════════════════════════════════════════════════
function _onlineCourtPrimaryTrigger_() {
  const list = _splitOnlineCourtList_(
    getConfig("ONLINE_COURT_PRIVATE_MENU_KEYWORDS"),
    _getOnlineCourtDefault_("ONLINE_COURT_PRIVATE_MENU_KEYWORDS")
  );
  for (let i = 0; i < list.length; i++) {
    if (String(list[i]).indexOf("ศูนย์ประสานงานคดี") >= 0) return String(list[i]).trim();
  }
  return (list[0] || "ศูนย์ประสานงานคดี").trim();
}

function _buildOnlineCourtWelcomeFlex_(trigger, msg) {
  const text = String(msg || "").trim() ||
    _getOnlineCourtDefault_("ONLINE_COURT_WELCOME_MSG") ||
    "ยินดีต้อนรับสู่ศูนย์ประสานงานคดีออนไลน์";
  const trig = String(trigger || "ศูนย์ประสานงานคดี").trim();
  return {
    type: "flex",
    altText: "ยินดีต้อนรับสู่ศูนย์ประสานงานคดีออนไลน์",
    fallbackText: text + "\n\nพิมพ์: " + trig,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#4C1D95",
        paddingAll: "18px",
        spacing: "xs",
        contents: [
          { type: "text", text: "⚖️ ศูนย์ประสานงานคดีออนไลน์", color: "#FFFFFF", weight: "bold", size: "lg", wrap: true },
          { type: "text", text: "ยินดีต้อนรับครับ/ค่ะ", color: "#E9D5FF", size: "sm", wrap: true }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "md",
        contents: [
          { type: "text", text: _onlineCourtFlexText_(text, 900), color: "#111827", size: "sm", wrap: true },
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#F5F3FF",
            cornerRadius: "8px",
            paddingAll: "10px",
            contents: [
              { type: "text", text: "เริ่มต้นใช้งาน: พิมพ์ \"" + trig + "\" หรือกดปุ่มด้านล่าง", color: "#4C1D95", size: "xs", wrap: true }
            ]
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [{
          type: "button",
          action: { type: "message", label: "เริ่มใช้งานศูนย์ประสานงานคดี", text: trig },
          style: "primary",
          color: "#7C3AED",
          height: "sm"
        }]
      }
    }
  };
}

// เรียกจาก doPost ของ Code.gs เมื่อ event.type === "follow" (typeof-guarded)
function _handleOnlineCourtFollow_(userId, userName, replyToken) {
  if (!replyToken) return false;
  if (String(getConfig("ONLINE_COURT_STATUS") || "OFF").toUpperCase() !== "ON") return false;
  const welcomeOn = String(
    getConfig("ONLINE_COURT_WELCOME_STATUS") || _getOnlineCourtDefault_("ONLINE_COURT_WELCOME_STATUS") || "ON"
  ).toUpperCase() === "ON";
  if (!welcomeOn) return false;
  const trigger = _onlineCourtPrimaryTrigger_();
  const msg = getConfig("ONLINE_COURT_WELCOME_MSG") || _getOnlineCourtDefault_("ONLINE_COURT_WELCOME_MSG");
  try {
    if (typeof sendUniversalReply === "function") {
      sendUniversalReply(replyToken, _buildOnlineCourtWelcomeFlex_(trigger, msg));
    } else {
      safeSendReply(replyToken, String(msg || "") + "\n\nพิมพ์: " + trigger);
    }
  } catch (e) {
    try { safeSendReply(replyToken, String(msg || "") + "\n\nพิมพ์: " + trigger); } catch (e2) {}
  }
  try {
    _logOnlineCourtPrivateUsage_(userId, userName, "(follow)", "แอดเพื่อน", "", "ส่งข้อความต้อนรับ", "Flex Card", "", "welcome on follow");
  } catch (e) {}
  return true;
}

// การ์ดถามข้อมูลเบื้องต้น (ขั้นตอนก่อนแสดงเมนู) — สไตล์เดียวกับการ์ดต้อนรับ
function _buildOnlineCourtRegisterFlex_(promptText) {
  const text = String(promptText || "").trim() ||
    _getOnlineCourtDefault_("ONLINE_COURT_REGISTER_PROMPT") ||
    "สวัสดีครับ/ค่ะ กรุณาระบุชื่อ-สกุล";
  return {
    type: "flex",
    altText: "ศูนย์ประสานงานคดีออนไลน์: กรุณาระบุข้อมูลเบื้องต้น",
    fallbackText: text,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#4C1D95",
        paddingAll: "18px",
        spacing: "xs",
        contents: [
          { type: "text", text: "⚖️ ศูนย์ประสานงานคดีออนไลน์", color: "#FFFFFF", weight: "bold", size: "lg", wrap: true },
          { type: "text", text: "ยินดีต้อนรับครับ/ค่ะ", color: "#E9D5FF", size: "sm", wrap: true }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "md",
        contents: [
          { type: "text", text: _onlineCourtFlexText_(text, 900), color: "#111827", size: "sm", wrap: true },
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#F5F3FF",
            cornerRadius: "8px",
            paddingAll: "10px",
            contents: [
              { type: "text", text: "พิมพ์ข้อมูลของท่านในช่องแชทได้เลย เช่น ชื่อ-สกุล / เลขคดี / บัลลังก์ / เวลานัด (เท่าที่ทราบ)", color: "#4C1D95", size: "xs", wrap: true }
            ]
          }
        ]
      }
    }
  };
}

// endpoint ตรวจระบบสถิติ (อ่านอย่างเดียว ไม่เขียน/ไม่สร้างชีต) — เรียกจาก Dashboard
function debugOnlineCourtUsageLog() {
  try {
    const status = String(getConfig("ONLINE_COURT_STATUS") || "OFF");
    const scriptTz = Session.getScriptTimeZone();
    const monthBangkok = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM");
    const sheetName = _getOnlineCourtUsageSheetName_();
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const usageSheets = _getOnlineCourtUsageSheets_(ss);
    if (!usageSheets.length) {
      return { success: true, status: status, scriptTz: scriptTz, monthBangkok: monthBangkok,
               sheetName: sheetName, sheetExists: false, sheetNames: [], legacySheetNames: [],
               candidateSheetNames: _getOnlineCourtUsageSheetNameCandidates_(), dataRows: 0, monthsPresent: [] };
    }
    const monthCount = {};
    let dataRows = 0;
    usageSheets.forEach(function(item) {
      const lr = item.sheet.getLastRow();
      dataRows += Math.max(0, lr - 1);
      if (lr <= 1) return;
      const vals = item.sheet.getRange(2, 3, lr - 1, 1).getValues(); // คอลัมน์ "เดือน"
      vals.forEach(function(r) {
        const m = _onlineCourtUsageMonthOf_(r[0]);
        if (m) monthCount[m] = (monthCount[m] || 0) + 1;
      });
    });
    const monthsPresent = Object.keys(monthCount).sort().map(function(m) {
      return m + " (" + monthCount[m] + " แถว)";
    });
    const sheetNames = usageSheets.map(function(item) { return item.name; });
    return { success: true, status: status, scriptTz: scriptTz, monthBangkok: monthBangkok,
             sheetName: sheetName, sheetExists: true, sheetNames: sheetNames,
             legacySheetNames: sheetNames.filter(function(name) { return name !== sheetName; }),
             candidateSheetNames: _getOnlineCourtUsageSheetNameCandidates_(),
             dataRows: dataRows, monthsPresent: monthsPresent };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}

function repairOnlineCourtUsageSheets(options) {
  try {
    options = options || {};
    const deleteMerged = options.deleteMerged !== false;
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const primaryName = _getOnlineCourtUsageSheetName_();
    const primary = _ensureOnlineCourtUsageSheet_();
    const primaryId = String(primary.getSheetId ? primary.getSheetId() : primaryName);
    const headers = _getOnlineCourtUsageHeaders_();
    const existingIds = {};
    if (primary.getLastRow() > 1) {
      primary.getRange(2, 1, primary.getLastRow() - 1, 1).getValues().forEach(function(row) {
        const id = String(row[0] || "").trim();
        if (id) existingIds[id] = true;
      });
    }

    const result = {
      success: true,
      primarySheet: primaryName,
      scannedSheets: [],
      mergedSheets: [],
      deletedSheets: [],
      skippedSheets: [],
      rowsCopied: 0,
      duplicateRows: 0,
      blankSheetsDeleted: 0
    };

    const allSheets = _getOnlineCourtUsageSheets_(ss, { includeBlankAutoSheets: true });
    allSheets.forEach(function(item) {
      const sheet = item.sheet;
      const name = sheet.getName();
      const id = String(sheet.getSheetId ? sheet.getSheetId() : name);
      if (id === primaryId) return;
      result.scannedSheets.push(name);

      if (_isSafeBlankAutoSheet_(sheet)) {
        if (deleteMerged && ss.getSheets().length > 1) {
          ss.deleteSheet(sheet);
          result.deletedSheets.push(name);
          result.blankSheetsDeleted++;
        } else {
          result.skippedSheets.push(name + " (ชีตว่าง)");
        }
        return;
      }

      if (!_looksLikeOnlineCourtUsageSheet_(sheet)) {
        result.skippedSheets.push(name + " (ไม่ใช่ชีตสถิติ)");
        return;
      }

      const lr = sheet.getLastRow();
      if (lr > 1) {
        const rows = sheet.getRange(2, 1, lr - 1, Math.max(headers.length, sheet.getLastColumn())).getValues();
        rows.forEach(function(row) {
          const hasAny = row.some(function(v) { return String(v || "").trim() !== ""; });
          if (!hasAny) return;
          const rowId = String(row[0] || "").trim() || ("OC_MIGRATED_" + new Date().getTime() + "_" + Math.floor(Math.random() * 999999));
          if (existingIds[rowId]) {
            result.duplicateRows++;
            return;
          }
          row[0] = rowId;
          primary.appendRow(row.slice(0, headers.length));
          existingIds[rowId] = true;
          result.rowsCopied++;
        });
      }

      result.mergedSheets.push(name);
      if (deleteMerged && ss.getSheets().length > 1) {
        ss.deleteSheet(sheet);
        result.deletedSheets.push(name);
      }
    });

    SpreadsheetApp.flush();
    return result;
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
}
