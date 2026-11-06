/* ระบบเบิกวัสดุ · sw.js — แคชเฉพาะไฟล์หน้าเว็บ (ไม่แคชผล API ข้อมูลส่วนบุคคล หรือมูลค่า) */
const CACHE = 'supply-shell-1.1.1';
const SHELL = ['./', 'index.html', 'config.js?v=1.1.0', 'manifest.json',
  'assets/css/app.css?v=1.1.1', 'assets/css/print.css?v=1.1.0',
  'assets/js/util.js?v=1.1.0', 'assets/js/store.js?v=1.1.0', 'assets/js/api.js?v=1.1.0', 'assets/js/app.js?v=1.1.1',
  'assets/js/user.js?v=1.1.0', 'assets/js/officer.js?v=1.1.1', 'assets/js/admin.js?v=1.1.1', 'assets/js/dash.js?v=1.1.0',
  'assets/js/print.js?v=1.1.0', 'assets/img/icon.svg',
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
self.addEventListener('fetch', function (e) {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;       // API (ต่างโดเมน) ไม่ผ่าน SW
  e.respondWith(caches.match(e.request).then(function (hit) {
    const net = fetch(e.request).then(function (res) {
      if (res.ok && (u.pathname.indexOf('/assets/') >= 0 || /index\.html$|\/$/.test(u.pathname))) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
