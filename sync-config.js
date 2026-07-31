// ใส่ URL ของ Google Apps Script Web App หลัง deploy หากต้องการซิงก์ข้ามเครื่อง
// ตัวอย่าง: window.DRAW_REMOTE_SYNC_URL = "https://script.google.com/macros/s/DEPLOYMENT_ID/exec";
window.DRAW_REMOTE_SYNC_URL = "https://script.google.com/macros/s/AKfycbw0K_tqGZVoRINVOclJCs28YEtBTGoWyw_NA1FZE5rEEIgE0evgMNH29bmjS49m8gDGVA/exec";

/*
 * Rapee69 UI hotfix v1.9.10
 * - แยกชื่อหน้า 4, 5 และ 6 ให้ชัดเจน
 * - เพิ่มตัวเลือกบันทึก PNG สำหรับตารางคะแนนสาย A / Play-off สาย B
 * - แก้หน้า summary ที่มี return ซ้ำใน display.js โดยไม่แก้ไฟล์ระบบหลัก
 * - คงระบบ Firebase, Apps Script, QR, วิดีโอ และ File System Access API เดิมทั้งหมด
 */
(() => {
  "use strict";

  const STAGE_LABELS = {
    intro: "หน้าต้อนรับ",
    format: "รูปแบบการแข่งขัน",
    draw: "จับฉลาก",
    official: "ผลแบ่งสาย A–B",
    summary: "ตารางคะแนน A / Play-off B",
    schedule: "ตารางแข่งขัน"
  };

  const MOBILE_LABELS = {
    intro: "ต้อนรับ",
    format: "รูปแบบ",
    draw: "จับฉลาก",
    official: "ผลแบ่งสาย",
    summary: "คะแนน / Play-off",
    schedule: "ตารางแข่ง"
  };

  let hotfixState = null;
  let displayObserver = null;
  let applyingSummary = false;

  function newerState(next) {
    if (!next || !Array.isArray(next.confirmed)) return false;
    const nextTime = Date.parse(next.updatedAt || "");
    const currentTime = Date.parse(hotfixState?.updatedAt || "");
    if (Number.isFinite(nextTime) && Number.isFinite(currentTime) && nextTime < currentTime) return false;
    return true;
  }

  function absorbState(next) {
    const A = window.DrawApp;
    if (!A || !newerState(next)) return;
    hotfixState = A.normalizeState ? A.normalizeState(next) : next;
  }

  function currentState() {
    const A = window.DrawApp;
    if (!A) return null;
    try {
      const local = A.loadState?.();
      if (newerState(local)) absorbState(local);
    } catch {
      // ใช้สถานะล่าสุดที่รับจาก Firebase / Apps Script / BroadcastChannel
    }
    return hotfixState;
  }

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function patchStageButtons() {
    const mobile = document.body.classList.contains("mobile-page");
    const labels = mobile ? MOBILE_LABELS : STAGE_LABELS;

    document.querySelectorAll("[data-stage]").forEach(button => {
      const stage = button.dataset.stage;
      const label = labels[stage];
      if (!label) return;
      const span = button.querySelector("span");
      if (span) setText(span, label);
    });
  }

  function patchStageStatus() {
    const state = currentState();
    const stage = state?.stage || "intro";
    setText(document.getElementById("liveStageName"), STAGE_LABELS[stage] || STAGE_LABELS.intro);
    setText(document.getElementById("mobileStageName"), STAGE_LABELS[stage] || STAGE_LABELS.intro);
  }

  function patchCaptureOptions() {
    const select = document.getElementById("captureStageSelect");
    if (!select) return;

    let official = select.querySelector('option[value="official"]');
    let summary = select.querySelector('option[value="summary"]');
    let schedule = select.querySelector('option[value="schedule"]');

    if (official) official.textContent = "ผลแบ่งสาย A–B";
    if (!summary) {
      summary = document.createElement("option");
      summary.value = "summary";
      if (schedule) select.insertBefore(summary, schedule);
      else select.append(summary);
    }
    summary.textContent = "ตารางคะแนนสาย A / Play-off สาย B";
    if (schedule) schedule.textContent = "ตารางแข่งขันครบ 10 นัด";
  }


  function patchReferenceDownloads() {
    const captureSelect = document.getElementById("captureStageSelect");
    if (!captureSelect || document.getElementById("referenceImageDownloads")) return;

    const panelBody = captureSelect.closest(".panel-body");
    if (!panelBody) return;

    const block = document.createElement("details");
    block.id = "referenceImageDownloads";
    block.open = true;
    block.style.cssText = [
      "margin-top:16px",
      "border:1px solid rgba(14,44,92,.18)",
      "border-radius:16px",
      "background:#f8fbff",
      "padding:12px 14px"
    ].join(";");

    block.innerHTML = `
      <summary style="cursor:pointer;font-weight:800;color:#10264f">
        ภาพประกอบสำหรับดาวน์โหลด (2 รูป)
      </summary>
      <p style="margin:8px 0 12px;color:#5f6b7d">
        ใช้สำหรับส่งในกลุ่ม LINE พิมพ์ประกาศ หรือเปิดประกอบการชี้แจงรูปแบบการแข่งขัน
      </p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
        <article style="background:#fff;border:1px solid #dfe7f3;border-radius:14px;padding:10px">
          <img
            src="assets/competition-format-a-b.jpg"
            alt="รูปแบบการแข่งขันสาย A และสาย B"
            loading="lazy"
            style="display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;border:1px solid #e3e8ef"
          />
          <h3 style="margin:10px 0 8px;font-size:18px">รูปแบบการแข่งขัน สาย A และสาย B</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn" href="assets/competition-format-a-b.jpg" target="_blank" rel="noopener">เปิดดู</a>
            <a
              class="btn primary"
              href="assets/competition-format-a-b.jpg"
              download="รูปแบบการแข่งขัน_สายA_สายB.jpg"
            >⬇ ดาวน์โหลดรูป</a>
          </div>
        </article>

        <article style="background:#fff;border:1px solid #dfe7f3;border-radius:14px;padding:10px">
          <img
            src="assets/competition-schedule-7-teams.jpg"
            alt="ตารางการแข่งขันฟุตบอล 7 คน"
            loading="lazy"
            style="display:block;width:100%;aspect-ratio:16/11;object-fit:cover;object-position:top;border-radius:10px;border:1px solid #e3e8ef"
          />
          <h3 style="margin:10px 0 8px;font-size:18px">ตารางการแข่งขันฟุตบอล 7 คน</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn" href="assets/competition-schedule-7-teams.jpg" target="_blank" rel="noopener">เปิดดู</a>
            <a
              class="btn primary"
              href="assets/competition-schedule-7-teams.jpg"
              download="ตารางการแข่งขันฟุตบอล_7_คน.jpg"
            >⬇ ดาวน์โหลดรูป</a>
          </div>
        </article>
      </div>
    `;

    panelBody.appendChild(block);
  }

  function matchBox(title, main, time) {
    return `<div class="match-box">
      <div class="match-title">${title}</div>
      <div class="match-main">${main}</div>
      <div class="match-time">${time}</div>
    </div>`;
  }

  function buildScoreRows(A, state) {
    return A.buildGroupATableRows(state).map(row => `
      <tr>
        <td>${row.pos}</td>
        <td class="team-col">${A.escapeHtml(row.team)}</td>
        <td>${row.played}</td><td>${row.win}</td><td>${row.draw}</td><td>${row.lose}</td>
        <td>${row.gf}</td><td>${row.ga}</td><td>${row.gd}</td><td>${row.pts}</td>
      </tr>
    `).join("");
  }

  function buildSummaryMarkup(A, state) {
    const n = position => A.getResolvedName(state, position);
    const complete = state.confirmed.length === A.POSITIONS.length;

    return `
      <section class="slide">
        <div class="slide-inner summary-slide is-hotfix-summary">
          <header class="official-header">
            <div>
              <div class="official-kicker">รูปแบบการแข่งขันหลังแบ่งสาย</div>
              <h1>ตารางคะแนนสาย A และผัง Play-off สาย B</h1>
              <p>${complete ? "จับฉลากครบ 7 ทีมแล้ว" : `ดำเนินการแล้ว ${state.confirmed.length} จาก 7 ทีม`}</p>
            </div>
            <span class="official-status ${complete ? "review" : "progress"}">${complete ? "พร้อมใช้งาน" : "กำลังจับฉลาก"}</span>
          </header>

          <div class="summary-grid-advanced">
            <section class="summary-card a">
              <h2>สาย A — ตารางคะแนนรวม</h2>
              <div class="summary-card-body">
                <table class="score-table">
                  <thead>
                    <tr>
                      <th>รหัส</th><th>ทีม</th><th>แข่ง</th><th>ชนะ</th><th>เสมอ</th><th>แพ้</th>
                      <th>ได้</th><th>เสีย</th><th>+/-</th><th>แต้ม</th>
                    </tr>
                  </thead>
                  <tbody>${buildScoreRows(A, state)}</tbody>
                </table>
                <div class="rules-note">
                  <strong>หลักเกณฑ์จัดอันดับสาย A</strong><br>
                  ชนะ 3 คะแนน · เสมอ 1 คะแนน · แพ้ 0 คะแนน<br>
                  เรียงลำดับ: คะแนน → ผลต่างประตูได้เสีย → ประตูได้ → ผลการแข่งขันระหว่างกัน
                  → ใบแดง/ใบเหลืองน้อยกว่า → จับสลาก
                </div>
              </div>
            </section>

            <section class="summary-card b">
              <h2>สาย B — Play-off 4 ทีม</h2>
              <div class="summary-card-body">
                <div class="playoff-layout">
                  <div class="playoff-column">
                    ${matchBox("แมตช์ที่ 1", `${n("B1")}<br>พบ<br>${n("B2")}`, "เวลา 18.25–18.45 น.")}
                    ${matchBox("แมตช์ที่ 2", `${n("B3")}<br>พบ<br>${n("B4")}`, "เวลา 18.50–19.10 น.")}
                  </div>

                  <div class="playoff-column">
                    <div>
                      <div class="arrow-note">ผู้ชนะ M1 / ผู้ชนะ M2</div>
                      ${matchBox("แมตช์ที่ 3", "ผู้ชนะ แมตช์ที่ 1<br>พบ<br>ผู้ชนะ แมตช์ที่ 2", "เวลา 19.40–20.00 น.")}
                    </div>
                    <div>
                      <div class="arrow-note lose">ผู้แพ้ M1 / ผู้แพ้ M2</div>
                      ${matchBox("แมตช์ที่ 4", "ผู้แพ้ แมตช์ที่ 1<br>พบ<br>ผู้แพ้ แมตช์ที่ 2", "เวลา 20.05–20.25 น.")}
                    </div>
                    <div>
                      <div class="arrow-note">ผู้แพ้ M3 / ผู้ชนะ M4</div>
                      ${matchBox("แมตช์ที่ 5", "ผู้แพ้ แมตช์ที่ 3<br>พบ<br>ผู้ชนะ แมตช์ที่ 4", "เวลา 20.55–21.15 น.")}
                    </div>
                  </div>

                  <div class="playoff-column">
                    <div class="result-box green">
                      <div class="big">อันดับ 1 สาย B</div>
                      <div class="small">ผู้ชนะ แมตช์ที่ 3</div>
                    </div>
                    <div class="result-box red">
                      <div class="big">ตกรอบ</div>
                      <div class="small">ผู้แพ้ แมตช์ที่ 4<br>(แพ้ครบ 2 นัด)</div>
                    </div>
                    <div class="result-box green">
                      <div class="big">อันดับ 2 สาย B</div>
                      <div class="small">ผู้ชนะ แมตช์ที่ 5</div>
                    </div>
                    <div class="result-box red">
                      <div class="big">ตกรอบ</div>
                      <div class="small">ผู้แพ้ แมตช์ที่ 5</div>
                    </div>
                  </div>
                </div>

                <div class="semi-grid">
                  <div class="semi-box">
                    <h3>รอบรองชนะเลิศ คู่ที่ 1</h3>
                    <div class="pair">อันดับ 1 สาย B พบ อันดับ 2 สาย A</div>
                    <div class="time">เวลา 21.20–21.40 น.</div>
                  </div>
                  <div class="semi-box">
                    <h3>รอบรองชนะเลิศ คู่ที่ 2</h3>
                    <div class="pair">อันดับ 1 สาย A พบ อันดับ 2 สาย B</div>
                    <div class="time">เวลา 21.45–22.05 น.</div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div class="last-result-bar" style="margin-top:12px">
            ${state.locked
              ? '<div class="lock-badge">🔒 ยืนยันและล็อกผลแล้ว</div>'
              : `<div class="last-result-label">สถานะ</div>
                 <div class="last-result-team">${A.escapeHtml(state.lastAction || "พร้อมเริ่มการจับฉลาก")}</div>`}
          </div>
        </div>
      </section>`;
  }

  function stageIsSummary(displayMain, state) {
    const forcedStage = new URLSearchParams(location.search).get("stage");
    // When a capture/print window explicitly requests a stage, that stage
    // must take precedence over the live state. This prevents official or
    // schedule PNG exports from being replaced by the summary page.
    if (forcedStage) return forcedStage === "summary";
    return state?.stage === "summary"
      || Boolean(displayMain.querySelector(".group-summary-slide"));
  }

  function patchDisplaySummary() {
    const A = window.DrawApp;
    const displayMain = document.getElementById("displayMain");
    if (!A || !displayMain || applyingSummary) return;

    const state = currentState();
    if (!state || !stageIsSummary(displayMain, state)) return;
    if (displayMain.querySelector(".is-hotfix-summary")) return;

    applyingSummary = true;
    displayMain.innerHTML = buildSummaryMarkup(A, state);
    applyingSummary = false;
  }

  function applyAll() {
    patchStageButtons();
    patchCaptureOptions();
    patchReferenceDownloads();
    patchStageStatus();
    patchDisplaySummary();
  }

  function startHotfix() {
    const A = window.DrawApp;
    if (!A) {
      setTimeout(startHotfix, 50);
      return;
    }

    absorbState(A.loadState?.());

    window.addEventListener("draw-firebase-state", event => {
      absorbState(event.detail?.state);
      queueMicrotask(applyAll);
    });
    window.addEventListener("draw-remote-state", event => {
      absorbState(event.detail?.state);
      queueMicrotask(applyAll);
    });
    window.addEventListener("storage", event => {
      if (event.key === A.STORAGE_KEY) {
        absorbState(A.loadState?.());
        queueMicrotask(applyAll);
      }
    });

    if (window.drawChannel) {
      window.drawChannel.addEventListener("message", event => {
        if (event.data?.state) {
          absorbState(event.data.state);
          queueMicrotask(applyAll);
        }
      });
    }

    const displayMain = document.getElementById("displayMain");
    if (displayMain) {
      displayObserver = new MutationObserver(() => queueMicrotask(patchDisplaySummary));
      displayObserver.observe(displayMain, { childList: true });
    }

    ["liveStageName", "mobileStageName"].forEach(id => {
      const node = document.getElementById(id);
      if (!node) return;
      const observer = new MutationObserver(() => queueMicrotask(patchStageStatus));
      observer.observe(node, { childList: true, subtree: true, characterData: true });
    });

    applyAll();
    setInterval(() => {
      absorbState(A.loadState?.());
      applyAll();
    }, 600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startHotfix, { once: true });
  } else {
    startHotfix();
  }
})();
