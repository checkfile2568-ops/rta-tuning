/* ระบบบริหารวัสดุสำนักงาน · util.js — เครื่องมือกลาง: วันที่ พ.ศ., ตัวเลข, escape, toast, modal, โหลดสคริปต์ */
'use strict';
const U = (function () {
  const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const nf = new Intl.NumberFormat('th-TH');
  const mf = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function d(v) { if (!v) return null; const x = v instanceof Date ? v : new Date(v); return isNaN(x) ? null : x; }
  const U = {
    esc: function (s) {
      return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    /** 6 พฤศจิกายน 2569 */
    thDate: function (v) { const x = d(v); return x ? x.getDate() + ' ' + MONTHS[x.getMonth()] + ' ' + (x.getFullYear() + 543) : ''; },
    /** 6 พ.ย. 2569 */
    thShort: function (v) { const x = d(v); return x ? x.getDate() + ' ' + MON[x.getMonth()] + ' ' + (x.getFullYear() + 543) : ''; },
    /** 6 พ.ย. 2569 13:49 */
    thDateTime: function (v) {
      const x = d(v);
      return x ? U.thShort(x) + ' ' + ('0' + x.getHours()).slice(-2) + ':' + ('0' + x.getMinutes()).slice(-2) : '';
    },
    ymd: function (v) {
      const x = d(v) || new Date();
      return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2);
    },
    fy: function (v) { const x = d(v) || new Date(); return x.getFullYear() + 543 + (x.getMonth() >= 9 ? 1 : 0); },
    n: function (v) { return v === null || v === undefined || v === '' ? '—' : nf.format(Number(v)); },
    money: function (v) { return v === null || v === undefined || v === '' ? '—' : mf.format(Number(v)); },
    uuid: function () {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      const b = new Uint8Array(16); crypto.getRandomValues(b);
      b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
      const h = Array.from(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    },
    debounce: function (fn, ms) { let t; return function () { const a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; },
    /** ค้นหาแบบไทย: ตัดช่องว่าง ไม่สนตัวพิมพ์ ทุกคำต้องพบ */
    norm: function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); },
    match: function (hay, q) {
      const H = U.norm(hay);
      return String(q || '').toLowerCase().split(/\s+/).filter(Boolean).every(function (w) { return H.indexOf(w) >= 0; });
    },
    $: function (sel, root) { return (root || document).querySelector(sel); },
    $$: function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); },
    toast: function (msg, kind, ms) {
      let box = U.$('#toasts');
      if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
      const el = document.createElement('div');
      el.className = 'toast ' + (kind || 'info');
      el.textContent = msg;
      box.appendChild(el);
      setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, ms || 3200);
    },
    /** หน้าต่างยืนยัน/ฟอร์ม — คืน Promise ของค่าในฟอร์ม หรือ null ถ้ายกเลิก */
    modal: function (o) {
      return new Promise(function (resolve) {
        const wrap = document.createElement('div');
        wrap.className = 'modal-wrap';
        wrap.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mdl-t">' +
          '<h3 id="mdl-t">' + U.esc(o.title || '') + '</h3><form class="modal-body">' + (o.html || '') +
          '<div class="modal-actions">' + (o.cancel === false ? '' : '<button type="button" class="btn ghost" data-x>' + U.esc(o.cancel || 'ยกเลิก') + '</button>') +
          '<button type="submit" class="btn ' + (o.danger ? 'danger' : 'primary') + '">' + U.esc(o.ok || 'ตกลง') + '</button></div></form></div>';
        document.body.appendChild(wrap);
        const form = wrap.querySelector('form');
        const done = function (v) { wrap.remove(); document.removeEventListener('keydown', esc); resolve(v); };
        const esc = function (e) { if (e.key === 'Escape') done(null); };
        document.addEventListener('keydown', esc);
        wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.hasAttribute('data-x')) done(null); });
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          const v = {};
          U.$$('[name]', form).forEach(function (f) { v[f.name] = f.type === 'checkbox' ? f.checked : f.value; });
          if (o.validate) { const m = o.validate(v, form); if (m) { const er = form.querySelector('.modal-err') || form.insertBefore(document.createElement('p'), form.querySelector('.modal-actions')); er.className = 'modal-err'; er.textContent = m; return; } }
          done(v);
        });
        const first = form.querySelector('input,select,textarea,button[type=submit]');
        if (first) setTimeout(function () { first.focus(); }, 30);
      });
    },
    confirm: function (title, html, okText, danger) { return U.modal({ title: title, html: '<p>' + html + '</p>', ok: okText || 'ยืนยัน', danger: danger }).then(function (v) { return !!v; }); },
    loadScript: function (src) {
      U._ls = U._ls || {};
      if (U._ls[src]) return U._ls[src];
      U._ls[src] = new Promise(function (res, rej) {
        const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { delete U._ls[src]; rej(new Error('โหลดไม่สำเร็จ: ' + src)); };
        document.head.appendChild(s);
      });
      return U._ls[src];
    },
    /** ส่งออก Excel ด้วย SheetJS (สร้างไฟล์ในเบราว์เซอร์) */
    exportXlsx: function (name, sheets) {
      return U.loadScript('assets/vendor/xlsx.full.min.js').then(function () {
        const wb = XLSX.utils.book_new();
        sheets.forEach(function (s) {
          const ws = XLSX.utils.aoa_to_sheet([s.head].concat(s.rows));
          ws['!cols'] = s.head.map(function (h, i) { return { wch: Math.max(8, Math.min(40, String(h).length + 6, s.widths ? s.widths[i] : 99)) }; });
          XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
        });
        XLSX.writeFile(wb, name + '.xlsx');
      });
    },
    badge: function (lvl) {
      return { ok: '<span class="badge ok">พร้อมเบิก</span>', low: '<span class="badge low">ใกล้หมด</span>',
               out: '<span class="badge out">หมด</span>' }[lvl] || '';
    }
  };
  /** ชื่อระบบที่แสดงทุกจุดในหน้าเว็บ — แก้ที่ config.js (APP_NAME) จุดเดียว */
  U.APP_NAME = (window.APP_CONFIG && APP_CONFIG.APP_NAME) || 'ระบบบริหารวัสดุสำนักงาน';
  return U;
})();
