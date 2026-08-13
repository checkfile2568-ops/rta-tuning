const APP_ = Object.freeze({
  NAME: 'เอกสารรายงานการส่งหมาย',
  CONFIG_PROPERTY: 'NOTICE_REPORT_CONFIG_SPREADSHEET_ID',
  TIMEZONE: 'Asia/Bangkok',
  CONFIG_SHEET: 'การตั้งค่า',
  ADMIN_SHEET: 'ผู้ดูแล',
  ACCESS_SHEET: 'ผู้มีสิทธิ์โฟลเดอร์',
  OUTPUT_SHEET: 'เอกสารรายงานการส่งหมาย',
  LEDGER_SHEET: 'รายการเอกสาร',
  DAILY_FOLDER_INDEX_SHEET: 'โฟลเดอร์รายวัน',
  MONTHLY_FOLDER_INDEX_SHEET: 'โฟลเดอร์รายเดือน',
  LINE_MONTHLY_INDEX_SHEET: 'LINE-ค้นหาส่งหมายรายเดือน',
  SYSTEM_LOG_SHEET: 'บันทึกระบบ',
  RELEASE_VERSION: '2026.08-rc2',
  TRIGGER_HANDLER: 'runScheduledReport',
  AUTOMATION_OWNER_PROPERTY: 'NOTICE_AUTOMATION_TRIGGER_OWNER',
  AUTOMATION_DIRTY_PROPERTY: 'NOTICE_AUTOMATION_DAY_DIRTY'
});

// A single job is stopped cleanly at a record boundary once this budget is used,
// so it never gets hard-killed by the 6-minute Apps Script limit mid-write.
const MAX_RUN_MILLIS_ = 4.5 * 60 * 1000;

const DEFAULT_SETTINGS_ = Object.freeze({
  DISPLAY_DATE_FORMAT: 'full',
  AUTOMATION_DAY: 'monday',
  DOCUMENT_TITLE: 'รายงานผลการส่งหมาย',
  DOCUMENT_FONT: 'TH Sarabun New',
  PHOTO_HEIGHT_MM: '148',
  HOUSE_FONT_SIZE_PT: '42',
  PHOTO_FIT: 'contain',
  PHOTO_QUALITY: 'normal',
  SOURCE_SPREADSHEET_ID: '',
  SOURCE_SHEET_NAME: '',
  SOURCE_HEADER_ROW: '1',
  SOURCE_DATE_COLUMN: '',
  SOURCE_HOUSE_COLUMN: '',
  SOURCE_IMAGE_FILE_ID_COLUMN: '',
  SOURCE_IMAGE_URL_COLUMN: '',
  SOURCE_RECORD_ID_COLUMN: '',
  SOURCE_GROUP_COLUMN: '',
  ROOT_FOLDER_ID: ''
});

/** Opens the protected administrator UI. Deploy this project as a web app. */
function doGet() {
  // Do not return even the shell page until the account is an approved administrator.
  // This requires the web app to be deployed as "User accessing the web app".
  assertAdmin_();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_.NAME)
    // Required only for the trusted GitHub Pages wrapper; all data operations
    // still require Google sign-in and an ADMIN row in the configuration sheet.
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * One-time installer. Run it from the Apps Script editor while signed in as
 * the first administrator. It creates only NEW configuration/output assets;
 * it never changes the source spreadsheet used by the LINE bot.
 */
function setupProject() {
  assertScriptTimezone_();
  const properties = PropertiesService.getScriptProperties();
  const existingId = properties.getProperty(APP_.CONFIG_PROPERTY);
  if (existingId) {
    return { ok: true, reused: true, configSpreadsheetUrl: SpreadsheetApp.openById(existingId).getUrl() };
  }

  const installerEmail = getInstallerEmail_();
  if (!installerEmail) {
    throw new Error('ไม่พบอีเมลผู้ติดตั้ง โปรดรัน setupProject จากบัญชี Google Workspace ที่ใช้เป็นผู้ดูแลระบบ');
  }

  const configSpreadsheet = SpreadsheetApp.create(`${APP_.NAME} - การตั้งค่า`);
  const firstSheet = configSpreadsheet.getSheets()[0];
  firstSheet.setName(APP_.CONFIG_SHEET);
  const adminSheet = configSpreadsheet.insertSheet(APP_.ADMIN_SHEET);
  const accessSheet = configSpreadsheet.insertSheet(APP_.ACCESS_SHEET);
  const outputSheet = configSpreadsheet.insertSheet(APP_.OUTPUT_SHEET);
  const ledgerSheet = configSpreadsheet.insertSheet(APP_.LEDGER_SHEET);
  const dailyFolderIndexSheet = configSpreadsheet.insertSheet(APP_.DAILY_FOLDER_INDEX_SHEET);
  const monthlyFolderIndexSheet = configSpreadsheet.insertSheet(APP_.MONTHLY_FOLDER_INDEX_SHEET);
  const lineMonthlyIndexSheet = configSpreadsheet.insertSheet(APP_.LINE_MONTHLY_INDEX_SHEET);
  const systemLogSheet = configSpreadsheet.insertSheet(APP_.SYSTEM_LOG_SHEET);

  setupConfigSheet_(firstSheet);
  setupAdminSheet_(adminSheet, installerEmail);
  setupAccessSheet_(accessSheet, installerEmail);
  setupOutputSheet_(outputSheet);
  setupLedgerSheet_(ledgerSheet);
  setupDailyFolderIndexSheet_(dailyFolderIndexSheet);
  setupMonthlyFolderIndexSheet_(monthlyFolderIndexSheet);
  setupLineMonthlyIndexSheet_(lineMonthlyIndexSheet);
  setupSystemLogSheet_(systemLogSheet);

  // Store the ID before using helpers that resolve the configuration workbook.
  properties.setProperty(APP_.CONFIG_PROPERTY, configSpreadsheet.getId());

  const rootFolder = DriveApp.createFolder(APP_.NAME);
  rootFolder.setDescription('โฟลเดอร์ผลลัพธ์ที่สร้างโดยระบบเอกสารรายงานการส่งหมาย');
  setSettings_({ ROOT_FOLDER_ID: rootFolder.getId() });

  installOrReplaceTrigger_('monday');
  properties.setProperty(APP_.AUTOMATION_OWNER_PROPERTY, installerEmail);
  logSystemEvent_('SETUP', 'INFO', 'สร้างโครงสร้างระบบ Release Candidate แล้ว', { rootFolderId: rootFolder.getId(), automationOwner: installerEmail });

  return {
    ok: true,
    configSpreadsheetUrl: configSpreadsheet.getUrl(),
    rootFolderUrl: rootFolder.getUrl(),
    message: 'สร้างการตั้งค่า โฟลเดอร์ และรอบทุกวันจันทร์ 18.00 น. แล้ว'
  };
}

/** Data needed when the admin page opens. */
function getBootstrap() {
  const email = assertAdmin_();
  ensureAutomationTriggerForOwner_(email); // Keep exactly one trigger, owned by the automation owner.
  const settings = getSettings_();
  const automationOwner = getAutomationOwner_();
  return {
    appName: APP_.NAME,
    userEmail: email,
    settings: publicSettings_(settings),
    accounts: getAccessAccounts_(),
    admins: getAdministrators_(),
    automationOwner: automationOwner,
    isAutomationOwner: !automationOwner || automationOwner === email,
    dashboard: getDashboardData_(),
    health: getSystemHealth_(),
    outputRows: searchOutputRows(''),
    configured: Boolean(settings.SOURCE_SPREADSHEET_ID && settings.SOURCE_SHEET_NAME)
  };
}

/** Saves permitted administrator-facing settings. Secrets are never accepted from the browser. */
function saveAdminSettings(patch) {
  assertAdmin_();
  const allowed = [
    'DISPLAY_DATE_FORMAT', 'DOCUMENT_TITLE', 'DOCUMENT_FONT', 'PHOTO_HEIGHT_MM',
    'HOUSE_FONT_SIZE_PT', 'PHOTO_FIT', 'PHOTO_QUALITY', 'SOURCE_SPREADSHEET_ID', 'SOURCE_SHEET_NAME',
    'SOURCE_HEADER_ROW', 'SOURCE_DATE_COLUMN', 'SOURCE_HOUSE_COLUMN',
    'SOURCE_IMAGE_FILE_ID_COLUMN', 'SOURCE_IMAGE_URL_COLUMN', 'SOURCE_RECORD_ID_COLUMN',
    'SOURCE_GROUP_COLUMN', 'ROOT_FOLDER_ID'
  ];
  const sanitized = {};
  (patch && typeof patch === 'object' ? Object.keys(patch) : []).forEach((key) => {
    if (!allowed.includes(key)) return;
    sanitized[key] = validateSetting_(key, patch[key]);
  });
  setSettings_(sanitized);
  if (Object.prototype.hasOwnProperty.call(sanitized, 'DISPLAY_DATE_FORMAT')) refreshOutputDateDisplay_();
  return getBootstrap();
}

/** Only Monday, Wednesday, and Friday at 18:00 Bangkok time are available. */
function saveAutomationDay(day) {
  const email = assertAdmin_();
  if (!['monday', 'wednesday', 'friday'].includes(day)) throw new Error('รอบอัตโนมัติไม่ถูกต้อง');
  setSettings_({ AUTOMATION_DAY: day });
  const properties = PropertiesService.getScriptProperties();
  const owner = getAutomationOwner_();
  // Only the automation owner holds the single scheduled trigger. This prevents each admin
  // from creating their own duplicate trigger (getProjectTriggers only returns the caller's).
  if (!owner || owner === email) {
    if (!owner) properties.setProperty(APP_.AUTOMATION_OWNER_PROPERTY, email);
    installOrReplaceTrigger_(day);
    properties.deleteProperty(APP_.AUTOMATION_DIRTY_PROPERTY);
    return { ok: true, day: day, label: automationLabel_(day), applied: true };
  }
  // A non-owner admin's change is saved but applied by the owner on their next visit.
  properties.setProperty(APP_.AUTOMATION_DIRTY_PROPERTY, '1');
  logSystemEvent_('AUTOMATION_DAY_PENDING', 'INFO', 'บันทึกรอบใหม่ รอบัญชีเจ้าของรอบใช้งาน', { day: day, owner: owner, requestedBy: email });
  return {
    ok: true, day: day, label: automationLabel_(day), applied: false, owner: owner,
    message: `บันทึกรอบเป็น “${automationLabel_(day)}” แล้ว แต่ต้องให้บัญชีเจ้าของรอบ (${owner}) เข้าสู่ระบบเพื่อใช้งานรอบ เพื่อป้องกัน trigger ซ้ำ`
  };
}

/** Runs with filters selected by the administrator immediately. */
function runImmediate(filters) {
  assertAdmin_();
  return runManagedJob_(filters || {}, 'manual');
}

/** Trigger entry point. It intentionally processes only the latest seven days and skips ledger duplicates. */
function runScheduledReport() {
  const today = startOfDay_(new Date());
  const from = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  return runManagedJob_({ from: formatIso_(from), to: formatIso_(today) }, 'scheduled');
}

function addAuthorizedAccount(account) {
  assertAdmin_();
  const email = String(account && account.email || '').trim().toLowerCase();
  const role = String(account && account.role || 'VIEWER').toUpperCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  if (!['VIEWER', 'EDITOR'].includes(role)) throw new Error('สิทธิ์ต้องเป็น VIEWER หรือ EDITOR');

  const sheet = getSheet_(APP_.ACCESS_SHEET);
  const existing = getAccessAccounts_();
  if (!existing.some((item) => item.email === email)) sheet.appendRow([email, role, new Date(), getActiveUserEmail_()]);
  syncAccessToExistingFolders_();
  return getAccessAccounts_();
}

function removeAuthorizedAccount(email) {
  assertAdmin_();
  const target = String(email || '').trim().toLowerCase();
  const sheet = getSheet_(APP_.ACCESS_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let row = values.length - 1; row >= 1; row -= 1) {
    if (String(values[row][0]).toLowerCase() === target) sheet.deleteRow(row + 1);
  }
  const revoked = revokeAccessFromManagedFolders_(target);
  logSystemEvent_('ACCESS_REVOKED', 'INFO', 'นำบัญชีออกจากสิทธิ์โฟลเดอร์ที่ระบบดูแล', { revoked: revoked });
  return getAccessAccounts_();
}

/**
 * Adds an administrator (ADMIN) and shares the assets the system owns — the configuration
 * spreadsheet and the root output folder — with them, so a USER_ACCESSING deployment works for
 * the new admin without manual sharing. The read-only source spreadsheet is owned elsewhere
 * (the LINE bot) and must be shared for reading by its own owner.
 */
function addAdministrator(account) {
  const actor = assertAdmin_();
  const email = String(account && account.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  const sheet = getSheet_(APP_.ADMIN_SHEET);
  if (!getAdministrators_().some((admin) => admin.email === email)) sheet.appendRow([email, 'ADMIN', new Date()]);
  const shared = shareManagedAssetsWith_(email);
  logSystemEvent_('ADMIN_ADDED', 'INFO', 'เพิ่มผู้ดูแลระบบและแชร์สิทธิ์ทรัพยากรที่ระบบเป็นเจ้าของ', { email: email, actor: actor, shared: shared });
  return getAdministrators_();
}

/** Removes an administrator. It never revokes previously shared Drive access, to avoid lockouts. */
function removeAdministrator(email) {
  const actor = assertAdmin_();
  const target = String(email || '').trim().toLowerCase();
  if (target === actor) throw new Error('ไม่สามารถถอนสิทธิ์ผู้ดูแลของบัญชีตนเองได้');
  const admins = getAdministrators_();
  if (admins.length <= 1) throw new Error('ต้องมีผู้ดูแลระบบอย่างน้อยหนึ่งบัญชี');
  if (target === getAutomationOwner_()) throw new Error('บัญชีนี้เป็นเจ้าของรอบอัตโนมัติ โปรดตั้งเจ้าของรอบใหม่ก่อนถอนสิทธิ์');
  const sheet = getSheet_(APP_.ADMIN_SHEET);
  const values = sheet.getDataRange().getValues();
  for (let row = values.length - 1; row >= 1; row -= 1) {
    if (String(values[row][0]).toLowerCase() === target && String(values[row][1]).toUpperCase() === 'ADMIN') sheet.deleteRow(row + 1);
  }
  logSystemEvent_('ADMIN_REMOVED', 'INFO', 'ถอนสิทธิ์ผู้ดูแลระบบ (ไม่ยกเลิกสิทธิ์ Drive ที่เคยแชร์)', { email: target, actor: actor });
  return getAdministrators_();
}

/** Shares the config spreadsheet and root output folder (both owned by the system) with an admin. */
function shareManagedAssetsWith_(email) {
  const shared = { configSpreadsheet: false, rootFolder: false };
  try { getConfigSpreadsheet_().addEditor(email); shared.configSpreadsheet = true; } catch (error) { /* Already shared, or the caller lacks sharing rights. */ }
  try {
    const rootId = getSettings_().ROOT_FOLDER_ID;
    if (rootId) { DriveApp.getFolderById(rootId).addEditor(email); shared.rootFolder = true; }
  } catch (error) { /* Missing or inaccessible root folder is skipped. */ }
  return shared;
}

/** Searches the output table by any supported Thai date representation. */
function searchOutputRows(query) {
  assertAdmin_();
  const displayFormat = getSettings_().DISPLAY_DATE_FORMAT; // Read once, not once per row.
  const sheet = getSheet_(APP_.OUTPUT_SHEET);
  const values = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues() : [];
  const normalizedQuery = normalizeDateSearch_(query);
  return values.map((row) => {
    const date = parseFlexibleDate_(row[0]);
    const dateInfo = date ? makeDateInfo_(date, displayFormat) : null;
    return {
      date: row[0],
      link: row[1],
      note: row[2],
      aliases: dateInfo ? dateInfo.aliases : []
    };
  }).filter((row) => !normalizedQuery || row.aliases.some((alias) => normalizeDateSearch_(alias).includes(normalizedQuery)));
}

function getInstallationInfo() {
  assertAdmin_();
  const settings = getSettings_();
  return {
    configSpreadsheetUrl: getConfigSpreadsheet_().getUrl(),
    rootFolderUrl: settings.ROOT_FOLDER_ID ? DriveApp.getFolderById(settings.ROOT_FOLDER_ID).getUrl() : '',
    sourceConfigured: Boolean(settings.SOURCE_SPREADSHEET_ID && settings.SOURCE_SHEET_NAME)
  };
}

function runManagedJob_(filters, runType) {
  const runId = Utilities.getUuid();
  return withScriptLock_(function () {
    assertScriptTimezone_();
    assertReleaseReadyForWrite_();
    const startedAt = new Date();
    logSystemEvent_('REPORT_RUN_STARTED', 'INFO', 'เริ่มประมวลผลเอกสารรายงานการส่งหมาย', { runId: runId, runType: runType, filters: filters || {} });
    try {
      const result = generateReports_(filters, runType);
      refreshLineMonthlyIndex_();
      result.runId = runId;
      result.finishedAt = new Date().toISOString();
      logSystemEvent_('REPORT_RUN_FINISHED', result.errors.length ? 'WARNING' : 'INFO', 'ประมวลผลเอกสารเสร็จแล้ว', {
        runId: runId,
        runType: runType,
        created: result.created,
        skipped: result.skipped,
        errors: result.errors.length,
        durationSeconds: Math.round((new Date().getTime() - startedAt.getTime()) / 1000)
      });
      return result;
    } catch (error) {
      logSystemEvent_('REPORT_RUN_FAILED', 'ERROR', 'ประมวลผลเอกสารไม่สำเร็จ', {
        runId: runId,
        runType: runType,
        message: error && error.message ? error.message : String(error)
      });
      throw error;
    }
  });
}

function generateReports_(filters, runType) {
  const settings = Object.assign({}, getSettings_(), {
    PHOTO_QUALITY: filters && filters.quality === 'low' ? 'low' : 'normal'
  });
  assertSourceConfigured_(settings);
  const records = readSourceRecords_(filters, settings);
  const ledger = getLedgerKeys_();
  const touchedDates = {};
  const result = { created: 0, skipped: 0, errors: [], runType: runType, partial: false, remaining: 0 };

  const deadline = Date.now() + MAX_RUN_MILLIS_;
  for (let index = 0; index < records.length; index += 1) {
    // Stop before starting a new record once the time budget is spent. Each started
    // record finishes (create document -> append ledger) before the next check, so the
    // ledger never ends up out of sync with Drive and the next run resumes cleanly.
    if (Date.now() > deadline) {
      result.partial = true;
      result.remaining = records.length - index;
      break;
    }
    const record = records[index];
    // Match either the new content-based key or the legacy row-based key already in the ledger.
    if (ledger[record.recordKey] || (record.legacyKey && ledger[record.legacyKey])) {
      result.skipped += 1;
      continue;
    }
    try {
      const folder = getOrCreateDailyFolder_(record.dateInfo, settings);
      const file = createGoogleDoc_(record, folder, settings);
      appendLedger_(record, file, folder);
      ledger[record.recordKey] = true; // Dedupe identical records within this same run too.
      touchedDates[record.dateInfo.iso] = record.dateInfo;
      result.created += 1;
    } catch (error) {
      result.errors.push({ recordKey: record.recordKey, message: error.message || String(error) });
    }
  }

  Object.keys(touchedDates).forEach((iso) => upsertFolderOutput_(touchedDates[iso], settings));
  result.message = `สร้าง ${result.created} เอกสาร ข้าม ${result.skipped} รายการ`;
  if (result.partial) {
    result.message += ` · ยังเหลือ ${result.remaining} รายการ (ใกล้ครบเวลาประมวลผล) กด “ประมวลผลทันที” อีกครั้งเพื่อทำต่อ`;
  }
  return result;
}

function readSourceRecords_(filters, settings) {
  const source = SpreadsheetApp.openById(settings.SOURCE_SPREADSHEET_ID);
  const sheet = source.getSheetByName(settings.SOURCE_SHEET_NAME);
  if (!sheet) throw new Error(`ไม่พบแท็บต้นทาง: ${settings.SOURCE_SHEET_NAME}`);

  const headerRow = Math.max(1, Number(settings.SOURCE_HEADER_ROW) || 1);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow <= headerRow || lastColumn === 0) return [];

  const headers = sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0];
  const dateIndex = findHeaderIndex_(headers, settings.SOURCE_DATE_COLUMN);
  const houseIndex = findHeaderIndex_(headers, settings.SOURCE_HOUSE_COLUMN);
  const imageIdIndex = findHeaderIndex_(headers, settings.SOURCE_IMAGE_FILE_ID_COLUMN);
  const imageUrlIndex = findHeaderIndex_(headers, settings.SOURCE_IMAGE_URL_COLUMN);
  const recordIdIndex = findHeaderIndex_(headers, settings.SOURCE_RECORD_ID_COLUMN);
  const groupIndex = findHeaderIndex_(headers, settings.SOURCE_GROUP_COLUMN);
  if (dateIndex < 0) throw new Error('ตั้งค่า SOURCE_DATE_COLUMN ให้ตรงกับชื่อหัวคอลัมน์ในชีตต้นทาง');
  if (imageIdIndex < 0 && imageUrlIndex < 0) throw new Error('ตั้งค่า SOURCE_IMAGE_FILE_ID_COLUMN หรือ SOURCE_IMAGE_URL_COLUMN อย่างน้อยหนึ่งช่อง');

  const values = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastColumn).getValues();
  const from = filters.from ? startOfDay_(parseFlexibleDate_(filters.from)) : null;
  const to = filters.to ? endOfDay_(parseFlexibleDate_(filters.to)) : null;
  const houseSearch = normalizeText_(filters.houseNumber || '');
  const records = [];

  values.forEach((row, offset) => {
    const date = parseFlexibleDate_(row[dateIndex]);
    if (!date || (from && date < from) || (to && date > to)) return;
    const houseNumber = houseIndex >= 0 ? String(row[houseIndex] || '').trim() : '';
    if (houseSearch && !normalizeText_(houseNumber).includes(houseSearch)) return;
    const rawFileId = imageIdIndex >= 0 ? String(row[imageIdIndex] || '').trim() : '';
    const rawImageUrl = imageUrlIndex >= 0 ? String(row[imageUrlIndex] || '').trim() : '';
    const fileId = extractDriveFileId_(rawFileId) || extractDriveFileId_(rawImageUrl);
    const sourceId = recordIdIndex >= 0 ? String(row[recordIdIndex] || '').trim() : '';
    // When no stable Record ID is provided, derive a CONTENT-based key (date + house + image)
    // instead of the source row number, so inserting or deleting rows upstream does not shift
    // keys and re-create duplicate documents for records that were already generated.
    const key = sourceId || `${source.getId()}:${sheet.getSheetId()}:${formatIso_(date)}:${normalizeText_(houseNumber)}:${fileId || rawImageUrl}`;
    // Backward-compatible key: the previous (row-number based) scheme. Checked against the ledger
    // so documents generated before this upgrade are still recognised and never regenerated.
    const legacyKey = sourceId || `${source.getId()}:${sheet.getSheetId()}:${headerRow + 1 + offset}:${formatIso_(date)}:${fileId || rawImageUrl}`;
    records.push({
      recordKey: key,
      legacyKey: legacyKey,
      sourceRow: headerRow + 1 + offset,
      date: date,
      dateInfo: makeDateInfo_(date, settings.DISPLAY_DATE_FORMAT),
      houseNumber: houseNumber,
      imageFileId: fileId,
      imageUrl: rawImageUrl,
      group: groupIndex >= 0 ? String(row[groupIndex] || '').trim() : ''
    });
  });
  return records;
}

function createGoogleDoc_(record, folder, settings) {
  const safeHouse = sanitizeFileName_(record.houseNumber || 'ไม่มีเลขที่บ้าน');
  const fileName = `${record.dateInfo.display}_${formatTimeForFile_(record.date)}_${safeHouse}`;
  const doc = DocumentApp.create(fileName);
  const body = doc.getBody();
  body.clear();
  body.setMarginTop(28).setMarginBottom(28).setMarginLeft(28).setMarginRight(28);

  const title = body.appendParagraph(settings.DOCUMENT_TITLE || 'รายงานผลการส่งหมาย');
  title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  title.setFontFamily(settings.DOCUMENT_FONT || 'TH Sarabun New').setFontSize(18).setBold(true).setSpacingAfter(10);

  const imageBlob = getImageBlob_(record, settings);
  const imageParagraph = body.appendParagraph('');
  imageParagraph.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  const image = imageParagraph.appendInlineImage(imageBlob);
  const size = calculateImageSize_(image.getWidth(), image.getHeight(), Number(settings.PHOTO_HEIGHT_MM) || 148, settings.PHOTO_FIT);
  image.setWidth(size.width).setHeight(size.height);

  if (record.houseNumber) {
    const house = body.appendParagraph(record.houseNumber);
    house.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    house.setFontFamily(settings.DOCUMENT_FONT || 'TH Sarabun New')
      .setFontSize(Number(settings.HOUSE_FONT_SIZE_PT) || 42)
      .setBold(true)
      .setSpacingBefore(14);
  }

  doc.saveAndClose();
  const file = DriveApp.getFileById(doc.getId());
  folder.addFile(file);
  try { DriveApp.getRootFolder().removeFile(file); } catch (error) { /* Shared Drive or policy can retain the root entry. */ }
  return file;
}

function getImageBlob_(record, settings) {
  if (record.imageFileId) {
    if (settings.PHOTO_QUALITY === 'low') return getReducedDriveBlob_(record.imageFileId);
    return DriveApp.getFileById(record.imageFileId).getBlob();
  }
  if (/^https?:\/\//i.test(record.imageUrl || '')) {
    return UrlFetchApp.fetch(record.imageUrl).getBlob();
  }
  throw new Error('ไม่พบ Google Drive File ID หรือ URL รูปภาพที่ใช้งานได้');
}

function getReducedDriveBlob_(fileId) {
  try {
    if (typeof Drive === 'undefined') throw new Error('ต้องเปิด Advanced Google service: Drive API');
    const file = Drive.Files.get(fileId);
    const thumbnailUrl = String(file.thumbnailLink || '').replace(/=s\d+$/, '=s1600');
    if (!thumbnailUrl) throw new Error('ไฟล์ไม่มี thumbnailLink');
    return UrlFetchApp.fetch(thumbnailUrl, {
      headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }
    }).getBlob();
  } catch (error) {
    // The original is preserved rather than creating a corrupt or grayscale document.
    return DriveApp.getFileById(fileId).getBlob();
  }
}

function getMonthKey_(dateInfo) {
  return String(dateInfo && dateInfo.iso || '').slice(0, 7);
}

function getOrCreateMonthlyFolder_(dateInfo, settings) {
  const monthKey = getMonthKey_(dateInfo);
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error('ไม่พบเดือนของข้อมูลที่ต้องสร้างโฟลเดอร์');
  const index = getSheet_(APP_.MONTHLY_FOLDER_INDEX_SHEET);
  const rows = index.getLastRow() > 1 ? index.getRange(2, 1, index.getLastRow() - 1, 4).getValues() : [];
  for (let row = 0; row < rows.length; row += 1) {
    if (String(rows[row][0]) === monthKey) {
      try { return DriveApp.getFolderById(rows[row][1]); } catch (error) { /* Replace a missing folder below. */ }
    }
  }

  const root = DriveApp.getFolderById(settings.ROOT_FOLDER_ID);
  const month = Number(monthKey.slice(5, 7));
  const buddhistYear = Number(monthKey.slice(0, 4)) + 543;
  const folder = root.createFolder(`${monthKey} · ${thaiMonthLong_(month - 1)} ${buddhistYear}`);
  applyFolderAccess_(folder);
  index.appendRow([monthKey, folder.getId(), folder.getUrl(), new Date()]);
  return folder;
}

function getOrCreateDailyFolder_(dateInfo, settings) {
  const index = getSheet_(APP_.DAILY_FOLDER_INDEX_SHEET);
  const rows = index.getLastRow() > 1 ? index.getRange(2, 1, index.getLastRow() - 1, 5).getValues() : [];
  for (let row = 0; row < rows.length; row += 1) {
    if (String(rows[row][0]) === dateInfo.iso) {
      try { return DriveApp.getFolderById(rows[row][2]); } catch (error) { /* Replace a missing folder below. */ }
    }
  }

  const monthFolder = getOrCreateMonthlyFolder_(dateInfo, settings);
  const folder = monthFolder.createFolder(dateInfo.full);
  applyFolderAccess_(folder);
  index.appendRow([dateInfo.iso, getMonthKey_(dateInfo), folder.getId(), monthFolder.getId(), new Date()]);
  return folder;
}

function applyFolderAccess_(folder) {
  getAccessAccounts_().forEach((account) => {
    if (account.role === 'EDITOR') folder.addEditor(account.email);
    else folder.addViewer(account.email);
  });
}

function syncAccessToExistingFolders_() {
  getManagedFolderIds_().forEach((folderId) => {
    try { applyFolderAccess_(DriveApp.getFolderById(folderId)); } catch (error) { /* A deleted folder is skipped. */ }
  });
}

function revokeAccessFromManagedFolders_(email) {
  let revoked = 0;
  getManagedFolderIds_().forEach((folderId) => {
    try {
      const folder = DriveApp.getFolderById(folderId);
      try { folder.removeEditor(email); } catch (error) { /* Role may not be editor. */ }
      try { folder.removeViewer(email); } catch (error) { /* Role may not be viewer. */ }
      revoked += 1;
    } catch (error) { /* A deleted folder is skipped. */ }
  });
  return revoked;
}

function getManagedFolderIds_() {
  const monthly = getSheetMaybe_(APP_.MONTHLY_FOLDER_INDEX_SHEET);
  const daily = getSheetMaybe_(APP_.DAILY_FOLDER_INDEX_SHEET);
  const monthlyValues = monthly && monthly.getLastRow() > 1 ? monthly.getRange(2, 1, monthly.getLastRow() - 1, 2).getValues() : [];
  const dailyValues = daily && daily.getLastRow() > 1 ? daily.getRange(2, 1, daily.getLastRow() - 1, 3).getValues() : [];
  const ids = monthlyValues.map((row) => row[1]).concat(dailyValues.map((row) => row[2]));
  return Array.from(new Set(ids.filter(Boolean).map(String)));
}

function appendLedger_(record, file, folder) {
  getSheet_(APP_.LEDGER_SHEET).appendRow([
    record.recordKey, record.dateInfo.iso, file.getId(), folder.getId(), record.houseNumber, record.sourceRow, new Date()
  ]);
}

function getLedgerKeys_() {
  const sheet = getSheet_(APP_.LEDGER_SHEET);
  const values = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
  return values.reduce((result, row) => { result[String(row[0])] = true; return result; }, {});
}

function upsertFolderOutput_(dateInfo, settings) {
  const folder = getOrCreateDailyFolder_(dateInfo, settings);
  const output = getSheet_(APP_.OUTPUT_SHEET);
  const count = countFiles_(folder);
  const note = `${count} เอกสาร · อัปเดต ${Utilities.formatDate(new Date(), APP_.TIMEZONE, 'HH:mm')} น.`;
  const display = makeDateInfo_(parseFlexibleDate_(dateInfo.iso), settings.DISPLAY_DATE_FORMAT).display;
  const rows = output.getLastRow() > 1 ? output.getRange(2, 1, output.getLastRow() - 1, 3).getValues() : [];
  for (let row = 0; row < rows.length; row += 1) {
    const existing = parseFlexibleDate_(rows[row][0]);
    if (existing && formatIso_(existing) === dateInfo.iso) {
      output.getRange(row + 2, 1, 1, 3).setValues([[display, folder.getUrl(), note]]);
      return;
    }
  }
  output.appendRow([display, folder.getUrl(), note]);
}

function refreshOutputDateDisplay_() {
  const settings = getSettings_();
  const sheet = getSheet_(APP_.OUTPUT_SHEET);
  if (sheet.getLastRow() <= 1) return;
  const dates = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  const refreshed = dates.map((row) => {
    const date = parseFlexibleDate_(row[0]);
    return [date ? makeDateInfo_(date, settings.DISPLAY_DATE_FORMAT).display : row[0]];
  });
  sheet.getRange(2, 1, refreshed.length, 1).setValues(refreshed);
}

function getDashboardData_() {
  const ledger = getSheet_(APP_.LEDGER_SHEET);
  const values = ledger.getLastRow() > 1 ? ledger.getRange(2, 1, ledger.getLastRow() - 1, 7).getValues() : [];
  const now = new Date();
  const currentYear = Number(Utilities.formatDate(now, APP_.TIMEZONE, 'yyyy'));
  const currentMonth = Number(Utilities.formatDate(now, APP_.TIMEZONE, 'M'));
  const monthly = Array.from({ length: 12 }, () => 0);
  const daily = {};
  values.forEach((row) => {
    const date = parseFlexibleDate_(row[1]);
    if (!date) return;
    const year = Number(Utilities.formatDate(date, APP_.TIMEZONE, 'yyyy'));
    const month = Number(Utilities.formatDate(date, APP_.TIMEZONE, 'M'));
    if (year === currentYear) monthly[month - 1] += 1;
    if (year === currentYear && month === currentMonth) {
      const day = Utilities.formatDate(date, APP_.TIMEZONE, 'dd');
      daily[day] = (daily[day] || 0) + 1;
    }
  });
  return {
    thaiYear: currentYear + 543,
    currentMonth: thaiMonthLong_(currentMonth - 1),
    monthly: monthly,
    daily: Object.keys(daily).sort().map((day) => ({ day: day, count: daily[day] })),
    totalDocuments: values.length
  };
}

function getSystemHealth_() {
  const readiness = getReleaseReadiness_();
  const monthly = getSheetMaybe_(APP_.MONTHLY_FOLDER_INDEX_SHEET);
  const daily = getSheetMaybe_(APP_.DAILY_FOLDER_INDEX_SHEET);
  const line = getSheetMaybe_(APP_.LINE_MONTHLY_INDEX_SHEET);
  const logs = getSheetMaybe_(APP_.SYSTEM_LOG_SHEET);
  if (!monthly || !daily || !line || !logs) {
    return {
      releaseVersion: APP_.RELEASE_VERSION,
      ready: false,
      missingSheets: readiness.missingSheets,
      schemaReady: readiness.schemaReady,
      monthlyFolderCount: 0,
      dailyFolderCount: 0,
      lineMonthlyRows: 0,
      duplicateMonthKeys: [],
      errors24h: 0,
      lastEvent: null
    };
  }
  const monthlyRows = monthly.getLastRow() > 1 ? monthly.getRange(2, 1, monthly.getLastRow() - 1, 1).getDisplayValues().flat().filter(Boolean) : [];
  const duplicateMonths = monthlyRows.filter((key, index) => monthlyRows.indexOf(key) !== index);
  // Scan up to the last 300 log rows and count ERROR entries that actually fall within the
  // trailing 24 hours (previously this counted errors among the last 25 rows regardless of time).
  const logLast = logs.getLastRow();
  const logStart = Math.max(2, logLast - 299);
  const logCount = logLast > 1 ? logLast - logStart + 1 : 0;
  const logRows = logCount > 0 ? logs.getRange(logStart, 1, logCount, 5).getValues() : [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const errors24h = logRows.filter((row) => String(row[2]) === 'ERROR' && row[0] instanceof Date && row[0].getTime() >= cutoff).length;
  const lastLog = logRows.length ? logRows[logRows.length - 1] : null;
  return {
    releaseVersion: APP_.RELEASE_VERSION,
    ready: readiness.ready,
    missingSheets: readiness.missingSheets,
    schemaReady: readiness.schemaReady,
    monthlyFolderCount: monthlyRows.length,
    dailyFolderCount: Math.max(0, daily.getLastRow() - 1),
    lineMonthlyRows: Math.max(0, line.getLastRow() - 1),
    duplicateMonthKeys: Array.from(new Set(duplicateMonths)),
    errors24h: errors24h,
    lastEvent: lastLog ? { at: lastLog[0] instanceof Date ? lastLog[0].toISOString() : String(lastLog[0]), event: lastLog[1], severity: lastLog[2] } : null
  };
}

/**
 * Read-only readiness check for an existing configuration spreadsheet.
 * It lets an administrator review a migration before any new folder or document is created.
 */
function inspectReleaseCandidateReadiness() {
  assertAdmin_();
  return getReleaseReadiness_();
}

function getSystemHealth() {
  assertAdmin_();
  return getSystemHealth_();
}

/**
 * Creates only missing support tabs. Existing tabs, Drive folders, and report rows are never changed.
 * It deliberately does not convert the old monthly index; call repairMonthlyFolderIndex only after its dry run.
 */
function prepareReleaseCandidateMigration(confirmPhrase) {
  assertAdmin_();
  if (confirmPhrase !== 'PREPARE_NOTICE_RC') {
    throw new Error('ต้องยืนยันด้วยข้อความ PREPARE_NOTICE_RC');
  }
  const spreadsheet = getConfigSpreadsheet_();
  const created = [];
  const definitions = [
    [APP_.DAILY_FOLDER_INDEX_SHEET, setupDailyFolderIndexSheet_],
    [APP_.LINE_MONTHLY_INDEX_SHEET, setupLineMonthlyIndexSheet_],
    [APP_.SYSTEM_LOG_SHEET, setupSystemLogSheet_]
  ];
  definitions.forEach((definition) => {
    if (spreadsheet.getSheetByName(definition[0])) return;
    const sheet = spreadsheet.insertSheet(definition[0]);
    definition[1](sheet);
    created.push(definition[0]);
  });
  const monthly = spreadsheet.getSheetByName(APP_.MONTHLY_FOLDER_INDEX_SHEET);
  if (!monthly) {
    const sheet = spreadsheet.insertSheet(APP_.MONTHLY_FOLDER_INDEX_SHEET);
    setupMonthlyFolderIndexSheet_(sheet);
    created.push(APP_.MONTHLY_FOLDER_INDEX_SHEET);
  }
  logSystemEvent_('MIGRATION_PREPARED', 'INFO', 'เพิ่มเฉพาะแท็บสนับสนุนที่ยังไม่มี โดยยังไม่แก้ข้อมูลเดิม', { created: created });
  return { ok: true, created: created, readiness: getReleaseReadiness_() };
}

function getReleaseReadiness_() {
  const spreadsheet = getConfigSpreadsheet_();
  const required = [
    APP_.CONFIG_SHEET,
    APP_.ADMIN_SHEET,
    APP_.ACCESS_SHEET,
    APP_.OUTPUT_SHEET,
    APP_.LEDGER_SHEET,
    APP_.DAILY_FOLDER_INDEX_SHEET,
    APP_.MONTHLY_FOLDER_INDEX_SHEET,
    APP_.LINE_MONTHLY_INDEX_SHEET,
    APP_.SYSTEM_LOG_SHEET
  ];
  const missingSheets = required.filter((name) => !spreadsheet.getSheetByName(name));
  const monthly = spreadsheet.getSheetByName(APP_.MONTHLY_FOLDER_INDEX_SHEET);
  const headers = monthly && monthly.getLastColumn() ? monthly.getRange(1, 1, 1, Math.min(4, monthly.getLastColumn())).getDisplayValues()[0] : [];
  const schemaReady = Boolean(monthly && ['MONTH_KEY', 'FOLDER_ID', 'FOLDER_URL', 'CREATED_AT'].every((header, index) => String(headers[index] || '') === header));
  return {
    releaseVersion: APP_.RELEASE_VERSION,
    ready: missingSheets.length === 0 && schemaReady,
    missingSheets: missingSheets,
    schemaReady: schemaReady,
    needsMonthlyIndexRepair: Boolean(monthly && !schemaReady),
    nextAction: missingSheets.length
      ? 'สร้างแท็บสนับสนุนที่หายไปด้วย prepareReleaseCandidateMigration'
      : (!schemaReady ? 'ตรวจ auditMonthlyFolderIndex แล้วซ่อมดัชนีรายเดือนด้วย repairMonthlyFolderIndex' : 'พร้อมประมวลผล')
  };
}

function assertReleaseReadyForWrite_() {
  const readiness = getReleaseReadiness_();
  if (!readiness.ready) {
    throw new Error(`Release Candidate ยังไม่พร้อมประมวลผล: ${readiness.nextAction}`);
  }
}

/**
 * All date math assumes the project time zone is Asia/Bangkok (raw Date methods such as
 * setHours run in the script time zone, while Utilities.formatDate is called with it explicitly).
 * Fail loudly instead of silently shifting dates if the manifest time zone is ever changed.
 */
function assertScriptTimezone_() {
  const timeZone = Session.getScriptTimeZone();
  if (timeZone !== APP_.TIMEZONE) {
    throw new Error(`เขตเวลาโปรเจกต์ต้องเป็น ${APP_.TIMEZONE} แต่พบ ${timeZone} — โปรดตั้งค่า timeZone ใน appsscript.json ให้ตรงก่อนใช้งาน เพื่อกันวันที่คลาดเคลื่อน`);
  }
}

function refreshLineMonthlyIndex_() {
  const source = getSheet_(APP_.MONTHLY_FOLDER_INDEX_SHEET);
  const target = getSheet_(APP_.LINE_MONTHLY_INDEX_SHEET);
  const values = source.getLastRow() > 1 ? source.getRange(2, 1, source.getLastRow() - 1, 3).getDisplayValues() : [];
  const rows = values
    .filter((row) => /^\d{4}-\d{2}$/.test(String(row[0])) && row[2])
    .map((row) => {
      const year = Number(String(row[0]).slice(0, 4)) + 543;
      const month = Number(String(row[0]).slice(5, 7));
      return [`ส่งหมายเดือน${thaiMonthLong_(month - 1)} ${year}`, row[2], `เอกสารรายงานการส่งหมาย เดือน${thaiMonthLong_(month - 1)} ${year}`];
    })
    .sort((a, b) => b[0].localeCompare(a[0], 'th'));
  if (target.getLastRow() > 1) target.getRange(2, 1, target.getLastRow() - 1, 3).clearContent();
  if (rows.length) target.getRange(2, 1, rows.length, 3).setValues(rows);
  return rows.length;
}

/** Safe audit only. It never changes Drive folders or spreadsheet rows. */
function auditMonthlyFolderIndex() {
  assertAdmin_();
  const index = getSheet_(APP_.MONTHLY_FOLDER_INDEX_SHEET);
  const headers = index.getLastColumn() ? index.getRange(1, 1, 1, index.getLastColumn()).getDisplayValues()[0] : [];
  const headerMap = {};
  headers.forEach((header, position) => { headerMap[String(header || '').trim()] = position; });
  const isCurrentSchema = ['MONTH_KEY', 'FOLDER_ID', 'FOLDER_URL', 'CREATED_AT'].every((header, position) => headerMap[header] === position);
  const rows = index.getLastRow() > 1 ? index.getRange(2, 1, index.getLastRow() - 1, Math.max(3, index.getLastColumn())).getDisplayValues() : [];
  const legacyLinks = getLegacyMonthlyLinks_();
  const grouped = {};
  rows.forEach((row, position) => {
    const key = String(row[0] || '');
    if (!key) return;
    if (!grouped[key]) grouped[key] = [];
    const folderId = String(row[headerMap.FOLDER_ID == null ? 1 : headerMap.FOLDER_ID] || '');
    const currentUrl = headerMap.FOLDER_URL == null ? '' : String(row[headerMap.FOLDER_URL] || '');
    grouped[key].push({ row: position + 2, folderId: folderId, folderUrl: currentUrl || legacyLinks[key] || '' });
  });
  const months = Object.keys(grouped).sort().map((key) => ({ monthKey: key, rows: grouped[key] }));
  const duplicates = months.filter((item) => item.rows.length > 1);
  return {
    dryRun: true,
    schemaReady: isCurrentSchema,
    indexedMonths: months.length,
    months: months,
    duplicateMonths: duplicates,
    requiresRepair: duplicates.length > 0 || !isCurrentSchema
  };
}

/**
 * Rebuilds only the monthly index after an administrator has reviewed auditMonthlyFolderIndex().
 * A timestamped backup tab is created first; no Drive folder or generated document is deleted.
 */
function repairMonthlyFolderIndex(confirmPhrase) {
  assertAdmin_();
  if (confirmPhrase !== 'REBUILD_MONTHLY_INDEX') throw new Error('ต้องยืนยันด้วยข้อความ REBUILD_MONTHLY_INDEX');
  const audit = auditMonthlyFolderIndex();
  if (!audit.requiresRepair) return { ok: true, repaired: 0, message: 'ดัชนีรายเดือนอยู่ในรูปแบบที่พร้อมใช้งานแล้ว' };
  const spreadsheet = getConfigSpreadsheet_();
  const index = getSheet_(APP_.MONTHLY_FOLDER_INDEX_SHEET);
  const backup = index.copyTo(spreadsheet).setName(`สำรองโฟลเดอร์รายเดือน_${Utilities.formatDate(new Date(), APP_.TIMEZONE, 'yyyyMMdd_HHmmss')}`);
  const uniqueRows = audit.months.map((item) => {
    const usable = item.rows.find((row) => row.folderId && row.folderUrl) || item.rows[0];
    // In the old three-column index the ID can identify a daily folder, while the legacy
    // monthly search index contains the intended parent folder URL. Prefer that URL there.
    let folderId = audit.schemaReady
      ? (extractDriveFileId_(usable.folderId) || extractDriveFileId_(usable.folderUrl))
      : (extractDriveFileId_(usable.folderUrl) || extractDriveFileId_(usable.folderId));
    let folderUrl = String(usable.folderUrl || '');
    if (!folderId) throw new Error(`ไม่พบ Folder ID ที่ใช้ได้สำหรับเดือน ${item.monthKey}; ยกเลิกก่อนแก้ดัชนีเดิม`);
    if (!/^https:\/\/drive\.google\.com\//i.test(folderUrl)) {
      try { folderUrl = DriveApp.getFolderById(folderId).getUrl(); } catch (error) {
        throw new Error(`ไม่สามารถยืนยันโฟลเดอร์ของเดือน ${item.monthKey}; ยกเลิกก่อนแก้ดัชนีเดิม`);
      }
    }
    return [item.monthKey, folderId, folderUrl, new Date()];
  });
  setupMonthlyFolderIndexSheet_(index);
  if (uniqueRows.length) index.getRange(2, 1, uniqueRows.length, 4).setValues(uniqueRows);
  refreshLineMonthlyIndex_();
  logSystemEvent_('MONTHLY_INDEX_REPAIRED', 'WARNING', 'สร้างดัชนีรายเดือนใหม่จากรายการซ้ำ โดยสำรองแท็บเดิมแล้ว', { backupSheet: backup.getName(), repaired: uniqueRows.length });
  return { ok: true, repaired: uniqueRows.length, backupSheet: backup.getName() };
}

/** Reads a legacy per-document monthly index only to recover an existing folder URL during migration. */
function getLegacyMonthlyLinks_() {
  const legacy = getSheetMaybe_('ดัชนีค้นหารายเดือน');
  if (!legacy || legacy.getLastRow() < 2) return {};
  const width = legacy.getLastColumn();
  const values = legacy.getRange(1, 1, legacy.getLastRow(), width).getDisplayValues();
  const headers = values[0].map((header) => String(header || '').trim());
  const monthColumn = headers.indexOf('MONTH_KEY');
  const urlColumn = headers.indexOf('FOLDER_URL');
  if (monthColumn < 0 || urlColumn < 0) return {};
  return values.slice(1).reduce((result, row) => {
    const monthKey = String(row[monthColumn] || '');
    const url = String(row[urlColumn] || '');
    if (/^\d{4}-\d{2}$/.test(monthKey) && /^https:\/\/drive\.google\.com\//i.test(url) && !result[monthKey]) result[monthKey] = url;
    return result;
  }, {});
}

function withScriptLock_(work) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return work(); } finally { lock.releaseLock(); }
}

function logSystemEvent_(event, severity, message, detail) {
  try {
    const sheet = getSheet_(APP_.SYSTEM_LOG_SHEET);
    const actor = getActiveUserEmail_() || String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase() || 'system';
    sheet.appendRow([new Date(), event, severity, actor, message, JSON.stringify(detail || {})]);
  } catch (error) {
    Logger.log(`System log failure: ${error.message || error}`);
  }
}

function getAutomationOwner_() {
  return String(PropertiesService.getScriptProperties().getProperty(APP_.AUTOMATION_OWNER_PROPERTY) || '').trim().toLowerCase();
}

/**
 * Ensures exactly one scheduled trigger exists and that it belongs to the automation owner.
 * Runs on bootstrap: only the owner acts, so no other admin can spawn a competing trigger.
 * Re-applies the saved day when a non-owner queued a change (dirty flag) or when the owner's
 * trigger count drifted from one.
 */
function ensureAutomationTriggerForOwner_(email) {
  const owner = getAutomationOwner_();
  if (!owner || owner !== email) return;
  const properties = PropertiesService.getScriptProperties();
  const day = getSettings_().AUTOMATION_DAY || 'monday';
  const triggers = ScriptApp.getProjectTriggers().filter((trigger) => trigger.getHandlerFunction() === APP_.TRIGGER_HANDLER);
  if (properties.getProperty(APP_.AUTOMATION_DIRTY_PROPERTY) === '1' || triggers.length !== 1) {
    installOrReplaceTrigger_(day);
    properties.deleteProperty(APP_.AUTOMATION_DIRTY_PROPERTY);
  }
}

function installOrReplaceTrigger_(day) {
  const dayMap = {
    monday: ScriptApp.WeekDay.MONDAY,
    wednesday: ScriptApp.WeekDay.WEDNESDAY,
    friday: ScriptApp.WeekDay.FRIDAY
  };
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === APP_.TRIGGER_HANDLER) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(APP_.TRIGGER_HANDLER)
    .timeBased()
    .atHour(18)
    .nearMinute(0)
    .everyWeeks(1)
    .onWeekDay(dayMap[day] || dayMap.monday)
    .create();
}

function setupConfigSheet_(sheet) {
  sheet.getRange(1, 1, 1, 3).setValues([['KEY', 'VALUE', 'DESCRIPTION']]);
  const descriptions = {
    SOURCE_SPREADSHEET_ID: 'Spreadsheet ID ของชีต LINE ต้นทาง (อ่านอย่างเดียว)',
    SOURCE_SHEET_NAME: 'ชื่อแท็บต้นทาง',
    SOURCE_DATE_COLUMN: 'ชื่อหัวคอลัมน์วันที่ส่งหมาย',
    SOURCE_HOUSE_COLUMN: 'ชื่อหัวคอลัมน์เลขที่บ้าน',
    SOURCE_IMAGE_FILE_ID_COLUMN: 'ชื่อหัวคอลัมน์ Google Drive File ID ของรูป',
    SOURCE_IMAGE_URL_COLUMN: 'ชื่อหัวคอลัมน์ URL รูป หากไม่มี File ID',
    SOURCE_RECORD_ID_COLUMN: 'ชื่อหัวคอลัมน์ ID รายการ (ไม่บังคับ)',
    SOURCE_GROUP_COLUMN: 'ชื่อหัวคอลัมน์ Group ID (ไม่บังคับ)'
  };
  const rows = Object.keys(DEFAULT_SETTINGS_).map((key) => [key, DEFAULT_SETTINGS_[key], descriptions[key] || 'การตั้งค่าระบบ']);
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
  styleHeader_(sheet, 3);
}

function setupAdminSheet_(sheet, email) {
  sheet.getRange(1, 1, 1, 3).setValues([['EMAIL', 'ROLE', 'CREATED_AT']]);
  sheet.appendRow([email, 'ADMIN', new Date()]);
  styleHeader_(sheet, 3);
}

function setupAccessSheet_(sheet, email) {
  sheet.getRange(1, 1, 1, 4).setValues([['EMAIL', 'ROLE', 'CREATED_AT', 'CREATED_BY']]);
  sheet.appendRow([email, 'EDITOR', new Date(), email]);
  styleHeader_(sheet, 4);
}

function setupOutputSheet_(sheet) {
  sheet.getRange('A1:C1').setValues([['วันที่ส่งหมาย', 'Link', 'หมายเหตุ']]);
  styleHeader_(sheet, 3);
  sheet.setColumnWidths(1, 1, 170);
  sheet.setColumnWidths(2, 1, 420);
  sheet.setColumnWidths(3, 1, 260);
}

function setupLedgerSheet_(sheet) {
  sheet.getRange(1, 1, 1, 7).setValues([['RECORD_KEY', 'ISO_DATE', 'DOCUMENT_ID', 'FOLDER_ID', 'HOUSE_NUMBER', 'SOURCE_ROW', 'CREATED_AT']]);
  styleHeader_(sheet, 7);
  sheet.hideSheet();
}

function setupDailyFolderIndexSheet_(sheet) {
  sheet.clear();
  sheet.getRange(1, 1, 1, 5).setValues([['ISO_DATE', 'MONTH_KEY', 'FOLDER_ID', 'MONTHLY_FOLDER_ID', 'CREATED_AT']]);
  styleHeader_(sheet, 5);
  sheet.hideSheet();
}

function setupMonthlyFolderIndexSheet_(sheet) {
  sheet.clear();
  sheet.getRange(1, 1, 1, 4).setValues([['MONTH_KEY', 'FOLDER_ID', 'FOLDER_URL', 'CREATED_AT']]);
  styleHeader_(sheet, 4);
  sheet.hideSheet();
}

function setupLineMonthlyIndexSheet_(sheet) {
  sheet.getRange(1, 1, 1, 3).setValues([['วันที่ส่งหมาย', 'Link', 'หมายเหตุ']]);
  styleHeader_(sheet, 3);
  sheet.setColumnWidths(1, 1, 220);
  sheet.setColumnWidths(2, 1, 420);
  sheet.setColumnWidths(3, 1, 300);
}

function setupSystemLogSheet_(sheet) {
  sheet.getRange(1, 1, 1, 6).setValues([['TIMESTAMP', 'EVENT', 'SEVERITY', 'ACTOR', 'MESSAGE', 'DETAIL_JSON']]);
  styleHeader_(sheet, 6);
  sheet.setColumnWidths(1, 1, 170);
  sheet.setColumnWidths(2, 1, 190);
  sheet.setColumnWidths(3, 1, 100);
  sheet.setColumnWidths(4, 1, 250);
  sheet.setColumnWidths(5, 1, 330);
  sheet.setColumnWidths(6, 1, 420);
}

function styleHeader_(sheet, columns) {
  sheet.getRange(1, 1, 1, columns).setBackground('#17385f').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function getSettings_() {
  const sheet = getSheet_(APP_.CONFIG_SHEET);
  const values = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues() : [];
  const settings = Object.assign({}, DEFAULT_SETTINGS_);
  values.forEach((row) => { if (row[0]) settings[String(row[0])] = String(row[1] || ''); });
  return settings;
}

function setSettings_(patch) {
  const sheet = getSheet_(APP_.CONFIG_SHEET);
  const lastRow = sheet.getLastRow();
  const values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
  const rowByKey = {};
  values.forEach((row, index) => { rowByKey[String(row[0])] = index + 2; });
  Object.keys(patch).forEach((key) => {
    if (rowByKey[key]) sheet.getRange(rowByKey[key], 2).setValue(patch[key]);
    else sheet.appendRow([key, patch[key], 'การตั้งค่าระบบ']);
  });
}

function getAccessAccounts_() {
  const sheet = getSheet_(APP_.ACCESS_SHEET);
  const values = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues() : [];
  return values.filter((row) => row[0]).map((row) => ({ email: String(row[0]).toLowerCase(), role: String(row[1] || 'VIEWER').toUpperCase() }));
}

function getAdministrators_() {
  const sheet = getSheet_(APP_.ADMIN_SHEET);
  const values = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues() : [];
  return values
    .filter((row) => row[0] && String(row[1]).toUpperCase() === 'ADMIN')
    .map((row) => ({ email: String(row[0]).toLowerCase(), createdAt: row[2] instanceof Date ? row[2].toISOString() : String(row[2] || '') }));
}

function assertAdmin_() {
  const email = getActiveUserEmail_();
  if (!email) throw new Error('ไม่สามารถยืนยันอีเมลได้ โปรด deploy เป็น “User accessing the web app” และจำกัดการเข้าถึงเฉพาะบัญชี Google ที่อนุญาต');
  const values = getSheet_(APP_.ADMIN_SHEET).getDataRange().getValues();
  const allowed = values.slice(1).some((row) => String(row[0]).toLowerCase() === email && String(row[1]).toUpperCase() === 'ADMIN');
  if (!allowed) throw new Error('บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ');
  return email;
}

function getActiveUserEmail_() {
  return String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
}

function getInstallerEmail_() {
  return getActiveUserEmail_() || String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
}

function getConfigSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(APP_.CONFIG_PROPERTY);
  if (!id) throw new Error('ยังไม่ได้ติดตั้งระบบ โปรดรัน setupProject หนึ่งครั้งจาก Apps Script editor');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  const sheet = getSheetMaybe_(name);
  if (!sheet) throw new Error(`ไม่พบแท็บระบบ: ${name}`);
  return sheet;
}

function getSheetMaybe_(name) {
  return getConfigSpreadsheet_().getSheetByName(name);
}

function assertSourceConfigured_(settings) {
  if (!settings.SOURCE_SPREADSHEET_ID || !settings.SOURCE_SHEET_NAME) {
    throw new Error('กรุณาตั้งค่า SOURCE_SPREADSHEET_ID และ SOURCE_SHEET_NAME ในแท็บการตั้งค่าก่อนใช้งาน');
  }
}

function validateSetting_(key, value) {
  const text = String(value == null ? '' : value).trim();
  if (key === 'DISPLAY_DATE_FORMAT' && !['full', 'short', 'compact'].includes(text)) throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  if (key === 'PHOTO_HEIGHT_MM' && (!Number.isFinite(Number(text)) || Number(text) < 90 || Number(text) > 148)) throw new Error('พื้นที่รูปต้องอยู่ระหว่าง 90–148 มม.');
  if (key === 'HOUSE_FONT_SIZE_PT' && (!Number.isFinite(Number(text)) || Number(text) < 20 || Number(text) > 60)) throw new Error('ขนาดเลขที่บ้านต้องอยู่ระหว่าง 20–60 pt');
  if (key === 'PHOTO_FIT' && !['contain', 'cover'].includes(text)) throw new Error('รูปแบบการวางรูปไม่ถูกต้อง');
  if (key === 'PHOTO_QUALITY' && !['normal', 'low'].includes(text)) throw new Error('คุณภาพรูปภาพไม่ถูกต้อง');
  if (key === 'ROOT_FOLDER_ID' && text) {
    const id = extractDriveFileId_(text); // Accept a pasted URL or a bare ID.
    if (!id) throw new Error('Drive Folder ID ของโฟลเดอร์หลักไม่ถูกต้อง');
    try { DriveApp.getFolderById(id); } catch (error) { throw new Error('ไม่พบโฟลเดอร์หลักตาม ID ที่ระบุ หรือไม่มีสิทธิ์เข้าถึง'); }
    return id;
  }
  if (key === 'SOURCE_SPREADSHEET_ID' && text) {
    const id = extractDriveFileId_(text); // Accept a pasted URL or a bare ID.
    if (!id) throw new Error('Source Spreadsheet ID ไม่ถูกต้อง');
    return id;
  }
  return text;
}

function publicSettings_(settings) {
  return {
    displayDateFormat: settings.DISPLAY_DATE_FORMAT,
    automationDay: settings.AUTOMATION_DAY,
    documentTitle: settings.DOCUMENT_TITLE,
    documentFont: settings.DOCUMENT_FONT,
    photoHeightMm: Number(settings.PHOTO_HEIGHT_MM),
    houseFontSizePt: Number(settings.HOUSE_FONT_SIZE_PT),
    photoFit: settings.PHOTO_FIT,
    rootFolderId: settings.ROOT_FOLDER_ID,
    sourceSpreadsheetId: settings.SOURCE_SPREADSHEET_ID,
    sourceSheetName: settings.SOURCE_SHEET_NAME,
    sourceHeaderRow: settings.SOURCE_HEADER_ROW,
    sourceDateColumn: settings.SOURCE_DATE_COLUMN,
    sourceHouseColumn: settings.SOURCE_HOUSE_COLUMN,
    sourceImageFileIdColumn: settings.SOURCE_IMAGE_FILE_ID_COLUMN,
    sourceImageUrlColumn: settings.SOURCE_IMAGE_URL_COLUMN,
    sourceRecordIdColumn: settings.SOURCE_RECORD_ID_COLUMN,
    sourceGroupColumn: settings.SOURCE_GROUP_COLUMN
  };
}

function calculateImageSize_(originalWidth, originalHeight, maxHeightMm, photoFit) {
  const maxWidth = 718; // 190 mm printable A4 width at 96 px/in.
  const maxHeight = Math.round(maxHeightMm * 3.7795);
  const ratio = originalWidth / originalHeight;
  let width = maxWidth;
  let height = Math.round(width / ratio);
  // Google Docs cannot crop an inline image, so "cover" cannot mean fill-and-crop
  // without distorting the evidence photo. Instead:
  //   contain (default): fit inside BOTH the printable width and the configured photo-area height.
  //   cover:             fill the full printable width, keeping aspect ratio (the mm cap is ignored).
  if (photoFit !== 'cover' && height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * ratio);
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function makeDateInfo_(date, displayFormat) {
  const local = new Date(date.getTime());
  const day = Number(Utilities.formatDate(local, APP_.TIMEZONE, 'd'));
  const month = Number(Utilities.formatDate(local, APP_.TIMEZONE, 'M'));
  const buddhistYear = Number(Utilities.formatDate(local, APP_.TIMEZONE, 'yyyy')) + 543;
  const full = `${day} ${thaiMonthLong_(month - 1)} ${buddhistYear}`;
  const short = `${day} ${thaiMonthShort_(month - 1)} ${String(buddhistYear).slice(-2)}`;
  const compact = `${String(day).padStart(2, '0')}${String(month).padStart(2, '0')}${String(buddhistYear).slice(-2)}`;
  const format = displayFormat || getSettings_().DISPLAY_DATE_FORMAT;
  return { iso: formatIso_(local), full: full, short: short, compact: compact, display: format === 'compact' ? compact : format === 'short' ? short : full, aliases: [full, short, compact, Utilities.formatDate(local, APP_.TIMEZONE, 'dd/MM/') + buddhistYear] };
}

function parseFlexibleDate_(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const text = String(value == null ? '' : value).trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return safeDate_(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const slash = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (slash) return safeDate_(normalizeYear_(Number(slash[3])), Number(slash[2]), Number(slash[1]));
  const compact = text.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (compact) return safeDate_(2500 + Number(compact[3]) - 543, Number(compact[2]), Number(compact[1]));
  const thai = text.match(/^(\d{1,2})\s+([^\s]+)\s+(\d{2,4})$/);
  if (thai) {
    const month = thaiMonthIndex_(thai[2]);
    if (month >= 0) return safeDate_(normalizeYear_(Number(thai[3])), month + 1, Number(thai[1]));
  }
  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function normalizeYear_(year) {
  if (year >= 2400) return year - 543;
  if (year < 100) return 2500 + year - 543;
  return year;
}

function safeDate_(year, month, day) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function findHeaderIndex_(headers, expectedHeader) {
  const expected = normalizeText_(expectedHeader);
  if (!expected) return -1;
  return headers.findIndex((header) => normalizeText_(header) === expected);
}

function extractDriveFileId_(value) {
  const text = String(value || '').trim();
  if (/^[\w-]{20,}$/.test(text)) return text;
  const match = text.match(/[-\w]{25,}/);
  return match ? match[0] : '';
}

function normalizeText_(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').replace(/[._\-/]/g, '');
}

function normalizeDateSearch_(value) {
  return normalizeText_(value).replace(/–/g, '');
}

function formatIso_(date) {
  return Utilities.formatDate(date, APP_.TIMEZONE, 'yyyy-MM-dd');
}

function formatTimeForFile_(date) {
  return Utilities.formatDate(date, APP_.TIMEZONE, 'HHmmss');
}

function startOfDay_(date) {
  if (!date) return null;
  const result = new Date(date.getTime());
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay_(date) {
  if (!date) return null;
  const result = new Date(date.getTime());
  result.setHours(23, 59, 59, 999);
  return result;
}

function countFiles_(folder) {
  let count = 0;
  const files = folder.getFiles();
  while (files.hasNext()) { files.next(); count += 1; }
  return count;
}

function sanitizeFileName_(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 90);
}

function automationLabel_(day) {
  return ({ monday: 'ทุกวันจันทร์ เวลา 18.00 น.', wednesday: 'ทุกวันพุธ เวลา 18.00 น.', friday: 'ทุกวันศุกร์ เวลา 18.00 น.' })[day] || 'ทุกวันจันทร์ เวลา 18.00 น.';
}

function thaiMonthLong_(index) {
  return ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'][index];
}

function thaiMonthShort_(index) {
  return ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][index];
}

function thaiMonthIndex_(value) {
  const normalized = String(value || '').replace(/\./g, '').toLowerCase();
  const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const shorts = ['มค', 'กพ', 'มีค', 'เมย', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'];
  return months.findIndex((month, index) => month === normalized || shorts[index] === normalized);
}

