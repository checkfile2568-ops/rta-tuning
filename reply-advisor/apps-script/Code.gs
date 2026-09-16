/**
 * Reply Advisor Central API v4.1
 * Read-only JSON/JSONP endpoint for GitHub Pages.
 * ฐานข้อมูล: Google Sheet กลาง ศาลจังหวัดลพบุรี
 */
const SPREADSHEET_ID = '1opbSrWYL18uAdVwxTlm2UDKw-ofCPPMvpwtPjTIGC38';
const CACHE_SECONDS = 300;

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = String(p.action || 'health').toLowerCase();
  let payload;
  try {
    if (action === 'db') payload = getDatabase_();
    else payload = { ok: true, service: 'reply-advisor-central', version: '4.1.0', time: new Date().toISOString() };
  } catch (err) {
    payload = { ok: false, error: String(err && err.message || err), time: new Date().toISOString() };
  }
  return output_(payload, p.callback);
}

function getDatabase_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('reply_db_v41');
  if (hit) return JSON.parse(hit);

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const config = objectFromKeyValue_(sheetRows_(ss, 'Config'));
  const contactsRows = rowsToObjects_(sheetRows_(ss, 'Contacts'));
  const quickRows = rowsToObjects_(sheetRows_(ss, 'QuickReplies'));
  const packRows = rowsToObjects_(sheetRows_(ss, 'AnswerPacks'));

  const contacts = {};
  contactsRows.filter(r => truthy_(r.active)).forEach(r => {
    contacts[String(r.id)] = { name: String(r.name || ''), phone: String(r.phone || ''), text: nl_(r.text) };
  });

  const quickReplies = quickRows.filter(r => truthy_(r.active)).map(r => ({
    id: String(r.id || ''), label: String(r.label || ''), text: nl_(r.text)
  }));

  const answerPacks = packRows.filter(r => truthy_(r.active)).map(r => {
    const attachment = r.attachment_type ? {
      type: String(r.attachment_type || ''),
      src: String(r.attachment_src || ''),
      title: String(r.attachment_title || ''),
      lead: nl_(r.attachment_lead)
    } : null;
    return {
      id: String(r.id || ''),
      category: String(r.category || ''),
      title: String(r.title || ''),
      intent: String(r.intent || ''),
      risk: String(r.risk || 'LOW'),
      priority: Number(r.priority || 0),
      active: true,
      keywords: json_(r.keywords_json, []),
      examples: json_(r.examples_json, []),
      responses: {
        short: nl_(r.response_short),
        normal: nl_(r.response_normal),
        detailed: nl_(r.response_detailed)
      },
      advisor: json_(r.advisor_json, []),
      askMore: json_(r.ask_more_json, []),
      attachment: attachment,
      contactRefs: json_(r.contact_refs_json, []),
      quickReplyIds: json_(r.quick_reply_ids_json, [])
    };
  });

  const db = {
    ok: true,
    version: String(config.version || '4.1.0'),
    updatedAt: String(config.updatedAt || new Date().toISOString()),
    title: String(config.title || 'ผู้ช่วยตอบประชาชน · ศาลจังหวัดลพบุรี'),
    contacts,
    quickReplies,
    answerPacks
  };

  cache.put('reply_db_v41', JSON.stringify(db), CACHE_SECONDS);
  return db;
}

function sheetRows_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error('ไม่พบชีต ' + name);
  return sh.getDataRange().getDisplayValues();
}

function rowsToObjects_(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(x => String(x).trim());
  return rows.slice(1).filter(r => r.some(v => String(v).trim() !== '')).map(row => {
    const o = {};
    headers.forEach((h, i) => o[h] = row[i]);
    return o;
  });
}

function objectFromKeyValue_(rows) {
  const out = {};
  (rows || []).slice(1).forEach(r => {
    const k = String(r[0] || '').trim();
    if (k) out[k] = r[1];
  });
  return out;
}

function truthy_(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return !['', 'FALSE', '0', 'NO', 'OFF'].includes(s);
}

function json_(v, fallback) {
  try { return JSON.parse(String(v || '')); } catch (e) { return fallback; }
}

function nl_(v) {
  return String(v == null ? '' : v).replace(/\\n/g, '\n');
}

function output_(obj, callback) {
  const json = JSON.stringify(obj);
  const cb = String(callback || '').trim();
  if (cb && /^[A-Za-z_$][0-9A-Za-z_$\.]{0,100}$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function clearReplyAdvisorCache() {
  CacheService.getScriptCache().remove('reply_db_v41');
}
