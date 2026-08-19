const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const config = {
  GEMINI_QA_STATUS: 'OFF',
  GEMINI_QA_GROUP_PREFIX: 'บอทถาม',
  GEMINI_QA_ALLOWED_USERS: '',
  GEMINI_QA_ALLOWED_SOURCES: '',
  GEMINI_QA_ALLOWED_TOPICS: '',
  GEMINI_QA_BLOCKED_TOPICS: 'รหัสผ่าน,api key,ตัดสินคดี',
  GEMINI_QA_SYSTEM_PROMPT: 'ตอบภาษาไทย',
  GEMINI_QA_MAX_TOKENS: '800',
  GEMINI_QA_SAVE_HISTORY: 'ON'
};
let replies = [];
let fetchedPayload = null;
const auditRows = [];
const auditSheet = {
  getLastRow: () => auditRows.length ? auditRows.length + 1 : 0,
  getLastColumn: () => 11,
  getRange: () => ({ setValues: () => {}, getDisplayValues: () => [] }),
  setFrozenRows: () => {},
  appendRow: row => auditRows.push(row)
};
const ss = {
  getSheetByName: name => name === 'GeminiQA_AUDIT' ? auditSheet : null,
  insertSheet: () => auditSheet
};
const context = {
  console,
  Date,
  Math,
  JSON,
  String,
  Number,
  Array,
  Object,
  RegExp,
  isFinite,
  encodeURIComponent,
  Logger: { log: () => {} },
  Utilities: { formatDate: () => '2026-08-19 12:00:00', base64Encode: bytes => Buffer.from(bytes).toString('base64') },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => key === 'GEMINI_API_KEY' ? 'test-key-abcdefghijklmnopqrstuvwxyz' : null,
    setProperty: (key, value) => { if (key === 'GEMINI_API_KEY') context.__apiKey = value; },
    deleteProperty: () => {}
  }) },
  SpreadsheetApp: { openById: () => ss, flush: () => {} },
  SPREADSHEET_ID: 'NEWBOT_TEST_SHEET',
  _getSS: () => ss,
  getConfig: key => config[key],
  setConfig: (key, value) => { config[key] = value; },
  getAdminIds: () => ['UADMIN'],
  safeSendReply: (token, text) => { replies.push({ token, text }); },
  UrlFetchApp: { fetch: (endpoint, options) => {
    fetchedPayload = JSON.parse(options.payload);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'คำตอบทดสอบภาษาไทย', status: 'ANSWER', used_sources: ['policy'], confidence: 0.9 }) }] } }]
    }) };
  } }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('GeminiQA.js', 'utf8'), context, { filename: 'GeminiQA.js' });

assert.strictEqual(context._isGeminiQAEnabled_(), false);
assert.strictEqual(context._shouldHandleGeminiQAText_('บอทถาม เวลาทำการ', true), false);

config.GEMINI_QA_STATUS = 'ON';
assert.strictEqual(context._shouldHandleGeminiQAText_('บอทถาม เวลาทำการ', true), true);
assert.strictEqual(context._shouldHandleGeminiQAText_('เวลาทำการ', false), true);
assert.strictEqual(context._shouldHandleGeminiQAText_('/help', false), false);

const blocked = context.handleGeminiQAMessage_('ถามรหัสผ่านระบบ', 'UADMIN', 'Admin', 'UADMIN', false, 'reply-blocked', null);
assert.strictEqual(blocked.handled, true);
assert.strictEqual(blocked.status, 'BLOCKED_POLICY');
assert.ok(replies.some(r => r.token === 'reply-blocked'));

const denied = context.handleGeminiQAMessage_('ข้อมูลศาล', 'UOTHER', 'Other', 'UOTHER', false, 'reply-denied', null);
assert.strictEqual(denied.handled, false);

const answered = context.handleGeminiQAMessage_('บอทถาม เวลาทำการ', 'UADMIN', 'Admin', 'C123', true, 'reply-ok', null);
assert.strictEqual(answered.handled, true);
assert.strictEqual(answered.status, 'ANSWER');
assert.strictEqual(replies[replies.length - 1].text, 'คำตอบทดสอบภาษาไทย');
assert.strictEqual(fetchedPayload.generationConfig.responseMimeType, 'application/json');
assert.strictEqual(fetchedPayload.generationConfig.responseSchema.required.indexOf('answer') >= 0, true);

const saved = context.saveGeminiQASettings({ GEMINI_QA_STATUS: 'OFF', GEMINI_QA_GROUP_PREFIX: 'ถามบอท', GEMINI_QA_MAX_TOKENS: '700' });
assert.strictEqual(saved.success, true);
assert.strictEqual(saved.GEMINI_QA_STATUS, 'OFF');
assert.strictEqual(saved.GEMINI_QA_GROUP_PREFIX, 'ถามบอท');
assert.strictEqual(saved.GEMINI_QA_MAX_TOKENS, 700);

const test = context.testGeminiQA('ทดสอบระบบ');
assert.strictEqual(test.success, true);
assert.strictEqual(test.text, 'คำตอบทดสอบภาษาไทย');

console.log(JSON.stringify({
  passed: true,
  replies: replies.length,
  auditRows: auditRows.length,
  model: test.model,
  schema: fetchedPayload.generationConfig.responseSchema.required
}, null, 2));
