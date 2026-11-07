/* ระบบเบิกวัสดุ · store.js — แคชในเครื่อง
 *  • IndexedDB: รายการวัสดุ (catalog) แยกตามบัญชี — ค้นหาในเครื่องทันที
 *  • localStorage: ตะกร้า/ร่าง และคิวส่ง แยกตามบัญชี (หมุนจอ/สลับแอป/หมดเวลาแล้วกลับมาทำต่อได้)
 *  • sessionStorage: token (ปิดแท็บแล้วหาย)
 *  ออกจากระบบ/สลับบัญชี → ล้างข้อมูลเฉพาะผู้ใช้ทั้งหมด */
'use strict';
const Store = (function () {
  let dataScope = '';
  let realEpoch = '';
  function scoped(k) {
    return dataScope && /^(catalog|cart|purpose|outbox):/.test(k)
      ? k.replace(':', ':training:' + dataScope + ':')
      : realEpoch && /^(catalog|cart|purpose|outbox):/.test(k) ? k.replace(':', ':real:' + realEpoch + ':') : k;
  }
  let dbp = null;
  const mem = {};
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res) {
      try {
        const r = indexedDB.open('supply-cache', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      if (!d) { const r = fn(null); return r && r.result; }
      return new Promise(function (res) {
        try {
          const t = d.transaction('kv', mode);
          const r = fn(t.objectStore('kv'));
          t.oncomplete = function () { res(r && r.result); };
          t.onerror = function () { res(undefined); };
        } catch (e) { res(undefined); }
      });
    });
  }
  const ls = {
    get: function (k, def) { try { const v = localStorage.getItem('sp:' + scoped(k)); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
    set: function (k, v) { try { localStorage.setItem('sp:' + scoped(k), JSON.stringify(v)); } catch (e) { /* เต็ม */ } },
    del: function (k) { try { localStorage.removeItem('sp:' + scoped(k)); } catch (e) { /**/ } }
  };
  return {
    setEpoch: function (epoch) { realEpoch = epoch || ''; },
    setScope: function (generation) { dataScope = generation || ''; },
    training: {
      get: function () { try { return sessionStorage.getItem('sp:training') || ''; } catch (e) { return ''; } },
      set: function (g) { if (g) sessionStorage.setItem('sp:training', g); else sessionStorage.removeItem('sp:training'); }
    },
    get: function (k) { k = scoped(k); return tx('readonly', function (s) { return s ? s.get(k) : { result: mem[k] }; }); },
    set: function (k, v) { k = scoped(k); return tx('readwrite', function (s) { if (s) return s.put(v, k); mem[k] = v; return null; }); },
    del: function (k) { k = scoped(k); return tx('readwrite', function (s) { if (s) return s.delete(k); delete mem[k]; return null; }); },
    ls: ls,
    token: {
      get: function () { try { return sessionStorage.getItem('sp:token') || ''; } catch (e) { return ''; } },
      set: function (t) { try { sessionStorage.setItem('sp:token', t); } catch (e) { /**/ } },
      del: function () { try { sessionStorage.removeItem('sp:token'); } catch (e) { /**/ } }
    },
    /** ลบแคชรายการวัสดุของบัญชีอื่นทั้งหมด (keep = คีย์ที่เก็บไว้ หรือว่างเพื่อลบทั้งหมด)
     *  แคชของเจ้าหน้าที่พัสดุมีมูลค่าวัสดุ — ไม่ให้ค้างในเครื่องหลังปิดแท็บหรือสลับบัญชี */
    clearCatalogs: function (keep) {
      keep = scoped(keep);
      return tx('readwrite', function (s) {
        if (!s) { Object.keys(mem).forEach(function (k) { if (k.indexOf('catalog:') === 0 && k !== keep) delete mem[k]; }); return null; }
        const r = s.getAllKeys ? s.getAllKeys() : null;
        if (r) r.onsuccess = function () { (r.result || []).forEach(function (k) { if (String(k).indexOf('catalog:') === 0 && k !== keep) s.delete(k); }); };
        return null;
      });
    },
    /** ล้างข้อมูลเฉพาะผู้ใช้ (ตะกร้า คิวส่ง แคชรายการ) */
    clearUser: function (code) {
      ls.del('cart:' + code); ls.del('outbox:' + code); ls.del('purpose:' + code);
      Store.token.del(); Store.training.set('');
      return Store.del('catalog:' + code);
    }
  };
})();


