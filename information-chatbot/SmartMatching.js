/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  🎯 SmartMatching.gs v1.0 — Master Build v10.2                   ║
 * ║  ระบบ LINE Bot ศาลจังหวัดลพบุรี                                  ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  วัตถุประสงค์:                                                    ║
 * ║    🔧 แก้ปัญหา 1: บอทตอบบ้างไม่ตอบบ้าง                            ║
 * ║    🔧 แก้ปัญหา 2: บอทค้นหาผิดฐาน                                  ║
 * ║                                                                   ║
 * ║  ฟังก์ชันหลัก:                                                    ║
 * ║    • normalizeText()        — ทำความสะอาดข้อความก่อน match        ║
 * ║    • SYNONYM_TABLE          — ตารางคำพ้องความหมาย                 ║
 * ║    • improvedKBSearch()     — ค้น KB แบบฉลาด (replace เดิม)       ║
 * ║    • detectDBHint()         — เดาฐานจากคำที่ใช้                   ║
 * ║    • prioritySearch()       — ค้น DB ตามลำดับ priority            ║
 * ║    • scoreMatch()           — คำนวณ score การ match               ║
 * ║                                                                   ║
 * ║  วิธีใช้:                                                         ║
 * ║    1. เพิ่มไฟล์นี้ใน Apps Script (File → New → Script)            ║
 * ║    2. Save                                                        ║
 * ║    3. Code.gs จะเรียกใช้ฟังก์ชันใน SmartMatching.gs โดยอัตโนมัติ  ║
 * ║                                                                   ║
 * ║  ทดสอบ:                                                           ║
 * ║    • Run testKnowledgeMatching() — ทดสอบ KB                      ║
 * ║    • Run testDBHintDetection()   — ทดสอบเดาฐาน                   ║
 * ║    • Run testFullSmartSearch()   — ทดสอบเต็มระบบ                  ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */


/* ════════════════════════════════════════════════════════════════════
 *  PART 1: TEXT NORMALIZATION
 *  - ทำความสะอาดข้อความให้เปรียบเทียบได้ถูกต้อง
 *  - แก้ปัญหา "ลงทะเบียน" ≠ "การลงทะเบียน"
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🧹 ทำความสะอาดข้อความเพื่อ match
 * - ตัด whitespace ทั้งสองด้าน
 * - แปลงเป็น lowercase
 * - ตัดเครื่องหมาย/space ตรงกลาง
 * - ตัด prefix ที่ไม่สำคัญ ("การ", "ที่", "เรื่อง")
 *
 * @param {string} text - ข้อความต้นฉบับ
 * @returns {string} ข้อความที่สะอาดแล้ว
 */
function normalizeText(text) {
  if (!text) return "";
  let result = String(text).trim().toLowerCase();

  // ตัดเครื่องหมายพิเศษ (เก็บแค่ตัวอักษร, ตัวเลข, ภาษาไทย)
  result = result.replace(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/g, " ");

  // ยุบ space หลายตัวเป็นตัวเดียว
  result = result.replace(/\s+/g, " ").trim();

  return result;
}


/**
 * 🧹 ทำความสะอาดแบบเข้มข้น — เอา prefix ภาษาไทยทิ้งด้วย
 * @param {string} text
 * @returns {string}
 */
function normalizeTextStrict(text) {
  let result = normalizeText(text);

  // ตัด prefix ที่พบบ่อย (ทำให้ "การลงทะเบียน" = "ลงทะเบียน")
  const prefixes = ["การ", "เรื่อง", "ที่", "เกี่ยวกับ", "วิธี", "อยาก", "ขอ"];
  for (const prefix of prefixes) {
    if (result.startsWith(prefix + " ")) {
      result = result.substring(prefix.length + 1);
    } else if (result.startsWith(prefix)) {
      // ถ้าเจอ prefix ติดกับคำเลย เช่น "การลงทะเบียน" → "ลงทะเบียน"
      const afterPrefix = result.substring(prefix.length);
      if (afterPrefix.length >= 2) result = afterPrefix;
    }
  }

  return result.trim();
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 2: SYNONYM TABLE
 *  - ตารางคำพ้องความหมาย (Thai + English)
 *  - ช่วยให้ "ลงทะเบียน" = "สมัคร" = "register"
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 📚 ตารางคำพ้องความหมาย
 * - Key: คำหลัก (canonical)
 * - Value: array ของคำที่หมายถึงสิ่งเดียวกัน
 */
const SMART_SYNONYM_TABLE = {
  "ลงทะเบียน": ["สมัคร", "register", "เพิ่มชื่อ", "สมัครสมาชิก", "join"],
  "เวลา": ["ชั่วโมง", "เปิดทำการ", "เลิกงาน", "ทำการ", "open", "time"],
  "ค่าธรรมเนียม": ["ค่าใช้จ่าย", "ราคา", "ค่า", "fee", "cost", "price"],
  "ติดต่อ": ["เบอร์", "โทร", "address", "contact", "ที่อยู่", "เบอร์โทร"],
  "บัญชีนัดความ": ["นัดความ", "นัด", "บัญชีนัด", "schedule"],
  "พิกัด": ["ตำแหน่ง", "location", "coordinates", "ที่อยู่", "GPS", "แผนที่"],
  "รูป": ["ภาพ", "photo", "image", "ถ่ายรูป", "หลักฐาน"],
  "เลขบ้าน": ["บ้านเลขที่", "house", "address", "เลขที่"],
  "ค้นหา": ["search", "หา", "ค้น", "find"],
  "ช่วยเหลือ": ["help", "ช่วย", "ขอความช่วยเหลือ", "support"],
  "คดี": ["case", "คดีความ", "คำสั่ง"],
  "ศาล": ["court", "ที่ศาล"],
  "ผู้ดูแล": ["admin", "ผู้ใช้สิทธิ์", "เจ้าหน้าที่"],
  "ผู้ใช้": ["user", "สมาชิก", "ผู้ใช้งาน"]
};


/**
 * 🔍 ขยายคำค้นด้วย synonym
 * @param {string} keyword
 * @returns {Array<string>} keywords ทั้งหมดที่เกี่ยวข้อง
 */
function expandSynonyms(keyword) {
  const normalized = normalizeText(keyword);
  const expanded = [normalized];

  // หา synonym ใน table
  for (const key in SMART_SYNONYM_TABLE) {
    const synonyms = SMART_SYNONYM_TABLE[key];
    if (key === normalized || synonyms.indexOf(normalized) >= 0) {
      // เจอ → เพิ่มทุกคำใน group
      expanded.push(key);
      synonyms.forEach(s => {
        if (expanded.indexOf(s) < 0) expanded.push(s);
      });
    }
  }

  return expanded;
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 3: IMPROVED KNOWLEDGE BASE SEARCH
 *  - แทนที่ searchKnowledgeBase() เดิม
 *  - ใช้ score-based + synonym
 *  - มี cache 5 นาที
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🎯 ค้น Knowledge Base แบบฉลาด (improved)
 * - Normalize text ก่อน match
 * - Multi-keyword support
 * - Synonym expansion
 * - Score-based ranking
 * - Cache 5 นาที (เร็วขึ้น)
 *
 * @param {string} query - คำที่ต้องการค้น
 * @param {string} userRole - "VIP" | "User"
 * @param {string} userId - Line User ID
 * @returns {string|null} คำตอบ หรือ null
 */
function _getKBCacheVersion_() {
  try {
    return PropertiesService.getScriptProperties().getProperty("KB_CACHE_VERSION") || "1";
  } catch (e) {
    return "1";
  }
}

function _getTestUserId_() {
  try {
    const admins = getAdminIds();
    if (admins && admins.length) return admins[0];
  } catch (e) {}
  return "TEST_USER_ID";
}

function improvedKBSearch(query, userRole, userId) {
  if (!query) return null;

  const cleanQuery = normalizeText(query);
  if (cleanQuery.length < 2) return null;
  const normRole = String(userRole || "").trim().toUpperCase();

  // ลองดึงจาก cache ก่อน (เร็วขึ้น)
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = "kb_" + _getKBCacheVersion_() + "_" + cleanQuery.substring(0, 100);
    const cached = cache.get(cacheKey);
    if (cached) {
      Logger.log("🎯 KB cache hit: " + cleanQuery);
      return cached === "__NULL__" ? null : cached;
    }
  } catch (e) {}

  // อ่านจาก sheet
  let answer = null;
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.KNOWLEDGE);
    if (!sheet || sheet.getLastRow() < 2) return null;

    const data = sheet.getDataRange().getValues();
    const candidates = [];

    // ขยาย synonym ของ query
    const queryKeywords = expandSynonyms(cleanQuery);

    // วน loop หาทุก row
    for (let i = 1; i < data.length; i++) {
      const question = String(data[i][1] || "");
      const ans = data[i][2];
      if (!ans) continue;

      const tags = String(data[i][4] || "");
      const status = String(data[i][5] || "Active").trim();
      const accessLevel = String(data[i][6] || "Public").trim().toUpperCase();

      // ตรวจสถานะ
      if (status !== "Active" && status !== "TRUE" && status !== "ใช้งาน" && status !== "1") continue;

      // ตรวจสิทธิ์
      const isAdminUser = isAdmin(userId);
      if (accessLevel === "INTERNAL" && normRole !== "VIP" && !isAdminUser) continue;
      if (accessLevel === "ADMIN" && !isAdminUser) continue;

      // คำนวณ score
      const score = scoreKBMatch(cleanQuery, queryKeywords, question, tags);
      if (score > 0) {
        candidates.push({ score: score, answer: String(ans), question: question, row: i + 1, rowValues: data[i] });
      }
    }

    // เรียงตาม score สูงสุด → ตอบอันแรก
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      answer = (typeof _buildKnowledgeReplyFromRow_ === "function")
        ? _buildKnowledgeReplyFromRow_(candidates[0].rowValues)
        : candidates[0].answer;
      Logger.log("✅ KB match: \"" + cleanQuery + "\" → \"" + candidates[0].question + "\" (score=" + candidates[0].score + ")");
    } else {
      Logger.log("❌ KB no match: \"" + cleanQuery + "\"");
    }
  } catch (e) {
    Logger.log("⚠️ improvedKBSearch error: " + e.message);
    return null;
  }

  // เก็บใน cache (5 นาที)
  try {
    const cache = CacheService.getScriptCache();
    const cacheKey = "kb_" + _getKBCacheVersion_() + "_" + cleanQuery.substring(0, 100);
    if (!answer || typeof answer === "string") {
      cache.put(cacheKey, answer || "__NULL__", 300);
    }
  } catch (e) {}

  return answer;
}


/**
 * 🎯 คำนวณ score การ match KB
 * - Exact match (full): × 100
 * - Exact match (part): × 50
 * - Substring match: × 10
 * - Tag match: × 30
 * - Synonym match: × 25
 * - Word overlap: × 5 ต่อคำ
 *
 * @param {string} cleanQuery
 * @param {Array} queryKeywords
 * @param {string} question
 * @param {string} tags
 * @returns {number} score
 */
function scoreKBMatch(cleanQuery, queryKeywords, question, tags) {
  let score = 0;
  const cleanQuestion = normalizeText(question);
  const strictQuestion = normalizeTextStrict(question);
  const strictQuery = normalizeTextStrict(cleanQuery);
  const cleanTags = normalizeText(tags);

  // 1. Exact match (full)
  if (cleanQuery === cleanQuestion) score += 100;
  if (strictQuery === strictQuestion) score += 80;

  // 2. Substring match (สองทาง)
  if (cleanQuestion.indexOf(cleanQuery) >= 0) score += 30;
  if (cleanQuery.indexOf(cleanQuestion) >= 0 && cleanQuestion.length >= 3) score += 25;
  if (strictQuestion.indexOf(strictQuery) >= 0) score += 20;
  if (strictQuery.indexOf(strictQuestion) >= 0 && strictQuestion.length >= 3) score += 15;

  // 3. Tag match
  if (cleanTags) {
    const tagList = cleanTags.split(/[,\s]+/).filter(t => t.length > 0);
    for (const tag of tagList) {
      if (cleanQuery.indexOf(tag) >= 0) score += 30;
      if (queryKeywords.indexOf(tag) >= 0) score += 25;
    }
  }

  // 4. Synonym match
  for (const kw of queryKeywords) {
    if (kw === cleanQuery) continue; // ข้ามตัวเอง
    if (cleanQuestion.indexOf(kw) >= 0) score += 25;
    if (strictQuestion.indexOf(kw) >= 0) score += 20;
  }

  // 5. Word overlap (กรณีคำหลายคำ)
  const queryWords = strictQuery.split(/\s+/).filter(w => w.length >= 2);
  const questionWords = strictQuestion.split(/\s+/).filter(w => w.length >= 2);
  let overlap = 0;
  for (const qw of queryWords) {
    if (questionWords.indexOf(qw) >= 0) overlap++;
  }
  if (overlap > 0) {
    // bonus เมื่อ match หลายคำ
    score += overlap * 8;
    // bonus พิเศษเมื่อ match ครบทุกคำ
    if (overlap === queryWords.length && queryWords.length >= 2) score += 20;
  }

  return score;
}


/**
 * 🧹 Clear KB cache (เรียกเมื่อ KB เปลี่ยน)
 */
function clearKBCache() {
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty("KB_CACHE_VERSION", String(Date.now()));
    return { success: true, message: "✅ ล้าง cache สำเร็จ" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 4: DB HINT DETECTION
 *  - เดาฐานข้อมูลจากคำที่ใช้
 *  - แก้ปัญหา "บอทค้นผิดฐาน"
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🎯 เดาว่าควรค้นใน DB ไหน
 *
 * Logic:
 *  - "พ123/2568" / "อ12/68" → ฐานคดี (court)
 *  - "ผบ123" → ฐานคดี
 *  - "123/1" / "12 หมู่" → ฐานพิกัด (location)
 *  - "พิกัด..." / "ตำแหน่ง..." → ฐานพิกัด
 *  - คำธรรมดา → no hint (ค้นทุกฐาน)
 *
 * @param {string} query
 * @returns {Object} { hint: "court"|"location"|"member"|null, confidence: 0-100 }
 */
function detectDBHint(query) {
  if (!query) return { hint: null, confidence: 0 };

  const clean = normalizeText(query);

  // Pattern 1: เลขคดี (พ, อ, ผบ + ตัวเลข + /)
  if (/^(พ|อ|ผบ|คม|พช|อช|ผบช)\s*[\d\/\-]+/.test(clean)) {
    return { hint: "court", confidence: 95, reason: "เลขคดี" };
  }

  // Pattern 2: เริ่มต้นด้วยคำ keyword พิกัด
  if (/^(พิกัด|ตำแหน่ง|location|coord|gps|แผนที่)\s/.test(clean)) {
    return { hint: "location", confidence: 90, reason: "คำว่าพิกัด" };
  }

  // Pattern 3: เลขบ้าน (เช่น 123/1, 45/2 หมู่ 3)
  if (/^\d+\/\d+(\s|$)/.test(clean)) {
    return { hint: "location", confidence: 80, reason: "เลขบ้าน" };
  }

  // Pattern 4: ระบุชื่อฐาน
  if (/^(ฐานคดี|คดี|นัด|นัดความ|บัญชีนัด)/.test(clean)) {
    return { hint: "court", confidence: 85, reason: "คำว่าคดี" };
  }
  if (/^(ฐานพิกัด|ที่อยู่|เลขบ้าน|บ้านเลขที่)/.test(clean)) {
    return { hint: "location", confidence: 85, reason: "คำว่าพิกัด" };
  }
  if (/^(ฐานสมาชิก|สมาชิก|member)/.test(clean)) {
    return { hint: "member", confidence: 80, reason: "คำว่าสมาชิก" };
  }

  // Pattern 5: คำสั่ง /ค้นหา[ฐาน] ...
  const cmdMatch = clean.match(/^\/?ค้นหา(คดี|พิกัด|สมาชิก|บ้าน)\s+(.+)/);
  if (cmdMatch) {
    const dbName = cmdMatch[1];
    const map = { "คดี": "court", "พิกัด": "location", "บ้าน": "location", "สมาชิก": "member" };
    return { hint: map[dbName] || null, confidence: 100, reason: "คำสั่งระบุฐาน", strippedQuery: cmdMatch[2] };
  }

  // ไม่เจอ pattern → no hint (ค้นทุกฐาน)
  return { hint: null, confidence: 0, reason: "ไม่มี hint" };
}

function _guessSearchDbType_(db) {
  const text = normalizeText([
    db && db.type,
    db && db.name,
    db && db.sheetName,
    db && db.icon
  ].join(" "));
  if (/(court|case|schedule|บัญชีนัด|นัดความ|บัญชี|คดี|ศาล)/.test(text)) return "court";
  if (/(location|loc|coord|gps|map|พิกัด|แผนที่|บ้าน|เลขที่|หมาย)/.test(text)) return "location";
  if (/(member|user|สมาชิก|ผู้ใช้|เจ้าหน้าที่)/.test(text)) return "member";
  return "";
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 5: PRIORITY-BASED MULTI-DB SEARCH
 *  - ค้นใน Priority DB ก่อน
 *  - ถ้าไม่เจอ → ค้นทุกฐาน
 *  - แทนที่ _smartSearchAllDbs() เดิม
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🔍 ค้นแบบฉลาด — ใช้ hint + priority + score
 * (replace _smartSearchAllDbs เดิม)
 *
 * @param {string} query
 * @param {string} userRole
 * @param {string} userId
 * @returns {string|null} ผลลัพธ์ formatted หรือ null
 */
function smartSearchAllDbs_v2(query, userRole, userId) {
  if (!query || query.length < 2) return null;

  // เดาว่าค้นฐานไหน
  const hint = detectDBHint(query);
  let actualQuery = query;
  if (hint.strippedQuery) {
    actualQuery = hint.strippedQuery;
    Logger.log("🎯 Search hint detected: " + hint.hint + " (stripped to: " + actualQuery + ")");
  } else if (hint.hint) {
    Logger.log("🎯 Search hint detected: " + hint.hint + " (reason: " + hint.reason + ")");
  }

  const dbs = getSearchDatabases();
  if (!dbs || !dbs.length) return null;

  const maxResults = parseInt(getConfig("SEARCH_MAX_RESULTS")) || 12;
  const keywords = actualQuery.split(/[\s,]+/).filter(k => k.length > 0);
  const normRole = String(userRole || "").trim().toUpperCase();
  let allResults = [];

  // วน loop ทุก DB
  for (const db of dbs) {
    if (db.status !== "ON") continue;

    // ตรวจสิทธิ์
    const isAdminUser = isAdmin(userId);
    const access = String(db.access || "").trim().toUpperCase();
    if (access === "INTERNAL" && normRole !== "VIP" && !isAdminUser) continue;
    if (access === "ADMIN" && !isAdminUser) continue;

    // คำนวณ priority bonus
    let priorityBonus = 0;
    if (hint.hint) {
      const dbType = _guessSearchDbType_(db);
      if (hint.hint === "court" && dbType === "court") {
        priorityBonus = 1000;
      } else if (hint.hint === "location" && dbType === "location") {
        priorityBonus = 1000;
      } else if (hint.hint === "member" && dbType === "member") {
        priorityBonus = 1000;
      }
    }

    try {
      const sh = SpreadsheetApp.openById(db.sheetId).getSheetByName(db.sheetName);
      if (!sh || sh.getLastRow() <= 1) continue;
      const data = sh.getDataRange().getValues();
      const headers = data[0].map(String);

      for (let i = 1; i < data.length; i++) {
        const rowVals = data[i].map(v => String(v || "").toLowerCase());
        const rowAll = rowVals.join(" ");

        // คำนวณ score
        let rowScore = scoreSearchRow(actualQuery, keywords, rowAll, rowVals, headers);
        if (rowScore > 0) {
          const entry = {};
          headers.forEach((h, ci) => { entry[h] = String(data[i][ci] || ""); });
          allResults.push({
            db: db,
            entry: entry,
            score: rowScore + priorityBonus,
            priorityBonus: priorityBonus
          });
        }
      }
    } catch (e) {
      Logger.log("⚠️ DB error: " + db.name + " - " + e.message);
      continue;
    }
  }

  if (!allResults.length) return null;

  // เรียงตาม score
  allResults.sort((a, b) => b.score - a.score);
  allResults = allResults.slice(0, maxResults);

  // SEARCH_USE_FLEX=ON: return LINE Flex object. Code.gs must send it with sendUniversalReply().
  if (String(getConfig("SEARCH_USE_FLEX") || "ON").toUpperCase() !== "OFF") {
    return _buildSmartSearchFlexV2_(query, actualQuery, hint, allResults);
  }

  // Format ผลลัพธ์
  let msg = "🔍 ผลค้นหา: \"" + query + "\"";
  if (hint.hint) {
    msg += "\n🎯 (ค้นใน: " + hint.hint + " เป็นหลัก)";
  }
  msg += "\n━━━━━━━━━━━━━━\n";

  let currentDb = "";
  const SKIP_COLS = ["timestamp", "_row", "id"];
  allResults.forEach(r => {
    if (r.db.name !== currentDb) {
      currentDb = r.db.name;
      msg += "\n" + (r.db.icon || "📋") + " " + r.db.name + "\n━━━━━━━━━━━━━━\n";
    }
    for (const key in r.entry) {
      if (SKIP_COLS.indexOf(key.toLowerCase()) >= 0) continue;
      const val = r.entry[key];
      if (!val) continue;
      msg += "• " + key + ": " + val + "\n";
    }
    msg += "—\n";
  });

  return msg;
}

function _buildSmartSearchFlexV2_(query, actualQuery, hint, results) {
  const safeResults = (results || []).slice(0, 12);
  const bubbles = safeResults.map(function(item, index) {
    return _buildSmartSearchBubbleV2_(item, index);
  });

  const titleQuery = _smartShortTextV2_(actualQuery || query, 80);
  return {
    type: "flex",
    altText: "🔍 ผลค้นหา: " + titleQuery,
    contents: bubbles.length === 1 ? bubbles[0] : {
      type: "carousel",
      contents: bubbles
    }
  };
}

function _buildSmartSearchBubbleV2_(item, index) {
  const db = item.db || {};
  const entry = item.entry || {};
  const fields = _smartFieldListV2_(entry);
  const main = fields.length ? fields[0] : { label: "ผลลัพธ์", value: "พบข้อมูล" };
  const bodyFields = fields.slice(0, 6).map(function(f) {
    return {
      type: "box",
      layout: "vertical",
      margin: "sm",
      contents: [
        {
          type: "text",
          text: _smartShortTextV2_(f.label, 42),
          size: "xxs",
          color: "#6B7280",
          wrap: true
        },
        {
          type: "text",
          text: _smartShortTextV2_(f.value, 180),
          size: "sm",
          color: "#111827",
          wrap: true,
          margin: "none"
        }
      ]
    };
  });

  const footerContents = [];
  const map = _smartFindMapV2_(entry);
  if (map) {
    footerContents.push({
      type: "button",
      style: "primary",
      height: "sm",
      color: "#2563EB",
      action: {
        type: "uri",
        label: "เปิด Maps",
        uri: "https://www.google.com/maps?q=" + encodeURIComponent(map.lat + "," + map.lng)
      }
    });
  }

  const phone = _smartFindPhoneV2_(entry);
  if (phone) {
    footerContents.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: {
        type: "uri",
        label: "โทร",
        uri: "tel:" + phone.replace(/[^\d+]/g, "")
      }
    });
  }
  const link = _smartFindUrlV2_(entry);
  if (link) {
    footerContents.push({
      type: "button",
      style: "primary",
      height: "sm",
      color: "#7C3AED",
      action: {
        type: "uri",
        label: _smartShortTextV2_(link.label || "เปิดลิงก์", 18),
        uri: link.url
      }
    });
  }
  const color = _smartHashColorV2_(db.name || "search");
  const bubble = {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      paddingAll: "14px",
      backgroundColor: color,
      contents: [
        {
          type: "text",
          text: (db.icon || "📋") + " " + _smartShortTextV2_(db.name || "ผลค้นหา", 36),
          color: "#FFFFFF",
          weight: "bold",
          size: "md",
          wrap: true
        },
        {
          type: "text",
          text: "ผลลัพธ์ #" + (index + 1),
          color: "#DBEAFE",
          size: "xxs",
          margin: "xs"
        }
      ]
    },
    body: {
      type: "box",
      layout: "vertical",
      paddingAll: "14px",
      backgroundColor: "#FFFFFF",
      contents: [
        {
          type: "text",
          text: _smartShortTextV2_(main.value, 120),
          size: "md",
          weight: "bold",
          color: "#111827",
          wrap: true
        },
        {
          type: "separator",
          margin: "md",
          color: "#E5E7EB"
        }
      ].concat(bodyFields)
    }
  };

  if (footerContents.length) {
    bubble.footer = {
      type: "box",
      layout: "vertical",
      paddingAll: "10px",
      paddingTop: "0px",
      spacing: "sm",
      contents: footerContents
    };
  }

  return bubble;
}

function _smartFieldListV2_(entry) {
  const skip = {
    "id": true,
    "_row": true,
    "row": true,
    "timestamp": true
  };
  const keys = Object.keys(entry || {});
  const result = [];
  keys.forEach(function(key) {
    const label = String(key || "").trim();
    const lower = label.toLowerCase();
    if (!label || skip[lower]) return;
    const value = String(entry[key] || "").trim();
    if (!value) return;
    if (/^https?:\/\//i.test(value)) return;
    result.push({ label: label, value: value });
  });
  return result;
}

function _smartHashColorV2_(text) {
  const colors = ["#1D4ED8", "#047857", "#B45309", "#7C3AED", "#BE123C", "#0F766E"];
  let hash = 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash) + s.charCodeAt(i);
  return colors[Math.abs(hash) % colors.length];
}

function _smartShortTextV2_(value, maxLen) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  const limit = Math.max(10, Number(maxLen) || 80);
  return text.length > limit ? text.substring(0, limit - 1) + "…" : text;
}

function _smartFindPhoneV2_(entry) {
  const keys = Object.keys(entry || {});
  for (let i = 0; i < keys.length; i++) {
    const k = String(keys[i] || "").toLowerCase();
    const v = String(entry[keys[i]] || "").trim();
    if (!v) continue;
    if (/(phone|tel|mobile|เบอร์|โทร)/i.test(k) && /[0-9]{8,}/.test(v.replace(/[^\d]/g, ""))) {
      return v;
    }
  }
  return "";
}

function _smartFindMapV2_(entry) {
  const keys = Object.keys(entry || {});
  let lat = "";
  let lng = "";
  keys.forEach(function(key) {
    const k = String(key || "").toLowerCase();
    const v = String(entry[key] || "").trim();
    if (!v) return;
    if (!lat && /(lat|ละติจูด)/i.test(k)) lat = v;
    if (!lng && /(lng|lon|ลองจิจูด)/i.test(k)) lng = v;
  });

  // 🆕 ต้องมีค่าทั้งคู่ (ไม่ใช่ empty)
  if (!lat || !lng) return null;

  const nLat = Number(lat);
  const nLng = Number(lng);

  // 🆕 ต้องเป็นตัวเลข valid
  if (isNaN(nLat) || isNaN(nLng)) return null;

  // 🆕 กันพิกัด 0,0 (กลางทะเล)
  if (nLat === 0 && nLng === 0) return null;

  // 🆕 ตรวจช่วงพิกัดที่สมเหตุสมผล
  if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) return null;

  return { lat: nLat, lng: nLng };
}
function _smartFindUrlV2_(entry) {
  const keys = Object.keys(entry || {});
  for (let i = 0; i < keys.length; i++) {
    const v = String(entry[keys[i]] || "").trim();
    if (/^https?:\/\//i.test(v)) {
      return { url: v, label: String(keys[i] || "เปิดลิงก์").trim() };
    }
  }
  return null;
}

/**
 * 🎯 คำนวณ score ของแต่ละ row ในการ search
 * - Exact word match: × 10
 * - Header value match: × 5
 * - Substring match: × 1
 *
 * @param {string} query
 * @param {Array} keywords
 * @param {string} rowAll - ทุก column รวมกัน
 * @param {Array} rowVals - แต่ละ column
 * @param {Array} headers
 * @returns {number}
 */
function scoreSearchRow(query, keywords, rowAll, rowVals, headers) {
  let score = 0;
  const cleanQuery = query.toLowerCase().trim();

  // 1. Exact full query match
  if (rowAll.indexOf(cleanQuery) >= 0) score += 50;

  // 2. Word matches
  for (const kw of keywords) {
    const lkw = kw.toLowerCase();
    if (lkw.length < 2) continue;

    // Substring ในทุก column
    if (rowAll.indexOf(lkw) >= 0) {
      score += 5;

      // Bonus: match ที่ column สำคัญ (ต้นแถว)
      for (let ci = 0; ci < Math.min(rowVals.length, 3); ci++) {
        if (rowVals[ci].indexOf(lkw) >= 0) score += 3;
      }
    }
  }

  return score;
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 6: PUBLIC API (เรียกจาก Code.gs)
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🎯 Public: ค้น KB (ใช้แทน searchKnowledgeBase เดิม)
 * Code.gs จะเรียกฟังก์ชันนี้แทน
 *
 * @returns {string|null}
 */
function smartSearchKB(query, userRole, userId) {
  return improvedKBSearch(query, userRole, userId);
}


/**
 * 🎯 Public: ค้น DB ทั้งหมด (ใช้แทน _smartSearchAllDbs เดิม)
 *
 * @returns {string|null}
 */
function smartSearchDB(query, userRole, userId) {
  return smartSearchAllDbs_v2(query, userRole, userId);
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 7: TEST FUNCTIONS
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🧪 ทดสอบการ normalize text
 */
function testNormalize() {
  const tests = [
    "ลงทะเบียน",
    "การลงทะเบียน",
    " การลงทะเบียน ",
    "เรื่องเวลาเปิดทำการ",
    "สอบถาม: ค่าธรรมเนียม?"
  ];

  const results = tests.map(t => ({
    input: t,
    normalized: normalizeText(t),
    strict: normalizeTextStrict(t)
  }));

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}


/**
 * 🧪 ทดสอบ KB matching
 * รันดูว่าเจอ KB หรือไม่ (ต้องมีข้อมูลใน Sheet KNOWLEDGE)
 */
function testKnowledgeMatching() {
  const tests = [
    "ลงทะเบียน",
    "การลงทะเบียน",
    "ลงทะเบียน ทำอย่างไร",
    "สมัครสมาชิก",  // ทดสอบ synonym
    "เวลาเปิดทำการ",
    "ค่าธรรมเนียม"
  ];

  const testUserId = _getTestUserId_(); // user ทดสอบ
  const results = [];

  for (const q of tests) {
    const start = Date.now();
    const answer = improvedKBSearch(q, "VIP", testUserId);
    const elapsed = Date.now() - start;
    results.push({
      query: q,
      found: !!answer,
      preview: answer ? String(answer).substring(0, 50) + "..." : "❌ ไม่เจอ",
      ms: elapsed
    });
  }

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}


/**
 * 🧪 ทดสอบ DB hint detection
 */
function testDBHintDetection() {
  const tests = [
    "พ123/2568",       // → court
    "อ12/68",          // → court
    "ผบ123",           // → court
    "พิกัด ที่อยู่",     // → location
    "123/1",           // → location (เลขบ้าน)
    "/ค้นหาคดี 102",    // → court (with strippedQuery)
    "ลงทะเบียน",       // → null (no hint)
    "นัดความ พรุ่งนี้",  // → court
  ];

  const results = tests.map(q => {
    const hint = detectDBHint(q);
    return {
      query: q,
      hint: hint.hint,
      confidence: hint.confidence,
      reason: hint.reason,
      stripped: hint.strippedQuery || "(ไม่ตัด)"
    };
  });

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}


/**
 * 🧪 ทดสอบ Synonym expansion
 */
function testSynonymExpansion() {
  const tests = ["ลงทะเบียน", "สมัคร", "register", "เวลา", "เปิดทำการ"];

  const results = tests.map(t => ({
    input: t,
    expanded: expandSynonyms(t)
  }));

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}


/**
 * 🧪 ทดสอบ Smart Search เต็มระบบ
 */
function testFullSmartSearch() {
  const testUserId = _getTestUserId_();
  const tests = [
    "พ123/2568",     // เดา court
    "พิกัด 123/1",   // เดา location
    "/ค้นหาคดี 102", // ระบุ court
    "นาย สมชาย"     // no hint
  ];

  const results = [];
  for (const q of tests) {
    const start = Date.now();
    const result = smartSearchAllDbs_v2(q, "VIP", testUserId);
    const elapsed = Date.now() - start;
    results.push({
      query: q,
      found: !!result,
      preview: result ? String(result).substring(0, 100) : "❌ ไม่เจอ",
      ms: elapsed
    });
  }

  Logger.log(JSON.stringify(results, null, 2));
  return results;
}


/**
 * 🎯 สรุปสถานะ SmartMatching
 */
function smartMatchingStatus() {
  return {
    version: "1.0",
    synonymGroups: Object.keys(SMART_SYNONYM_TABLE).length,
    cacheEnabled: true,
    cacheDuration: "5 minutes",
    functions: [
      "normalizeText", "normalizeTextStrict",
      "expandSynonyms", "improvedKBSearch",
      "scoreKBMatch", "detectDBHint",
      "smartSearchAllDbs_v2", "scoreSearchRow",
      "smartSearchKB", "smartSearchDB"
    ]
  };
}
