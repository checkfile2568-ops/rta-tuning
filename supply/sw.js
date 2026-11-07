/* ระบบเบิกวัสดุ · sw.js — แคชเฉพาะไฟล์หน้าเว็บ (ไม่แคชผล API ข้อมูลส่วนบุคคล หรือมูลค่า)
 *  • index.html, config.js, manifest.json → ดึงจากเครือข่ายก่อน (แก้ API_URL แล้วมีผลทันที) ออฟไลน์ค่อยใช้แคช
 *  • ไฟล์ใน assets/ (มี ?v= กำกับรุ่น) → ใช้แคชก่อนแล้วอัปเดตเบื้องหลัง
 *  • ล้างเฉพาะแคชของระบบนี้ (ชื่อขึ้นต้น supply-shell-) — โดเมนนี้มีระบบอื่นอยู่ด้วย */
const CACHE = 'supply-shell-1.3.0';
const V = '?v=1.3.0';
const SHELL = ['./', 'index.html', 'config.js' + V, 'manifest.json',
  'assets/css/app.css' + V, 'assets/css/print.css' + V,
  'assets/js/util.js' + V, 'assets/js/store.js' + V, 'assets/js/api.js' + V, 'assets/js/app.js' + V,
  'assets/js/user.js' + V, 'assets/js/officer.js' + V, 'assets/js/admin.js' + V, 'assets/js/dash.js' + V,
  'assets/js/training.js' + V, 'assets/js/real-trial.js' + V, 'assets/js/print.js' + V, 'assets/img/icon.svg',
  'assets/fonts/noto-sans-thai-thai-400-normal.woff2', 'assets/fonts/noto-sans-thai-thai-600-normal.woff2',
  'assets/fonts/noto-sans-thai-thai-700-normal.woff2', 'assets/fonts/noto-sans-thai-latin-400-normal.woff2'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('supply-shell-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function put(req, res) {
  if (!res || !res.ok) return;
  const copy = res.clone();
  caches.open(CACHE).then(function (c) { c.put(req, copy); });
}
function networkFirst(req) {
  return fetch(req, { cache: 'no-cache' }).then(function (res) { put(req, res); return res; })
    .catch(function () { return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || Response.error(); }); });
}
function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    const net = fetch(req).then(function (res) { put(req, res); return res; }).catch(function () { return hit; });
    return hit || net;
  });
}

self.addEventListener('fetch', function (e) {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;            // API (ต่างโดเมน) ไม่ผ่าน SW
  const scope = new URL(self.registration.scope);
  if (u.pathname.indexOf(scope.pathname) !== 0) return;                       // หน้าของระบบอื่นในโดเมนเดียวกัน
  const rel = u.pathname.slice(scope.pathname.length);
  if (req.mode === 'navigate' || rel === '' || rel === 'index.html' || rel === 'config.js' || rel === 'manifest.json') {
    e.respondWith(networkFirst(req));
  } else if (rel.indexOf('assets/') === 0) {
    e.respondWith(cacheFirst(req));
  }
});




