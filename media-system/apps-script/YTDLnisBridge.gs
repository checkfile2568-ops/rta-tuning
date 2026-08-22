/**
 * MMs YTDLnis handoff bridge.
 *
 * Deploy this code in a NEW Apps Script project. It deliberately does not
 * modify the legacy media Apps Script deployment.
 *
 * Script properties required:
 * - MEDIA_JOBS_SPREADSHEET_ID : Google Sheet ID used for the MediaJobs log
 * - YTDLNIS_ALLOWED_EMAILS    : comma-separated Google accounts allowed to use it
 */
const YTDLNIS_SHEET_NAME = 'MediaJobs';
const YTDLNIS_ALLOWED_RETURN_ORIGINS = ['https://checkfile2568-ops.github.io'];

function doGet(e) {
  try {
    const job = createYtdlnisJob_(e && e.parameter || {});
    return HtmlService.createHtmlOutput(renderHandoffPage_(job))
      .setTitle('MMs Android Download')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
  } catch (error) {
    return HtmlService.createHtmlOutput(renderErrorPage_(error))
      .setTitle('MMs Android Download')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DENY);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const job = createYtdlnisJob_(body);
    return ContentService.createTextOutput(JSON.stringify({ ok: true, job: job }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(error.message || error) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function createYtdlnisJob_(request) {
  const email = requireAllowedUser_();
  const sourceUrl = normalizeYouTubeUrl_(request.url);
  const type = request.type === 'audio' ? 'audio' : 'video';
  const returnUrl = allowedReturnUrl_(request.return_url);
  const job = {
    id: Utilities.getUuid(),
    requested_at: new Date(),
    requested_by: email,
    source_url: sourceUrl,
    media_type: type,
    status: 'handoff_opened',
    note: 'YTDLnis was opened locally; this status does not prove a download completed.',
    return_url: returnUrl
  };
  appendYtdlnisJob_(job);
  return job;
}

function requireAllowedUser_() {
  const props = PropertiesService.getScriptProperties();
  const allowed = String(props.getProperty('YTDLNIS_ALLOWED_EMAILS') || '')
    .split(',')
    .map(function(value) { return value.trim().toLowerCase(); })
    .filter(Boolean);
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!allowed.length) throw new Error('ผู้ดูแลยังไม่ได้ตั้งค่า YTDLNIS_ALLOWED_EMAILS');
  if (!email || allowed.indexOf(email) === -1) throw new Error('บัญชีนี้ไม่มีสิทธิ์ใช้ MMs Android Download');
  return email;
}

function normalizeYouTubeUrl_(value) {
  const raw = String(value || '').trim();
  if (!/^https?:\/\//i.test(raw)) throw new Error('ลิงก์ YouTube ไม่ถูกต้อง');
  const match = raw.match(/^https?:\/\/([^\/?#]+)/i);
  const host = match ? match[1].toLowerCase().replace(/^www\./, '') : '';
  const accepted = host === 'youtube.com' || /\.youtube\.com$/.test(host) || host === 'youtu.be' || host === 'youtube-nocookie.com' || /\.youtube-nocookie\.com$/.test(host);
  if (!accepted) throw new Error('รับเฉพาะลิงก์ YouTube');
  return raw;
}

function allowedReturnUrl_(value) {
  const fallback = YTDLNIS_ALLOWED_RETURN_ORIGINS[0] + '/rta-tuning/media.html#menus';
  const raw = String(value || fallback);
  const match = raw.match(/^(https?:\/\/[^\/?#]+)/i);
  const origin = match ? match[1].replace(/\/$/, '') : '';
  if (YTDLNIS_ALLOWED_RETURN_ORIGINS.indexOf(origin) === -1) return fallback;
  return raw;
}

function appendYtdlnisJob_(job) {
  const id = PropertiesService.getScriptProperties().getProperty('MEDIA_JOBS_SPREADSHEET_ID');
  if (!id) throw new Error('ผู้ดูแลยังไม่ได้ตั้งค่า MEDIA_JOBS_SPREADSHEET_ID');
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const book = SpreadsheetApp.openById(id);
    const sheet = book.getSheetByName(YTDLNIS_SHEET_NAME) || book.insertSheet(YTDLNIS_SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['job_id', 'requested_at', 'requested_by', 'source_url', 'media_type', 'status', 'note']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([job.id, job.requested_at, job.requested_by, job.source_url, job.media_type, job.status, job.note]);
  } finally {
    lock.releaseLock();
  }
}

function renderHandoffPage_(job) {
  const data = safeJson_({ id: job.id, url: job.source_url, type: job.media_type, returnUrl: job.return_url });
  return '<!doctype html><html><head><base target="_top"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MMs Android Download</title><style>body{font-family:Arial,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f7fbff;color:#17223c}.card{width:min(480px,90vw);background:#fff;border:1px solid #dbe5f1;border-radius:22px;padding:24px;box-shadow:0 16px 44px rgba(65,91,137,.12)}button,a{display:inline-block;padding:11px 14px;border-radius:10px;border:1px solid #b7cef0;background:#fff;color:#285993;font-weight:700;text-decoration:none;font-size:15px}button.primary{border:0;background:linear-gradient(90deg,#3d98ff,#8c68ff,#ed60c0);color:#fff}.hint{font-size:13px;color:#60708b;line-height:1.5}.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}</style></head><body><main class="card"><h1>บันทึกคำขอแล้ว</h1><p class="hint">เลขอ้างอิง: <b id="job"></b><br>สถานะนี้หมายถึงระบบส่งต่อไปยัง YTDLnis แล้ว ไม่ได้ยืนยันว่าดาวน์โหลดเสร็จ</p><div class="row"><button class="primary" onclick="openApp()">เปิด YTDLnis</button><a id="back">กลับ MMs</a></div><p id="message" class="hint"></p></main><script>const J=' + data + ';document.getElementById("job").textContent=J.id;document.getElementById("back").href=J.returnUrl;function openApp(){if(!/android/i.test(navigator.userAgent)){document.getElementById("message").textContent="โปรดเปิดหน้านี้บน Android เพื่อส่งต่อไป YTDLnis";return}document.getElementById("message").textContent="กำลังเปิด YTDLnis…";location.href="intent:#Intent;action=android.intent.action.SEND;type=text/plain;package=com.deniscerri.ytdl;S.android.intent.extra.TEXT="+encodeURIComponent(J.url)+";S.TYPE="+encodeURIComponent(J.type)+";S.BACKGROUND=false;end"}</script></body></html>';
}

function renderErrorPage_(error) {
  const message = escapeHtml_(String(error && error.message || error || 'ไม่สามารถสร้างคำขอได้'));
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>MMs Android Download</title><style>body{font-family:Arial,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#f7fbff;color:#17223c}.card{width:min(480px,90vw);background:#fff;border:1px solid #f0c1cd;border-radius:22px;padding:24px}.hint{color:#68758d;line-height:1.5}</style></head><body><main class="card"><h1>ยังส่งต่อไม่ได้</h1><p class="hint">' + message + '</p></main></body></html>';
}

function safeJson_(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, function(char) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
  });
}
