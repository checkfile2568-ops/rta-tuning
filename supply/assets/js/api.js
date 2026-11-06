/* ระบบเบิกวัสดุ · api.js — ชั้นเรียก API + คิวส่งคำขอเบิก
 *  • POST ไปที่ doPost ของ GAS ด้วย Content-Type: text/plain (ลดโอกาสเกิด CORS preflight)
 *  • ทุก action ที่เขียนข้อมูลแนบ client_uuid — ส่งซ้ำได้ผลเดิม ไม่เกิดเอกสารซ้ำ
 *  • คำขอเบิกผ่านคิวในเครื่อง: แสดง "กำลังส่ง/ส่งสำเร็จ/ส่งไม่สำเร็จ" แยกจากรายการที่บันทึกแล้ว
 *  • การจ่าย รับเข้า ปรับยอด ต้องรอผลจากเซิร์ฟเวอร์ก่อนแสดงว่าสำเร็จ */
'use strict';
class ApiError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details || null; }
}

const API = (function () {
  const cfg = window.APP_CONFIG || {};
  let token = Store.token.get();
  let lastCatVer = null;
  const listeners = { session: [], catalog: [] };

  async function call(action, data, opt) {
    opt = opt || {};
    if (!cfg.API_URL || /ใส่ URL/.test(cfg.API_URL)) throw new ApiError('NO_API', 'ยังไม่ได้ตั้งค่า API_URL ใน config.js');
    const body = { action: action, token: token, data: data || {} };
    if (opt.write) body.client_uuid = opt.uuid || U.uuid();
    const ctrl = window.AbortController ? new AbortController() : null;
    const timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opt.timeout || 45000) : null;
    let res, text;
    try {
      res = await fetch(cfg.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body), redirect: 'follow', credentials: 'omit', signal: ctrl ? ctrl.signal : undefined });
      text = await res.text();
    } catch (e) {
      throw new ApiError('NETWORK', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่', { offline: !navigator.onLine });
    } finally { if (timer) clearTimeout(timer); }
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new ApiError('BAD_RESPONSE', 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง กรุณาลองใหม่', { status: res && res.status }); }
    if (j.catalogVersion !== undefined && lastCatVer !== null && j.catalogVersion !== lastCatVer) {
      listeners.catalog.forEach(function (f) { f(j.catalogVersion); });
    }
    if (j.catalogVersion !== undefined) lastCatVer = j.catalogVersion;
    if (!j.ok) {
      const e = j.error || {};
      const err = new ApiError(e.code || 'ERROR', e.message || 'เกิดข้อผิดพลาด', e.details);
      if (/^(SESSION_EXPIRED|SESSION_REVOKED|PIN_CHANGE_REQUIRED)$/.test(err.code) && action !== 'login') {
        listeners.session.forEach(function (f) { f(err); });
      }
      throw err;
    }
    return j.data;
  }

  return {
    call: call,
    write: function (action, data, uuid) { return call(action, data, { write: true, uuid: uuid }); },
    setToken: function (t) { token = t || ''; if (t) Store.token.set(t); else Store.token.del(); },
    token: function () { return token; },
    setCatalogVersion: function (v) { lastCatVer = v; },
    on: function (ev, fn) { listeners[ev].push(fn); }
  };
})();

/** คิวส่งคำขอเบิก (เก็บในเครื่องแยกตามบัญชี) */
const Outbox = (function () {
  let code = '';
  let items = [];
  const subs = [];
  function save() { if (code) Store.ls.set('outbox:' + code, items); subs.forEach(function (f) { f(items); }); }
  async function send(it) {
    it.status = 'sending'; it.error = null; save();
    try {
      const r = await API.write('submitRequest', it.data, it.uuid);
      it.status = 'done'; it.result = r; save();
      return r;
    } catch (e) {
      if (e.code === 'NETWORK' || e.code === 'BAD_RESPONSE' || e.code === 'BUSY') it.status = 'failed';
      else if (/^SESSION_/.test(e.code)) it.status = 'needs_login';
      else it.status = 'rejected';
      it.error = { code: e.code, message: e.message, details: e.details };
      save();
      throw e;
    }
  }
  return {
    load: function (c) { code = c; items = (Store.ls.get('outbox:' + c, []) || []).filter(function (x) { return x.status !== 'done'; }); save(); },
    list: function () { return items.slice(); },
    pending: function () { return items.filter(function (x) { return x.status !== 'done'; }); },
    add: function (data) {
      const it = { uuid: U.uuid(), data: data, created: new Date().toISOString(), status: 'queued' };
      items.push(it); save();
      return it;
    },
    send: send,
    retry: function (uuid) { const it = items.find(function (x) { return x.uuid === uuid; }); return it ? send(it) : Promise.reject(new Error('ไม่พบรายการ')); },
    /** หลังล็อกอินใหม่: ส่งรายการที่ค้างเพราะหมดเวลา (uuid เดิม — เซิร์ฟเวอร์ตรวจซ้ำให้) */
    resumeAll: function () {
      return Promise.all(items.filter(function (x) { return x.status === 'needs_login' || x.status === 'failed' || x.status === 'sending' || x.status === 'queued'; })
        .map(function (x) { return send(x).catch(function () { return null; }); }));
    },
    remove: function (uuid) { items = items.filter(function (x) { return x.uuid !== uuid; }); save(); },
    clearDone: function () { items = items.filter(function (x) { return x.status !== 'done'; }); save(); },
    subscribe: function (f) { subs.push(f); }
  };
})();
