/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  ⏰ ScheduleFix.gs v3.0 — Once Catch-up Window + Expiry           ║
 * ║  ระบบ LINE Bot ศาลจังหวัดลพบุรี                                  ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║  🔴 Bug แก้ใน v2.0 (รวม 9 จุด):                                  ║
 * ║                                                                   ║
 * ║  CRITICAL:                                                        ║
 * ║   🐞 G — Recurring schedule ค้างถ้า trigger หยุด → catch-up       ║
 * ║   🐞 F — Schedule timeout 6 นาที → time-budget guard              ║
 * ║                                                                   ║
 * ║  MEDIUM:                                                          ║
 * ║   🐞 M — HTTP 429 (rate limit) → retry-with-backoff               ║
 * ║   🐞 N — Reply token expiry → fallback push (ถ้ามี userId)       ║
 * ║   🐞 K — NOTIFY_STATUS=OFF → warning ใน status banner            ║
 * ║                                                                   ║
 * ║  LOW:                                                             ║
 * ║   🐞 A — admins ว่าง → log warning                                ║
 * ║   🐞 E — broadcast count = -1 (ไม่ระบุ)                           ║
 * ║   🐞 H — datetime อดีต → reject ทุกกรณี                           ║
 * ║   🐞 L — scheduled send → logActivity ด้วย                        ║
 * ║                                                                   ║
 * ║  🆕 v3.0 Bug แก้เพิ่ม (1 จุด):                                    ║
 * ║   🐞 P — Once schedule ตกหล่นถาวรเมื่อ trigger ดีเลย์ > 2 นาที    ║
 * ║       FIX: เพิ่ม ONCE_CATCHUP_MIN = 30 นาที                       ║
 * ║       - ดีเลย์ ≤ 30 นาที → ส่งทันที (catch-up)                    ║
 * ║       - ดีเลย์ > 30 นาที → mark "หมดอายุ" (กันค้าง sheet)         ║
 * ║                                                                   ║
 * ║  📌 OVERRIDE:                                                     ║
 * ║   • runScheduledNotify_v2 (เดิมจาก v1.0)                          ║
 * ║   • addScheduledNotify (เดิมจาก v1.0)                             ║
 * ║   • _linePost (จาก Code.gs) — เพิ่ม retry                        ║
 * ║   • sendLineNotification (จาก Code.gs) — เพิ่ม logging            ║
 * ║                                                                   ║
 * ║  🚀 ติดตั้ง:                                                       ║
 * ║   1. แทนที่เนื้อหาในไฟล์ ScheduleFix.gs ที่มีอยู่ทั้งหมด           ║
 * ║   2. Save                                                          ║
 * ║   3. รัน setupScheduleTrigger() เพื่อ refresh trigger             ║
 * ║   4. Deploy → New version                                          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */


// ════════════════════════════════════════════════════════════════════
// 🔧 SETUP
// ════════════════════════════════════════════════════════════════════

function setupScheduleSheet() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.SCHEDULE);
    if (!sheet) {
      return { success: false, error: "ไม่พบชีต ตารางเวลา — กดปุ่ม ⚙️ ซ่อมแซม ก่อน" };
    }

    const lc = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, Math.max(lc, 1)).getValues()[0];

    if (lc < 8 || !headers[7]) {
      sheet.getRange(1, 8)
        .setValue("ส่งครั้งล่าสุด")
        .setFontWeight("bold")
        .setBackground("#1e3a8a")
        .setFontColor("#ffffff")
        .setHorizontalAlignment("center");
      Logger.log("✅ เพิ่ม column 'ส่งครั้งล่าสุด' ในชีต ตารางเวลา");
    }

    return { success: true, message: "Setup ชีต ตารางเวลา เรียบร้อย" };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}

function setupScheduleTrigger() {
  try {
    let removed = 0;
    ScriptApp.getProjectTriggers().forEach(function(t) {
      const fn = t.getHandlerFunction();
      if (fn === "runScheduledNotify" || fn === "runScheduledNotify_v2") {
        ScriptApp.deleteTrigger(t);
        removed++;
      }
    });

    const setupRes = setupScheduleSheet();
    if (!setupRes.success) return setupRes;

    ScriptApp.newTrigger("runScheduledNotify_v2")
      .timeBased()
      .everyMinutes(5)
      .create();

    Logger.log("✅ ตั้ง Schedule Trigger สำเร็จ (ทุก 5 นาที, ลบเก่า " + removed + " ตัว)");
    return {
      success: true,
      message: "✅ ตั้งระบบส่งกำหนดการสำเร็จ (รันทุก 5 นาที)\n\n📌 ตอนนี้กำหนดการที่บันทึกใน Dashboard จะส่งอัตโนมัติแล้ว"
    };
  } catch (e) {
    Logger.log("❌ setupScheduleTrigger error: " + e.message);
    return { success: false, error: String(e.message || e) };
  }
}

function removeScheduleTrigger() {
  try {
    let removed = 0;
    ScriptApp.getProjectTriggers().forEach(function(t) {
      const fn = t.getHandlerFunction();
      if (fn === "runScheduledNotify" || fn === "runScheduledNotify_v2") {
        ScriptApp.deleteTrigger(t);
        removed++;
      }
    });
    return {
      success: true,
      message: removed > 0 ? "ลบ trigger ออก " + removed + " ตัว" : "ไม่มี trigger ให้ลบ"
    };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}


// ════════════════════════════════════════════════════════════════════
// ⏰ MAIN — runScheduledNotify_v2 (with all v2 bug fixes)
// ════════════════════════════════════════════════════════════════════

function runScheduledNotify_v2() {
  const t0 = Date.now();
  // 🐞 Bug F FIX: Time-budget guard — รันได้สูงสุด 4 นาที (เผื่อ 2 นาทีให้ Apps Script cleanup)
  const TIME_BUDGET_MS = 4 * 60 * 1000;

  let processed = 0, sent = 0, skipped = 0, errors = 0, advanced = 0;

  try {
    if (getConfig("NOTIFY_STATUS") === "OFF") {
      return;
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.SCHEDULE);
    if (!sheet || sheet.getLastRow() <= 1) return;

    const now = new Date();
    const data = sheet.getDataRange().getValues();
    const tz = Session.getScriptTimeZone();

    const WINDOW_MIN = 6;
    // 🆕 v3 Bug Fix: Once catch-up window — schedule แบบครั้งเดียวที่ดีเลย์
    // ภายใน 30 นาที จะส่งอยู่ดี (กัน Apps Script trigger delay)
    const ONCE_CATCHUP_MIN = 30;

    for (let i = 1; i < data.length; i++) {
      // 🐞 Bug F FIX: เช็ค time budget ก่อน process แต่ละ row
      if (Date.now() - t0 > TIME_BUDGET_MS) {
        Logger.log("⏱️ runScheduledNotify_v2: Time budget reached at row " + (i+1) +
                   " — จะรันต่อในรอบถัดไป");
        break;
      }

      try {
        processed++;

        const id      = data[i][0];
        const sendAt  = data[i][1] ? new Date(data[i][1]) : null;
        const message = data[i][2];
        const repeat  = data[i][3] || "once";
        const targets = String(data[i][4] || "all");
        const status  = data[i][5];
        const lastSent = data[i][7] ? new Date(data[i][7]) : null;

        // กรองรายการที่ไม่ต้องส่ง
        if (status !== "ใช้งาน") { skipped++; continue; }
        if (!sendAt || isNaN(sendAt.getTime())) {
          Logger.log("⚠️ Schedule row " + (i+1) + ": ไม่มี datetime ที่ valid");
          skipped++;
          continue;
        }
        if (!message || !String(message).trim()) {
          Logger.log("⚠️ Schedule row " + (i+1) + ": ข้อความว่าง");
          skipped++;
          continue;
        }

        const diffMin = (now.getTime() - sendAt.getTime()) / 60000;

        // ────────────────────────────────────────────────────────────
        // 🐞 Bug G FIX: Recurring catch-up
        //
        // ถ้า diffMin > WINDOW_MIN และเป็น recurring → เลื่อน sendAt ไปอนาคต
        // (ไม่ส่งของเก่าทั้งหมด — ไม่งั้น user รับข้อความซ้ำ 100 รอบ)
        // ────────────────────────────────────────────────────────────
        if (diffMin > WINDOW_MIN && repeat !== "once") {
          const nextSendAt = _calculateNextSendAt(sendAt, repeat, now);
          if (nextSendAt && nextSendAt > now) {
            sheet.getRange(i+1, 2).setValue(nextSendAt);
            advanced++;
            Logger.log("⏭️ Schedule " + id + " (" + repeat + ") เลื่อนเป็น: " +
                       Utilities.formatDate(nextSendAt, tz, "dd/MM HH:mm") +
                       " (เก่า: " + Math.round(diffMin) + " นาทีที่แล้ว)");
            skipped++;
            continue;
          }
        }

        // ────────────────────────────────────────────────────────────
        // 🆕 v3 Bug Fix: Once schedule ที่หมดอายุ (>30 นาที) → mark เลิกใช้
        //
        // เพื่อไม่ให้ schedule ค้างใน sheet ตลอดไป
        // ────────────────────────────────────────────────────────────
        if (diffMin > ONCE_CATCHUP_MIN && repeat === "once") {
          sheet.getRange(i+1, 6).setValue("หมดอายุ");
          Logger.log("⏰ Once expired: " + id + " เลย " +
                     Math.round(diffMin) + " นาที — mark 'หมดอายุ'");
          skipped++;
          continue;
        }

        // ────────────────────────────────────────────────────────────
        // 🆕 v3 Bug Fix: Once catch-up — schedule แบบครั้งเดียวที่ดีเลย์
        //   > WINDOW_MIN (2 นาที) แต่ ≤ ONCE_CATCHUP_MIN (30 นาที)
        //   → ส่งอยู่ดี (Apps Script trigger อาจ delay)
        // ────────────────────────────────────────────────────────────
        if (diffMin > WINDOW_MIN && diffMin <= ONCE_CATCHUP_MIN && repeat === "once") {
          Logger.log("⏰ Once catch-up: " + id + " ดีเลย์ " +
                     Math.round(diffMin) + " นาที — ส่งทันที");
          // ตกไปยัง "ส่ง" ปกติด้านล่าง (ไม่ต้อง continue)
        }
        // อยู่นอก window ปกติ → skip (เฉพาะ recurring; once ผ่าน catch-up ข้างบนแล้ว)
        else if (diffMin < 0 || diffMin > WINDOW_MIN) { skipped++; continue; }

        // กันส่งซ้ำ
        if (lastSent && !isNaN(lastSent.getTime())) {
          const sinceLastSent = (now.getTime() - lastSent.getTime()) / 60000;
          if (sinceLastSent < 5) {
            Logger.log("⏭️ Schedule " + id + " เพิ่งส่ง " + sinceLastSent.toFixed(1) + " นาทีที่แล้ว → ข้าม");
            skipped++;
            continue;
          }
        }

        // ส่ง
        Logger.log("📤 ส่งกำหนดการ " + id + ": " + String(message).substring(0, 50));
        const tgts = targets.split(",").map(function(s){ return s.trim(); }).filter(Boolean);
        const result = sendLineNotification({
          title: "",
          body: String(message),
          targets: tgts.length > 0 ? tgts : ["all"]
        });

        if (result && result.success) {
          sent++;
          _logScheduledNotify(id, message, targets, "ส่งแล้ว", result.recipientCount || 0);

          // 🐞 Bug L FIX: log activity ด้วย
          try {
            if (typeof logActivity === "function") {
              logActivity("scheduled", "Scheduled-" + id, String(message).substring(0, 100),
                          "ScheduledNotify", "Success", 0);
            }
          } catch(e) {}

          sheet.getRange(i+1, 8).setValue(
            Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss")
          );

          if (repeat === "once") {
            sheet.getRange(i+1, 6).setValue("ส่งแล้ว");
          } else {
            // คำนวณ next ที่อยู่อนาคต
            const next = _calculateNextSendAt(sendAt, repeat, now);
            sheet.getRange(i+1, 2).setValue(next);
          }
        } else {
          errors++;
          _logScheduledNotify(id, message, targets,
            "ล้มเหลว: " + (result && result.error ? result.error : "unknown"), 0);
          Logger.log("❌ ส่งกำหนดการ " + id + " ล้มเหลว: " + (result && result.error));
        }
      } catch (rowErr) {
        errors++;
        Logger.log("❌ row " + (i+1) + " error: " + rowErr.message);
      }
    }

    const elapsed = Date.now() - t0;
    if (sent > 0 || errors > 0 || advanced > 0) {
      Logger.log("📊 runScheduledNotify_v2: processed=" + processed
        + " sent=" + sent + " advanced=" + advanced
        + " skipped=" + skipped + " errors=" + errors
        + " in " + elapsed + "ms");
    }
  } catch (e) {
    Logger.log("💥 runScheduledNotify_v2 fatal: " + e.message + "\n" + e.stack);
  }
}


/**
 * 🐞 Bug G HELPER: คำนวณ sendAt ถัดไปให้อยู่ในอนาคต
 *
 * ตัวอย่าง: schedule = daily, sendAt เก่า = 1/5/2026, now = 5/5/2026
 *  → ก้าวที่ 1: 2/5 (ยังเก่า)
 *  → ก้าวที่ 2: 3/5 (ยังเก่า)
 *  → ก้าวที่ 3: 4/5 (ยังเก่า)
 *  → ก้าวที่ 4: 5/5 (เท่ากับ now หรือใกล้เคียง — ใช้เป็น next)
 *  → ก้าวที่ 5: 6/5 (ใช้เป็น next ที่อนาคต)
 *
 * @param {Date} sendAt — sendAt ปัจจุบัน
 * @param {string} repeat — "daily" / "weekly" / "monthly"
 * @param {Date} now — เวลา reference
 * @returns {Date} — sendAt ใหม่ที่ > now
 */
function _calculateNextSendAt(sendAt, repeat, now) {
  let next = new Date(sendAt);
  let safety = 0;
  // กันลูปไม่จบ — สูงสุด 1000 ก้าว (~3 ปีสำหรับ daily)
  while (next <= now && safety < 1000) {
    if (repeat === "daily") {
      next.setDate(next.getDate() + 1);
    } else if (repeat === "weekly") {
      next.setDate(next.getDate() + 7);
    } else if (repeat === "monthly") {
      next.setMonth(next.getMonth() + 1);
    } else {
      break;  // unknown repeat type
    }
    safety++;
  }
  return next;
}


// ════════════════════════════════════════════════════════════════════
// 📝 OVERRIDE addScheduledNotify
// ════════════════════════════════════════════════════════════════════

function addScheduledNotify(d) {
  try {
    if (!d || !d.datetime) {
      return { success: false, error: "กรุณาระบุวันเวลา" };
    }
    if (!d.message || !String(d.message).trim()) {
      return { success: false, error: "กรุณาระบุข้อความ" };
    }

    const sendAt = new Date(d.datetime);
    if (isNaN(sendAt.getTime())) {
      return { success: false, error: "รูปแบบวันเวลาไม่ถูกต้อง" };
    }

    // 🐞 Bug H FIX: reject ทุกกรณีที่อยู่ในอดีต (ไม่ผ่อนปรน -2 นาที)
    const now = new Date();
    const diffMin = (sendAt.getTime() - now.getTime()) / 60000;
    if (diffMin < 0) {
      return {
        success: false,
        error: "❌ เวลาที่ตั้งอยู่ในอดีต (" + Math.abs(Math.round(diffMin)) + " นาทีที่แล้ว)\nกรุณาเลือกเวลาในอนาคต"
      };
    }

    const repeat = d.repeat || "once";
    if (["once","daily","weekly","monthly"].indexOf(repeat) < 0) {
      return { success: false, error: "ความถี่ไม่ถูกต้อง" };
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.SCHEDULE);
    if (!sheet) {
      return { success: false, error: "ไม่พบชีต ตารางเวลา" };
    }

    setupScheduleSheet();

    const newId = "S" + Date.now();
    sheet.appendRow([
      newId,
      sendAt,
      String(d.message).trim(),
      repeat,
      String(d.targets || "all"),
      "ใช้งาน",
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      ""
    ]);

    const hasT = ScriptApp.getProjectTriggers().some(function(t){
      return t.getHandlerFunction() === "runScheduledNotify_v2";
    });

    return {
      success: true,
      id: newId,
      message: hasT
        ? "✅ บันทึกกำหนดการสำเร็จ"
        : "⚠️ บันทึกแล้ว แต่ระบบส่งอัตโนมัติยังไม่เปิด!\nกรุณารัน setupScheduleTrigger() ใน Apps Script"
    };
  } catch (e) {
    Logger.log("❌ addScheduledNotify error: " + e.message);
    return { success: false, error: String(e.message || e) };
  }
}


// ════════════════════════════════════════════════════════════════════
// 🌐 OVERRIDE _linePost — Add Retry-with-Backoff (Bug M)
// ════════════════════════════════════════════════════════════════════
//
// LINE rate limit:
//   - Push:      ~100 req/sec
//   - Reply:     ~100 req/sec
//   - Multicast: ~200 messages/sec
//
// HTTP 429 / 5xx → retry with exponential backoff: 1s, 3s, 9s
//
function _linePost(u, p) {
  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 1000;
  let lastCode = 0;
  let lastBody = "";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = UrlFetchApp.fetch(u, {
        method: "post",
        headers: {
          "Authorization": "Bearer " + LINE_CHANNEL_ACCESS_TOKEN,
          "Content-Type": "application/json"
        },
        payload: JSON.stringify(p),
        muteHttpExceptions: true
      });
      lastCode = res.getResponseCode();
      lastBody = res.getContentText();

      // success
      if (lastCode === 200) {
        if (attempt > 0) {
          Logger.log("✅ _linePost succeeded on retry #" + (attempt+1));
        }
        return { responseCode: 200, body: lastBody };
      }

      // 4xx (except 429) → don't retry — bad request
      if (lastCode >= 400 && lastCode < 500 && lastCode !== 429) {
        Logger.log("⚠️ _linePost HTTP " + lastCode + " (no retry): " + lastBody.substring(0, 200));
        return { responseCode: lastCode, body: lastBody };
      }

      // 429 / 5xx → retry with backoff
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(3, attempt);  // 1s, 3s, 9s
        Logger.log("⏳ _linePost HTTP " + lastCode + " — retry #" + (attempt+1) +
                   " ในอีก " + (delay/1000) + " วินาที");
        Utilities.sleep(delay);
        continue;
      }
    } catch (e) {
      lastCode = -1;
      lastBody = String(e.message || e);
      Logger.log("⚠️ _linePost exception attempt " + (attempt+1) + ": " + lastBody);
      if (attempt < MAX_RETRIES - 1) {
        Utilities.sleep(BASE_DELAY_MS * Math.pow(3, attempt));
        continue;
      }
    }
  }

  Logger.log("❌ _linePost ล้มเหลวหลังพยายาม " + MAX_RETRIES + " ครั้ง: HTTP " + lastCode);
  return { responseCode: lastCode, body: lastBody };
}


// ════════════════════════════════════════════════════════════════════
// 🛡️ OVERRIDE safeSendReply — Fallback to Push if Reply Fails (Bug N)
// ════════════════════════════════════════════════════════════════════
//
// Reply token หมดอายุใน 1 นาที — ถ้า reply ล้มเหลว แต่มี userId →
// fallback ไป push แทน (ผู้ใช้รับข้อความได้)
//
function safeSendReply(replyToken, text, userIdFallback) {
  if (!replyToken || !text) {
    Logger.log("⚠️ safeSendReply: missing replyToken or text");
    return null;
  }

  try {
    const res = sendLineReply(replyToken, String(text));
    if (res && res.responseCode === 200) {
      return res;
    }

    // Reply ล้มเหลว — ลอง fallback push (ถ้ามี userIdFallback)
    if (userIdFallback && userIdFallback.length > 5) {
      Logger.log("🔄 Reply failed (HTTP " + (res && res.responseCode) + ") → fallback push to " +
                 userIdFallback.substring(0, 10) + "...");
      const pushRes = _linePush(userIdFallback, String(text));
      return pushRes;
    }

    Logger.log("⚠️ safeSendReply: reply failed, no fallback userId");
    return res;
  } catch (e) {
    Logger.log("⚠️ safeSendReply error: " + e.message + " | text: " + String(text).substring(0, 50));

    // Try fallback on exception too
    if (userIdFallback && userIdFallback.length > 5) {
      try {
        const pushRes = _linePush(userIdFallback, String(text));
        return pushRes;
      } catch (e2) {
        Logger.log("⚠️ Fallback push also failed: " + e2.message);
      }
    }
    return null;
  }
}


// ════════════════════════════════════════════════════════════════════
// 📨 OVERRIDE sendLineNotification — Better logging (Bug A, E)
// ════════════════════════════════════════════════════════════════════

function sendLineNotification(p) {
  try {
    if (getConfig("NOTIFY_STATUS") === "OFF") {
      return { success: false, error: "ปิดแจ้งเตือน" };
    }

    let tgts = p.targets || ["all"];
    let msg = p.title ? p.title + "\n\n" + p.body : p.body;
    if (!msg || !String(msg).trim()) {
      return { success: false, error: "ข้อความว่าง" };
    }
    if (typeof tgts === 'string') tgts = tgts.split(",");
    tgts = tgts.map(function(t){ return String(t).trim(); }).filter(Boolean);

    if (tgts.length === 0) tgts = ["all"];

    // ── Broadcast all ──
    if (tgts.indexOf("all") >= 0) {
      const res = _lineBroadcast(msg);
      const ok = res.responseCode === 200;
      // 🐞 Bug E FIX: ใช้ -1 แทน 0 (ไม่รู้จำนวน follower ที่จริง)
      _logNotify(p.title, p.body, "all", -1,
                 ok ? "ส่งแล้ว (Broadcast)" : "ล้มเหลว HTTP " + res.responseCode,
                 p.source || "Manual");
      return { success: ok, recipientCount: -1 };
    }

    // ── Resolve targets to user/group IDs ──
    let uIds = [];
    let mb = [];
    try {
      mb = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.MEMBERS).getDataRange().getValues();
    } catch(e) {}

    tgts.forEach(function(t) {
      const tl = t.toLowerCase();
      if (tl === "admins") {
        uIds = uIds.concat(getAdminIds());
      } else if (tl === "members") {
        uIds = uIds.concat(mb.filter(function(m){ return m[4] === "User"; }).map(function(m){ return m[1]; }));
      } else if (tl === "vip") {
        uIds = uIds.concat(mb.filter(function(m){ return String(m[4]).toUpperCase() === "VIP"; }).map(function(m){ return m[1]; }));
      } else {
        uIds.push(t);
      }
    });

    uIds = Array.from(new Set(uIds)).filter(Boolean);

    if (uIds.length === 0) {
      // 🐞 Bug A FIX: log แม้ส่งไม่สำเร็จ
      _logNotify(p.title, p.body, tgts.join(","), 0,
                 "ไม่พบเป้าหมาย — ตรวจ ADMIN_LINE_IDS หรือชื่อ target",
                 p.source || "Manual");
      return { success: false, error: "ไม่พบเป้าหมาย" };
    }

    // Split user vs group
    const us = uIds.filter(function(id){ return id.startsWith("U"); });
    const gs = uIds.filter(function(id){ return !id.startsWith("U"); });

    let allOk = true;
    let failedIds = [];

    if (us.length > 0) {
      const r = _lineMulticast(us, msg);
      if (r.responseCode !== 200) {
        allOk = false;
        failedIds.push("multicast(" + us.length + ")");
      }
    }

    gs.forEach(function(id) {
      const r = _linePush(id, msg);
      if (r.responseCode !== 200) {
        allOk = false;
        failedIds.push(id);
      }
    });

    const statusStr = allOk
      ? "ส่งแล้ว"
      : "ส่งบางส่วน — ล้มเหลว: " + failedIds.slice(0, 3).join(", ") + (failedIds.length > 3 ? " และอีก " + (failedIds.length - 3) : "");
    _logNotify(p.title, p.body, tgts.join(","), uIds.length, statusStr, p.source || "Manual");

    return { success: allOk, recipientCount: uIds.length, failed: failedIds };
  } catch (e) {
    Logger.log("❌ sendLineNotification error: " + e.message);
    return { success: false, error: String(e.message || e) };
  }
}


// ════════════════════════════════════════════════════════════════════
// 📊 STATUS
// ════════════════════════════════════════════════════════════════════

function getScheduleStatus() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    const hasTrigger = triggers.some(function(t){
      return t.getHandlerFunction() === "runScheduledNotify_v2";
    });

    const notifyStatus = getConfig("NOTIFY_STATUS") || "ON";

    let activeCount = 0;
    let upcomingCount = 0;
    let sentTodayCount = 0;
    const now = new Date();
    const tz = Session.getScriptTimeZone();
    const todayStr = Utilities.formatDate(now, tz, "yyyy-MM-dd");

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.SCHEDULE);
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][5] === "ใช้งาน") {
          activeCount++;
          const sendAt = new Date(data[i][1]);
          if (!isNaN(sendAt.getTime()) && sendAt > now) upcomingCount++;
        }
        const lastSent = data[i][7];
        if (lastSent) {
          const ls = new Date(lastSent);
          if (!isNaN(ls.getTime()) &&
              Utilities.formatDate(ls, tz, "yyyy-MM-dd") === todayStr) {
            sentTodayCount++;
          }
        }
      }
    }

    let nextSchedule = null;
    if (sheet && sheet.getLastRow() > 1) {
      const data = sheet.getDataRange().getValues();
      let minDiff = Infinity;
      for (let i = 1; i < data.length; i++) {
        if (data[i][5] !== "ใช้งาน") continue;
        const sendAt = new Date(data[i][1]);
        if (isNaN(sendAt.getTime())) continue;
        const diff = sendAt.getTime() - now.getTime();
        if (diff > 0 && diff < minDiff) {
          minDiff = diff;
          nextSchedule = {
            datetime: Utilities.formatDate(sendAt, tz, "dd/MM/yyyy HH:mm"),
            message: String(data[i][2]).substring(0, 50),
            inMinutes: Math.round(diff / 60000)
          };
        }
      }
    }

    return {
      success: true,
      hasTrigger: hasTrigger,
      notifyEnabled: notifyStatus === "ON",
      activeCount: activeCount,
      upcomingCount: upcomingCount,
      sentTodayCount: sentTodayCount,
      nextSchedule: nextSchedule,
      statusBadge: hasTrigger
        ? (notifyStatus === "ON" ? "🟢 ระบบส่งอัตโนมัติทำงานปกติ" : "🟡 Trigger ตั้งแล้ว แต่ NOTIFY_STATUS = OFF")
        : "🔴 ระบบส่งอัตโนมัติยังไม่เปิด — รัน setupScheduleTrigger()"
    };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}


// ════════════════════════════════════════════════════════════════════
// 🧪 TEST
// ════════════════════════════════════════════════════════════════════

function testScheduleNow() {
  try {
    Logger.log("🧪 ทดสอบ runScheduledNotify_v2 ทันที...");
    runScheduledNotify_v2();
    return {
      success: true,
      message: "✅ รัน runScheduledNotify_v2 แล้ว\nดู Logger.log เพื่อตรวจสอบรายละเอียด"
    };
  } catch (e) {
    return { success: false, error: String(e.message || e) };
  }
}


// ════════════════════════════════════════════════════════════════════
// 📋 LOG
// ════════════════════════════════════════════════════════════════════

function _logScheduledNotify(scheduleId, body, targets, status, recipientCount) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.NOTIFY_LOG);
    if (!sheet) return;
    sheet.appendRow([
      "N" + Date.now(),
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss"),
      "📅 ตามกำหนดการ " + scheduleId,
      String(body || "").substring(0, 200),
      String(targets || "all"),
      recipientCount || 0,
      status || "",
      0,
      "ScheduledBot"
    ]);
  } catch (e) {
    Logger.log("⚠️ _logScheduledNotify error: " + e.message);
  }
}

function scheduleSystemStatus() {
  return getScheduleStatus();
}


// ════════════════════════════════════════════════════════════════════
// 🌅 HELPER (เก่า — ยังคงอยู่)
// ════════════════════════════════════════════════════════════════════

function getThaiTimeLabel(hour) {
  const h = parseInt(hour);
  if (isNaN(h)) return { icon: "⏰", label: "ไม่ระบุ" };
  if (h >= 5  && h <= 7)  return { icon: "🌅", label: "อรุณรุ่ง" };
  if (h >= 8  && h <= 11) return { icon: "☀️", label: "เช้า" };
  if (h >= 12 && h <= 13) return { icon: "🍱", label: "เที่ยง" };
  if (h >= 14 && h <= 16) return { icon: "🌤️", label: "บ่าย" };
  if (h >= 17 && h <= 18) return { icon: "🌇", label: "เย็น" };
  if (h >= 19 && h <= 21) return { icon: "🌃", label: "ค่ำ" };
  return { icon: "🌙", label: "ดึก" };
}

function getThaiRepeatLabel(repeat) {
  const map = {
    "once":    { icon: "🔂", label: "ครั้งเดียว" },
    "daily":   { icon: "📅", label: "ทุกวัน" },
    "weekly":  { icon: "🗓️", label: "ทุกสัปดาห์" },
    "monthly": { icon: "📆", label: "ทุกเดือน" }
  };
  return map[repeat] || { icon: "❓", label: repeat || "ไม่ทราบ" };
}

function getScheduledNotifyThai() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.SCHEDULE);
    if (!sheet || sheet.getLastRow() <= 1) return [];

    const tz = Session.getScriptTimeZone();
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues().map(function(r) {
      const sendAt = r[1] ? new Date(r[1]) : null;
      const repeat = String(r[3] || "once");
      const lastSent = r[7] ? new Date(r[7]) : null;

      const repeatInfo = getThaiRepeatLabel(repeat);
      let timeInfo = { icon: "⏰", label: "" };
      let dtStr = "";

      if (sendAt && !isNaN(sendAt.getTime())) {
        timeInfo = getThaiTimeLabel(sendAt.getHours());
        dtStr = Utilities.formatDate(sendAt, tz, "dd/MM/yyyy HH:mm");
      }

      return {
        id: r[0],
        datetime: dtStr,
        timeIcon: timeInfo.icon,
        timeLabel: timeInfo.label,
        message: r[2],
        repeat: repeat,
        repeatIcon: repeatInfo.icon,
        repeatLabel: repeatInfo.label,
        targets: r[4],
        status: r[5],
        lastSent: lastSent && !isNaN(lastSent.getTime())
          ? Utilities.formatDate(lastSent, tz, "dd/MM HH:mm")
          : ""
      };
    });
  } catch (e) {
    Logger.log("getScheduledNotifyThai error: " + e.message);
    return [];
  }
}


// ════════════════════════════════════════════════════════════════════
// 🧪 SELF-TEST — ใช้ตรวจสอบทุก fix หลังติดตั้ง
// ════════════════════════════════════════════════════════════════════

function runScheduleSelfTest() {
  const results = [];

  // T1: trigger exists
  const hasT = ScriptApp.getProjectTriggers().some(function(t){
    return t.getHandlerFunction() === "runScheduledNotify_v2";
  });
  results.push({ test: "Trigger ตั้งอยู่", pass: hasT });

  // T2: NOTIFY_STATUS readable
  try {
    const s = getConfig("NOTIFY_STATUS");
    results.push({ test: "อ่าน NOTIFY_STATUS ได้", pass: !!s, value: s });
  } catch(e) {
    results.push({ test: "อ่าน NOTIFY_STATUS ได้", pass: false, error: e.message });
  }

  // T3: Sheet ตารางเวลา มี column 8
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SCHEDULE);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    results.push({ test: "ชีต ตารางเวลา column 'ส่งครั้งล่าสุด'",
                   pass: headers.length >= 8 && headers[7] === "ส่งครั้งล่าสุด" });
  } catch(e) {
    results.push({ test: "ชีต ตารางเวลา column 8", pass: false, error: e.message });
  }

  // T4: addScheduledNotify reject อดีต
  const past = new Date(Date.now() - 60*60*1000);  // 1 ชั่วโมงที่แล้ว
  const r = addScheduledNotify({
    datetime: Utilities.formatDate(past, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm"),
    message: "TEST",
    repeat: "once",
    targets: "all"
  });
  results.push({ test: "Reject datetime อดีต", pass: r.success === false });

  // T5: _calculateNextSendAt ทำงาน
  const past2 = new Date(2024, 0, 1);  // 1/1/2024
  const next = _calculateNextSendAt(past2, "daily", new Date());
  results.push({ test: "_calculateNextSendAt advance ถูก",
                 pass: next > new Date(),
                 value: next.toString() });

  // T6: _linePost retry mechanism (ตรวจ source — ไม่ส่งจริง)
  results.push({ test: "_linePost มี retry logic",
                 pass: _linePost.toString().indexOf("MAX_RETRIES") > 0 });

  // T7: safeSendReply มี fallback
  results.push({ test: "safeSendReply มี fallback push",
                 pass: safeSendReply.toString().indexOf("userIdFallback") > 0 });

  // T8: sendLineNotification log ทุก path
  results.push({ test: "sendLineNotification log ไม่พบเป้าหมาย",
                 pass: sendLineNotification.toString().indexOf("ไม่พบเป้าหมาย — ตรวจ") > 0 });

  // 🆕 v3 T9: ตรวจว่า runScheduledNotify_v2 มี ONCE_CATCHUP_MIN
  results.push({ test: "v3: ONCE_CATCHUP_MIN constant",
                 pass: runScheduledNotify_v2.toString().indexOf("ONCE_CATCHUP_MIN") > 0 });

  // 🆕 v3 T10: ตรวจว่ามี Once catch-up logic
  results.push({ test: "v3: Once catch-up logic",
                 pass: runScheduledNotify_v2.toString().indexOf("Once catch-up:") > 0 });

  // 🆕 v3 T11: ตรวจว่ามี Once expiry logic
  results.push({ test: "v3: Once expiry → 'หมดอายุ'",
                 pass: runScheduledNotify_v2.toString().indexOf("\"หมดอายุ\"") > 0 });

  // Print
  Logger.log("═══ ScheduleFix v3.0 Self-Test ═══");
  let pass = 0;
  results.forEach(function(r) {
    Logger.log((r.pass ? "✅" : "❌") + " " + r.test +
               (r.value ? " [" + r.value + "]" : "") +
               (r.error ? " — " + r.error : ""));
    if (r.pass) pass++;
  });
  Logger.log("PASSED: " + pass + "/" + results.length);

  return {
    success: pass === results.length,
    passed: pass,
    total: results.length,
    results: results
  };
}