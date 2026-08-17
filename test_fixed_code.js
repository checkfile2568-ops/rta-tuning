const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const coreCode = fs.readFileSync('/home/ubuntu/05-line-bot-fixed/FIXED_CoreHelpers.js', 'utf8');
const webhookCode = fs.readFileSync('/home/ubuntu/05-line-bot-fixed/FIXED_Webhook.js', 'utf8');

let config = { ADMIN_LINE_IDS: { bad: true } };
const context = {
  Logger: { log() {} },
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty(key) {
          if (key === 'LINE_CHANNEL_ACCESS_TOKEN') return 'token';
          if (key === 'LINE_CHANNEL_SECRET') return 'secret';
          if (key === 'LINE_SIGNATURE_MODE') return 'REQUIRED';
          return null;
        },
        setProperty() {},
        deleteProperty() {}
      };
    }
  },
  Utilities: {
    sleep() {},
    formatDate(date) { return String(date); },
    computeHmacSha256Signature(body, secret) {
      return Array.from(require('crypto').createHmac('sha256', secret).update(body).digest());
    },
    base64Encode(bytes) { return Buffer.from(bytes).toString('base64'); }
  },
  Session: { getScriptTimeZone() { return 'Asia/Bangkok'; } },
  LockService: { getScriptLock() { return { tryLock() { return true; }, releaseLock() {} }; } },
  getConfig(key, fallback) { return config[key] === undefined ? fallback : config[key]; },
  UrlFetchApp: { fetch() { return { getResponseCode() { return 200; }, getContentText() { return ''; } }; } },
  Array,
  Set,
  JSON,
  Math,
  Date,
  String,
  Number,
  Object,
  Boolean,
  Error,
  console,
  require
};
vm.createContext(context);
vm.runInContext(coreCode, context, { filename: 'FIXED_CoreHelpers.js' });
vm.runInContext(webhookCode, context, { filename: 'FIXED_Webhook.js' });

assert.deepStrictEqual(Array.from(context.getAdminIds()), []);
config.ADMIN_LINE_IDS = 'U1, U2\nU3';
context.FIXED_CORE_ADMIN_CACHE_ = null;
assert.deepStrictEqual(Array.from(context.getAdminIds()), ['U1', 'U2', 'U3']);
config.ADMIN_LINE_IDS = ['U4', ' U5 '];
context.FIXED_CORE_ADMIN_CACHE_ = null;
assert.deepStrictEqual(Array.from(context.getAdminIds()), ['U4', 'U5']);

const body = '{"events":[]}';
const signature = require('crypto').createHmac('sha256', 'secret').update(body).digest('base64');
const valid = context.fixedWebhookValidateSignature_({ headers: { 'x-line-signature': signature } }, body);
assert.strictEqual(valid.valid, true);
const invalid = context.fixedWebhookValidateSignature_({ headers: { 'x-line-signature': 'wrong' } }, body);
assert.strictEqual(invalid.valid, false);
const missing = context.fixedWebhookValidateSignature_({ headers: {} }, body);
assert.strictEqual(missing.valid, false);

console.log('fixed helper tests: PASS');
