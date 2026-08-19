const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

function makeSheet(name, initial) {
  const data = initial || [];
  function range(row, col, numRows, numCols) {
    return {
      getValues: () => data.slice(row - 1, row - 1 + (numRows || 1)).map(r => r.slice(col - 1, col - 1 + (numCols || 1))),
      setValues: values => { values.forEach((vals, i) => { for (let j = 0; j < vals.length; j++) data[row - 1 + i][col - 1 + j] = vals[j]; }); },
      setValue: value => { while (!data[row - 1]) data.push([]); data[row - 1][col - 1] = value; },
      getValue: () => (data[row - 1] || [])[col - 1],
      setFontWeight: () => range(row, col, numRows, numCols),
      setBackground: () => range(row, col, numRows, numCols),
      setFontColor: () => range(row, col, numRows, numCols),
      setHorizontalAlignment: () => range(row, col, numRows, numCols)
    };
  }
  return {
    getName: () => name,
    getLastRow: () => data.length,
    getLastColumn: () => Math.max(1, ...data.map(r => r.length)),
    getRange: range,
    getDataRange: () => ({ getValues: () => data.map(r => r.slice()) }),
    appendRow: row => data.push(row.slice()),
    setFrozenRows: () => {},
    _data: data
  };
}

const settingsSheet = makeSheet('ตั้งค่า', [['Key', 'Value', 'Description']]);
const sheets = { 'ตั้งค่า': settingsSheet };
const configDefaults = {
  NOTIFY_STATUS: 'ON',
  NOTIFY_DEFAULT_TARGETS: 'admins',
  NOTIFY_FOOTER_TEXT: 'ระบบแจ้งเตือน',
  NOTIFY_BRAND_COLOR: '#1E40AF',
  NOTIFY_TIMEZONE: 'Asia/Bangkok'
};
const ss = {
  getSheetByName: name => sheets[name] || null,
  insertSheet: name => { const s = makeSheet(name, []); sheets[name] = s; return s; }
};
const context = {
  console, Date, String, Number, Math, Object, Array, RegExp,
  SPREADSHEET_ID: 'NEWBOT_NOTIFY_TEST',
  SHEETS: { SETTINGS: 'ตั้งค่า', SCHEDULE: 'ตารางเวลา', NOTIFY_LOG: 'แจ้งเตือน' },
  SpreadsheetApp: { openById: () => ss, flush: () => {} },
  Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
  Utilities: { formatDate: () => '2026-08-19 12:00:00' },
  getConfig: key => {
    const row = settingsSheet._data.slice(1).find(r => String(r[0] || '').trim() === key);
    return row ? row[1] : configDefaults[key];
  },
  Logger: { log: () => {} }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('LineFlexNotifyFix.js', 'utf8'), context, { filename: 'LineFlexNotifyFix.js' });

let result = context.saveNotifySettings({ config: {
  NOTIFY_STATUS: 'OFF',
  NOTIFY_BRAND_COLOR: '#f97316',
  NOTIFY_DEFAULT_TARGETS: 'admins,C123',
  NOTIFY_FOOTER_TEXT: 'แจ้งเตือนจากบอทใหม่',
  NOTIFY_TIMEZONE: 'Asia/Bangkok'
}});
assert.strictEqual(result.success, true);
let loaded = context.getNotifySettings();
assert.strictEqual(loaded.config.NOTIFY_STATUS, 'OFF');
assert.strictEqual(loaded.config.NOTIFY_BRAND_COLOR, '#F97316');
assert.strictEqual(loaded.config.NOTIFY_DEFAULT_TARGETS, 'admins,C123');
assert.strictEqual(loaded.config.NOTIFY_FOOTER_TEXT, 'แจ้งเตือนจากบอทใหม่');

assert.strictEqual(context.saveNotifySettings({ config: { NOTIFY_STATUS: 'MAYBE' } }).success, false);
assert.strictEqual(context.saveNotifySettings({ config: { NOTIFY_BRAND_COLOR: 'orange' } }).success, false);
assert.strictEqual(context.getScheduleList().success, false);

console.log(JSON.stringify({ passed: true, settingRows: settingsSheet._data.length - 1, status: loaded.config.NOTIFY_STATUS, color: loaded.config.NOTIFY_BRAND_COLOR }, null, 2));
