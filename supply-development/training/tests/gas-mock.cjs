/**
 * ตัวจำลองบริการ Google Apps Script สำหรับรันโค้ด gas/*.gs ใน Node
 * ใช้ทดสอบตรรกะฝั่งเซิร์ฟเวอร์และเปิดหน้าเว็บในเครื่องโดยไม่ต้อง deploy
 * (ไม่ใช่ส่วนหนึ่งของระบบที่ขึ้นใช้งานจริง)
 */
'use strict';
process.env.TZ = 'Asia/Bangkok';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function signed(buf) { return Array.from(buf, function (b) { return b > 127 ? b - 256 : b; }); }
function toBuf(v) {
  if (Array.isArray(v)) return Buffer.from(v.map(function (b) { return (b + 256) % 256; }));
  return Buffer.from(String(v), 'utf8');
}

function createEnv(opts) {
  opts = opts || {};
  let offset = 0;                       // เลื่อนเวลาเสมือน (ms)
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor() {
      if (arguments.length === 0) super(RealDate.now() + offset);
      else super(...arguments);
    }
    static now() { return RealDate.now() + offset; }
  }

  /* ------------------------------------------------------------ Sheets */
  const books = {};
  let bookSeq = 0;
  class Range {
    constructor(sheet, r, c, nr, nc) {
      if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('Range out of bounds: ' + [r, c, nr, nc]);
      this.s = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc;
    }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.s.data[this.r - 1 + i] || [];
        const o = [];
        for (let j = 0; j < this.nc; j++) {
          const v = row[this.c - 1 + j];
          o.push(v === undefined || v === null ? '' : (v instanceof RealDate ? new FakeDate(v.getTime()) : v));
        }
        out.push(o);
      }
      return out;
    }
    getValue() { return this.getValues()[0][0]; }
    setValues(vals) {
      if (!Array.isArray(vals) || vals.length !== this.nr) throw new Error('setValues: rows mismatch ' + (vals && vals.length) + ' != ' + this.nr);
      for (let i = 0; i < this.nr; i++) {
        if (vals[i].length !== this.nc) throw new Error('setValues: cols mismatch ' + vals[i].length + ' != ' + this.nc);
        const ri = this.r - 1 + i;
        while (this.s.data.length <= ri) this.s.data.push([]);
        for (let j = 0; j < this.nc; j++) {
          let v = vals[i][j];
          if (v === undefined || v === null) v = '';
          if (typeof v === 'object' && !(v instanceof RealDate)) throw new Error('setValues: cell must be primitive or Date (got object)');
          if (typeof v === 'string' && v.charAt(0) === "'") v = v.slice(1);
          if (typeof v === 'string' && v.length > 50000) throw new Error('setValues: cell exceeds 50000 chars');
          if (opts.strictRows && ri + 1 > this.s.maxRows) throw new Error('Range beyond max rows ' + this.s.maxRows);
          this.s.data[ri][this.c - 1 + j] = v instanceof RealDate ? new RealDate(v.getTime()) : v;
        }
      }
      this.s.book.writes++;
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    clearContent() {
      for (let i = 0; i < this.nr; i++) {
        const row = this.s.data[this.r - 1 + i];
        if (row) for (let j = 0; j < this.nc; j++) row[this.c - 1 + j] = '';
      }
      return this;
    }
  }
  ['setFontWeight', 'setBackground', 'setFontColor', 'setNumberFormat', 'setWrap', 'setHorizontalAlignment',
    'protect', 'setNote', 'setDataValidation'].forEach(function (m) { Range.prototype[m] = function () { return this; }; });

  class Sheet {
    constructor(book, name) { this.book = book; this.name = name; this.data = []; this.maxRows = 1000; }
    insertRowsAfter(after, n) { this.maxRows += n; return this; }
    getName() { return this.name; }
    getLastRow() {
      for (let i = this.data.length - 1; i >= 0; i--) {
        const row = this.data[i];
        if (row && row.some(function (v) { return v !== '' && v !== undefined && v !== null; })) return i + 1;
      }
      return 0;
    }
    getLastColumn() { return this.data.reduce(function (m, r) { return Math.max(m, r ? r.length : 0); }, 0); }
    getMaxRows() { return Math.max(this.maxRows, this.data.length); }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
    appendRow(arr) { this.getRange(this.getLastRow() + 1, 1, 1, arr.length).setValues([arr]); return this; }
    deleteRow(i) { this.data.splice(i - 1, 1); return this; }
    clear() { this.data = []; return this; }
  }
  ['setFrozenRows', 'autoResizeColumns', 'setColumnWidth', 'hideSheet', 'setTabColor'].forEach(function (m) {
    Sheet.prototype[m] = function () { return this; };
  });

  class Book {
    constructor(name) { this.id = 'BOOK_' + (++bookSeq); this.name = name; this.sheets = []; this.writes = 0; books[this.id] = this; }
    getId() { return this.id; }
    getName() { return this.name; }
    getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getSheetByName(n) { return this.sheets.find(function (s) { return s.name === n; }) || null; }
    getSheets() { return this.sheets.slice(); }
    setSpreadsheetTimeZone(tz) { this.tz = tz; }
    insertSheet(n) { if (this.getSheetByName(n)) throw new Error('sheet exists: ' + n); const s = new Sheet(this, n); this.sheets.push(s); return s; }
    deleteSheet(s) { this.sheets = this.sheets.filter(function (x) { return x !== s; }); }
    cloneAs(name) {
      const b = new Book(name);
      this.sheets.forEach(function (s) {
        const t = b.insertSheet(s.name);
        t.data = s.data.map(function (r) { return r ? r.map(function (v) { return v instanceof RealDate ? new RealDate(v.getTime()) : v; }) : []; });
      });
      return b;
    }
  }

  const SpreadsheetApp = {
    create: function (name) { const b = new Book(name); b.insertSheet('Sheet1'); return b; },
    openById: function (id) { if (!books[id]) throw new Error('No spreadsheet ' + id); return books[id]; },
    getActiveSpreadsheet: function () { return null; },
    flush: function () { env.flushes++; },
    getUi: function () { throw new Error('No UI in tests'); }
  };

  /* ------------------------------------------------------------ Cache / Lock / Props */
  const cacheStore = new Map();
  function cacheObj() {
    return {
      get: function (k) {
        const e = cacheStore.get(k);
        if (!e) return null;
        if (e.exp < FakeDate.now()) { cacheStore.delete(k); return null; }
        return e.v;
      },
      put: function (k, v, ttl) {
        if (String(v).length > 100000) throw new Error('Cache value too large');
        cacheStore.set(k, { v: String(v), exp: FakeDate.now() + Math.min(ttl || 600, 21600) * 1000 });
      },
      remove: function (k) { cacheStore.delete(k); },
      removeAll: function (ks) { ks.forEach(function (k) { cacheStore.delete(k); }); },
      getAll: function (ks) { const o = {}; ks.forEach(function (k) { const v = cacheObj().get(k); if (v !== null) o[k] = v; }); return o; },
      putAll: function (o, ttl) { Object.keys(o).forEach(function (k) { cacheObj().put(k, o[k], ttl); }); }
    };
  }
  const CacheService = { getScriptCache: cacheObj, getUserCache: cacheObj };

  const lockState = { held: false, busy: false, acquired: 0 };
  const LockService = {
    getScriptLock: function () {
      return {
        waitLock: function () { if (lockState.busy) throw new Error('Lock timeout'); if (lockState.held && opts.strictLock) throw new Error('Nested lock (would deadlock)'); lockState.held = true; lockState.acquired++; },
        tryLock: function () { if (lockState.busy) return false; lockState.held = true; lockState.acquired++; return true; },
        releaseLock: function () { lockState.held = false; },
        hasLock: function () { return lockState.held; }
      };
    }
  };

  const props = {};
  const propObj = {
    getProperty: function (k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
    setProperty: function (k, v) { props[k] = String(v); return propObj; },
    deleteProperty: function (k) { delete props[k]; return propObj; },
    getProperties: function () { return Object.assign({}, props); },
    setProperties: function (o) { Object.keys(o).forEach(function (k) { props[k] = String(o[k]); }); return propObj; }
  };
  const PropertiesService = { getScriptProperties: function () { return propObj; } };

  /* ------------------------------------------------------------ Utilities etc. */
  const Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5', SHA_1: 'sha1' },
    Charset: { UTF_8: 'utf8' },
    getUuid: function () { return crypto.randomUUID(); },
    computeDigest: function (alg, v) { return signed(crypto.createHash(alg).update(toBuf(v)).digest()); },
    computeHmacSha256Signature: function (v, key) { return signed(crypto.createHmac('sha256', toBuf(key)).update(toBuf(v)).digest()); },
    base64Encode: function (v) { return toBuf(v).toString('base64'); },
    base64Decode: function (s) { return signed(Buffer.from(String(s), 'base64')); },
    formatDate: function (d, tz, fmt) {
      d = new RealDate(d.getTime());
      const p = function (n) { return ('0' + n).slice(-2); };
      return fmt.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
        .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()));
    },
    sleep: function () {},
    newBlob: function (data, mime, name) { return { data: data, mime: mime, name: name, getBytes: function () { return toBuf(data); } }; }
  };
  const ContentService = {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
    createTextOutput: function (s) {
      return { content: String(s), mime: 'text/plain', setMimeType: function (m) { this.mime = m; return this; }, getContent: function () { return this.content; } };
    }
  };
  const HtmlService = { createHtmlOutput: function (s) { return { getContent: function () { return s; }, setTitle: function () { return this; } }; } };
  const UrlFetchApp = {
    fetch: function (url, params) {
      if (!opts.fetchHandler) throw new Error('UrlFetchApp not mocked');
      const res = opts.fetchHandler(url, params || {});
      return { getResponseCode: function () { return res.code || 200; }, getContentText: function () { return typeof res.body === 'string' ? res.body : JSON.stringify(res.body); } };
    }
  };
  const folders = {};
  const DriveApp = {
    getFileById: function (id) {
      const b = books[id];
      return {
        getId: function () { return id; },
        getName: function () { return b.name; },
        makeCopy: function (name, folder) { const c = b.cloneAs(name); return { getId: function () { return c.id; }, getName: function () { return name; }, getUrl: function () { return c.getUrl(); } }; },
        setTrashed: function () { delete books[id]; }
      };
    },
    getFolderById: function (id) { return folders[id] || null; },
    createFolder: function (name) {
      const id = 'FOLDER_' + Object.keys(folders).length;
      folders[id] = { getId: function () { return id; }, getName: function () { return name; } };
      return folders[id];
    }
  };
  const triggers = [];
  const ScriptApp = {
    getProjectTriggers: function () { return triggers.slice(); },
    deleteTrigger: function (t) { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
    newTrigger: function (h) {
      const t = { timeBased: function () { return t; }, everyDays: function () { return t; }, everyHours: function () { return t; },
        atHour: function () { return t; }, onWeekDay: function () { return t; }, nearMinute: function () { return t; },
        getHandlerFunction: function () { return h; }, create: function () { triggers.push(t); return t; } };
      return t;
    },
    WeekDay: { SUNDAY: 'SUNDAY' }
  };
  const Session = { getScriptTimeZone: function () { return 'Asia/Bangkok'; } };
  const logs = [];
  const Logger = { log: function () { logs.push(Array.from(arguments).join(' ')); } };

  const env = {
    flushes: 0, logs: logs, books: books, props: props, cacheStore: cacheStore, lockState: lockState,
    advance: function (ms) { offset += ms; },
    clearCache: function () { cacheStore.clear(); },
    ctx: null
  };

  const sandbox = {
    SpreadsheetApp, CacheService, LockService, PropertiesService, Utilities, ContentService, HtmlService,
    UrlFetchApp, DriveApp, ScriptApp, Session, Logger, Date: FakeDate, Math, JSON, console
  };
  const context = vm.createContext(sandbox);
  const dir = opts.gasDir || path.join(__dirname, '..', 'gas');
  const files = fs.readdirSync(dir).filter(function (f) { return /\.gs$/.test(f); }).sort();
  const code = files.map(function (f) { return '/* ' + f + ' */\n' + fs.readFileSync(path.join(dir, f), 'utf8'); }).join('\n');
  vm.runInContext(code, context, { filename: 'gas-bundle.js' });
  env.ctx = context;

  /** เรียก API เหมือนหน้าเว็บยิง POST */
  env.post = function (body) {
    const out = context.doPost({ postData: { contents: JSON.stringify(body), type: 'text/plain' }, parameter: {} });
    return JSON.parse(out.getContent());
  };
  env.call = function (name) { return context[name].apply(null, Array.prototype.slice.call(arguments, 1)); };
  env.setFault = function (name) { context.__FAULT__ = name || ''; };
  env.sheetRows = function (name) {
    const id = props.DB_ID; const sh = books[id].getSheetByName(name);
    const n = sh.getLastRow(); if (n < 2) return [];
    const vals = sh.getRange(1, 1, n, sh.getLastColumn()).getValues();
    const head = vals[0];
    return vals.slice(1).map(function (r) { const o = {}; head.forEach(function (h, i) { o[h] = r[i]; }); return o; });
  };
  return env;
}

module.exports = { createEnv };
