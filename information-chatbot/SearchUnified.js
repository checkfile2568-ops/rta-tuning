/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  🔍 SearchUnified.gs v1.0 — ระบบค้นหารวมศูนย์ (Single Command)  ║
 * ║  ระบบ LINE Bot ศาลจังหวัดลพบุรี                                  ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  ใช้คำสั่งเดียว "ค้นหา" ทำได้ทุกอย่าง:                            ║
 * ║                                                                   ║
 * ║  📱 แชทส่วนตัว:                                                   ║
 * ║    • ค้นหา 89/9                  → ค้นทุกฐาน                      ║
 * ║    • ค้นหา ผู้ใหญ่บ้าน 89        → ค้นเฉพาะฐาน "ผู้ใหญ่บ้าน"      ║
 * ║    • ค้นหา ถนนใหญ่ ลาดพร้าว      → ค้นเฉพาะฐาน "ถนนใหญ่"         ║
 * ║    • ค้นหา / ค้นหา ฐาน           → แสดงรายการฐานที่ค้นได้         ║
 * ║                                                                   ║
 * ║  👥 กลุ่ม:                                                         ║
 * ║    • บอท ค้นหา 89/9                                                ║
 * ║    • บอท ค้นหา ผู้ใหญ่บ้าน 89                                     ║
 * ║                                                                   ║
 * ║  สิทธิ์: VIP (ลงทะเบียนแล้ว) + Admin                             ║
 * ║                                                                   ║
 * ║  ติดตั้ง:                                                          ║
 * ║    1. File → New → Script → ตั้งชื่อ SearchUnified                ║
 * ║    2. วางโค้ดทั้งหมดนี้ → Save                                    ║
 * ║    3. Run setupSearchUnified() ครั้งแรก                          ║
 * ║    4. แก้ doPost ใน Code.gs (ดู patch ในข้อความ)                 ║
 * ║    5. Deploy → New version                                        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */


// ════════════════════════════════════════════════════════════════════
// 🔧 SETUP — เพิ่ม Config keys ที่จำเป็น
// ════════════════════════════════════════════════════════════════════

function setupSearchUnified() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const configSheet = ss.getSheetByName(SHEETS.CONFIG);
    if (!configSheet) {
      return { success: false, error: "ไม่พบชีต ตั้งค่า — กดปุ่ม ⚙️ ซ่อมแซม ก่อน" };
    }

    const data = configSheet.getDataRange().getValues();
    const existing = {};
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) existing[data[i][0]] = true;
    }

    const newConfigs = [
      ["SEARCH_KEYWORD", "ค้นหา", "คีย์เวิร์ดหลักของระบบค้นหา (default: ค้นหา)"],
      ["SEARCH_GROUP_PREFIX", "บอท", "Prefix ในกลุ่ม (default: บอท)"],
      ["SEARCH_WHITELIST_GROUPS", "", "Group IDs ที่อนุญาตให้ค้น (ว่าง = ทุกกลุ่ม) คั่น ,"],
      ["SEARCH_MAX_RESULTS_PER_DB", "12", "ผลลัพธ์สูงสุดต่อฐาน"],
      ["SEARCH_MAX_BUBBLES", "12", "จำนวน bubble สูงสุดใน Carousel"],
      ["SEARCH_NO_PERM_MSG_V2", "🔒 คำสั่งค้นหาสำหรับเจ้าหน้าที่เท่านั้น\n\n💡 ลงทะเบียน VIP ก่อนใช้งานครับ", "ข้อความเมื่อไม่มีสิทธิ์"]
    ];

    const added = [];
    newConfigs.forEach(function(c) {
      if (!existing[c[0]]) {
        configSheet.appendRow([c[0], c[1], c[2]]);
        added.push("✅ " + c[0]);
      }
    });

    return {
      success: true,
      message: added.length > 0
        ? "🎉 Setup สำเร็จ\n\n" + added.join("\n")
        : "✓ Config ครบถ้วนอยู่แล้ว"
    };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}


// ════════════════════════════════════════════════════════════════════
// 🎯 MAIN ROUTER — เรียกจาก doPost
// ════════════════════════════════════════════════════════════════════
//
// คืนค่า:
//   { handled: true, reply: ...} → ระบบใหม่จัดการแล้ว
//   { handled: false }           → ส่งต่อให้ logic อื่น
//
function routeSearchCommandV2(messageText, user, userId, isGroup, sourceId, replyToken, options) {
  try {
    const parsed = _parseSearchCommandV2(messageText, isGroup, options || {});
    if (!parsed.isSearch) {
      return { handled: false };
    }

    if (String(getConfig("SEARCH_STATUS") || "OFF").toUpperCase() !== "ON") {
      safeSendReply(replyToken, "🔕 ระบบค้นหาถูกปิดอยู่ครับ");
      logActivity(userId, user.name, "พยายามค้นหาแต่ระบบปิด", "SearchV2", "Disabled", 0);
      return { handled: true };
    }

    // เช็คสิทธิ์
    const permCheck = _checkSearchPermissionV2(user, userId, sourceId, isGroup);
    if (!permCheck.allowed) {
      try {
        if (typeof logPermissionDenied === "function") {
          logPermissionDenied(userId, "search_v2", permCheck.reason);
        }
      } catch (e) {}
      safeSendReply(replyToken, permCheck.message);
      return { handled: true };
    }

    // List mode → แสดงฐานทั้งหมด
    if (parsed.isListMode) {
      const listResult = _buildDatabaseListFlex(user.role, userId);
      sendUniversalReply(replyToken, listResult);
      logActivity(userId, user.name, "ดูรายการฐานค้นหา", "SearchV2", "Success", 0);
      return { handled: true };
    }

    if (!String(parsed.query || "").trim()) {
      const hintText = parsed.dbHint ? " หลังชื่อฐาน \"" + parsed.dbHint + "\"" : "";
      safeSendReply(replyToken, "🔎 กรุณาระบุคำค้น" + hintText + "\n\nตัวอย่าง: ค้นหา " + (parsed.dbHint ? parsed.dbHint + " " : "") + "89/9");
      logActivity(userId, user.name, "ค้นหาโดยไม่มีคำค้น", "SearchV2", "Invalid", 0);
      return { handled: true };
    }

    // ทำการค้นหา
    const result = unifiedSearch(parsed.query, parsed.dbHint, user.role, userId);
    let finalResult = result;

    if (_isSearchEmptyReplyV2_(result) && typeof searchKnowledgeBase === "function") {
      const kbQuery = parsed.dbHint ? (parsed.dbHint + " " + parsed.query).trim() : parsed.query;
      const kbFallback = searchKnowledgeBase(kbQuery, user.role, userId);
      if (kbFallback) finalResult = kbFallback;
    }

    sendUniversalReply(replyToken, finalResult);

    const logQuery = parsed.dbHint
      ? "[" + parsed.dbHint + "] " + parsed.query
      : parsed.query;
    logActivity(userId, user.name, "ค้นหา: " + logQuery, "SearchV2", "Success", 0);

    if (typeof updateDailyStats === "function") {
      updateDailyStats(1, 1, 0);
    }
    return { handled: true };
  } catch (e) {
    Logger.log("❌ routeSearchCommandV2 error: " + e.message + "\n" + e.stack);
    safeSendReply(replyToken, "⚠️ เกิดข้อผิดพลาดในการค้นหา กรุณาลองใหม่");
    return { handled: true };
  }
}


// ════════════════════════════════════════════════════════════════════
// 📝 PARSER — แยก command, dbHint, query
// ════════════════════════════════════════════════════════════════════

function _isSearchEmptyReplyV2_(result) {
  if (!result || result.type !== "flex") return false;
  if (!result.contents || result.contents.type !== "bubble") return false;
  const header = result.contents.header || {};
  return String(header.backgroundColor || "").toUpperCase() === "#DC2626";
}

function _parseSearchCommandV2(text, isGroup, options) {
  if (!text) return { isSearch: false };

  const keyword = (getConfig("SEARCH_KEYWORD") || "ค้นหา").trim();
  const groupPrefix = (getConfig("SEARCH_GROUP_PREFIX") || "บอท").trim();
  const allowBareGroupSearch = !!(options && options.allowBareGroupSearch);

  let working = String(text).trim();

  // ในกลุ่มทั่วไปต้องมี prefix; กลุ่มส่งหมายสามารถอนุญาต /ค้นหา ได้จาก doPost
  if (isGroup) {
    const prefixPattern = new RegExp("^/?#?" + _escapeRegex(groupPrefix) + "\\s+", "i");
    const m = working.match(prefixPattern);
    if (m) {
      working = working.substring(m[0].length).trim();
    } else if (!allowBareGroupSearch) {
      return { isSearch: false };
    }
  }

  // รองรับ /ค้นหา และ ค้นหา
  const cmdPattern = new RegExp("^/?" + _escapeRegex(keyword) + "(\\s|$)");
  if (!cmdPattern.test(working)) return { isSearch: false };

  // ตัด keyword ออก
  let rest = working.replace(new RegExp("^/?" + _escapeRegex(keyword) + "\\s*"), "").trim();

  // List mode: "ค้นหา" / "ค้นหา ฐาน" / "ค้นหา ฐานข้อมูล"
  if (!rest || /^(ฐาน|ฐานข้อมูล|รายการ|list|menu)\s*$/i.test(rest)) {
    return { isSearch: true, isListMode: true };
  }

  // ลองดูว่าคำแรก match ชื่อฐานไหนหรือไม่
  const dbs = (typeof getSearchDatabases === "function") ? getSearchDatabases() : [];
  let dbHint = null;
  let query = rest;

  // เรียงชื่อฐานจากยาวไปสั้น (ป้องกัน "ผู้ใหญ่" match ก่อน "ผู้ใหญ่บ้าน")
  const sorted = dbs.slice().sort(function(a, b){ return (b.name||"").length - (a.name||"").length; });

  for (let i = 0; i < sorted.length; i++) {
    const dbName = String(sorted[i].name || "").trim();
    if (!dbName) continue;
    if (sorted[i].status !== "ON") continue;

    // เช็คว่า rest เริ่มต้นด้วย dbName + space (หรือ dbName เป็นทั้งหมด)
    const dbPattern = new RegExp("^" + _escapeRegex(dbName) + "(\\s+|$)", "i");
    const dbMatch = rest.match(dbPattern);
    if (dbMatch) {
      dbHint = dbName;
      query = rest.substring(dbMatch[0].length).trim();
      break;
    }
  }

  return {
    isSearch: true,
    isListMode: false,
    dbHint: dbHint,
    query: query
  };
}


function _escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


// ════════════════════════════════════════════════════════════════════
// 🔐 PERMISSION
// ════════════════════════════════════════════════════════════════════

function _checkSearchPermissionV2(user, userId, sourceId, isGroup) {
  // 1. ต้องเป็น VIP (ลงทะเบียนแล้ว) หรือ Admin
  const role = String(user.role || "").trim().toUpperCase();
  const userIsAdmin = (typeof isAdmin === "function") && isAdmin(userId);
  const userIsVip = role === "VIP";

  if (!userIsAdmin && !userIsVip) {
    return {
      allowed: false,
      reason: "ไม่ใช่ VIP/Admin (role=" + user.role + ")",
      message: getConfig("SEARCH_NO_PERM_MSG_V2") ||
               getConfig("SEARCH_NO_PERM_MSG") ||
               "🔒 คำสั่งค้นหาสำหรับเจ้าหน้าที่เท่านั้นครับ"
    };
  }

  // 2. ถ้าเป็นกลุ่ม → เช็ค whitelist (ถ้าตั้งไว้)
  if (isGroup) {
    const whitelistRaw = (getConfig("SEARCH_WHITELIST_GROUPS") || "").trim();
    if (whitelistRaw) {
      const whitelist = whitelistRaw.split(",").map(function(s){ return s.trim(); }).filter(Boolean);
      if (whitelist.length > 0 && whitelist.indexOf(sourceId) < 0) {
        return {
          allowed: false,
          reason: "กลุ่มไม่อยู่ใน whitelist (" + sourceId + ")",
          message: "🔒 ระบบค้นหายังไม่เปิดในกลุ่มนี้\n\nกรุณาติดต่อ Admin เพื่อขอเปิดสิทธิ์"
        };
      }
    }
  }

  return { allowed: true };
}


// ════════════════════════════════════════════════════════════════════
// 🔍 UNIFIED SEARCH — ค้นทุกฐาน (หรือเฉพาะ dbHint)
// ════════════════════════════════════════════════════════════════════

function unifiedSearch(query, dbHint, userRole, userId) {
  const maxPerDb = parseInt(getConfig("SEARCH_MAX_RESULTS_PER_DB") || "12") || 12;
  const maxBubbles = parseInt(getConfig("SEARCH_MAX_BUBBLES") || "12") || 12;

  const allResults = [];

  // ───── 1. ค้นในชีต LOCATION (พิกัด/บ้านเลขที่) ─────
  if (!dbHint || _isLocationDbName(dbHint)) {
    const locResults = _searchInLocationSheet(query, maxPerDb);
    locResults.forEach(function(r) { allResults.push(r); });
  }

  // ───── 2. ค้นใน Search DBs ─────
  const dbs = (typeof getSearchDatabases === "function") ? getSearchDatabases() : [];
  for (let i = 0; i < dbs.length; i++) {
    const db = dbs[i];
    if (db.status !== "ON") continue;

    // ถ้า dbHint ระบุ → ค้นเฉพาะที่ตรง
    if (dbHint && String(db.name || "").trim().toLowerCase() !== String(dbHint).trim().toLowerCase()) {
      continue;
    }

    // เช็คสิทธิ์ฐาน
    if (!_canAccessDb(db, userRole, userId)) continue;

    const dbResults = _searchInSearchDb(db, query, maxPerDb);
    dbResults.forEach(function(r) { allResults.push(r); });
  }

  // ───── 3. สร้างผลลัพธ์ ─────
  if (allResults.length === 0) {
    return _buildSearchEmptyV2(query, dbHint);
  }

  return _buildSearchCarouselV2(query, dbHint, allResults.slice(0, maxBubbles), allResults.length);
}


function _isLocationDbName(name) {
  const s = String(name || "").trim().toLowerCase();
  return s === "พิกัด" || s === "บ้าน" || s === "บ้านเลขที่" ||
         s === "ข้อมูลพิกัด" || s === "location";
}


function _canAccessDb(db, userRole, userId) {
  const access = String(db.access || "Internal").trim();
  const userIsAdmin = (typeof isAdmin === "function") && isAdmin(userId);
  const userIsVip = String(userRole || "").trim().toUpperCase() === "VIP";

  if (access === "Public") return true;
  if (access === "Admin") return userIsAdmin;
  // Internal (default) → VIP + Admin
  return userIsVip || userIsAdmin;
}


// ════════════════════════════════════════════════════════════════════
// 🏠 SEARCH IN LOCATION SHEET
// ════════════════════════════════════════════════════════════════════

function _searchInLocationSheet(query, maxResults) {
  const results = [];
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.LOCATION);
    if (!sheet || sheet.getLastRow() <= 1) return results;

    const data = sheet.getDataRange().getValues();
    const seen = {};
    const rawQuery = String(query || "").trim();
    const cleanQuery = _normalizeLocationHouseQuery_(rawQuery);
    const lowerQuery = rawQuery.toLowerCase();
    const lowerCleanQuery = cleanQuery.toLowerCase();

    for (let i = 1; i < data.length; i++) {
      if (results.length >= maxResults) break;

      const hn = String(data[i][3] || "").trim();
      // 🔧 รองรับ "/" และรูปแบบบ้านเลขที่ทั่วไป
      if (!_isCleanHouseNumber(hn)) continue;

      const hnLower = hn.toLowerCase();
      const hnCleanLower = _normalizeLocationHouseQuery_(hn).toLowerCase();
      const addr = String(data[i][6] || "").toLowerCase();
      const matches = (hn === query) ||
                      hnLower.indexOf(lowerQuery) >= 0 ||
                      (lowerCleanQuery && hnCleanLower === lowerCleanQuery) ||
                      (lowerCleanQuery && hnCleanLower.indexOf(lowerCleanQuery) >= 0) ||
                      addr.indexOf(lowerQuery) >= 0;

      if (!matches) continue;

      const lat = data[i][4] || "";
      const lng = data[i][5] || "";
      const dedupeKey = hn + "|" + lat + "|" + lng;
      if (seen[dedupeKey]) continue;
      seen[dedupeKey] = true;

      const ts = data[i][1]
        ? Utilities.formatDate(new Date(data[i][1]), Session.getScriptTimeZone(), "dd/MM/yy HH:mm")
        : "-";

      results.push({
        source: "📍 พิกัด",
        sourceColor: "#1E40AF",
        title: hn,
        ts: ts,
        fields: [
          { label: "🕐 บันทึกเมื่อ", value: ts }
        ],
        addr: String(data[i][6] || "").substring(0, 80),
        lat: lat,
        lng: lng,
        actions: (lat && lng) ? [
          {
            type: "uri",
            label: "🗺️ Google Maps",
            uri: "https://www.google.com/maps?q=" + lat + "," + lng,
            color: "#1E40AF"
          }
        ] : []
      });
    }
  } catch (e) {
    Logger.log("⚠️ _searchInLocationSheet error: " + e.message);
  }
  return results;
}


function _isCleanHouseNumber(text) {
  if (!text) return false;
  let t = String(text).trim();
  if (!t) return false;
  if (t.length > 50) return false;
  if (/^(ค้นหา|บอท|หา|บัญชี|นัด|ส่ง|#|\/)/.test(t)) return false;
  // เริ่มด้วยเลข, "หมู่", หรือ "ม."
  return /^(\d|หมู่|ม\.)/.test(t);
}

function _normalizeLocationHouseQuery_(text) {
  let t = String(text || "").trim();
  if (!t) return "";
  t = t.replace(/^(ค้นหา|หา)\s+/i, "");
  t = t.replace(/^(บ้านเลขที่|เลขที่บ้าน|เลขที่|บ้าน)\s*/i, "");
  t = t.replace(/\s+/g, " ");
  for (let i = 0; i < 5; i++) {
    const before = t;
    t = t.replace(/(\d)\s+\/\s*(\d)/g, "$1/$2");
    t = t.replace(/(\d)\s*\/\s+(\d)/g, "$1/$2");
    if (t === before) break;
  }
  return t.trim();
}


// ════════════════════════════════════════════════════════════════════
// 📋 SEARCH IN SEARCH DB (ฐานภายนอก)
// ════════════════════════════════════════════════════════════════════

function _searchInSearchDb(db, query, maxResults) {
  const results = [];
  try {
    const sh = SpreadsheetApp.openById(db.sheetId).getSheetByName(db.sheetName);
    if (!sh || sh.getLastRow() <= 1) return results;

    const data = sh.getDataRange().getValues();
    const headers = data[0].map(String);
    const lowerQuery = String(query).toLowerCase();
    const queryWords = lowerQuery.split(/[\s,]+/).filter(function(w){ return w.length > 0; });

    // หา column phone/tel เพื่อสร้างปุ่ม tel:
    const phoneColIdx = _findPhoneColumn(headers);
    // หา column address/ที่อยู่ เพื่อสร้างปุ่ม Maps
    const addrColIdx = _findAddressColumn(headers);

    const candidates = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowText = row.map(function(v){ return String(v || "").toLowerCase(); }).join(" ");

      let score = 0;
      queryWords.forEach(function(w) {
        if (rowText.indexOf(w) >= 0) score++;
      });

      if (score === 0) continue;

      candidates.push({ row: row, score: score, idx: i });
    }

    candidates.sort(function(a, b){ return b.score - a.score; });

    candidates.slice(0, maxResults).forEach(function(c) {
      const row = c.row;
      // หา title (column 1 หรือคอลัมน์แรกที่มีค่า)
      let title = "";
      for (let k = 0; k < headers.length; k++) {
        const v = String(row[k] || "").trim();
        const lowerH = String(headers[k] || "").toLowerCase();
        // ข้าม id/timestamp
        if (/^(id|_row|timestamp|วันที่|เวลา)$/i.test(lowerH)) continue;
        if (v) { title = v; break; }
      }
      if (!title) title = "(ไม่ระบุ)";

      // สร้าง fields (เอาทุก column ที่มีค่า ยกเว้น id/timestamp)
      const fields = [];
      headers.forEach(function(h, idx) {
        const v = String(row[idx] || "").trim();
        if (!v) return;
        const lowerH = String(h || "").toLowerCase();
        if (/^(id|_row|timestamp)$/i.test(lowerH)) return;
        fields.push({ label: h, value: v.substring(0, 80) });
      });

      // Actions (ปุ่ม)
      const actions = [];
      if (phoneColIdx >= 0 && row[phoneColIdx]) {
        const phone = String(row[phoneColIdx]).replace(/[^\d+]/g, "");
        if (phone.length >= 8) {
          actions.push({
            type: "uri",
            label: "📞 โทร " + phone,
            uri: "tel:" + phone,
            color: "#10B981"
          });
        }
      }
      if (addrColIdx >= 0 && row[addrColIdx]) {
        const addr = encodeURIComponent(String(row[addrColIdx]));
        actions.push({
          type: "uri",
          label: "🗺️ เปิด Maps",
          uri: "https://www.google.com/maps?q=" + addr,
          color: "#1E40AF"
        });
      }

      results.push({
        source: (db.icon || "📋") + " " + db.name,
        sourceColor: _hashColor(db.name),
        title: title,
        fields: fields.slice(0, 6),  // จำกัดไม่ให้ bubble ใหญ่เกิน
        actions: actions
      });
    });
  } catch (e) {
    Logger.log("⚠️ _searchInSearchDb error (" + db.name + "): " + e.message);
  }
  return results;
}


function _findPhoneColumn(headers) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").toLowerCase();
    if (/(โทร|เบอร์|tel|phone|mobile)/.test(h)) return i;
  }
  return -1;
}


function _findAddressColumn(headers) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").toLowerCase();
    if (/(ที่อยู่|address|location|พิกัด)/.test(h)) return i;
  }
  return -1;
}


function _hashColor(s) {
  // สีตามชื่อฐาน (consistent)
  const colors = ["#1E40AF","#9333EA","#059669","#DC2626","#EA580C","#0891B2","#7C3AED","#BE185D","#15803D","#B45309"];
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}


// ════════════════════════════════════════════════════════════════════
// 🎨 FLEX BUILDERS
// ════════════════════════════════════════════════════════════════════

function _buildDatabaseListFlex(userRole, userId) {
  const dbs = (typeof getSearchDatabases === "function") ? getSearchDatabases() : [];
  const accessible = [];

  // เพิ่ม "พิกัด" เป็นฐานเสมอ
  accessible.push({
    name: "พิกัด",
    icon: "📍",
    desc: "บ้านเลขที่และพิกัด GPS",
    color: "#1E40AF"
  });

  dbs.forEach(function(db) {
    if (db.status !== "ON") return;
    if (!_canAccessDb(db, userRole, userId)) return;
    accessible.push({
      name: db.name,
      icon: db.icon || "📋",
      desc: "ฐาน " + db.name,
      color: _hashColor(db.name)
    });
  });

  if (accessible.length === 0) {
    return "📭 ไม่มีฐานข้อมูลที่ค้นได้";
  }

  const items = accessible.slice(0, 10).map(function(a) {
    return {
      type: "box", layout: "horizontal", margin: "sm", spacing: "sm",
      contents: [
        { type: "text", text: a.icon, size: "xl", flex: 0 },
        {
          type: "box", layout: "vertical", flex: 5,
          contents: [
            { type: "text", text: a.name, size: "sm", weight: "bold", color: "#111827" },
            { type: "text", text: "ค้นหา " + a.name + " [คำค้น]", size: "xs", color: "#6B7280", wrap: true }
          ]
        }
      ]
    };
  });

  return {
    type: "flex",
    altText: "📋 รายการฐานค้นหา (" + accessible.length + ")",
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#1E40AF", paddingAll: "16px",
        contents: [
          { type: "text", text: "📋 ฐานข้อมูลที่ค้นได้", color: "#FFFFFF", weight: "bold", size: "md" },
          { type: "text", text: accessible.length + " ฐาน", color: "#DBEAFE", size: "xs", margin: "xs" }
        ]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "12px", spacing: "xs",
        contents: items
      },
      footer: {
        type: "box", layout: "vertical", paddingAll: "12px",
        contents: [
          { type: "text", text: "💡 พิมพ์: ค้นหา [ชื่อฐาน] [คำค้น]", size: "xs", color: "#6B7280", align: "center", wrap: true },
          { type: "text", text: "หรือ: ค้นหา [คำค้น]   (ค้นทุกฐาน)", size: "xs", color: "#9CA3AF", align: "center", margin: "xs", wrap: true }
        ]
      }
    }
  };
}


function _buildSearchEmptyV2(query, dbHint) {
  const headerText = dbHint ? "ค้น \"" + query + "\" ใน " + dbHint : "ค้น \"" + query + "\"";

  return {
    type: "flex",
    altText: "🔍 ไม่พบ " + query,
    contents: {
      type: "bubble", size: "kilo",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#DC2626", paddingAll: "14px",
        contents: [
          { type: "text", text: "🔍 ไม่พบข้อมูล", color: "#FFFFFF", weight: "bold", size: "md" },
          { type: "text", text: headerText, color: "#FEE2E2", size: "sm", margin: "xs", wrap: true }
        ]
      },
      body: {
        type: "box", layout: "vertical", paddingAll: "14px",
        contents: [
          { type: "text", text: "❌ ไม่พบข้อมูลที่ค้นหา", size: "md", color: "#DC2626", weight: "bold", wrap: true },
          { type: "separator", margin: "md" },
          { type: "text", text: "💡 ลองคำสั่งเหล่านี้:", size: "sm", color: "#374151", margin: "md", weight: "bold" },
          { type: "text", text: "• ค้นหา ฐาน  (ดูฐานทั้งหมด)", size: "xs", color: "#6B7280", margin: "sm", wrap: true },
          { type: "text", text: "• ค้นหา [คำค้น]  (ค้นทุกฐาน)", size: "xs", color: "#6B7280", margin: "xs", wrap: true },
          { type: "text", text: "• ลองตัดคำค้นให้สั้นลง", size: "xs", color: "#6B7280", margin: "xs", wrap: true }
        ]
      }
    }
  };
}


function _buildSearchCarouselV2(query, dbHint, results, totalCount) {
  const bubbles = results.map(function(r) { return _buildResultBubbleV2(r, query); });

  if (bubbles.length === 1) {
    return {
      type: "flex",
      altText: "🔍 พบ \"" + query + "\" (1 รายการ)",
      contents: bubbles[0]
    };
  }

  return {
    type: "flex",
    altText: "🔍 พบ \"" + query + "\" (" + totalCount + " รายการ)",
    contents: {
      type: "carousel",
      contents: bubbles
    }
  };
}


function _buildResultBubbleV2(r, query) {
  // Header
  const headerContents = [
    { type: "text", text: r.source, color: "#FFFFFF", size: "xs", weight: "bold" },
    { type: "text", text: r.title, color: "#FFFFFF", weight: "bold", size: "md", margin: "xs", wrap: true }
  ];

  // Body fields
  const bodyContents = [];
  (r.fields || []).slice(0, 6).forEach(function(f, idx) {
    if (idx > 0) bodyContents.push({ type: "separator", margin: "sm", color: "#F3F4F6" });
    bodyContents.push({
      type: "box", layout: "vertical", margin: idx === 0 ? "none" : "sm",
      contents: [
        { type: "text", text: f.label, size: "xxs", color: "#9CA3AF" },
        { type: "text", text: f.value, size: "sm", color: "#111827", wrap: true }
      ]
    });
  });

  if (r.addr) {
    bodyContents.push({
      type: "box", layout: "horizontal", margin: "md",
      contents: [
        { type: "text", text: "🏠", size: "xs", flex: 0 },
        { type: "text", text: " " + r.addr, size: "xs", color: "#6B7280", flex: 1, wrap: true }
      ]
    });
  }

  if (bodyContents.length === 0) {
    bodyContents.push({ type: "text", text: "(ไม่มีข้อมูลเพิ่มเติม)", size: "xs", color: "#9CA3AF" });
  }

  // Footer
  const footerContents = [];
  (r.actions || []).forEach(function(a) {
    footerContents.push({
      type: "button",
      style: "primary",
      color: a.color || "#1E40AF",
      height: "sm",
      action: { type: "uri", label: a.label, uri: a.uri }
    });
  });

  const bubble = {
    type: "bubble", size: "kilo",
    header: {
      type: "box", layout: "vertical",
      backgroundColor: r.sourceColor || "#1E40AF",
      paddingAll: "14px",
      contents: headerContents
    },
    body: {
      type: "box", layout: "vertical", paddingAll: "14px", spacing: "none",
      contents: bodyContents
    }
  };

  if (footerContents.length > 0) {
    bubble.footer = {
      type: "box", layout: "vertical", paddingAll: "10px", spacing: "xs",
      contents: footerContents
    };
  }

  return bubble;
}


// ════════════════════════════════════════════════════════════════════
// 🧪 TEST HELPERS
// ════════════════════════════════════════════════════════════════════

function testSearchUnified() {
  const tests = [
    { text: "ค้นหา 89/9", isGroup: false, expect: "search" },
    { text: "ค้นหา ผู้ใหญ่บ้าน 89", isGroup: false, expect: "search with hint" },
    { text: "ค้นหา", isGroup: false, expect: "list mode" },
    { text: "ค้นหา ฐาน", isGroup: false, expect: "list mode" },
    { text: "บอท ค้นหา 89", isGroup: true, expect: "search in group" },
    { text: "ค้นหา 89", isGroup: true, expect: "NOT search (no บอท prefix in group)" },
    { text: "สวัสดี", isGroup: false, expect: "NOT search" }
  ];

  const results = [];
  tests.forEach(function(t) {
    const parsed = _parseSearchCommandV2(t.text, t.isGroup);
    results.push({
      text: t.text,
      isGroup: t.isGroup,
      expect: t.expect,
      parsed: parsed
    });
  });

  Logger.log(JSON.stringify(results, null, 2));
  return { success: true, results: results };
}


function searchUnifiedStatus() {
  const dbs = (typeof getSearchDatabases === "function") ? getSearchDatabases() : [];
  return {
    version: "1.0",
    keyword: getConfig("SEARCH_KEYWORD") || "ค้นหา",
    groupPrefix: getConfig("SEARCH_GROUP_PREFIX") || "บอท",
    activeDatabases: dbs.filter(function(d){ return d.status === "ON"; }).length,
    totalDatabases: dbs.length,
    whitelistGroups: (getConfig("SEARCH_WHITELIST_GROUPS") || "").split(",").filter(Boolean).length
  };
}
