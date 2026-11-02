/*
 * run-net.js — ส่วนเชื่อมต่อของเกมวิ่งแข่ง (ใช้ร่วมกันระหว่าง run.html และ pad.html)
 * ------------------------------------------------------------------
 * มีช่องทางส่งข้อมูล 2 แบบ ใช้ API ชุดเดียวกัน
 *   1) firebase : Firebase Realtime Database (ใช้งานจริง จอเกม ↔ มือถือ)
 *   2) local    : BroadcastChannel ในเบราว์เซอร์เดียวกัน (ทดสอบบนคอมเครื่องเดียว หลายแท็บ)
 *
 * โครงข้อมูลห้อง: games/run/<รหัสห้อง>/{host, players/p1|p2, input/p1|p2}
 * EXTENSION POINT: เกมอื่น (เช่น มวย) ใช้ไฟล์นี้ได้เลย แค่เปลี่ยน ROOT
 */
(function () {
  'use strict';

  const FB_VER = '10.12.2';                 // รุ่นเดียวกับระบบ RTA
  const ROOT = 'games/run';
  const CFG_KEY = 'run_fb_cfg';             // ค่า Firebase ของเกม (localStorage)
  const RTA_KEY = 'rta_fb_cfg';             // ค่าเดิมของระบบ RTA (โดเมนเดียวกัน ใช้ซ้ำได้)
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ตัด 0/O และ 1/I/L ออก

  /* ---------------- เครื่องมือทั่วไป ---------------- */
  function loadScript(src) {
    return new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = ok;
      s.onerror = () => no(new Error('โหลด Firebase SDK ไม่ได้ (เช็กอินเทอร์เน็ต)'));
      document.head.appendChild(s);
    });
  }
  const clean = p => String(p || '').replace(/^\/+|\/+$/g, '');
  const parts = p => clean(p).split('/').filter(Boolean);
  const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

  function parseConfig(t) {
    if (t && typeof t === 'object') return t.databaseURL ? t : null;
    t = String(t || '');
    try { const j = JSON.parse(t); if (j && j.databaseURL) return j; } catch (_) { }
    const o = {};
    ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'].forEach(k => {
      const m = t.match(new RegExp(k + '\\s*:\\s*["\']([^"\']+)["\']'));
      if (m) o[k] = m[1];
    });
    const um = t.match(/https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?/i);
    if (!o.databaseURL && um) o.databaseURL = um[0];
    if (!o.databaseURL) return null;
    o.databaseURL = o.databaseURL.replace(/\/$/, '');
    return o;
  }

  function loadSavedConfig() {
    try { const c = parseConfig(JSON.parse(localStorage.getItem(CFG_KEY) || 'null')); if (c) return { config: c, from: 'game' }; } catch (_) { }
    try {
      const sy = JSON.parse(localStorage.getItem(RTA_KEY) || 'null');
      const c = sy && parseConfig(sy.config);
      if (c) return { config: c, from: 'rta' };
    } catch (_) { }
    return null;
  }
  function saveConfig(cfg) { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (_) { } }
  function clearConfig() { try { localStorage.removeItem(CFG_KEY); } catch (_) { } }

  function makeCode(n = 4) {
    let s = '';
    const a = new Uint32Array(n); crypto.getRandomValues(a);
    for (let i = 0; i < n; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
    return s;
  }
  function makeToken() {
    const a = new Uint32Array(3); crypto.getRandomValues(a);
    return Array.from(a, x => x.toString(36)).join('');
  }
  const roomPath = code => ROOT + '/' + code;

  /* ---------------- ช่องทาง Firebase ---------------- */
  async function firebaseTransport(cfg) {
    if (!window.firebase || !window.firebase.database) {
      await loadScript('https://www.gstatic.com/firebasejs/' + FB_VER + '/firebase-app-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/' + FB_VER + '/firebase-database-compat.js');
    }
    const fb = window.firebase;
    let app = (fb.apps || []).find(a => a.name === 'run');
    if (!app) app = fb.initializeApp({ databaseURL: cfg.databaseURL, apiKey: cfg.apiKey, projectId: cfg.projectId }, 'run');
    const db = app.database();
    let offset = 0, connected = false;
    const connCbs = [], errCbs = [];
    const fail = e => { console.warn('[run-net]', e); errCbs.forEach(f => f(e)); };
    db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
    db.ref('.info/connected').on('value', s => { connected = !!s.val(); connCbs.forEach(f => f(connected)); });
    const r = p => db.ref(clean(p));
    return {
      kind: 'firebase',
      now: () => Date.now() + offset,
      set: (p, v) => r(p).set(v).catch(fail),
      update: (p, v) => r(p).update(v).catch(fail),
      remove: p => r(p).remove().catch(fail),
      get: p => r(p).once('value').then(s => s.val()).catch(e => { fail(e); return null; }),
      on: (p, cb) => {
        const ref = r(p);
        const h = ref.on('value', s => cb(s.val()), fail);
        return () => ref.off('value', h);
      },
      transaction: (p, fn) => r(p).transaction(fn).then(x => ({ committed: x.committed, value: x.snapshot.val() })).catch(e => { fail(e); return { committed: false, value: null }; }),
      onDisconnect: p => ({
        set: v => r(p).onDisconnect().set(v).catch(fail),
        update: v => r(p).onDisconnect().update(v).catch(fail),
        remove: () => r(p).onDisconnect().remove().catch(fail),
        cancel: () => r(p).onDisconnect().cancel().catch(fail)
      }),
      onConnection: cb => { connCbs.push(cb); cb(connected); },
      onError: cb => errCbs.push(cb),
      isConnected: () => connected
    };
  }

  /* ---------------- ช่องทางทดสอบในเครื่อง (BroadcastChannel) ---------------- */
  function localTransport() {
    const me = makeToken();
    const ch = new BroadcastChannel('run-local-net');
    let tree = {};
    const listeners = new Set();
    const onDiscOps = new Map();
    let gotSnap;                                     // รอสำเนาข้อมูลจากแท็บอื่น (สูงสุด 0.6 วินาที)
    const ready = new Promise(ok => { gotSnap = ok; setTimeout(ok, 600); });

    function getAt(p) {
      let n = tree;
      for (const k of parts(p)) { if (n == null || typeof n !== 'object') return null; n = n[k]; }
      return n === undefined ? null : clone(n);
    }
    function prune(obj) {
      if (obj && typeof obj === 'object') {
        for (const k of Object.keys(obj)) {
          if (obj[k] === null || obj[k] === undefined) delete obj[k];
          else if (typeof obj[k] === 'object') { prune(obj[k]); if (!Object.keys(obj[k]).length) delete obj[k]; }
        }
      }
      return obj;
    }
    function setAt(p, v) {
      const ks = parts(p);
      v = clone(v);
      if (v && typeof v === 'object') prune(v);
      if (!ks.length) { tree = (v && typeof v === 'object') ? v : {}; return; }
      let n = tree;
      for (let i = 0; i < ks.length - 1; i++) {
        if (n[ks[i]] == null || typeof n[ks[i]] !== 'object') n[ks[i]] = {};
        n = n[ks[i]];
      }
      const last = ks[ks.length - 1];
      if (v === null || (typeof v === 'object' && !Object.keys(v).length)) delete n[last];
      else n[last] = v;
      prune(tree);
    }
    function apply(m) {
      if (m.op === 'set') setAt(m.path, m.value);
      else if (m.op === 'update') { for (const [k, v] of Object.entries(m.value || {})) setAt(clean(m.path) + '/' + k, v); }
      else if (m.op === 'remove') setAt(m.path, null);
      notify(m.path);
    }
    function notify(changed) {
      const c = clean(changed);
      for (const l of [...listeners]) {
        if (!listeners.has(l)) continue;
        if (l.path === c || l.path.startsWith(c + '/') || c.startsWith(l.path + '/') || c === '' || l.path === '') {
          try { l.cb(getAt(l.path)); } catch (e) { console.error(e); }
        }
      }
    }
    function send(m) { m.from = me; ch.postMessage(m); }
    function write(m) { apply(m); send(m); return Promise.resolve(); }

    ch.onmessage = e => {
      const m = e.data || {};
      if (m.from === me) return;
      if (m.op === 'hello') { if (Object.keys(tree).length) send({ op: 'snap', to: m.from, tree }); return; }
      if (m.op === 'snap') { if (m.to === me && !Object.keys(tree).length) { tree = clone(m.tree) || {}; notify(''); } if (m.to === me) gotSnap(); return; }
      apply(m);
    };
    send({ op: 'hello' });
    window.addEventListener('pagehide', () => { for (const fn of onDiscOps.values()) try { fn(); } catch (_) { } });

    return {
      kind: 'local',
      now: () => Date.now(),
      set: (p, v) => write({ op: 'set', path: clean(p), value: clone(v) }),
      update: (p, v) => write({ op: 'update', path: clean(p), value: clone(v) }),
      remove: p => write({ op: 'remove', path: clean(p) }),
      get: p => ready.then(() => getAt(p)),
      on: (p, cb) => {
        const l = { path: clean(p), cb };
        listeners.add(l);
        ready.then(() => { if (listeners.has(l)) cb(getAt(l.path)); });
        return () => listeners.delete(l);
      },
      transaction: (p, fn) => ready.then(() => {
        const nv = fn(getAt(p));
        if (nv === undefined) return { committed: false, value: getAt(p) };
        write({ op: 'set', path: clean(p), value: nv });
        return { committed: true, value: getAt(p) };
      }),
      onDisconnect: p => ({
        set: v => { onDiscOps.set(p, () => send({ op: 'set', path: clean(p), value: clone(v) })); return Promise.resolve(); },
        update: v => { onDiscOps.set(p, () => send({ op: 'update', path: clean(p), value: clone(v) })); return Promise.resolve(); },
        remove: () => { onDiscOps.set(p, () => send({ op: 'remove', path: clean(p) })); return Promise.resolve(); },
        cancel: () => { onDiscOps.delete(p); return Promise.resolve(); }
      }),
      onConnection: cb => cb(true),
      onError: () => { },
      isConnected: () => true
    };
  }

  async function connect(opts) {
    if (opts && opts.mode === 'local') return localTransport();
    const cfg = parseConfig(opts && opts.config);
    if (!cfg) throw new Error('ยังไม่มีค่า Firebase (databaseURL)');
    return firebaseTransport(cfg);
  }

  window.RunNet = {
    ROOT, connect, parseConfig, loadSavedConfig, saveConfig, clearConfig,
    makeCode, makeToken, roomPath
  };
})();
