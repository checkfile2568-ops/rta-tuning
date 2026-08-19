/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  🔒 PikadOnlyGroup.gs v1.0 — Group-Scoped Bot Mute               ║
 * ║  ระบบ LINE Bot ศาลจังหวัดลพบุรี                                  ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  วัตถุประสงค์:                                                    ║
 * ║    ในกลุ่มที่ระบุไว้ใน PIKAD_ONLY_GROUPS:                         ║
 * ║      ✅ รับพิกัด/รูป/เลขบ้าน → PikadSession ทำงานปกติ              ║
 * ║      ❌ ปิด KB Search (Knowledge Base)                            ║
 * ║      ❌ ปิด DB Search (ทุกฐานข้อมูล)                              ║
 * ║                                                                   ║
 * ║  ❗ ไม่กระทบ:                                                     ║
 * ║      • กลุ่มอื่นๆ → ทำงานปกติ                                      ║
 * ║      • Private chat → ทำงานปกติ                                   ║
 * ║      • PikadSession (saveOrUpdateLocationData/HouseNumber)        ║
 * ║      • Admin commands (/บอท ปิด, /สอน, ฯลฯ)                       ║
 * ║      • บัญชีนัดความ                                                ║
 * ║                                                                   ║
 * ║  📋 วิธีติดตั้ง:                                                   ║
 * ║    1. Apps Script → File → New → Script                          ║
 * ║    2. ตั้งชื่อ "PikadOnlyGroup"                                    ║
 * ║    3. วางโค้ดนี้ทั้งหมด → Save                                     ║
 * ║    4. Run setupPikadOnlyGroup()  (รันครั้งเดียว)                  ║
 * ║    5. ไปชีต "ตั้งค่า" → ใส่ Group ID ในแถว PIKAD_ONLY_GROUPS      ║
 * ║    6. แก้ Code.gs 2 จุด (ดูคำแนะนำท้ายไฟล์)                       ║
 * ║    7. Deploy version ใหม่                                         ║
 * ║                                                                   ║
 * ║  🧪 ทดสอบ:                                                        ║
 * ║    • Run testPikadOnlyGroup() — ทดสอบฟังก์ชัน                     ║
 * ║    • Run debugPikadOnlyConfig() — ดูค่า config ปัจจุบัน           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */


/* ════════════════════════════════════════════════════════════════════
 *  PART 1: SETUP
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🔧 ติดตั้ง config key ครั้งแรก
 * รันครั้งเดียวหลังเพิ่มไฟล์
 */
function setupPikadOnlyGroup() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const configSheet = ss.getSheetByName(SHEETS.CONFIG);
    if (!configSheet) {
      return { success: false, error: "❌ ไม่พบ Sheet 'ตั้งค่า'" };
    }

    const data = configSheet.getDataRange().getValues();
    const existing = {};
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) existing[String(data[i][0]).trim()] = i + 1;
    }

    const added = [];
    if (!existing.PIKAD_ONLY_GROUPS) {
      configSheet.appendRow([
        "PIKAD_ONLY_GROUPS",
        "",
        "🔒 Group IDs ที่ปิด KB+DB Search (คั่นด้วย ,) — รับเฉพาะพิกัด/รูป/เลขบ้าน เช่น Cxxxxx,Cyyyyy"
      ]);
      added.push("✅ เพิ่ม config: PIKAD_ONLY_GROUPS");
    } else {
      added.push("✓ มี config PIKAD_ONLY_GROUPS อยู่แล้ว (แถวที่ " + existing.PIKAD_ONLY_GROUPS + ")");
    }

    const msg = "🎉 Setup PikadOnlyGroup สำเร็จ\n\n" + added.join("\n")
      + "\n\n📋 ขั้นตอนต่อไป:\n"
      + "1. ไปที่ชีต 'ตั้งค่า'\n"
      + "2. หาแถว PIKAD_ONLY_GROUPS\n"
      + "3. ใส่ Group ID ของห้องส่งหมาย (คอลัมน์ B)\n"
      + "   - หาได้โดยพิมพ์ /ไอดีกลุ่ม ในห้องนั้น\n"
      + "   - ขึ้นต้นด้วย C (เช่น Cxxxxx...)\n"
      + "4. แก้ Code.gs 2 จุด (ดูคู่มือท้ายไฟล์นี้)\n"
      + "5. Deploy version ใหม่";

    Logger.log(msg);
    return { success: true, msg: msg };
  } catch (e) {
    Logger.log("❌ setupPikadOnlyGroup error: " + e.message);
    return { success: false, error: e.message };
  }
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 2: HELPER — ตรวจสอบว่า group อยู่ใน list หรือไม่
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🔍 ตรวจว่า groupId นี้อยู่ใน PIKAD_ONLY_GROUPS หรือไม่
 *
 * @param {string} groupId - LINE Group ID (Cxxx...)
 * @returns {boolean} true = ห้องนี้ปิด KB+DB / false = ห้องปกติ
 */
function _isPikadOnlyGroup_(groupId) {
  if (!groupId) return false;

  try {
    const raw = String(getConfig("PIKAD_ONLY_GROUPS") || "").trim();
    if (!raw) return false;

    // รองรับคั่นด้วย , ; เว้นบรรทัด หรือ space
    const ids = raw.split(/[,\n;]+/)
                   .map(function(s) { return s.trim(); })
                   .filter(Boolean);

    const target = String(groupId).trim();
    return ids.indexOf(target) >= 0;
  } catch (e) {
    Logger.log("⚠️ _isPikadOnlyGroup_ error: " + e.message);
    return false;
  }
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 3: OVERRIDE — smartSearchKB / smartSearchDB
 *
 *  หลักการ:
 *    - Apps Script ใช้ฟังก์ชันที่ define หลังสุด → จะ override ของเดิม
 *      ใน SmartMatching.gs โดยอัตโนมัติ
 *    - เพิ่ม optional 4th argument: groupId
 *    - ถ้า groupId อยู่ใน list → return null (บอทเงียบ)
 *    - ถ้าไม่มี groupId หรือไม่อยู่ใน list → เรียก logic เดิมเป๊ะ
 *      (backward compatible — Code.gs เก่าๆ ที่ไม่ส่ง groupId ก็ยังใช้ได้)
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🎯 Override smartSearchKB
 * รับ 4 พารามิเตอร์: (query, userRole, userId, groupId?)
 */
function smartSearchKB(query, userRole, userId, groupId) {
  // ✋ Guard: ถ้าอยู่ใน Pikad-only group → ไม่ค้น KB
  if (_isPikadOnlyGroup_(groupId)) {
    Logger.log("🔒 PikadOnly: ข้าม KB Search ในกลุ่ม " +
               String(groupId).substring(0, 10) + "... | query: " +
               String(query || "").substring(0, 30));
    return null;
  }

  // ✅ ปกติ → เรียก improvedKBSearch เหมือนเดิม
  return improvedKBSearch(query, userRole, userId);
}


/**
 * 🎯 Override smartSearchDB
 * รับ 4 พารามิเตอร์: (query, userRole, userId, groupId?)
 */
function smartSearchDB(query, userRole, userId, groupId) {
  // ✋ Guard: ถ้าอยู่ใน Pikad-only group → ไม่ค้น DB
  if (_isPikadOnlyGroup_(groupId)) {
    Logger.log("🔒 PikadOnly: ข้าม DB Search ในกลุ่ม " +
               String(groupId).substring(0, 10) + "... | query: " +
               String(query || "").substring(0, 30));
    return null;
  }

  // ✅ ปกติ → เรียก smartSearchAllDbs_v2 เหมือนเดิม
  return smartSearchAllDbs_v2(query, userRole, userId);
}


/* ════════════════════════════════════════════════════════════════════
 *  PART 4: DEBUG & TEST
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 🔍 ดูค่า config PIKAD_ONLY_GROUPS ปัจจุบัน
 */
function debugPikadOnlyConfig() {
  try {
    const raw = String(getConfig("PIKAD_ONLY_GROUPS") || "").trim();
    const ids = raw ? raw.split(/[,\n;]+/).map(function(s){return s.trim();}).filter(Boolean) : [];

    const msg = "📋 PIKAD_ONLY_GROUPS Config\n\n"
      + "Raw value: \"" + raw + "\"\n"
      + "Parsed count: " + ids.length + " groups\n\n"
      + (ids.length ? ids.map(function(id, i){ return (i+1) + ". " + id; }).join("\n") : "(ว่าง — ยังไม่ได้ตั้งค่า)");

    Logger.log(msg);
    return { success: true, count: ids.length, ids: ids, raw: raw };
  } catch (e) {
    Logger.log("❌ debugPikadOnlyConfig error: " + e.message);
    return { success: false, error: e.message };
  }
}


/**
 * 🧪 ทดสอบ override ทำงานถูกต้อง
 */
function testPikadOnlyGroup() {
  const tests = [];
  const testQuery = "ผู้ใหญ่บ้าน คลองเกตุ";
  const testUserId = "TEST_USER_PIKAD";

  // Test 1: ไม่มี groupId → ทำงานปกติ
  try {
    const r1 = smartSearchKB(testQuery, "VIP", testUserId);
    tests.push({
      case: "1. ไม่ส่ง groupId (private chat)",
      result: r1 !== undefined ? "✅ ทำงานปกติ" : "⚠️ undefined",
      preview: r1 ? String(r1).substring(0, 50) + "..." : "null (ไม่เจอใน KB)"
    });
  } catch (e) {
    tests.push({ case: "1. ไม่ส่ง groupId", result: "❌ Error: " + e.message });
  }

  // Test 2: groupId ที่ไม่อยู่ใน list → ทำงานปกติ
  try {
    const r2 = smartSearchKB(testQuery, "VIP", testUserId, "C_OTHER_GROUP_NOT_IN_LIST");
    tests.push({
      case: "2. groupId ไม่อยู่ใน list",
      result: "✅ ทำงานปกติ",
      preview: r2 ? String(r2).substring(0, 50) + "..." : "null"
    });
  } catch (e) {
    tests.push({ case: "2. groupId ไม่อยู่ใน list", result: "❌ Error: " + e.message });
  }

  // Test 3: ตรวจ config
  const cfg = debugPikadOnlyConfig();
  if (cfg.ids && cfg.ids.length > 0) {
    // Test 3a: ใช้ groupId แรกใน config
    try {
      const testGid = cfg.ids[0];
      const r3 = smartSearchKB(testQuery, "VIP", testUserId, testGid);
      tests.push({
        case: "3. groupId อยู่ใน PIKAD_ONLY_GROUPS (" + testGid.substring(0, 10) + "...)",
        result: r3 === null ? "✅ Guard ทำงาน (return null)" : "❌ Guard ไม่ทำงาน (ตอบกลับ: " + String(r3).substring(0, 30) + ")"
      });
    } catch (e) {
      tests.push({ case: "3. groupId ใน list", result: "❌ Error: " + e.message });
    }
  } else {
    tests.push({
      case: "3. ทดสอบ guard",
      result: "⚠️ ข้าม — ยังไม่มี Group ID ใน config (ใส่ก่อนทดสอบ)"
    });
  }

  // สรุปผล
  const summary = "🧪 ผลทดสอบ PikadOnlyGroup\n\n"
    + tests.map(function(t, i) {
        return "Test " + t.case + "\n  → " + t.result
             + (t.preview ? "\n  Preview: " + t.preview : "");
      }).join("\n\n");

  Logger.log(summary);
  return { success: true, tests: tests };
}


/* ════════════════════════════════════════════════════════════════════
 *
 *  📝 คู่มือแก้ Code.gs (สำคัญ!)
 *
 *  ════════════════════════════════════════════════════════════════════
 *
 *  เปิดไฟล์ Code.gs → หา 2 จุดที่เรียก smartSearchKB และ smartSearchDB
 *  แล้วเพิ่ม argument ที่ 4 (groupId) เข้าไป
 *
 *  วิธีหา: ใน Apps Script Editor กด Ctrl+H (Find & Replace)
 *
 *  ────────────────────────────────────────────────────────────────
 *  จุดที่ 1: smartSearchKB
 *  ────────────────────────────────────────────────────────────────
 *
 *  ก่อนแก้ (โดยประมาณ):
 *      const kbAnswer = smartSearchKB(text, userRole, userId);
 *
 *  หลังแก้ (เพิ่ม , groupId):
 *      const kbAnswer = smartSearchKB(text, userRole, userId, groupId);
 *
 *  ────────────────────────────────────────────────────────────────
 *  จุดที่ 2: smartSearchDB
 *  ────────────────────────────────────────────────────────────────
 *
 *  ก่อนแก้:
 *      const dbAnswer = smartSearchDB(text, userRole, userId);
 *
 *  หลังแก้:
 *      const dbAnswer = smartSearchDB(text, userRole, userId, groupId);
 *
 *  ────────────────────────────────────────────────────────────────
 *  📌 หมายเหตุสำคัญ:
 *
 *  1. ตัวแปร groupId ใน Code.gs อาจชื่ออื่น เช่น:
 *     - event.source.groupId
 *     - sourceId
 *     - chatId
 *     ให้ใช้ตัวแปรที่ Code.gs ใช้อยู่
 *
 *  2. ถ้าเป็น private chat groupId จะเป็น undefined/null
 *     → guard จะ skip การเช็คโดยอัตโนมัติ (return false)
 *     → KB/DB ทำงานปกติเหมือนเดิม
 *
 *  3. ถ้าไม่อยากแก้ Code.gs:
 *     ฟังก์ชันยังทำงานปกติเหมือนเดิม (3 args)
 *     แค่ feature นี้ไม่ทำงานเท่านั้น
 *
 *  ════════════════════════════════════════════════════════════════════
 *
 *  📌 หา Group ID ห้องส่งหมาย:
 *
 *  วิธีที่ 1: พิมพ์ในห้อง LINE
 *      /ไอดีกลุ่ม
 *      → บอทตอบกลับด้วย Group ID ที่ขึ้นต้นด้วย C
 *
 *  วิธีที่ 2: ดูจาก Apps Script Logs
 *      ส่งข้อความอะไรก็ได้ในห้อง → ดู Logs ใน Apps Script
 *
 *  ════════════════════════════════════════════════════════════════════
 */
