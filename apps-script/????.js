/**
 * ?????????????????? - Google Apps Script
 * v3.0 - ????????????????:
 *   ? ??????????????? "?????????" (1 2 3) ? ????????? .docx ????????? "??????" (? ? ?)
 *   ? ????????????????????????? (??? 2/3 ???????????????????????? ? ???????????)
 *   ? ??????????????????????????????????? (??????????????? + ??????????)
 *   ? ???????????: ?????????? / ????????? (?????????????????????) ???????
 *
 * ??????????: ?????????????????????????? ? ?????????????????????? "???????????"
 */

// ========== Configuration ==========
const TEMPLATE_ID = "1AdtxPQP8iGX9Lp7V_PnpbR4oLSq0nmszm_jxzhxW_hE"; // ???????????????? (????? vs ?????)

// ? v3.1: ????????????????? (?E = ??????????) ? ???????? "???????"
const ESTATE_TEMPLATE_ID = "1GFwFJebyYbaiWyyxK95ok2dmPiur3NvnGJPTd8518MA";

// ?????? "???????" ???????????????????? ? ?????????????????????????
// ?? ????? "?E" ???????? (??E / ??E / ??E = ???????????????)
const ESTATE_PREFIXES = ["?E"];

const MAIN_FOLDER_NAME = "?????????"; // ????????????????

// ????? Google Sheet ???????? (?????????? "???? Sheet" ??? auto-fill)
const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1IPQ14iDBGIksCezdqC78r0uYB3MJ1K2NetvO1i3ENZ4/edit?gid=0#gid=0";

// ????????????????????????????????????
const CENTER_REPORT_TEMPLATE_ID = "1frZtaYfHVyAQXIsbt9wz-gF2-thLOs0vlaGdGtjcSw4";
const CENTER_REPORT_FOLDER_NAME = "?????????????????????????????????";
const CENTER_REPORT_PROP_PREFIX = "CENTER_MONTHLY_REPORT_";
const CENTER_REPORT_EVIDENCE_FOLDER_NAME = "????????????????????????????????";
const CENTER_REPORT_MAX_PHOTOS = 12;
const CENTER_REPORT_MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const CENTER_REPORT_MAX_DAYS = 31;
const CENTER_REPORT_MONTHS = [
  "??????", "??????????", "??????", "??????", "???????", "????????",
  "???????", "???????", "???????", "??????", "?????????", "???????"
];

// ?????????????????
const PROP_TOTAL_IMPORTED = "TOTAL_IMPORTED"; // ???????????????????????????
const PROP_TOTAL_CREATED  = "TOTAL_CREATED";  // ??????????????????? (??????????) ????
const PROP_LAST_RUN       = "LAST_RUN";
const PRINT_SETTINGS_PROPERTY = "HTML_PRINT_SETTINGS_V1";
const LAWYER_SEARCH_SHEET_NAME = "?????????";
const LAWYER_SEARCH_HEADERS = ["????", "????????", "????????"];
const LAWYER_SYNC_TARGET_SHEET_URL = "https://docs.google.com/spreadsheets/d/1JWIcKZVC2-p0Do7kozAMd3Hjyg3nww-rUpB00u7wEFQ/edit?gid=702586898#gid=702586898";
const LAWYER_SYNC_TRIGGER_HANDLER = "lawyerAutoSyncOnChange";

// ========== Main ==========

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('legal-doc-system')
    .setTitle('??????????????????????????????????')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** URL ??????? (template) ????????? */
function getTemplateUrl() {
  try {
    const file = DriveApp.getFileById(TEMPLATE_ID);
    return { url: file.getUrl(), name: file.getName() };
  } catch (error) {
    throw new Error("??????????????????????????: " + error.message);
  }
}

/** ? v3.1: URL ????????????????? (?E) */
function getEstateTemplateUrl() {
  try {
    if (!ESTATE_TEMPLATE_ID || ESTATE_TEMPLATE_ID === "PUT_ESTATE_TEMPLATE_ID_HERE") {
      throw new Error("???????????????? ESTATE_TEMPLATE_ID");
    }
    const file = DriveApp.getFileById(ESTATE_TEMPLATE_ID);
    return { url: file.getUrl(), name: file.getName() };
  } catch (error) {
    throw new Error("????????????????????????????????????: " + error.message);
  }
}

/** URL Google Sheet ???????? */
function getDefaultSheetUrl() {
  try {
    return { url: DEFAULT_SHEET_URL, name: "????????? (Google Sheet)" };
  } catch (error) {
    throw new Error("????????????????? Sheet ???: " + error.message);
  }
}

/** ?????/???????????????? ???????????????????????? */
function getLawyerSearchSheetInfo(sheetUrl) {
  const sheet = getOrCreateLawyerSearchSheet_(sheetUrl);
  const read = readLawyerContactsFromSheet_(sheet);
  return {
    success: true,
    sheetName: sheet.getName(),
    sheetUrl: buildSheetTabUrl_(sheet),
    headers: LAWYER_SEARCH_HEADERS.slice(),
    records: read.records,
    totalRows: read.totalRows,
    duplicateCount: read.duplicateCount
  };
}

function loadLawyerContacts(sheetUrl) {
  return getLawyerSearchSheetInfo(sheetUrl);
}

function saveLawyerContact(sheetUrl, contact) {
  const sheet = getOrCreateLawyerSearchSheet_(sheetUrl);
  const normalized = normalizeLawyerContact_(contact || {});
  if (!normalized.name) throw new Error("?????????????????");
  if (!normalized.phone) throw new Error("?????????????????");

  const rowIndex = parseInt((contact || {}).rowIndex, 10) || 0;
  const duplicateRow = findLawyerDuplicateRow_(sheet, normalized.key, rowIndex);
  if (duplicateRow) {
    throw new Error("???????????????????????????????");
  }

  const values = [[normalized.name, normalized.phone, normalized.note]];
  if (rowIndex > 1 && rowIndex <= sheet.getMaxRows()) {
    sheet.getRange(rowIndex, 1, 1, 3).setValues(values);
    sheet.getRange(rowIndex, 1, 1, 3).setNumberFormat("@");
  } else {
    const nextRow = Math.max(sheet.getLastRow() + 1, 2);
    sheet.getRange(nextRow, 1, 1, 3).setValues(values);
    sheet.getRange(nextRow, 1, 1, 3).setNumberFormat("@");
  }
  lawyerFormatSearchSheet_(sheet);
  return attachLawyerSyncResult_(getLawyerSearchSheetInfo(sheetUrl), sheet);
}

function importLawyerContacts(sheetUrl, importText) {
  const parsed = parseLawyerImportRows_(importText);
  return importLawyerContactsFromParsedRows_(sheetUrl, parsed);
}

function importLawyerContactsFromXlsx(sheetUrl, filePayload) {
  const payload = filePayload || {};
  const fileName = String(payload.name || "lawyer-import.xlsx");
  if (!/\.xlsx$/i.test(fileName)) {
    throw new Error("??????????????? .xlsx");
  }
  const base64 = String(payload.base64 || "").replace(/^data:[^,]+,/, "");
  if (!base64) throw new Error("??????????????? .xlsx");
  const blob = Utilities.newBlob(
    Utilities.base64Decode(base64),
    payload.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileName
  );
  const parsed = parseLawyerXlsxRows_(blob);
  const info = importLawyerContactsFromParsedRows_(sheetUrl, parsed);
  info.sourceFile = fileName;
  return info;
}

function importLawyerContactsFromParsedRows_(sheetUrl, parsed) {
  const sheet = getOrCreateLawyerSearchSheet_(sheetUrl);
  if (!parsed.length) {
    throw new Error("???????????????????????");
  }

  const existing = lawyerExistingKeyMap_(sheet);
  const rows = [];
  const skipped = [];
  parsed.forEach(function(item) {
    const record = normalizeLawyerContact_(item);
    if (!record.name || !record.phone) {
      skipped.push(record.name || record.phone || "???????");
      return;
    }
    if (existing[record.key]) {
      skipped.push(record.name);
      return;
    }
    existing[record.key] = true;
    rows.push([record.name, record.phone, record.note]);
  });

  if (rows.length) {
    const startRow = Math.max(sheet.getLastRow() + 1, 2);
    sheet.getRange(startRow, 1, rows.length, 3).setValues(rows);
    sheet.getRange(startRow, 1, rows.length, 3).setNumberFormat("@");
  }

  lawyerFormatSearchSheet_(sheet);
  const info = getLawyerSearchSheetInfo(sheetUrl);
  info.addedCount = rows.length;
  info.skippedCount = skipped.length;
  info.skippedNames = skipped.slice(0, 20);
  return attachLawyerSyncResult_(info, sheet);
}

function deleteLawyerContact(sheetUrl, rowIndex) {
  const sheet = getOrCreateLawyerSearchSheet_(sheetUrl);
  const row = parseInt(rowIndex, 10);
  if (!row || row <= 1 || row > sheet.getLastRow()) {
    throw new Error("??????????????????????????");
  }
  sheet.deleteRow(row);
  lawyerFormatSearchSheet_(sheet);
  return attachLawyerSyncResult_(getLawyerSearchSheetInfo(sheetUrl), sheet);
}

function syncLawyerContactsToTarget() {
  const sourceSheet = getOrCreateLawyerSearchSheet_(DEFAULT_SHEET_URL);
  return syncLawyerContactsToTarget_(sourceSheet);
}

function installLawyerAutoSyncTrigger() {
  const sourceId = extractSpreadsheetId(DEFAULT_SHEET_URL);
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === LAWYER_SYNC_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger(LAWYER_SYNC_TRIGGER_HANDLER)
    .forSpreadsheet(sourceId)
    .onChange()
    .create();
  const syncInfo = syncLawyerContactsToTarget();
  return {
    success: true,
    message: "?????????????????????????",
    syncInfo: syncInfo
  };
}

function lawyerAutoSyncOnChange(e) {
  try {
    syncLawyerContactsToTarget();
  } catch (error) {
    Logger.log("lawyerAutoSyncOnChange error: " + error.message);
  }
}

/** ??????????????????????????? Apps Script ???????????????????????? */
function getCurrentDocumentDate() {
  const now = new Date();
  const timeZone = Session.getScriptTimeZone() || "Asia/Bangkok";
  const yearAD = parseInt(Utilities.formatDate(now, timeZone, "yyyy"), 10);
  return {
    day: parseInt(Utilities.formatDate(now, timeZone, "d"), 10),
    month: parseInt(Utilities.formatDate(now, timeZone, "M"), 10),
    yearBE: yearAD + 543,
    timeZone: timeZone
  };
}

/**
 * ????????????? Google Sheet
 * ? v3.0: ?????????? "?????????" (?????????????????????) ???????????????????????????
 *         ?????????????????????????????????????????? replacePlaceholders / generateDocName
 */
function getCasesFromSheet(sheetUrl) {
  try {
    const sheet = getSheetFromUrl(sheetUrl);
    const data = sheet.getDataRange().getValues();

    if (data.length < 2) {
      throw new Error("????????????? Sheet");
    }

    const cases = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row[0] && !row[1] && !row[2]) continue; // ???????????

      cases.push({
        caseNo:    (row[0] || "").toString().trim(),  // A: ????????
        plaintiff: (row[1] || "").toString().trim(),  // B: ????? / ???????
        defendant: (row[2] || "").toString().trim(),  // C: ????? / ???????????
        judge:     (row[3] || "").toString().trim(),  // D: ??????????
        // ???????????????? E ????????????????? (?????????????????????????)
        // ???????? detail ??????? ????????????????????????????? {{DETAIL}} ????????
        detail:    "",
        benchNo:   (row[4] || "").toString().trim(),  // E: ???????????
        rowIndex:  i + 1
      });
    }

    // ?????: ?????????????????? (????)
    addToStat(PROP_TOTAL_IMPORTED, cases.length);

    return cases;

  } catch (error) {
    throw new Error("??????????????????????: " + error.message);
  }
}

/**
 * ??????????? ? ??????????????????????????? (???????) ????????
 * ? v3.0: ?????????????????????????
 *   - ????????????????????????????????????????????? ? ???????????? ??????????? (alreadyExists:true)
 *   - ????????????????? 2/3 ???????????????????????
 *
 * @return {Array} [{ docUrl, folderUrl, success, alreadyExists, docName, error }]
 */
function createDocsInSameFolderByDate(cases, config) {
  try {
    const results = [];
    const docConfig = normalizeConfig(config);

    const mainFolder = getOrCreateFolder(MAIN_FOLDER_NAME);
    const today = new Date();
    const dateFolder = getOrCreateDateFolder(mainFolder, today);
    const dateFolderUrl = dateFolder.getUrl();

    const templateCache = {}; // ???? template ??? id (??????????????????????)

    let createdCount = 0; // ????????????? (?????????????????????????????)

    for (let i = 0; i < cases.length; i++) {
      const caseData = cases[i];

      try {
        const docName = generateDocName(caseData);

        // ? ??????????: ??????????????????????????????????
        const existing = dateFolder.getFilesByName(docName);
        if (existing.hasNext()) {
          const existingFile = existing.next();
          results.push({
            docUrl: existingFile.getUrl(),
            folderUrl: dateFolderUrl,
            success: true,
            alreadyExists: true,   // ? ?????????? ????????????
            docName: docName,
            error: null
          });
          continue;
        }

        // ? v3.2: ?????????????????????? + ??????? "??????????" (????? ?E)
        const templateId = getTemplateIdForCase(caseData);
        if (!templateId || templateId === "PUT_ESTATE_TEMPLATE_ID_HERE") {
          throw new Error("???????????????? ESTATE_TEMPLATE_ID ???????????????? (?E)");
        }
        if (!templateCache[templateId]) templateCache[templateId] = DriveApp.getFileById(templateId);
        const template = templateCache[templateId];

        // ?????? ? ?????????
        const newDoc = template.makeCopy(docName, dateFolder);
        const doc = DocumentApp.openById(newDoc.getId());
        const body = doc.getBody();

        replacePlaceholders(body, caseData, docConfig);
        meetAttachEvidenceToBody_(body, caseData);
        doc.saveAndClose();

        createdCount++;
        results.push({
          docUrl: newDoc.getUrl(),
          folderUrl: dateFolderUrl,
          success: true,
          alreadyExists: false,
          docName: docName,
          error: null
        });

        Utilities.sleep(100);

      } catch (error) {
        Logger.log("Error creating doc for case " + caseData.caseNo + ": " + error.message);
        results.push({
          docUrl: null,
          folderUrl: null,
          success: false,
          alreadyExists: false,
          docName: null,
          error: error.message
        });
      }
    }

    // ?????: ???????????????????????? (?????????????????????)
    if (createdCount > 0) addToStat(PROP_TOTAL_CREATED, createdCount);
    PropertiesService.getScriptProperties().setProperty(PROP_LAST_RUN, new Date().toISOString());

    return results;

  } catch (error) {
    throw new Error("??????????????????????????????: " + error.message);
  }
}

/**
 * ? v3.0: ????????????????????????????????????????????????
 * ??????????????? + ????????/??????????????????
 */
function getExistingDocs(request) {
  try {
    const mainFolder = getOrCreateFolder(MAIN_FOLDER_NAME);
    const targetDate = parseExistingDocsDate_(request);
    const folderName = formatThaiDate(targetDate);
    const dateFolder = findDateFolder_(mainFolder, targetDate);

    if (!dateFolder) {
      return {
        folderName: folderName,
        folderUrl: "",
        count: 0,
        docs: []
      };
    }

    const it = dateFolder.getFiles();
    const docs = [];
    while (it.hasNext()) {
      const f = it.next();
      docs.push({
        name: f.getName(),
        url: f.getUrl(),
        id: f.getId(),
        mimeType: f.getMimeType(),
        isGoogleDoc: f.getMimeType() === MimeType.GOOGLE_DOCS,
        updated: f.getLastUpdated().toISOString()
      });
    }

    // ??????????????????????
    docs.sort((a, b) => (a.updated < b.updated ? 1 : -1));

    return {
      folderName: folderName,
      folderUrl: dateFolder.getUrl(),
      count: docs.length,
      docs: docs
    };
  } catch (error) {
    throw new Error("???????????????????????????: " + error.message);
  }
}

function parseExistingDocsDate_(request) {
  const value = request && request.date ? String(request.date).trim() : "";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const date = new Date(y, mo, d);
    if (!isNaN(date.getTime())) return date;
  }
  return new Date();
}

/**
 * ???????????????????????????? Google Doc ???????????????
 * ??????????????????????????????????????? ????????????????? Google Docs ??????????
 */
function appendImageToExistingDoc(payload) {
  payload = payload || {};
  const docId = String(payload.docId || "").trim();
  const docDate = parseExistingDocsDate_({ date: payload.date });
  const dataUrl = String(payload.dataUrl || "");
  if (!docId) throw new Error("???????????????????????????");

  const match = dataUrl.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  if (!match) throw new Error("???????????????? (???????? JPEG ???? PNG)");

  const file = findExistingCaseDocumentById_(docId, docDate);
  if (file.getMimeType() !== MimeType.GOOGLE_DOCS) {
    throw new Error("???????????????????????????? Google Docs");
  }

  const doc = DocumentApp.openById(docId);
  try {
    const body = doc.getBody();
    if (!body) throw new Error("?????????????????????????????");

    if (!body.findText("?????????")) {
      body.appendParagraph("");
      body.appendParagraph("?????????")
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    }

    const blob = Utilities.newBlob(
      Utilities.base64Decode(match[2]),
      match[1],
      "Meet " + meetSafeName_(file.getName()) + "." + (match[1] === "image/png" ? "png" : "jpg")
    );
    const image = body.appendImage(blob);
    meetFitImage_(image);
    meetCenterImage_(image);
    doc.saveAndClose();

    return {
      success: true,
      target: "existing-doc",
      docId: docId,
      docName: file.getName(),
      docUrl: file.getUrl()
    };
  } catch (error) {
    try { doc.saveAndClose(); } catch (e) {}
    throw new Error("????????????????????????????????: " + error.message);
  }
}

/** ???????????????????????????????????????????????????????????????????? */
function findExistingCaseDocumentById_(docId, targetDate) {
  const mainFolder = getOrCreateFolder(MAIN_FOLDER_NAME);
  const dateFolder = findDateFolder_(mainFolder, targetDate);
  if (!dateFolder) throw new Error("?????????????????????????????????");

  const files = dateFolder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getId() === docId) return file;
  }
  throw new Error("???????????????????????????????????????????????");
}

/** ? v3.0: ??????????????? */
function getStats() {
  const props = PropertiesService.getScriptProperties();
  return {
    totalImported: parseInt(props.getProperty(PROP_TOTAL_IMPORTED) || "0", 10),
    totalCreated:  parseInt(props.getProperty(PROP_TOTAL_CREATED)  || "0", 10),
    lastRun:       props.getProperty(PROP_LAST_RUN) || ""
  };
}

/** ??????????????? (??????????? Apps Script editor ????????????) */
function resetStats() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_TOTAL_IMPORTED);
  props.deleteProperty(PROP_TOTAL_CREATED);
  props.deleteProperty(PROP_LAST_RUN);
}

function addToStat(key, n) {
  try {
    const props = PropertiesService.getScriptProperties();
    const cur = parseInt(props.getProperty(key) || "0", 10);
    props.setProperty(key, (cur + n).toString());
  } catch (e) {
    Logger.log("Stat error (" + key + "): " + e.message);
  }
}

/** normalize config */
function normalizeConfig(config) {
  const today = new Date();
  if (!config) {
    return {
      day: today.getDate(),
      month: today.getMonth() + 1,
      yearBE: today.getFullYear() + 543,
      startTime: "",
      endTime: ""
    };
  }
  const month = Math.max(1, Math.min(12, parseInt(config.month, 10) || (today.getMonth() + 1)));
  const yearBE = parseInt(config.year, 10) || (today.getFullYear() + 543);
  const maxDay = new Date(yearBE - 543, month, 0).getDate();
  const day = Math.max(1, Math.min(maxDay, parseInt(config.day, 10) || today.getDate()));
  return {
    day: day,
    month: month,
    yearBE: yearBE,
    startTime: config.startTime || "",
    endTime: config.endTime || ""
  };
}

// ========== Helper Functions ==========

function getSheetFromUrl(url) {
  try {
    const id = extractSpreadsheetId(url);
    const ss = SpreadsheetApp.openById(id);
    return ss.getActiveSheet();
  } catch (error) {
    throw new Error("URL ????????????????????????????????");
  }
}

function extractSpreadsheetId(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  throw new Error("????? Spreadsheet ID ?? URL");
}

function openSpreadsheetFromUrlOrDefault_(sheetUrl) {
  const url = (sheetUrl || DEFAULT_SHEET_URL || "").toString().trim();
  if (!url) throw new Error("?????????????? Google Sheet");
  return SpreadsheetApp.openById(extractSpreadsheetId(url));
}

function getOrCreateLawyerSearchSheet_(sheetUrl) {
  const ss = openSpreadsheetFromUrlOrDefault_(sheetUrl);
  let sheet = ss.getSheetByName(LAWYER_SEARCH_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(LAWYER_SEARCH_SHEET_NAME);
  }
  ensureLawyerSearchHeaders_(sheet);
  normalizeLawyerSheetRows_(sheet);
  lawyerFormatSearchSheet_(sheet);
  return sheet;
}

function ensureLawyerSearchHeaders_(sheet) {
  if (sheet.getMaxColumns() < 3) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 3 - sheet.getMaxColumns());
  }
  const headerRange = sheet.getRange(1, 1, 1, 3);
  const current = headerRange.getDisplayValues()[0].map(function(v) {
    return String(v || "").trim();
  });
  const matches = current[0] === LAWYER_SEARCH_HEADERS[0] &&
    current[1] === LAWYER_SEARCH_HEADERS[1] &&
    current[2] === LAWYER_SEARCH_HEADERS[2];
  if (!matches) {
    const isKnownHeader = isLawyerHeaderRow_(current[0], current[1], current[2]) ||
      isLawyerImportHeaderRow_(current[0], current[1], current[2]);
    const hasExistingFirstRow = current.some(function(v) { return !!v; });
    if (hasExistingFirstRow && !isKnownHeader) sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, 3).setValues([LAWYER_SEARCH_HEADERS]);
  }
}

function lawyerFormatSearchSheet_(sheet) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 3)
    .setFontWeight("bold")
    .setBackground("#1b3a6b")
    .setFontColor("#ffffff");
  sheet.getRange(1, 1, Math.max(sheet.getMaxRows(), 1), 3).setNumberFormat("@");
  try {
    sheet.autoResizeColumns(1, 3);
  } catch (error) {
    Logger.log("?????????????????????????????????: " + error.message);
  }
}

function normalizeLawyerSheetRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const values = sheet.getRange(2, 1, lastRow - 1, 3).getDisplayValues();
  values.forEach(function(row, index) {
    const name = String(row[0] || "").trim();
    const phone = String(row[1] || "").trim();
    const note = String(row[2] || "").trim();
    if (!name && !phone && !note) return;
    if (isLawyerHeaderRow_(name, phone, note) || isLawyerImportHeaderRow_(name, phone, note)) return;
    const normalized = normalizeLawyerContact_({ name: name, phone: phone, note: note });
    if (normalized.name !== name || normalized.phone !== phone || normalized.note !== note) {
      const rowIndex = index + 2;
      sheet.getRange(rowIndex, 1, 1, 3).setNumberFormat("@");
      sheet.getRange(rowIndex, 1, 1, 3).setValues([[normalized.name, normalized.phone, normalized.note]]);
    }
  });
}

function buildSheetTabUrl_(sheet) {
  return sheet.getParent().getUrl() + "#gid=" + sheet.getSheetId();
}

function attachLawyerSyncResult_(info, sourceSheet) {
  try {
    info.syncInfo = syncLawyerContactsToTarget_(sourceSheet);
  } catch (error) {
    info.syncError = error.message;
    Logger.log("????????????????????????: " + error.message);
  }
  return info;
}

function syncLawyerContactsToTarget_(sourceSheet) {
  if (!LAWYER_SYNC_TARGET_SHEET_URL) {
    return { success: false, message: "????????????????????????????" };
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const source = sourceSheet || getOrCreateLawyerSearchSheet_(DEFAULT_SHEET_URL);
    const sourceRecords = readLawyerContactsFromSheet_(source).records
      .map(function(record) { return normalizeLawyerContact_(record); })
      .filter(function(record) { return record.name && record.phone; });

    const target = getLawyerSyncTargetSheet_();
    ensureLawyerSearchHeaders_(target);
    lawyerFormatSearchSheet_(target);

    const targetData = target.getDataRange().getDisplayValues();
    const targetMap = {};
    for (let i = 1; i < targetData.length; i++) {
      const row = targetData[i] || [];
      const name = String(row[0] || "").trim();
      if (!name || isLawyerHeaderRow_(name, row[1], row[2]) || isLawyerImportHeaderRow_(name, row[1], row[2])) continue;
      const key = normalizeLawyerName_(name);
      if (key && !targetMap[key]) {
        targetMap[key] = {
          rowIndex: i + 1,
          phone: normalizeLawyerPhone_(row[1] || ""),
          note: String(row[2] || "").trim()
        };
      }
    }

    let added = 0;
    let updated = 0;
    const rowsToAppend = [];
    sourceRecords.forEach(function(record) {
      const key = normalizeLawyerName_(record.name);
      if (!key) return;
      const existing = targetMap[key];
      const values = [record.name, record.phone, record.note];
      if (existing) {
        if (existing.phone !== record.phone || existing.note !== record.note) {
          target.getRange(existing.rowIndex, 1, 1, 3).setNumberFormat("@");
          target.getRange(existing.rowIndex, 1, 1, 3).setValues([values]);
          updated++;
        }
      } else {
        rowsToAppend.push(values);
        targetMap[key] = { rowIndex: 0, phone: record.phone, note: record.note };
      }
    });

    if (rowsToAppend.length) {
      const startRow = Math.max(target.getLastRow() + 1, 2);
      target.getRange(startRow, 1, rowsToAppend.length, 3).setNumberFormat("@");
      target.getRange(startRow, 1, rowsToAppend.length, 3).setValues(rowsToAppend);
      added = rowsToAppend.length;
    }
    lawyerFormatSearchSheet_(target);
    return {
      success: true,
      sourceCount: sourceRecords.length,
      added: added,
      updated: updated,
      targetSheetName: target.getName(),
      targetUrl: buildSheetTabUrl_(target),
      syncedAt: new Date().toISOString()
    };
  } finally {
    lock.releaseLock();
  }
}

function getLawyerSyncTargetSheet_() {
  const ss = openSpreadsheetFromUrlOrDefault_(LAWYER_SYNC_TARGET_SHEET_URL);
  const gidMatch = LAWYER_SYNC_TARGET_SHEET_URL.match(/[?#&]gid=(\d+)/);
  if (gidMatch) {
    const gid = parseInt(gidMatch[1], 10);
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === gid) return sheets[i];
    }
  }
  return ss.getSheetByName(LAWYER_SEARCH_SHEET_NAME) || ss.getActiveSheet();
}

function readLawyerContactsFromSheet_(sheet) {
  const data = sheet.getDataRange().getDisplayValues();
  const records = [];
  const seen = {};
  let duplicateCount = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i] || [];
    const name = String(row[0] || "").trim();
    const phone = String(row[1] || "").trim();
    const note = String(row[2] || "").trim();
    if (!name && !phone && !note) continue;
    if (isLawyerHeaderRow_(name, phone, note) || isLawyerImportHeaderRow_(name, phone, note)) continue;
    const key = normalizeLawyerName_(name);
    if (key && seen[key]) {
      duplicateCount++;
      continue;
    }
    if (key) seen[key] = true;
    records.push({
      rowIndex: i + 1,
      name: name,
      phone: phone,
      note: note
    });
  }
  return {
    records: records,
    totalRows: records.length,
    duplicateCount: duplicateCount
  };
}

function isLawyerHeaderRow_(name, phone, note) {
  const a = normalizeLawyerName_(name);
  const b = normalizeLawyerName_(phone);
  const c = normalizeLawyerName_(note);
  return a === normalizeLawyerName_(LAWYER_SEARCH_HEADERS[0]) &&
    b === normalizeLawyerName_(LAWYER_SEARCH_HEADERS[1]) &&
    c === normalizeLawyerName_(LAWYER_SEARCH_HEADERS[2]);
}

function normalizeLawyerContact_(contact) {
  const name = normalizeLawyerDisplayName_(contact.name || contact.lawyerName || "");
  const phone = normalizeLawyerPhone_(contact.phone || contact.lawyerPhone || "");
  const note = String(contact.note || contact.remark || "").replace(/\s+/g, " ").trim();
  return {
    name: name,
    phone: phone,
    note: note,
    key: normalizeLawyerName_(name)
  };
}

function normalizeLawyerName_(name) {
  return String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeLawyerDisplayName_(name) {
  let value = String(name || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  value = value
    .replace(/\s*(?:?????????????|????????|????????|?????)\s*$/i, "")
    .replace(/^????????\s*/i, "")
    .replace(/^????\s*/i, "")
    .replace(/^??????\s*/i, "")
    .replace(/^?\.?\s*?\.?\s*/i, "")
    .replace(/^???\s*/i, "")
    .replace(/^???\s*/i, "")
    .trim();
  return value ? "????" + value : "";
}

function normalizeLawyerPhone_(phone) {
  const raw = String(phone || "").replace(/[?-?]/g, function(ch) {
    return "??????????".indexOf(ch);
  }).trim();
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return raw.replace(/\s+/g, " ");
  if (digits.indexOf("66") === 0 && digits.length >= 11) {
    return "0" + digits.slice(2);
  }
  if (digits.length === 9 && digits.charAt(0) !== "0") {
    return "0" + digits;
  }
  return digits;
}

function findLawyerDuplicateRow_(sheet, normalizedName, exceptRowIndex) {
  if (!normalizedName) return 0;
  const data = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < data.length; i++) {
    const rowNumber = i + 1;
    if (exceptRowIndex && rowNumber === exceptRowIndex) continue;
    if (normalizeLawyerName_(data[i][0]) === normalizedName) return rowNumber;
  }
  return 0;
}

function lawyerExistingKeyMap_(sheet) {
  const data = sheet.getDataRange().getDisplayValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const name = String((data[i] || [])[0] || "").trim();
    if (!name) continue;
    if (isLawyerHeaderRow_(name, data[i][1], data[i][2]) || isLawyerImportHeaderRow_(name, data[i][1], data[i][2])) continue;
    map[normalizeLawyerName_(name)] = true;
  }
  return map;
}

function parseLawyerImportRows_(importText) {
  const lines = String(importText || "").split(/\r?\n/);
  const rows = [];
  lines.forEach(function(rawLine) {
    let line = String(rawLine || "").replace(/^\s*\d+[\).\-\s]+/, "").trim();
    if (!line) return;
    let cols = [];
    if (line.indexOf("\t") !== -1) {
      cols = line.split("\t");
    } else if (line.indexOf("|") !== -1) {
      cols = line.split("|");
    } else if (line.indexOf(",") !== -1) {
      cols = line.split(",");
    }

    let item;
    if (cols.length) {
      item = {
        name: cols[0],
        phone: cols[1],
        note: cols.slice(2).join(" ")
      };
    } else {
      const match = line.match(/(?:\+?66|0)?\d(?:[\s.\-]?\d){7,9}/);
      if (match) {
        item = {
          name: line.slice(0, match.index).replace(/[\/,:;\-\s]+$/, ""),
          phone: match[0],
          note: line.slice(match.index + match[0].length).replace(/^[\/,:;\-\s]+/, "")
        };
      } else {
        item = { name: line, phone: "", note: "" };
      }
    }
    if (isLawyerHeaderRow_(item.name, item.phone, item.note)) return;
    if (isLawyerImportHeaderRow_(item.name, item.phone, item.note)) return;
    const normalized = normalizeLawyerContact_(item);
    if (isLawyerHeaderRow_(normalized.name, normalized.phone, normalized.note)) return;
    if (isLawyerImportHeaderRow_(normalized.name, normalized.phone, normalized.note)) return;
    rows.push(normalized);
  });
  return rows;
}

function parseLawyerXlsxRows_(blob) {
  let parts;
  try {
    parts = Utilities.unzip(blob);
  } catch (error) {
    throw new Error("???????? .xlsx ????????? ??????????????????????? Excel ????");
  }
  const files = {};
  parts.forEach(function(part) {
    files[part.getName()] = part.getDataAsString("UTF-8");
  });
  const sheetPath = findFirstXlsxSheetPath_(files);
  const sheetXml = files[sheetPath];
  if (!sheetXml) throw new Error("????????????????? .xlsx");
  const sharedStrings = parseXlsxSharedStrings_(files["xl/sharedStrings.xml"] || "");
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const cells = {};
    const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1] || "";
      const refMatch = attrs.match(/\br="([A-Z]+)\d+"/i);
      if (!refMatch) continue;
      const colIndex = xlsxColumnToIndex_(refMatch[1]);
      if (colIndex < 1 || colIndex > 3) continue;
      cells[colIndex] = parseXlsxCellValue_(attrs, cellMatch[2] || "", sharedStrings);
    }
    const rawItem = {
      name: cells[1] || "",
      phone: cells[2] || "",
      note: cells[3] || ""
    };
    if (!rawItem.name && !rawItem.phone && !rawItem.note) continue;
    if (isLawyerHeaderRow_(rawItem.name, rawItem.phone, rawItem.note)) continue;
    if (isLawyerImportHeaderRow_(rawItem.name, rawItem.phone, rawItem.note)) continue;
    const item = normalizeLawyerContact_(rawItem);
    if (!item.name && !item.phone && !item.note) continue;
    rows.push(item);
  }
  return rows;
}

function findFirstXlsxSheetPath_(files) {
  const workbookXml = files["xl/workbook.xml"] || "";
  const relsXml = files["xl/_rels/workbook.xml.rels"] || "";
  const firstSheet = workbookXml.match(/<sheet\b[^>]*\br:id="([^"]+)"/);
  if (firstSheet && relsXml) {
    const id = firstSheet[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rel = relsXml.match(new RegExp('<Relationship\\b[^>]*\\bId="' + id + '"[^>]*\\bTarget="([^"]+)"'));
    if (rel && rel[1]) {
      let target = rel[1].replace(/^\/?xl\//, "");
      if (target.indexOf("/") !== 0) target = "xl/" + target;
      return target;
    }
  }
  const sheetNames = Object.keys(files).filter(function(name) {
    return /^xl\/worksheets\/sheet\d+\.xml$/i.test(name);
  }).sort();
  return sheetNames[0] || "xl/worksheets/sheet1.xml";
}

function parseXlsxSharedStrings_(xml) {
  const values = [];
  if (!xml) return values;
  const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let siMatch;
  while ((siMatch = siRegex.exec(xml)) !== null) {
    let text = "";
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch;
    while ((tMatch = tRegex.exec(siMatch[1])) !== null) {
      text += decodeXml_(tMatch[1]);
    }
    values.push(text);
  }
  return values;
}

function parseXlsxCellValue_(attrs, body, sharedStrings) {
  const typeMatch = attrs.match(/\bt="([^"]+)"/);
  const type = typeMatch ? typeMatch[1] : "";
  if (type === "inlineStr") {
    const inline = [];
    const tRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tMatch;
    while ((tMatch = tRegex.exec(body)) !== null) inline.push(decodeXml_(tMatch[1]));
    return inline.join("");
  }
  const valueMatch = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
  const raw = valueMatch ? decodeXml_(valueMatch[1]) : "";
  if (type === "s") {
    return sharedStrings[parseInt(raw, 10)] || "";
  }
  return raw;
}

function xlsxColumnToIndex_(letters) {
  return String(letters || "").toUpperCase().split("").reduce(function(total, ch) {
    return total * 26 + ch.charCodeAt(0) - 64;
  }, 0);
}

function decodeXml_(text) {
  return String(text || "")
    .replace(/&#x([0-9a-f]+);/gi, function(_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function(_, dec) { return String.fromCharCode(parseInt(dec, 10)); })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function isLawyerImportHeaderRow_(name, phone, note) {
  const a = normalizeLawyerName_(name);
  const b = normalizeLawyerName_(phone);
  const c = normalizeLawyerName_(note);
  const nameHeaders = ["????", "????????", "???????????????", "???????????"];
  const phoneHeaders = ["????????", "?????????????", "????????", "?????"];
  const noteHeaders = ["????????", "????????????", "????????/????????????", ""];
  return nameHeaders.indexOf(a) !== -1 &&
    phoneHeaders.indexOf(b) !== -1 &&
    noteHeaders.indexOf(c) !== -1;
}

function getOrCreateFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
}

function getOrCreateDateFolder(parentFolder, date) {
  const dateStr = formatThaiDate(date);
  const folders = parentFolder.getFoldersByName(dateStr);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(dateStr);
}

function findDateFolder_(parentFolder, date) {
  const dateStr = formatThaiDate(date);
  const folders = parentFolder.getFoldersByName(dateStr);
  return folders.hasNext() ? folders.next() : null;
}

/** ????????????? (????????????) ? ?????? ?????????????????? */
function formatThaiDate(date) {
  const thaiDays = ["???????", "??????", "??????", "???", "????????", "?????", "?????"];
  const thaiMonths = [
    "??????", "??????????", "??????", "??????",
    "???????", "????????", "???????", "???????",
    "???????", "??????", "?????????", "???????"
  ];
  const day = date.getDate();
  const month = thaiMonths[date.getMonth()];
  const year = date.getFullYear() + 543;
  const dayName = thaiDays[date.getDay()];
  return `${day} ${month} ${year} - ???${dayName}`;
}

function formatConfigDate(config) {
  const thaiMonths = [
    "??????", "??????????", "??????", "??????",
    "???????", "????????", "???????", "???????",
    "???????", "??????", "?????????", "???????"
  ];
  return `${config.day} ${thaiMonths[config.month - 1]} ${config.yearBE}`;
}

/**
 * ? v3.2: ??????????????? "?E" ??????? (?????????????????????????????????)
 */
function isEstateEligible(caseNo) {
  const s = (caseNo || "").toString().trim();
  for (let i = 0; i < ESTATE_PREFIXES.length; i++) {
    if (s.indexOf(ESTATE_PREFIXES[i]) === 0) return true;
  }
  return false;
}

/**
 * ?????????????????????????: ??????? ?E ???????????????? "?????????????????"
 */
function useEstateTemplate(caseData) {
  return isEstateEligible(caseData.caseNo) && caseData.isEstate === true;
}

function getTemplateIdForCase(caseData) {
  return useEstateTemplate(caseData) ? ESTATE_TEMPLATE_ID : TEMPLATE_ID;
}

/**
 * ?????????? ? ???????? "??????" ???????????????????????????????? (v2.x)
 * ?????????????????????: ???????????????????????????????????
 * ? v3.2: ???????? ?E ??????? "??????????" ? ??????????? "(???????)"
 */
function generateDocName(caseData) {
  const caseNo = toThaiNumber(caseData.caseNo || "???????");
  const safeCaseNo = caseNo.toString().replace(/\//g, "-");
  const plaintiff = toThaiNumber(truncateText(caseData.plaintiff, 20));

  if (useEstateTemplate(caseData)) {
    return `???????? ${safeCaseNo} - ${plaintiff} (???????)`;
  }
  const defendant = toThaiNumber(truncateText(caseData.defendant, 20));
  return `???????? ${safeCaseNo} - ${plaintiff} vs ${defendant}`;
}

function truncateText(text, maxLength) {
  if (!text) return "???????";
  text = text.toString();
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

/** ????????? ? ?????? (idempotent) */
function toThaiNumber(text) {
  if (text === null || text === undefined || text === "") return "";
  const thaiDigits = ["?", "?", "?", "?", "?", "?", "?", "?", "?", "?"];
  return text.toString().replace(/\d/g, digit => thaiDigits[digit]);
}

function parseTime(timeStr) {
  if (!timeStr) return { hour: "", minute: "" };
  const value = String(timeStr).trim();
  const match = value.match(/^(\d{1,2})[.:](\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) return { hour: "", minute: "" };
  let hour = parseInt(match[1], 10);
  const minute = Math.max(0, Math.min(59, parseInt(match[2], 10) || 0));
  const period = String(match[3] || "").toUpperCase();
  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour < 12) hour += 12;
  hour = Math.max(0, Math.min(23, hour));
  return {
    hour: ("0" + hour).slice(-2),
    minute: ("0" + minute).slice(-2)
  };
}

function formatConfigFullDate_(config) {
  const thaiMonths = [
    "??????", "??????????", "??????", "??????",
    "???????", "????????", "???????", "???????",
    "???????", "??????", "?????????", "???????"
  ];
  return "?????? " + toThaiNumber(config.day) +
    " ?????" + thaiMonths[config.month - 1] +
    " ?????????? " + toThaiNumber(config.yearBE);
}

function formatThaiTime_(timeStr) {
  const parsed = parseTime(timeStr);
  if (!parsed.hour) return "";
  return toThaiNumber(parsed.hour + "." + parsed.minute) + " ?.";
}

/** ?????? placeholders ? ????????????????? "??????" */
function replacePlaceholders(body, caseData, config) {
  const thaiMonths = [
    "??????", "??????????", "??????", "??????",
    "???????", "????????", "???????", "???????",
    "???????", "??????", "?????????", "???????"
  ];

  const isPetitionerCase = useEstateTemplate(caseData);
  const petitioner = isPetitionerCase ? (caseData.plaintiff || "") : "";
  const petitionerLawyer = isPetitionerCase ? (caseData.defendant || "") : "";

  body.replaceText("{{CASE_NO}}",   toThaiNumber(caseData.caseNo    || ""));
  body.replaceText("{{PLAINTIFF}}", toThaiNumber(caseData.plaintiff || ""));
  body.replaceText("{{PETITIONER}}", toThaiNumber(petitioner));
  body.replaceText("{{PETITIONER_LAWYER}}", toThaiNumber(petitionerLawyer));
  body.replaceText("{{DEFENDANT}}", toThaiNumber(caseData.defendant || ""));
  body.replaceText("{{JUDGE}}",     toThaiNumber(caseData.judge     || ""));
  body.replaceText("{{DETAIL}}",    toThaiNumber(caseData.detail    || ""));

  body.replaceText("{{DAY}}", toThaiNumber(config.day.toString()));
  body.replaceText("{{MONTH}}", toThaiNumber(config.month.toString()));
  body.replaceText("{{MONTH_NAME}}", thaiMonths[config.month - 1]);
  body.replaceText("{{YEAR}}", toThaiNumber(config.yearBE.toString()));
  body.replaceText("{{FULL_DATE}}", formatConfigFullDate_(config));

  const startParts = parseTime(config.startTime);
  const endParts = parseTime(config.endTime);

  const startTimeText = formatThaiTime_(config.startTime);
  const endTimeText = formatThaiTime_(config.endTime);
  body.replaceText("{{START_TIME}}\\s*??????", startTimeText);
  body.replaceText("{{START_TIME}}\\s*?\\.", startTimeText);
  body.replaceText("{{START_TIME}}", startTimeText);
  body.replaceText("{{END_TIME}}\\s*??????", endTimeText);
  body.replaceText("{{END_TIME}}\\s*?\\.", endTimeText);
  body.replaceText("{{END_TIME}}", endTimeText);
  body.replaceText("{{START_HOUR}}", toThaiNumber(startParts.hour));
  body.replaceText("{{START_MIN}}", toThaiNumber(startParts.minute));
  body.replaceText("{{END_HOUR}}", toThaiNumber(endParts.hour));
  body.replaceText("{{END_MIN}}", toThaiNumber(endParts.minute));

  body.replaceText("{{TODAY}}", toThaiNumber(formatThaiDate(new Date())));
}

function updateSheetWithLinks(sheetUrl, cases, results) {
  try {
    const sheet = getSheetFromUrl(sheetUrl);
    const linkColumnIndex = 5;
    for (let i = 0; i < cases.length; i++) {
      const rowIndex = cases[i].rowIndex;
      const result = results[i];
      if (result && result.docUrl && rowIndex) {
        sheet.getRange(rowIndex, linkColumnIndex + 1).setValue(result.docUrl);
      }
    }
  } catch (error) {
    Logger.log("?????????????????????? Sheet: " + error.message);
  }
}

// ========== Testing ==========
function testCreateDocs() {
  const testCases = [{
    caseNo: "123/2567",
    plaintiff: "???????? ????",
    defendant: "?????????????? ??????",
    judge: "????????????? ?????",
    detail: "???????????? v3.0",
    rowIndex: 2
  }];
  const testConfig = { day: 15, month: 6, year: 2569, startTime: "09:00", endTime: "12:00" };
  const results = createDocsInSameFolderByDate(testCases, testConfig);
  Logger.log("Results: " + JSON.stringify(results));
}

// ========== Book Manager + Gemini AI ==========
// Store the real API key in Script Properties as GEMINI_API_KEY.
// Optional Script Properties:
//   GEMINI_MODEL (default: gemini-2.5-flash)
//   GEMINI_LIMIT_RPM, GEMINI_LIMIT_RPD, GEMINI_LIMIT_TPM (shown in the UI)

const BOOK_MANAGER_FOLDER_NAME = "????????????? - ????????";
const BOOK_MANAGER_DEFAULT_MODEL = "gemini-3.5-flash";
const BOOK_MANAGER_USAGE_PREFIX = "BOOK_AI_USAGE_";
const BOOK_MANAGER_MAX_INLINE_BYTES = 8 * 1024 * 1024;
const BOOK_MANAGER_ALLOWED_MODELS = ["gemini-3.5-flash", "gemini-2.5-flash"]; // ????????????
const BOOK_FREE_DEFAULT_RPD = 1500;     // ???????? ????/???
const BOOK_FREE_DEFAULT_RPM = 15;       // ????/????
const BOOK_FREE_DEFAULT_TPM = 1000000;  // ?????/????

function setGeminiApiKeyForBookManager(apiKey) {
  const key = bookSanitizeGeminiApiKey_(apiKey);
  bookAssertGeminiApiKeyLooksValid_(key);
  const validation = bookValidateGeminiApiKeyValue_(key);
  PropertiesService.getScriptProperties().setProperty("GEMINI_API_KEY", key);
  return {
    success: true,
    message: "?????? GEMINI_API_KEY ?? Script Properties ????",
    maskedKey: bookMaskGeminiKey_(key),
    validation: validation
  };
}

function clearGeminiApiKeyForBookManager() {
  PropertiesService.getScriptProperties().deleteProperty("GEMINI_API_KEY");
  return { success: true, message: "?? GEMINI_API_KEY ????" };
}

function validateGeminiApiKeyForBookManager() {
  const key = bookGetGeminiApiKey_();
  bookAssertGeminiApiKeyLooksValid_(key);
  return bookValidateGeminiApiKeyValue_(key);
}

function bookValidateGeminiApiKeyValue_(key) {
  const model = bookNormalizeGeminiModel_(PropertiesService.getScriptProperties().getProperty("GEMINI_MODEL") || BOOK_MANAGER_DEFAULT_MODEL);
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) + ":generateContent";
  const payload = {
    contents: [{
      role: "user",
      parts: [{ text: "???????? OK ????????" }]
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8
    }
  };
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-goog-api-key": key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const raw = response.getContentText();
  if (status < 200 || status >= 300) {
    let message = raw;
    try {
      const data = JSON.parse(raw || "{}");
      message = data && data.error && data.error.message ? data.error.message : raw;
    } catch (error) {}
    throw new Error(bookFriendlyGeminiError_(status, message));
  }
  return {
    success: true,
    model: model,
    maskedKey: bookMaskGeminiKey_(key),
    message: "Gemini API key ?????????"
  };
}

function setGeminiModelForBookManager(modelName) {
  const model = String(modelName || "").trim().replace(/^models\//, "");
  if (BOOK_MANAGER_ALLOWED_MODELS.indexOf(model) === -1) {
    throw new Error("??????????????????: " + BOOK_MANAGER_ALLOWED_MODELS.join(", "));
  }
  PropertiesService.getScriptProperties().setProperty("GEMINI_MODEL", model);
  return { success: true, model: model };
}

function setGeminiUsageLimitsForBookManager(rpm, rpd, tpm) {
  const props = PropertiesService.getScriptProperties();
  const values = {
    GEMINI_LIMIT_RPM: rpm,
    GEMINI_LIMIT_RPD: rpd,
    GEMINI_LIMIT_TPM: tpm
  };
  Object.keys(values).forEach(function (key) {
    const value = values[key];
    if (value === null || value === undefined || String(value).trim() === "") {
      props.deleteProperty(key);
    } else {
      props.setProperty(key, String(value).trim());
    }
  });
  return getBookAiUsage();
}

function bookEffectiveLimits_() {
  const props = PropertiesService.getScriptProperties();
  function num(v, d) { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : d; }
  return {
    rpd: num(props.getProperty("GEMINI_LIMIT_RPD"), BOOK_FREE_DEFAULT_RPD),
    rpm: num(props.getProperty("GEMINI_LIMIT_RPM"), BOOK_FREE_DEFAULT_RPM),
    tpm: num(props.getProperty("GEMINI_LIMIT_TPM"), BOOK_FREE_DEFAULT_TPM)
  };
}

function getBookAiUsage() {
  const props = PropertiesService.getScriptProperties();
  const key = bookGetGeminiApiKey_(true);
  const usage = bookGetTodayUsage_();
  const eff = bookEffectiveLimits_();
  const overQuota = usage.requests >= eff.rpd;
  return {
    hasApiKey: !!key,
    maskedKey: key ? bookMaskGeminiKey_(key) : "",
    model: bookNormalizeGeminiModel_(props.getProperty("GEMINI_MODEL") || BOOK_MANAGER_DEFAULT_MODEL),
    allowedModels: BOOK_MANAGER_ALLOWED_MODELS,
    limits: {
      rpm: props.getProperty("GEMINI_LIMIT_RPM") || String(eff.rpm),
      rpd: props.getProperty("GEMINI_LIMIT_RPD") || String(eff.rpd),
      tpm: props.getProperty("GEMINI_LIMIT_TPM") || String(eff.tpm)
    },
    effectiveLimits: eff,
    usage: usage,
    overQuota: overQuota,
    remaining: Math.max(0, eff.rpd - usage.requests),
    maxInlineMb: Math.floor(BOOK_MANAGER_MAX_INLINE_BYTES / 1024 / 1024),
    rateLimitNote: "?????????????????????????????????????????? (RPD) ? ???????????????????????????????????????????????"
  };
}

/** ??????????????? HTML A4 ???????????????????? */
function getHtmlPrintSettings() {
  const props = PropertiesService.getScriptProperties();
  let saved = {};
  try {
    saved = JSON.parse(props.getProperty(PRINT_SETTINGS_PROPERTY) || "{}");
  } catch (error) {
    saved = {};
  }
  return printNormalizeSettings_(saved);
}

function saveHtmlPrintSettings(settings) {
  const normalized = printNormalizeSettings_(settings || {});
  PropertiesService.getScriptProperties().setProperty(
    PRINT_SETTINGS_PROPERTY,
    JSON.stringify(normalized)
  );
  return {
    success: true,
    message: "??????????????????? Script Properties ????",
    settings: normalized
  };
}

function printNormalizeSettings_(settings) {
  const source = settings || {};
  const margins = source.margins || {};
  const sections = source.sections || {};
  const logo = source.logo || {};
  const headerFooter = source.headerFooter || {};
  const orientation = ["portrait", "landscape"].indexOf(source.orientation) !== -1
    ? source.orientation
    : "portrait";
  const marginPreset = ["normal", "narrow", "wide", "custom"].indexOf(source.marginPreset) !== -1
    ? source.marginPreset
    : "normal";
  const scaleValue = parseInt(source.scale, 10);
  const scale = [90, 100, 110].indexOf(scaleValue) !== -1 ? scaleValue : 100;
  const logoPosition = ["left", "center", "right"].indexOf(logo.position) !== -1
    ? logo.position
    : "left";

  return {
    orientation: orientation,
    marginPreset: marginPreset,
    margins: {
      top: printClampNumber_(margins.top, 0.5, 5, 2),
      right: printClampNumber_(margins.right, 0.5, 5, 2),
      bottom: printClampNumber_(margins.bottom, 0.5, 5, 2),
      left: printClampNumber_(margins.left, 0.5, 5, 2)
    },
    scale: scale,
    sections: {
      header: sections.header !== false,
      summary: sections.summary !== false,
      table: sections.table !== false,
      chart: sections.chart !== false,
      yearly: sections.yearly !== false,
      draft: sections.draft !== false
    },
    logo: {
      position: logoPosition,
      offsetX: printClampNumber_(logo.offsetX, -5, 5, 0),
      offsetY: printClampNumber_(logo.offsetY, -5, 5, 0),
      scale: printClampNumber_(logo.scale, 50, 180, 100)
    },
    headerFooter: {
      showHeader: headerFooter.showHeader !== false,
      agencyName: String(headerFooter.agencyName || "?????????????????").trim().slice(0, 120),
      showPageNumber: headerFooter.showPageNumber !== false
    },
    printBackground: source.printBackground !== false
  };
}

function printClampNumber_(value, min, max, fallback) {
  const number = Number(value);
  if (!isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function runBookAiTask(request) {
  request = request || {};
  const prompt = bookBuildPrompt_(request);
  const parts = [{ text: prompt }];
  const attachment = request.attachment || null;

  if (attachment && attachment.data) {
    const mimeType = String(attachment.mimeType || "").toLowerCase();
    if (!/^application\/pdf$/.test(mimeType) && !/^image\//.test(mimeType)) {
      throw new Error("??????????????? PDF ??????????");
    }
    const sizeBytes = Math.floor(String(attachment.data).length * 3 / 4);
    if (sizeBytes > BOOK_MANAGER_MAX_INLINE_BYTES) {
      throw new Error("???????????? " + Math.floor(BOOK_MANAGER_MAX_INLINE_BYTES / 1024 / 1024) + " MB ?????????????????????? AI ????");
    }
    parts.push({
      inlineData: {
        mimeType: mimeType,
        data: String(attachment.data)
      }
    });
  }

  const ai = bookCallGemini_(parts);
  const draftText = (request.task === "design")
    ? String(ai.text || "").trim()
    : bookNormalizeDraft_(ai.text);
  return {
    success: true,
    draftText: draftText,
    usageMetadata: ai.usageMetadata || {},
    trackedUsage: ai.trackedUsage || bookGetTodayUsage_(),
    model: ai.model,
    title: bookSuggestedTitle_(request)
  };
}

function saveBookDraftToDoc(request) {
  request = request || {};
  const draftText = String(request.draftText || "").trim();
  if (!draftText) throw new Error("?????????????????????????????");

  const title = bookSafeDocName_(request.title || bookSuggestedTitle_(request));
  const doc = DocumentApp.create(title);
  const body = doc.getBody();
  body.clear();
  body.appendParagraph("????????????????").setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph("?????????????????????? ?????? ????????? ?????? ?????????????????????????????????")
    .setItalic(true);
  body.appendParagraph("");

  let cleanDraft = draftText.replace(/^????????????????\s*/i, "").trim();
  if (!cleanDraft) cleanDraft = draftText;
  bookAppendMultiline_(body, cleanDraft);

  const meta = [];
  if (request.task) meta.push("?????????: " + bookTaskLabel_(request.task));
  if (request.subject) meta.push("??????: " + request.subject);
  if (request.recipient) meta.push("?????/???: " + request.recipient);
  if (request.attachmentName) meta.push("??????????: " + request.attachmentName);
  if (meta.length) {
    body.appendParagraph("");
    body.appendHorizontalRule();
    body.appendParagraph("????????????").setHeading(DocumentApp.ParagraphHeading.HEADING2);
    meta.forEach(function (line) { body.appendParagraph(line); });
  }

  doc.saveAndClose();
  const folder = bookGetOrCreateFolder_(BOOK_MANAGER_FOLDER_NAME);
  const file = DriveApp.getFileById(doc.getId());
  file.moveTo(folder);
  return {
    success: true,
    docId: doc.getId(),
    docUrl: doc.getUrl(),
    name: doc.getName(),
    folderUrl: folder.getUrl()
  };
}

function bookCallGemini_(parts) {
  const props = PropertiesService.getScriptProperties();
  const eff = bookEffectiveLimits_();
  const todayUsage = bookGetTodayUsage_();
  if (todayUsage.requests >= eff.rpd) {
    throw new Error("???????????????????????? (" + todayUsage.requests + "/" + eff.rpd + " ????) ????????????????????????????????????????????????? ???????????????????????");
  }
  const apiKey = bookGetGeminiApiKey_();
  bookAssertGeminiApiKeyLooksValid_(apiKey);
  const model = bookNormalizeGeminiModel_(props.getProperty("GEMINI_MODEL") || BOOK_MANAGER_DEFAULT_MODEL);
  const payload = {
    systemInstruction: {
      parts: [{
        text: "???????????????????????????????????????? ?????????????????? ?????? ??????????? ????????????????????????????????????????????"
      }]
    },
    contents: [{
      role: "user",
      parts: parts
    }],
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens: 4096
    }
  };
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) + ":generateContent";
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-goog-api-key": apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const raw = response.getContentText();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch (error) {
    throw new Error("?????????????? Gemini ?????????: " + error.message);
  }
  if (status < 200 || status >= 300) {
    const message = data && data.error && data.error.message
      ? data.error.message
      : raw;
    bookRecordUsage_(null, status, response.getAllHeaders ? response.getAllHeaders() : {});
    throw new Error(bookFriendlyGeminiError_(status, message));
  }
  const text = bookExtractGeminiText_(data);
  if (!text) {
    const blockReason = data.promptFeedback && data.promptFeedback.blockReason
      ? data.promptFeedback.blockReason
      : "???????????????????";
    throw new Error("Gemini ???????????????????: " + blockReason);
  }
  const usageMetadata = data.usageMetadata || {};
  const trackedUsage = bookRecordUsage_(
    usageMetadata,
    status,
    response.getAllHeaders ? response.getAllHeaders() : {}
  );
  return {
    text: text,
    usageMetadata: usageMetadata,
    trackedUsage: trackedUsage,
    model: model
  };
}

function bookNormalizeGeminiModel_(modelName) {
  const raw = String(modelName || "").trim().replace(/^models\//, "");
  if (!raw) return BOOK_MANAGER_DEFAULT_MODEL;
  return BOOK_MANAGER_ALLOWED_MODELS.indexOf(raw) !== -1 ? raw : BOOK_MANAGER_DEFAULT_MODEL;
}

function bookGetGeminiApiKey_(optional) {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("GEMINI_API_KEY") ||
    props.getProperty("GOOGLE_API_KEY") ||
    props.getProperty("GEMINI_KEY") ||
    "";
  const key = bookSanitizeGeminiApiKey_(raw);
  if (!key && !optional) {
    throw new Error("???????????????? GEMINI_API_KEY ?? Script Properties");
  }
  return key;
}

function bookSanitizeGeminiApiKey_(apiKey) {
  let key = String(apiKey || "").trim();
  key = key.replace(/^\uFEFF/, "");
  key = key.replace(/^GEMINI_API_KEY\s*=\s*/i, "");
  key = key.replace(/^GOOGLE_API_KEY\s*=\s*/i, "");
  key = key.replace(/^["'`]+|["'`;]+$/g, "");
  key = key.replace(/\s+/g, "");
  return key;
}

function bookAssertGeminiApiKeyLooksValid_(key) {
  const value = bookSanitizeGeminiApiKey_(key);
  if (!value) throw new Error("???????????? GEMINI_API_KEY ??????????");
  if (/YOUR_KEY|PASTE|???|???|API_KEY|GEMINI_API_KEY/i.test(value)) {
    throw new Error("GEMINI_API_KEY ?????????????????????? ???????????? API key ??????? Google AI Studio");
  }
  if (!/^AIza[0-9A-Za-z_-]{20,}$/.test(value)) {
    throw new Error("?????? GEMINI_API_KEY ?????????? ?????????????????? AIza ????????????????/????????????????");
  }
}

function bookMaskGeminiKey_(key) {
  const value = bookSanitizeGeminiApiKey_(key);
  if (!value) return "";
  return value.substring(0, 6) + "..." + value.substring(value.length - 4);
}

function bookFriendlyGeminiError_(status, message) {
  const msg = String(message || "");
  if (status === 400 && /API key not valid|valid API key|API_KEY_INVALID/i.test(msg)) {
    return "Gemini API key ??????????: ??????????/?????? API key ??????? Google AI Studio ??????? setupGeminiApiKey() ????";
  }
  if (status === 403) {
    return "Gemini API ???????????????: ??????? API key ??????? Gemini API ???? ??????????? Google Cloud/AI Studio ?????????";
  }
  if (status === 429) {
    return "Gemini API ???????????????????????????????? ?????????????????????? rate limits";
  }
  return "Gemini API ???????????????? (" + status + "): " + msg;
}

function bookBuildPrompt_(request) {
  const task = String(request.task || "draft");
  const sourceText = String(request.sourceText || "").trim();
  const instructions = String(request.instructions || "").trim();
  const subject = String(request.subject || "").trim();
  const recipient = String(request.recipient || "").trim();
  const targetLanguage = String(request.targetLanguage || "???").trim();
  const tone = String(request.tone || "????????? ?????? ??????").trim();
  const attachmentName = request.attachment && request.attachment.name
    ? String(request.attachment.name)
    : "";

  const lines = [
    "???????????????: " + bookTaskLabel_(task),
    (task === "design"
      ? "??????????????????????????? \"?????????????? (?????????????????)\" ????????????????? ?????????????????????"
      : "??????????????????????????? \"????????????????\" ????????"),
    "??????????????????????????????????????? Google Docs ??? ??????????????????????????????????????",
    "???????: " + tone
  ];
  if (subject) lines.push("??????/??????: " + subject);
  if (recipient) lines.push("?????/???: " + recipient);
  if (targetLanguage) lines.push("????????????: " + targetLanguage);
  if (attachmentName) lines.push("??????????????????????: " + attachmentName);
  if (instructions) lines.push("????????????????????????:\n" + instructions);
  if (sourceText) lines.push("?????????????:\n" + sourceText);

  if (task === "translate") {
    lines.push("??????????????????????????????????????????????????????? ??????????????????????????????????????? ?");
  } else if (task === "summarize") {
    lines.push("?????????????????: ????????????, ???????????/?????????, ??????????????????????");
  } else if (task === "extract") {
    lines.push("??????? PDF/???????????????????? ??????????????????????????????????????????????????");
  } else if (task === "design") {
    lines.push("???????????????????????????? ?????? '?????????????????' ???????????????????????????????: ?) ??????????/???????????? ?) ???????????????????? ?) ??????/????????????????? ?) ???????????/?????????????????");
  } else {
    lines.push("????????????????????????????? ??????, ?????, ?????????, ?????????????? ???????????????????????????? [???????????...]");
  }
  return lines.join("\n\n");
}

function bookExtractGeminiText_(data) {
  const candidates = data && data.candidates ? data.candidates : [];
  const chunks = [];
  candidates.forEach(function (candidate) {
    const parts = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts
      : [];
    parts.forEach(function (part) {
      if (part && part.text) chunks.push(part.text);
    });
  });
  return chunks.join("\n\n").trim();
}

function bookNormalizeDraft_(text) {
  const clean = String(text || "").trim();
  if (!clean) return "????????????????\n\n";
  return /^????????????????/.test(clean)
    ? clean
    : "????????????????\n\n" + clean;
}

function bookRecordUsage_(usageMetadata, status, headers) {
  const props = PropertiesService.getScriptProperties();
  const key = BOOK_MANAGER_USAGE_PREFIX + bookTodayKey_();
  let data = {};
  try {
    data = JSON.parse(props.getProperty(key) || "{}");
  } catch (error) {
    data = {};
  }
  data.date = bookTodayKey_();
  data.requests = Number(data.requests || 0) + 1;
  if (status >= 400) data.errors = Number(data.errors || 0) + 1;
  if (usageMetadata) {
    data.promptTokens = Number(data.promptTokens || 0) + Number(usageMetadata.promptTokenCount || 0);
    data.candidateTokens = Number(data.candidateTokens || 0) + Number(usageMetadata.candidatesTokenCount || 0);
    data.totalTokens = Number(data.totalTokens || 0) + Number(usageMetadata.totalTokenCount || 0);
    data.lastUsage = usageMetadata;
  }
  data.lastStatus = status;
  data.lastRateHeaders = bookPickRateHeaders_(headers || {});
  data.lastUpdated = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  props.setProperty(key, JSON.stringify(data));
  return data;
}

function bookGetTodayUsage_() {
  const props = PropertiesService.getScriptProperties();
  const key = BOOK_MANAGER_USAGE_PREFIX + bookTodayKey_();
  try {
    const data = JSON.parse(props.getProperty(key) || "{}");
    data.date = data.date || bookTodayKey_();
    data.requests = Number(data.requests || 0);
    data.errors = Number(data.errors || 0);
    data.promptTokens = Number(data.promptTokens || 0);
    data.candidateTokens = Number(data.candidateTokens || 0);
    data.totalTokens = Number(data.totalTokens || 0);
    return data;
  } catch (error) {
    return {
      date: bookTodayKey_(),
      requests: 0,
      errors: 0,
      promptTokens: 0,
      candidateTokens: 0,
      totalTokens: 0
    };
  }
}

function bookPickRateHeaders_(headers) {
  const picked = {};
  Object.keys(headers || {}).forEach(function (key) {
    const low = String(key).toLowerCase();
    if (low.indexOf("ratelimit") !== -1 || low.indexOf("quota") !== -1 || low === "retry-after") {
      picked[key] = headers[key];
    }
  });
  return picked;
}

function bookTodayKey_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
}

function bookSuggestedTitle_(request) {
  request = request || {};
  const subject = String(request.subject || request.title || "").trim();
  const taskLabel = bookTaskLabel_(request.task || "draft");
  const dateText = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  return bookSafeDocName_("???????? - " + taskLabel + (subject ? " - " + subject : "") + " - " + dateText);
}

function bookTaskLabel_(task) {
  const labels = {
    draft: "???????????",
    translate: "?????????",
    summarize: "??????????",
    extract: "???? PDF/???",
    design: "??????????/?????????????"
  };
  return labels[String(task || "draft")] || labels.draft;
}

function bookSafeDocName_(name) {
  const clean = String(name || "???????????????").replace(/[\\/:*?"<>|#%{}~&]/g, " ").replace(/\s+/g, " ").trim();
  return clean.substring(0, 180) || "???????????????";
}

function bookGetOrCreateFolder_(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
}

function bookAppendMultiline_(body, text) {
  String(text || "").split(/\r?\n/).forEach(function (line) {
    body.appendParagraph(line);
  });
}

// ========== Monthly Center Report ==========

function getMonthlyCenterReportBootstrap() {
  const now = new Date();
  const tz = Session.getScriptTimeZone();
  const month = now.getMonth() + 1;
  const year = now.getFullYear() + 543;
  return {
    month: month,
    year: year,
    reportDate: Utilities.formatDate(now, tz, "yyyy-MM-dd"),
    todayThai: centerFormatThaiDate_(now),
    saved: getMonthlyCenterReport(year, month),
    yearly: getCenterReportYearlyStats(year)
  };
}

function getMonthlyCenterReport(yearBE, month) {
  const key = centerReportKey_(yearBE, month);
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return null;
  try {
    return centerNormalizeReport_(JSON.parse(raw));
  } catch (error) {
    return null;
  }
}

function saveMonthlyCenterReport(report) {
  let normalized = centerNormalizeReport_(report || {}, { markActiveSheetSaved: true });
  normalized = centerSaveReportPhotos_(normalized, (report || {}).newPhotos || []);
  const key = centerReportKey_(normalized.year, normalized.month);
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(normalized));
  return {
    success: true,
    report: normalized,
    yearly: getCenterReportYearlyStats(normalized.year)
  };
}

function getCenterReportYearlyStats(yearBE) {
  const year = parseInt(yearBE, 10) || (new Date().getFullYear() + 543);
  const months = [];
  const totals = { online: 0, incoming: 0, mediation: 0, court: 0, totalFinished: 0 };
  for (let month = 1; month <= 12; month++) {
    const report = getMonthlyCenterReport(year, month);
    const monthTotals = report ? centerTotals_(centerReportRows_(report)) : { online: 0, incoming: 0, mediation: 0, court: 0, totalFinished: 0 };
    totals.online += monthTotals.online;
    totals.incoming += monthTotals.incoming;
    totals.mediation += monthTotals.mediation;
    totals.court += monthTotals.court;
    totals.totalFinished += monthTotals.totalFinished;
    months.push({
      month: month,
      monthName: CENTER_REPORT_MONTHS[month - 1],
      hasData: !!report,
      totals: monthTotals
    });
  }
  return { year: year, months: months, totals: totals };
}

function importMonthlyCenterReportFromFile(request) {
  request = request || {};
  const attachment = request.attachment || null;
  const sourceText = String(request.sourceText || "").trim();
  if (!attachment && !sourceText) {
    throw new Error("???????????? PDF/?????? ??????????????????????????????");
  }
  const parts = [{
    text: centerBuildImportPrompt_(request)
  }];
  if (attachment && attachment.data) {
    const mimeType = String(attachment.mimeType || "").toLowerCase();
    if (!/^application\/pdf$/.test(mimeType) && !/^image\//.test(mimeType)) {
      throw new Error("??????????? PDF ??????????");
    }
    const sizeBytes = Math.floor(String(attachment.data).length * 3 / 4);
    if (sizeBytes > BOOK_MANAGER_MAX_INLINE_BYTES) {
      throw new Error("???????????? " + Math.floor(BOOK_MANAGER_MAX_INLINE_BYTES / 1024 / 1024) + " MB ??????????????????????");
    }
    parts.push({
      inline_data: {
        mime_type: mimeType,
        data: String(attachment.data)
      }
    });
  }
  const ai = bookCallGemini_(parts);
  const parsed = centerExtractJson_(ai.text);
  const report = centerNormalizeReport_({
    month: parsed.month || request.month,
    year: parsed.year || request.year,
    reportDate: parsed.reportDate || request.reportDate,
    sheetCount: parsed.sheetCount || request.sheetCount,
    activeSheet: parsed.activeSheet || request.activeSheet,
    sheets: parsed.sheets || request.sheets || [],
    weeks: parsed.weeks || parsed.rooms || [],
    rooms: parsed.rooms || parsed.weeks || [],
    sourceName: attachment ? attachment.name : "?????????????",
    note: parsed.note || request.note || "",
    photos: request.photos || [],
    evidenceFolderUrl: request.evidenceFolderUrl || ""
  });
  return {
    success: true,
    report: report,
    usageMetadata: ai.usageMetadata || {},
    trackedUsage: ai.trackedUsage || bookGetTodayUsage_(),
    rawText: ai.text
  };
}

function createMonthlyCenterReportDoc(report) {
  const saved = saveMonthlyCenterReport(report || {});
  const normalized = saved.report;
  const folder = bookGetOrCreateFolder_(CENTER_REPORT_FOLDER_NAME);
  const title = centerReportTitle_(normalized);
  let doc;
  let file;
  try {
    const template = DriveApp.getFileById(CENTER_REPORT_TEMPLATE_ID);
    file = template.makeCopy(title, folder);
    doc = DocumentApp.openById(file.getId());
  } catch (error) {
    doc = DocumentApp.create(title);
    file = DriveApp.getFileById(doc.getId());
    file.moveTo(folder);
  }

  const body = doc.getBody();
  centerReplaceBodyText_(body, "{{MONTH}}", normalized.monthName);
  centerReplaceBodyText_(body, "{{YEAR}}", String(normalized.year));
  centerReplaceBodyText_(body, "{{REPORT_DATE}}", centerFormatInputDateThai_(normalized.reportDate));
  centerReplaceBodyText_(body, "{{TODAY}}", centerFormatThaiDate_(new Date()));
  centerReplaceBodyText_(body, "{{TOTAL_ONLINE}}", String(normalized.totals.online));
  centerReplaceBodyText_(body, "{{TOTAL_INCOMING}}", String(normalized.totals.incoming));
  centerReplaceBodyText_(body, "{{TOTAL_MEDIATION}}", String(normalized.totals.mediation));
  centerReplaceBodyText_(body, "{{TOTAL_COURT}}", String(normalized.totals.court));
  centerReplaceBodyText_(body, "{{TOTAL_FINISHED}}", String(normalized.totals.totalFinished));
  centerReplaceBodyText_(body, "{{SHEET_COUNT}}", String(normalized.sheetCount));
  centerReplaceBodyText_(body, "{{WEEK_COUNT}}", String(normalized.sheetCount));
  centerReplaceBodyText_(body, "{{REPORT_DRAFT}}", normalized.note || "");
  centerReplaceBodyText_(body, "{{NOTE}}", normalized.note || "");

  if (!String(body.getText() || "").trim()) {
    body.appendParagraph("");
    body.appendParagraph("????????????????????????????????????????").setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph("??????????" + normalized.monthName + " ?.?. " + normalized.year);
    body.appendParagraph("????????????????? " + centerFormatThaiDate_(new Date()));
    body.appendParagraph("");
    body.appendParagraph("?????? ?????????????????????????????????????");
    body.appendParagraph("????? ??????????????");
    body.appendParagraph("?????????????????????????????????????????????????" + normalized.monthName + " ?.?. " + normalized.year + " ????????????????????");
  }

  centerAppendReportPhotosToDoc_(body, normalized);

  const yearly = getCenterReportYearlyStats(normalized.year);

  doc.saveAndClose();
  return {
    success: true,
    docId: doc.getId(),
    docUrl: doc.getUrl(),
    folderUrl: folder.getUrl(),
    name: doc.getName(),
    report: normalized,
    yearly: yearly
  };
}

/** ???????????????????? Drive ??????? metadata ???????????????????????????? */
function centerSaveReportPhotos_(report, newPhotos) {
  const existing = (report.photos || []).map(centerNormalizeReportPhoto_).filter(function(photo) {
    return photo.id;
  });
  const incoming = Array.isArray(newPhotos) ? newPhotos : [];
  if (existing.length + incoming.length > CENTER_REPORT_MAX_PHOTOS) {
    throw new Error("???????????????? " + CENTER_REPORT_MAX_PHOTOS + " ????????????");
  }
  if (!incoming.length) {
    report.photos = existing;
    return report;
  }

  const folder = centerGetReportEvidenceFolder_(report);
  incoming.forEach(function(item, index) {
    const photo = item || {};
    const mimeType = String(photo.mimeType || "").toLowerCase();
    const encoded = String(photo.data || "").replace(/^data:[^,]+,/, "");
    if (!/^image\/(jpeg|png|gif|webp)$/i.test(mimeType) || !encoded) {
      throw new Error("????????????????????? JPEG, PNG, GIF ???? WEBP");
    }
    const bytes = Utilities.base64Decode(encoded);
    if (bytes.length > CENTER_REPORT_MAX_PHOTO_BYTES) {
      throw new Error("??????????????????????????????? 6 MB");
    }
    const order = existing.length + index + 1;
    const originalName = centerSafePhotoName_(photo.name || ("image-" + order));
    const fileName = centerPhotoLabel_(order) + " - " + originalName;
    const file = folder.createFile(Utilities.newBlob(bytes, mimeType, fileName));
    existing.push(centerNormalizeReportPhoto_({
      id: file.getId(),
      name: originalName,
      order: order,
      mimeType: mimeType,
      url: file.getUrl(),
      thumbnailUrl: "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w1200",
      createdAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss")
    }));
  });
  report.photos = existing;
  report.evidenceFolderUrl = folder.getUrl();
  return report;
}

function centerGetReportEvidenceFolder_(report) {
  const root = bookGetOrCreateFolder_(CENTER_REPORT_FOLDER_NAME);
  const name = CENTER_REPORT_EVIDENCE_FOLDER_NAME + " - " + report.year + "-" + ("0" + report.month).slice(-2);
  const found = root.getFoldersByName(name);
  return found.hasNext() ? found.next() : root.createFolder(name);
}

function centerNormalizeReportPhoto_(photo) {
  photo = photo || {};
  const id = String(photo.id || "").trim();
  const order = Math.max(1, parseInt(photo.order, 10) || 1);
  return {
    id: id,
    name: String(photo.name || ("?????? " + order)),
    order: order,
    mimeType: String(photo.mimeType || "image/jpeg"),
    url: String(photo.url || (id ? "https://drive.google.com/open?id=" + id : "")),
    thumbnailUrl: String(photo.thumbnailUrl || (id ? "https://drive.google.com/thumbnail?id=" + id + "&sz=w1200" : "")),
    createdAt: String(photo.createdAt || "")
  };
}

function centerSafePhotoName_(name) {
  return String(name || "image").replace(/[\\/:*?"<>|]+/g, "-").replace(/^\.+/, "").substring(0, 120) || "image";
}

function centerPhotoLabel_(order) {
  return "?????? " + order;
}

function centerAppendReportPhotosToDoc_(body, report) {
  const photos = report.photos || [];
  if (!photos.length) return;
  body.appendPageBreak();
  body.appendParagraph("???????????????").setHeading(DocumentApp.ParagraphHeading.HEADING1);
  photos.forEach(function(photo, index) {
    try {
      const file = DriveApp.getFileById(photo.id);
      body.appendParagraph(centerPhotoLabel_(photo.order || (index + 1))).setHeading(DocumentApp.ParagraphHeading.HEADING2);
      const image = body.appendImage(file.getBlob());
      const width = image.getWidth();
      const height = image.getHeight();
      if (width > 460) image.setWidth(460).setHeight(Math.max(1, Math.round(height * 460 / width)));
    } catch (error) {
      body.appendParagraph(centerPhotoLabel_(photo.order || (index + 1)) + " (???????????????????)");
    }
  });
}

function centerBuildImportPrompt_(request) {
  const monthName = CENTER_REPORT_MONTHS[(parseInt(request.month, 10) || 1) - 1] || "";
  return [
    "?????????????????????????????????????????? ???????????? JSON ???????? ?????? markdown",
    "????????????????:",
    "{\"month\":1,\"year\":2569,\"activeSheet\":1,\"reportDate\":\"2026-01-26\",\"sheets\":[{\"title\":\"???????????? 2026-01-26\",\"reportDate\":\"2026-01-26\",\"rooms\":[{\"room\":\"????????????????? 2\",\"online\":0,\"incoming\":0,\"mediation\":0,\"court\":0}]}],\"note\":\"\"}",
    "??????????????:",
    "sheets = ?????????????????????????????? ??? 1 sheet ??? 1 ??????????????",
    "??????? sheets[].rooms ????????????????????????????????????",
    "room = ???????? ???? ????????????????? 2",
    "online = ????????????????????????????????",
    "incoming = ????????????????????? ?",
    "mediation = ????????????????????????????????????? ?",
    "court = ?????????????????????????????????",
    "??????????????????/?????????? 0 ???????????????????????????",
    "???????????????????: " + monthName + " " + (request.year || ""),
    "??????????????????????????: " + (request.reportDate || ""),
    request.sourceText ? "?????????????:\n" + request.sourceText : ""
  ].join("\n\n");
}

function centerExtractJson_(text) {
  let clean = String(text || "").trim();
  clean = clean.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) clean = clean.substring(start, end + 1);
  try {
    return JSON.parse(clean);
  } catch (error) {
    throw new Error("Gemini ????????????? ??????? JSON ?????????: " + error.message);
  }
}

function centerNormalizeReport_(report, options) {
  options = options || {};
  const now = new Date();
  const month = Math.max(1, Math.min(12, parseInt(report.month, 10) || (now.getMonth() + 1)));
  const year = parseInt(report.year, 10) || (now.getFullYear() + 543);
  let rawSheets = (report.sheets && report.sheets.length) ? report.sheets : [];
  if (!rawSheets.length) {
    const legacyRows = (report.rooms && report.rooms.length) ? report.rooms : (report.weeks || []);
    rawSheets = [{ title: "????? 1", reportDate: report.reportDate, rooms: legacyRows }];
  }
  const sheets = rawSheets.slice(0, CENTER_REPORT_MAX_DAYS).map(function (sheet, idx) {
    return centerNormalizeSheet_(sheet, idx, report.reportDate);
  });
  if (!sheets.length) sheets.push(centerNormalizeSheet_({ reportDate: report.reportDate, rooms: [] }, 0, report.reportDate));
  const sheetCount = sheets.length;
  const activeSheet = Math.max(1, Math.min(sheetCount, parseInt(report.activeSheet, 10) || 1));
  if (options.markActiveSheetSaved && sheets[activeSheet - 1]) {
    sheets[activeSheet - 1].savedAt = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  }
  const activeRows = (sheets[activeSheet - 1] && sheets[activeSheet - 1].rooms) || [];
  const normalized = {
    month: month,
    monthName: CENTER_REPORT_MONTHS[month - 1],
    year: year,
    sheetCount: sheetCount,
    activeSheet: activeSheet,
    reportDate: report.reportDate || (sheets[0] && sheets[0].reportDate) || Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd"),
    sheets: sheets,
    rooms: activeRows,
    note: String(report.note || ""),
    sourceName: String(report.sourceName || ""),
    chartImage: String(report.chartImage || ""),
    photos: (report.photos || []).map(centerNormalizeReportPhoto_).filter(function(photo) { return photo.id; }),
    evidenceFolderUrl: String(report.evidenceFolderUrl || "")
  };
  normalized.totals = centerTotals_(centerReportRows_(normalized));
  normalized.updatedAt = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  return normalized;
}

function centerNormalizeSheet_(sheet, idx, fallbackDate) {
  sheet = sheet || {};
  const rows = sheet.rooms || sheet.rows || sheet.weeks || [];
  const rooms = rows.map(function (row, rowIdx) {
    return {
      room: String(row.room || row.label || row.week || "").trim() || ("????????????????? " + (rowIdx + 1)),
      online: centerNumber_(row.online),
      incoming: centerNumber_(row.incoming),
      mediation: centerNumber_(row.mediation),
      court: centerNumber_(row.court)
    };
  }).filter(function (row) {
    return row.room || row.online || row.incoming || row.mediation || row.court;
  });
  return {
    title: String(sheet.title || "").trim() || ("????? " + (idx + 1)),
    reportDate: String(sheet.reportDate || sheet.date || fallbackDate || ""),
    rooms: rooms,
    onlineCases: (sheet.onlineCases || []).map(centerNormalizeOnlineCase_).filter(function(item) {
      return item.caseNo;
    }),
    savedAt: String(sheet.savedAt || "")
  };
}

function centerNormalizeOnlineCase_(item) {
  item = item || {};
  return {
    caseNo: String(item.caseNo || "").trim(),
    benchNo: String(item.benchNo || "").trim(),
    plaintiff: String(item.plaintiff || "").trim(),
    defendant: String(item.defendant || "").trim(),
    mediation: centerBoolean_(item.mediation),
    incoming: centerBoolean_(item.incoming),
    court: centerBoolean_(item.court)
  };
}

function centerBoolean_(value) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function centerReportRows_(report) {
  if (report && report.sheets && report.sheets.length) {
    return report.sheets.reduce(function (all, sheet) {
      return all.concat((sheet && sheet.rooms) || []);
    }, []);
  }
  return (report && (report.weeks || report.rooms)) || [];
}

function centerTotals_(rows) {
  const totals = { online: 0, incoming: 0, mediation: 0, court: 0, totalFinished: 0 };
  (rows || []).forEach(function (row) {
    totals.online += centerNumber_(row.online);
    totals.incoming += centerNumber_(row.incoming);
    totals.mediation += centerNumber_(row.mediation);
    totals.court += centerNumber_(row.court);
  });
  totals.totalFinished = totals.mediation + totals.court;
  return totals;
}

function centerNumber_(value) {
  const n = Number(String(value || 0).replace(/[^\d.-]/g, ""));
  return isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function centerReportKey_(yearBE, month) {
  const y = parseInt(yearBE, 10) || (new Date().getFullYear() + 543);
  const m = Math.max(1, Math.min(12, parseInt(month, 10) || 1));
  return CENTER_REPORT_PROP_PREFIX + y + "_" + ("0" + m).slice(-2);
}

function centerReportTitle_(report) {
  return "????????????????????????????????? - " + report.monthName + " " + report.year;
}

function centerReplaceBodyText_(body, pattern, value) {
  try {
    body.replaceText(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), String(value || ""));
  } catch (error) {}
}

function centerChartBlob_(dataUrl, name) {
  const match = String(dataUrl || "").match(/^data:image\/png;base64,(.+)$/);
  if (!match) return null;
  return Utilities.newBlob(Utilities.base64Decode(match[1]), "image/png", name || "chart.png");
}

function centerFormatInputDateThai_(value) {
  if (!value) return centerFormatThaiDate_(new Date());
  const parts = String(value).split("-");
  if (parts.length === 3) {
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return centerFormatThaiDate_(date);
  }
  return String(value);
}

function centerFormatThaiDate_(date) {
  const d = date || new Date();
  const dayNames = ["??????????", "?????????", "?????????", "??????", "???????????", "????????", "????????"];
  return dayNames[d.getDay()] + "??? " + d.getDate() + " " + CENTER_REPORT_MONTHS[d.getMonth()] + " " + (d.getFullYear() + 543);
}

function setupGeminiApiKey() {
  const apiKey = "PASTE_REAL_GEMINI_API_KEY_HERE";
  return setGeminiApiKeyForBookManager(apiKey);
}

function checkGeminiApiKey() {
  const result = validateGeminiApiKeyForBookManager();
  Logger.log(JSON.stringify(result));
  return result;
}

function setupGeminiLimits() {
  setGeminiUsageLimitsForBookManager("10", "500", "250000");
}

/* ============================================================
 *  ??????????? Meet ???????????????? (Server / Code.gs)
 *  ???????? JPEG ?????????????? "??????? Meet" ?????????????????????????????????
 *  ??????????????? + ??????? Script Properties (?????????????)
 *  ??????????????????????? "??????????????????" ???? meetAttachEvidenceToBody_()
 * ============================================================ */

const MEET_EVIDENCE_FOLDER_NAME = "??????? Meet";
const MEET_INDEX_PROP_PREFIX = "MEET_EVIDENCE_INDEX_";
const MEET_DOC_IMAGE_MAX_WIDTH = 460; // ??? (points) ???? A4 ?????????

/** ???????????? "??????" (??????? ? ???????????????????????????????) */
function meetIndexKey_() {
  const tz = Session.getScriptTimeZone() || "Asia/Bangkok";
  return MEET_INDEX_PROP_PREFIX + Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
}

function meetReadIndex_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(meetIndexKey_()) || "{}") || {};
  } catch (e) {
    return {};
  }
}

function meetWriteIndex_(idx) {
  PropertiesService.getScriptProperties().setProperty(meetIndexKey_(), JSON.stringify(idx || {}));
}

function meetSafeName_(text) {
  return String(text || "").replace(/[\/\\:\*\?"<>\|]/g, "-").trim() || "???????";
}

/** ??/????????????? "??????? Meet" ?????????????????????????????? (????????????????) */
function meetGetEvidenceFolder_() {
  const mainFolder = getOrCreateFolder(MAIN_FOLDER_NAME);
  const dateFolder = getOrCreateDateFolder(mainFolder, new Date());
  const subs = dateFolder.getFoldersByName(MEET_EVIDENCE_FOLDER_NAME);
  const folder = subs.hasNext() ? subs.next() : dateFolder.createFolder(MEET_EVIDENCE_FOLDER_NAME);
  return { dateFolder: dateFolder, folder: folder };
}

/** ???????????????????????????????? (???????????????) ? ??? null ??????????? */
function meetFindEvidenceFolder_() {
  const mains = DriveApp.getFoldersByName(MAIN_FOLDER_NAME);
  if (!mains.hasNext()) return null;
  const main = mains.next();
  const dateName = formatThaiDate(new Date());
  const dfs = main.getFoldersByName(dateName);
  if (!dfs.hasNext()) return null;
  const df = dfs.next();
  const subs = df.getFoldersByName(MEET_EVIDENCE_FOLDER_NAME);
  return subs.hasNext() ? subs.next() : null;
}

/**
 * ????????? Meet (?????????????????? + ??????????????? client ????)
 * @param {Object} payload { caseNo, dataUrl, replace }
 *   dataUrl = "data:image/jpeg;base64,..." (?????? png ????)
 *   replace = true ? ????????????????????????????????????????
 */
function meetSaveImage(payload) {
  payload = payload || {};
  const caseNo = String(payload.caseNo || "").trim();
  if (!caseNo) throw new Error("??????????? ? ???????????????????????");

  const dataUrl = String(payload.dataUrl || "");
  const m = dataUrl.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  if (!m) throw new Error("???????????????? (???????? JPEG ???? PNG)");

  const mimeType = m[1];
  const ext = (mimeType === "image/png") ? "png" : "jpg";
  const bytes = Utilities.base64Decode(m[2]);

  const ctx = meetGetEvidenceFolder_();
  const idx = meetReadIndex_();

  if (payload.replace) {
    (idx[caseNo] || []).forEach(function (it) {
      try { DriveApp.getFileById(it.id).setTrashed(true); } catch (e) {}
    });
    idx[caseNo] = [];
  }

  const list = idx[caseNo] || [];
  const seq = list.length + 1;
  const name = "Meet " + meetSafeName_(caseNo) + " (" + seq + ")." + ext;
  const blob = Utilities.newBlob(bytes, mimeType, name);
  const file = ctx.folder.createFile(blob);

  const info = {
    id: file.getId(),
    url: file.getUrl(),
    name: name,
    ts: new Date().toISOString()
  };
  list.push(info);
  idx[caseNo] = list;
  meetWriteIndex_(idx);

  return {
    success: true,
    caseNo: caseNo,
    count: list.length,
    file: info,
    folderUrl: ctx.folder.getUrl()
  };
}

/** ??????????????????????????????? + ????????????? (??????????????????) */
function meetGetEvidence() {
  const folder = meetFindEvidenceFolder_();
  return {
    index: meetReadIndex_(),
    folderUrl: folder ? folder.getUrl() : ""
  };
}

/** ????????????? */
function meetDeleteImage(payload) {
  payload = payload || {};
  const caseNo = String(payload.caseNo || "").trim();
  const fileId = String(payload.fileId || "");
  if (!caseNo || !fileId) throw new Error("??????????????????????????");

  const idx = meetReadIndex_();
  const list = (idx[caseNo] || []).filter(function (it) {
    if (it.id === fileId) {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
      return false;
    }
    return true;
  });
  idx[caseNo] = list;
  meetWriteIndex_(idx);
  return { success: true, caseNo: caseNo, count: list.length };
}

/** ?????????????????????????????? A4 */
function meetFitImage_(image) {
  try {
    const w = image.getWidth();
    const h = image.getHeight();
    if (w > MEET_DOC_IMAGE_MAX_WIDTH) {
      const ratio = MEET_DOC_IMAGE_MAX_WIDTH / w;
      image.setWidth(MEET_DOC_IMAGE_MAX_WIDTH);
      image.setHeight(Math.round(h * ratio));
    }
  } catch (e) {}
}

/** ????????????????????????? A4 (??????????????????????? center) */
function meetCenterImage_(image) {
  try {
    const parent = image.getParent();
    if (parent && parent.getType() === DocumentApp.ElementType.PARAGRAPH) {
      parent.asParagraph().setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    }
  } catch (e) {}
}

/**
 * ??????? Meet ???? body ??????????????????
 *  - ????? {{MEET_EVIDENCE}} ? ?????????????? (???????????????????)
 *  - ???????? ? ????????????????? "?????????"
 *  - ???????????????? {{MEET_EVIDENCE}} ? ?? placeholder ???? ??????????????????
 */
function meetAttachEvidenceToBody_(body, caseData) {
  try {
    const caseNo = String((caseData && caseData.caseNo) || "").trim();
    const idx = caseNo ? meetReadIndex_() : {};
    const list = (caseNo && idx[caseNo]) ? idx[caseNo] : [];

    const blobs = [];
    list.forEach(function (it) {
      try { blobs.push(DriveApp.getFileById(it.id).getBlob()); } catch (e) {}
    });

    const found = body.findText("\\{\\{MEET_EVIDENCE\\}\\}");

    if (found) {
      // ?????????????? placeholder (?????????????????????????????????)
      try {
        found.getElement().asText().deleteText(found.getStartOffset(), found.getEndOffsetInclusive());
      } catch (e) {}

      if (blobs.length) {
        // ??????????????????? body ??????????????????
        let child = found.getElement();
        while (child.getParent() && child.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION) {
          child = child.getParent();
        }
        let insertAt;
        if (child.getParent() && child.getParent().getType() === DocumentApp.ElementType.BODY_SECTION) {
          insertAt = body.getChildIndex(child) + 1;
        } else {
          insertAt = body.getNumChildren();
        }
        blobs.forEach(function (blob) {
          const img = body.insertImage(insertAt++, blob);
          meetFitImage_(img);
          meetCenterImage_(img);
        });
      }
      return;
    }

    // ????? placeholder ? ????????????????? "?????????"
    if (blobs.length) {
      body.appendParagraph("");
      body.appendParagraph("?????????")
        .setHeading(DocumentApp.ParagraphHeading.HEADING2)
        .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
      blobs.forEach(function (blob) {
        const img = body.appendImage(blob);
        meetFitImage_(img);
        meetCenterImage_(img);
      });
    }
  } catch (e) {
    Logger.log("meetAttachEvidenceToBody_ error: " + e.message);
  }
}

/**
 * ====== ????? OCR ????????? T.N.K. ??? ======
 * ?????????? T.N.K. ??? ?????????? "????????????" ???? Gemini ????????????????????????
 * - ??? GEMINI_API_KEY / ????????? / ????????????????????????? (??????????????????)
 * - ??????????????????? doPost ??????? ?????? action ??????? doPost ???
 *
 * ??????????????:
 *   1) ???? OCR_SHARED_KEY ?????????????????? T.N.K. ??? (??????????? TNK-OCR-2026)
 *   2) Deploy -> Manage deployments -> New version -> Deploy
 *      ???? Who has access = Anyone ????????????????????????????
 *   3) ?????? URL ????????? /exec ????? OCR_ENDPOINT_URL ?????? T.N.K. ??? ???? Deploy ??????????????
 */
const OCR_SHARED_KEY = 'TNK-OCR-2026';

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    if (body.action === 'ocr') {
      if (String(body.key || '') !== OCR_SHARED_KEY) return ocrJson_({ ok: false, error: 'unauthorized' });
      if (!body.image) return ocrJson_({ ok: false, error: 'no image' });
      var text = footballOcrViaGemini_(body.image, body.mimeType);
      return ocrJson_({ ok: true, text: String(text || '').trim() });
    }

    return ocrJson_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return ocrJson_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** ????????? Gemini ???? "????????" ????????????????????????? */
function footballOcrViaGemini_(base64Data, mimeType) {
  var eff = bookEffectiveLimits_();
  var used = bookGetTodayUsage_();
  if (used.requests >= eff.rpd) {
    throw new Error('????????? Gemini ??????????????? (' + used.requests + '/' + eff.rpd + ' ????) ????????????????????');
  }

  var apiKey = bookGetGeminiApiKey_();
  bookAssertGeminiApiKeyLooksValid_(apiKey);
  var model = bookNormalizeGeminiModel_(
    PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL') || BOOK_MANAGER_DEFAULT_MODEL);

  var mt = String(mimeType || 'image/jpeg').toLowerCase();
  if (!/^image\//.test(mt)) mt = 'image/jpeg';

  var sizeBytes = Math.floor(String(base64Data).length * 3 / 4);
  if (sizeBytes > BOOK_MANAGER_MAX_INLINE_BYTES) {
    throw new Error('??????????? ' + Math.floor(BOOK_MANAGER_MAX_INLINE_BYTES / 1024 / 1024) + ' MB ???????????????');
  }

  var prompt = [
    '???? "??????????????????" ?????????',
    '???????????????????????? ???????? 1 ??? ??????:  ???????? ?????-????? ????????',
    '????????:  ????? 2-1 ?????',
    '??: ???????????????????????????????, ??????????????????????????????????????? -',
    '???????????? ???????? ???????? ????????????????? ???????????????????????????????'
  ].join('\n');

  var payload = {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType: mt, data: String(base64Data) } }
      ]
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048 }
  };

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent';
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var status = resp.getResponseCode();
  var data = {};
  try { data = JSON.parse(resp.getContentText() || '{}'); } catch (e) {}

  if (status < 200 || status >= 300) {
    bookRecordUsage_(null, status, resp.getAllHeaders ? resp.getAllHeaders() : {});
    var msg = (data && data.error && data.error.message) ? data.error.message : resp.getContentText();
    throw new Error(bookFriendlyGeminiError_(status, msg));
  }

  bookRecordUsage_(data.usageMetadata || {}, status, resp.getAllHeaders ? resp.getAllHeaders() : {});
  var text = bookExtractGeminiText_(data);
  return String(text || '')
    .split(/\r?\n/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return /\d+\s*[-:]\s*\d+/.test(s); })
    .join('\n');
}

function ocrJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
