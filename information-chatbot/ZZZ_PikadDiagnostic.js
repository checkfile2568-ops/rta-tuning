/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  🔬 ZZZ_PikadDiagnostic.gs — ตัวตรวจสอบระบบ (อ่านอย่างเดียว)     ║
 * ║  ระบบ LINE Bot ศาลจังหวัดลพบุรี                                  ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  ⚠️ ไฟล์นี้ "ไม่แก้ไข" อะไรเลย — แค่ตรวจสอบและรายงานผล          ║
 * ║                                                                   ║
 * ║  วิธีใช้:                                                         ║
 * ║    1. เพิ่มไฟล์นี้ใน Apps Script                                  ║
 * ║    2. เลือกฟังก์ชัน diagnosePikadSystem → ▶ เรียกใช้              ║
 * ║    3. ดูผลใน Logs (Ctrl+Enter หรือเมนู "บันทึกการดำเนินการ")     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */


function diagnosePikadSystem() {
  const out = [];
  const push = function(s) { out.push(s); };

  push("═══════════════════════════════════════");
  push("🔬 PIKAD SYSTEM DIAGNOSTIC");
  push("เวลา: " + new Date().toString());
  push("═══════════════════════════════════════");
  push("");

  // ────────────────────────────────────────────
  // [1] TRIGGERS
  // ────────────────────────────────────────────
  push("【1】 TRIGGERS");
  try {
    const triggers = ScriptApp.getProjectTriggers();
    push("   จำนวนทั้งหมด: " + triggers.length + " ตัว");
    const counts = {};
    triggers.forEach(function(t) {
      const fn = t.getHandlerFunction();
      counts[fn] = (counts[fn] || 0) + 1;
    });
    Object.keys(counts).forEach(function(fn) {
      const dup = counts[fn] > 1 ? "  🚨 ซ้ำ " + counts[fn] + " ตัว!" : "";
      push("   • " + fn + dup);
    });
    if (triggers.length >= 6) {
      push("   ⚠️ trigger เยอะ (" + triggers.length + ") — เสี่ยง execution ชนกัน");
      push("      → อาจทำให้ doPost ถูก queue → reply token หมดอายุ");
    } else {
      push("   ✅ จำนวน trigger ปกติ");
    }
    push("   📌 หมายเหตุ: API อ่าน 'ความถี่นาที' ไม่ได้");
    push("      → ดูความถี่ที่เมนู ⏰ ทริกเกอร์");
  } catch (e) {
    push("   ❌ error: " + e.message);
  }
  push("");

  // ────────────────────────────────────────────
  // [2] WINDOW_MIN (อ่านจาก source code)
  // ────────────────────────────────────────────
  push("【2】 SCHEDULE WINDOW_MIN");
  try {
    if (typeof runScheduledNotify_v2 === "function") {
      const src = runScheduledNotify_v2.toString();
      const m = src.match(/WINDOW_MIN\s*=\s*(\d+)/);
      if (m) {
        const win = parseInt(m[1]);
        push("   WINDOW_MIN ในโค้ด: " + win + " นาที");
        push("   ⚠️ กฎ: WINDOW_MIN ต้อง ≥ ความถี่ trigger");
        push("      - trigger 1 นาที → WINDOW_MIN 2 พอ");
        push("      - trigger 5 นาที → ต้องตั้ง WINDOW_MIN 6");
        if (win < 6) {
          push("   🔴 ถ้าจะลด trigger เป็น 5 นาที ต้องเพิ่ม WINDOW_MIN เป็น 6 ก่อน");
          push("      ไม่งั้น 'กำหนดการประจำ' จะส่งพลาด!");
        }
      } else {
        push("   ⚠️ หา WINDOW_MIN ในโค้ดไม่เจอ");
      }
    } else {
      push("   ⚠️ ไม่พบฟังก์ชัน runScheduledNotify_v2");
    }
  } catch (e) {
    push("   ❌ error: " + e.message);
  }
  push("");

  // ────────────────────────────────────────────
  // [3] PIKAD CONFIG
  // ────────────────────────────────────────────
  push("【3】 PIKAD CONFIG");
  try {
    const cfg = function(k) {
      try { return String(getConfig(k) || ""); } catch (e) { return "(error)"; }
    };
    const checks = [
      { k: "LOC_SAVE_MSG_STATUS", expect: "ON", desc: "เปิดตอบกลับพิกัด/หมาย" },
      { k: "PIKAD_USE_FLEX",      expect: "ON", desc: "ใช้ Flex card" },
      { k: "PHOTO_SAVE_STATUS",   expect: "ON", desc: "เปิดรับรูป" },
      { k: "PHOTO_ALLOWED_IDS",   expect: "all", desc: "ใครส่งรูปได้" },
      { k: "PHOTO_ALLOWED_SOURCES", expect: "*", desc: "ห้องที่ส่งรูปได้" },
      { k: "LOC_ALLOWED_SOURCES", expect: "*", desc: "ห้องที่ส่งพิกัดได้" },
      { k: "PIKAD_SYSTEM_URL",    expect: "*", desc: "URL ระบบพิกัด" },
      { k: "PIKAD_ONLY_GROUPS",   expect: "*", desc: "ห้องปิด KB+DB" },
      { k: "PIKAD_SESSION_MINUTES", expect: "*", desc: "เวลา merge (นาที)" }
    ];
    checks.forEach(function(c) {
      const v = cfg(c.k);
      let mark;
      if (c.expect === "*") {
        mark = v ? "✅" : "🔴 ว่าง!";
      } else {
        mark = (v.toUpperCase() === c.expect.toUpperCase()) ? "✅" : "⚠️ ได้ '" + v + "'";
      }
      const shown = v.length > 35 ? v.substring(0, 32) + "..." : v;
      push("   " + mark + " " + c.k + " = '" + shown + "'");
      push("        (" + c.desc + ")");
    });
  } catch (e) {
    push("   ❌ error: " + e.message);
  }
  push("");

  // ────────────────────────────────────────────
  // [4] LINE QUOTA
  // ────────────────────────────────────────────
  push("【4】 LINE MESSAGE QUOTA");
  try {
    var token = "";
    try { token = LINE_CHANNEL_ACCESS_TOKEN; } catch (e) { token = ""; }
    if (!token) {
      push("   ⚠️ หา LINE_CHANNEL_ACCESS_TOKEN ไม่เจอ — ข้าม");
    } else {
      const opt = {
        method: "get",
        headers: { "Authorization": "Bearer " + token },
        muteHttpExceptions: true
      };
      const qRes = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/quota", opt);
      const cRes = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/quota/consumption", opt);
      let limit = "?", used = "?";
      try { limit = JSON.parse(qRes.getContentText()).value; } catch (e) {}
      try { used = JSON.parse(cRes.getContentText()).totalUsage; } catch (e) {}
      push("   Limit (push/เดือน): " + limit);
      push("   ใช้ไปแล้ว: " + used);
      if (limit !== "?" && used !== "?") {
        const remain = Number(limit) - Number(used);
        push("   เหลือ: " + remain);
        if (remain <= 20) {
          push("   🔴 โควต้า push ใกล้หมด/หมด");
          push("      แต่ Pikad ใช้ REPLY (ฟรี) → ไม่ควรกระทบการตอบรูป/พิกัด");
        } else {
          push("   ✅ โควต้ายังเหลือพอ");
        }
      }
    }
  } catch (e) {
    push("   ❌ error: " + e.message);
  }
  push("");

  // ────────────────────────────────────────────
  // [5] PIKAD SESSION ล่าสุด (อ่าน sheet)
  // ────────────────────────────────────────────
  push("【5】 PIKAD SESSION ล่าสุด (5 แถวท้าย)");
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.LOCATION);
    if (!sheet || sheet.getLastRow() < 2) {
      push("   ⚠️ ไม่มีข้อมูลในชีตพิกัด");
    } else {
      const last = sheet.getLastRow();
      const start = Math.max(2, last - 4);
      const data = sheet.getRange(start, 1, last - start + 1, 9).getValues();
      data.forEach(function(r) {
        const id = String(r[0] || "").substring(0, 14);
        const time = String(r[1] || "");
        const house = String(r[3] || "").trim() ? "🏠" : "—";
        const lat = String(r[4] || "").trim() ? "📍" : "—";
        const status = String(r[8] || "").indexOf("[EXPIRED]") >= 0 ? "[หมดอายุ]" : "[active]";
        push("   " + id + " | " + time + " | " + house + lat + " " + status);
      });
      push("   (🏠=มีเลขบ้าน 📍=มีพิกัด)");
    }
  } catch (e) {
    push("   ❌ error: " + e.message);
  }
  push("");

  // ────────────────────────────────────────────
  // [6] วินิจฉัยสรุป
  // ────────────────────────────────────────────
  push("═══════════════════════════════════════");
  push("🩺 วินิจฉัยเบื้องต้น");
  push("═══════════════════════════════════════");
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const locMsg = String(getConfig("LOC_SAVE_MSG_STATUS") || "ON").toUpperCase();
    const photoIds = String(getConfig("PHOTO_ALLOWED_IDS") || "");
    const pikadUrl = String(getConfig("PIKAD_SYSTEM_URL") || "");

    if (locMsg === "OFF") {
      push("🔴 LOC_SAVE_MSG_STATUS = OFF → ปิดตอบกลับอยู่ ให้เปิดเป็น ON");
    }
    if (photoIds && photoIds.toLowerCase() !== "all" && photoIds.toLowerCase().indexOf("admins") >= 0) {
      push("🔴 PHOTO_ALLOWED_IDS ยังเป็น admins → คนทั่วไปส่งรูปไม่ได้");
      push("   ให้เปลี่ยนเป็น all");
    }
    if (!pikadUrl) {
      push("🔴 PIKAD_SYSTEM_URL ว่าง → ปุ่มเข้าระบบพิกัดอาจหาย");
    }
    if (triggers.length >= 6) {
      push("⚠️ trigger " + triggers.length + " ตัว → ถ้า Pikad เงียบเป็นช่วงๆ");
      push("   สาเหตุน่าจะคือ reply token หมดอายุจาก execution แน่น");
      push("   วิธียืนยัน: ดู log doPost → หา 'Pikad flex reply HTTP'");
      push("     - HTTP 200 = ส่งสำเร็จ (ปัญหาอื่น)");
      push("     - HTTP 400 + Invalid reply token = ✅ ยืนยัน token หมดอายุ");
    }
    push("");
    push("📌 ถ้าทุกอย่างข้างบน ✅ แต่ยังเงียบ:");
    push("   → ปัญหาอยู่ที่ doPost ไม่ถูกเรียก หรือ reply token");
    push("   → เปิด log doPost ตอนคนส่งรูป แล้วส่งภาพมาให้ดู");
  } catch (e) {
    push("   ❌ error: " + e.message);
  }
  push("═══════════════════════════════════════");

  const report = out.join("\n");
  Logger.log(report);
  return report;
}


/**
 * 🧪 ทดสอบ "ส่ง Pikad reply จริง" ไปหาตัวเอง (ต้องใส่ replyToken ไม่ได้)
 * ใช้ทดสอบว่า buildPikadSessionFlex + config ทำงานถูกไหม (ไม่ส่งจริง)
 */
function diagnosePikadFlexBuild() {
  const out = [];
  out.push("🧪 ทดสอบสร้าง Flex (ไม่ส่งจริง)");
  try {
    const fakeStatus = {
      locId: "DIAG_TEST", hasCoord: true, hasPhoto: true, hasHouseNum: true,
      complete: true, lat: 14.805, lng: 100.614, houseNum: "123/1",
      address: "ทดสอบ", photoUrl: "https://test",
      expiresInSec: 120, expiresAt: "00:00:00", sessionMin: 3
    };
    const flex = buildPikadSessionFlex("house", fakeStatus);
    out.push("✅ สร้าง Flex สำเร็จ");
    out.push("   altText: " + flex.altText);
    out.push("   มี footer ปุ่ม: " + (flex.contents && flex.contents.footer ? "มี" : "ไม่มี"));
    out.push("");
    out.push("→ ถ้าตรงนี้ ✅ แปลว่าโค้ดสร้าง Flex ปกติ");
    out.push("   ปัญหาเงียบจึงอยู่ที่ reply token / config / trigger");
  } catch (e) {
    out.push("🔴 สร้าง Flex ไม่ได้: " + e.message);
    out.push("   → มี bug ใน buildPikadSessionFlex");
  }
  const report = out.join("\n");
  Logger.log(report);
  return report;
}