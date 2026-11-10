/* ═══════════════════════════════════════════════════════════════════════
 * print-kit · print-kit.js · v1.0.0 (9 พ.ย. 2569)
 * ตัวสร้างเอกสาร A4 จากแม่แบบ JSON + ข้อมูล — ใช้ร่วมกันทุกระบบของศาล
 *
 * แนวคิด
 *   แม่แบบ (templates/*.json) = ข้อความ + รูปแบบ (ขนาด ตัวหนา จัดแนว กระจายอักษร
 *   ระยะบรรทัด ระยะก่อน/หลัง ย่อหน้า) แก้ได้จากหน้าจอโดยไม่แตะโค้ด
 *   ระบบปลายทาง = ส่ง "ข้อมูล" (คีย์ภาษาไทย) + "slot" สำหรับส่วนที่ซับซ้อน (เช่น QR)
 *   ข้อมูลจริงถูกเติมในเบราว์เซอร์ของผู้ใช้ ไม่ถูกส่งไปที่ใด
 *
 * ใช้งาน
 *   const out = PrintKit.render(tpl, data, { slots, assetBase, markUnknown });
 *   el.innerHTML = out.html;                     // หน้าตัวอย่าง
 *   PrintKit.print(el.innerHTML, tpl.page, { pages, stamp });   // สั่งพิมพ์
 *
 * ต่อยอด: เพิ่มชนิดบล็อกใหม่ที่ BLOCKS (ด้านล่าง) · เพิ่มตัวกรองที่ FILTERS
 * ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const VERSION = '1.0.0';
  const TH_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
  const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const MONTHS_S = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  /* ───────────── ตัวช่วยทั่วไป ───────────── */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function thaiNum(s) { return String(s === null || s === undefined ? '' : s).replace(/[0-9]/g, function (d) { return TH_DIGITS[d]; }); }
  function arabicNum(s) { return String(s || '').replace(/[๐-๙]/g, function (d) { return String(TH_DIGITS.indexOf(d)); }); }
  /** เปลี่ยนเลขเฉพาะข้อความ ไม่แตะแท็ก/แอตทริบิวต์/entity */
  function thaiNumHtml(html) {
    return String(html).replace(/(^|>)([^<]*)/g, function (m, a, txt) {
      return a + txt.replace(/(&[#a-zA-Z0-9]+;)|([0-9])/g, function (x, ent, d) { return ent || TH_DIGITS[d]; });
    });
  }
  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }
  /** 9 พฤศจิกายน 2569 */
  function thDate(v) { const d = toDate(v); return d ? d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543) : ''; }
  /** 9 พ.ย. 2569 (เดือนย่อ — ใช้ในช่องแคบ เช่น ใต้ช่องลงนาม) */
  function thDateS(v) { const d = toDate(v); return d ? d.getDate() + ' ' + MONTHS_S[d.getMonth()] + ' ' + (d.getFullYear() + 543) : ''; }
  /** { วัน:'9', เดือน:'พฤศจิกายน', ปี:'2569' } สำหรับแบบที่มีช่อง วันที่…เดือน…พ.ศ.… */
  function thDateParts(v) { const d = toDate(v); return d ? { 'วัน': String(d.getDate()), 'เดือน': MONTHS[d.getMonth()], 'ปี': String(d.getFullYear() + 543) } : { 'วัน': '', 'เดือน': '', 'ปี': '' }; }
  /** 9 พ.ย. 2569 10:15 น. */
  function thDateTime(v) {
    const d = toDate(v); if (!d) return '';
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getDate() + ' ' + MONTHS_S[d.getMonth()] + ' ' + (d.getFullYear() + 543) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ' น.';
  }
  /** 1234567890123 → 1-2345-67890-12-3 */
  function idCard(s) {
    const x = arabicNum(s).replace(/\D/g, '');
    return x.length === 13 ? x[0] + '-' + x.slice(1, 5) + '-' + x.slice(5, 10) + '-' + x.slice(10, 12) + '-' + x[12] : String(s || '');
  }

  /* ───────────── ตัวกรองในช่องเติม {{คีย์|ตัวกรอง}} ───────────── */
  const DOTS = '..................................';
  const FILTERS = {
    // ห้ามตัดบรรทัด (ชื่อคน) — ชื่อยาวเกิน 30 อักษรปล่อยให้ตัดได้ ไม่ให้ล้นขอบกระดาษ
    nb: function (v, raw) { return v && String(raw).length <= 30 ? '<span class="pk-nb">' + v + '</span>' : v; },
    dots: function (v) { return v ? v : DOTS; },                                         // ว่าง → จุดไข่ปลา
    shortdots: function (v) { return v ? v : '...../...../.....'; },
    id: function (v, raw) { return esc(idCard(raw)); },
    date: function (v, raw) { return esc(thDate(raw)); }
    // ต่อยอด: เพิ่มตัวกรองใหม่ที่นี่
  };

  /** แทน {{คีย์}} ด้วยข้อมูล · **ตัวหนา** · ขึ้นบรรทัดใหม่ด้วย \n */
  function fill(text, data, ctx) {
    let s = esc(text || '');
    s = s.replace(/\{\{\s*([^}|]+?)\s*(?:\|\s*([a-z]+)\s*)?\}\}/g, function (m, key, filter) {
      const has = Object.prototype.hasOwnProperty.call(data, key);
      if (!has) {
        ctx.unknown[key] = true;
        return ctx.markUnknown ? '<span class="pk-unknown">{{' + key + '}}</span>' : '';
      }
      const raw = data[key];
      let v = esc(raw === null || raw === undefined ? '' : raw);
      if (filter && FILTERS[filter]) v = FILTERS[filter](v, raw);
      return v;
    });
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    return s;
  }

  /* ───────────── รูปแบบ (style) ของบล็อก ─────────────
   * size (pt) · bold · italic · underline · align: left|center|right|justify|distribute
   * indent (ซม. ย่อหน้าบรรทัดแรก) · hang (ซม. ย่อหน้าห้อย) · letterSpacing (pt กระจายอักษร)
   * wordSpacing (pt) · lineHeight (เท่า) · before/after (pt ระยะก่อน/หลัง)                */
  const STYLE_KEYS = ['size', 'bold', 'italic', 'underline', 'align', 'indent', 'hang', 'letterSpacing', 'wordSpacing', 'lineHeight', 'before', 'after'];
  function styleOf(st) {
    st = st || {};
    const c = [];
    if (st.size) c.push('font-size:' + Number(st.size) + 'pt');
    if (st.bold !== undefined) c.push('font-weight:' + (st.bold ? 700 : 400));
    if (st.italic) c.push('font-style:italic');
    if (st.underline) c.push('text-decoration:underline');
    if (st.align && st.align !== 'distribute' && st.align !== 'justify') c.push('text-align:' + st.align);
    if (st.hang) { c.push('padding-left:' + Number(st.hang) + 'cm'); c.push('text-indent:-' + Number(st.hang) + 'cm'); }
    else if (st.indent) c.push('text-indent:' + Number(st.indent) + 'cm');
    if (st.letterSpacing) c.push('letter-spacing:' + Number(st.letterSpacing) + 'pt');
    if (st.wordSpacing) c.push('word-spacing:' + Number(st.wordSpacing) + 'pt');
    if (st.lineHeight) c.push('line-height:' + Number(st.lineHeight));
    if (st.before) c.push('margin-top:' + Number(st.before) + 'pt');
    if (st.after) c.push('margin-bottom:' + Number(st.after) + 'pt');
    return c.join(';');
  }
  function cls(st) {
    st = st || {};
    return 'pk-b' + (st.align === 'distribute' ? ' pk-distribute' : st.align === 'justify' ? ' pk-justify' : '');
  }
  function wrap(tag, b, inner, extraCls) {
    return '<' + tag + ' class="' + cls(b.style) + (extraCls ? ' ' + extraCls : '') + '" style="' + styleOf(b.style) + '" data-bid="' + esc(b.id || '') + '">' + inner + '</' + tag + '>';
  }

  /* ───────────── ชนิดบล็อก ───────────── */
  const BLOCKS = {
    /** ย่อหน้าข้อความ */
    text: function (b, data, ctx) { return wrap('p', b, fill(b.text, data, ctx)); },
    /** บรรทัดซ้าย-ขวา (เช่น เลขที่ … / วันที่ …) */
    row: function (b, data, ctx) {
      return wrap('div', b, '<span class="pk-l">' + fill(b.left, data, ctx) + '</span><span class="pk-r">' + fill(b.right, data, ctx) + '</span>', 'pk-row');
    },
    /** หัวเอกสาร: ตราศาล | ชื่อเอกสาร + บรรทัดรอง | QR (slot) */
    head: function (b, data, ctx) {
      const seal = b.seal ? '<img src="' + esc(ctx.asset('court-seal.webp')) + '" alt="ตราศาล">' : '';
      const qr = b.qr && ctx.slots.qr ? ctx.slots.qr(data, b, ctx) || '' : '';
      return '<div class="pk-head pk-b" style="' + styleOf(b.style) + '" data-bid="' + esc(b.id || '') + '">' +
        '<div class="pk-seal">' + seal + '</div>' +
        '<div class="pk-title"><div class="' + cls(b.titleStyle) + '" style="' + styleOf(b.titleStyle) + '">' + fill(b.title, data, ctx) + '</div>' +
        (b.subtitle ? '<div class="' + cls(b.subtitleStyle) + '" style="' + styleOf(b.subtitleStyle) + '">' + fill(b.subtitle, data, ctx) + '</div>' : '') + '</div>' +
        '<div class="pk-qr">' + qr + '</div></div>';
    },
    /** ตราครุฑ (หนังสือภายนอก 3 ซม. / บันทึกข้อความ 1.5 ซม.) */
    garuda: function (b, data, ctx) {
      return '<div class="pk-b" style="' + styleOf(b.style) + '" data-bid="' + esc(b.id || '') + '"><img class="pk-garuda" style="height:' + (Number(b.height) || 3) + 'cm" src="' + esc(ctx.asset(b.file || 'garuda.png')) + '" alt="ตราครุฑ"></div>';
    },
    /** ตาราง: แถวมาจาก data[source] (อาร์เรย์ของอ็อบเจกต์คีย์ไทย) */
    table: function (b, data, ctx) {
      const cols = b.columns || [];
      const rows = (data[b.source] || []).map(function (r, i) {
        return '<tr>' + cols.map(function (c) {
          const v = c.key === '#' ? String(i + 1) : (r[c.key] === null || r[c.key] === undefined ? '' : r[c.key]);
          return '<td class="' + (c.align || '') + '">' + esc(v) + '</td>';
        }).join('') + '</tr>';
      });
      while (rows.length < (b.minRows || 0)) rows.push('<tr>' + cols.map(function () { return '<td>&nbsp;</td>'; }).join('') + '</tr>');
      const hs = styleOf(b.headStyle);
      const head = '<thead><tr>' + cols.map(function (c) {
        const s = (c.width ? 'width:' + Number(c.width) + '%;' : '') + hs;
        return '<th' + (s ? ' style="' + s + '"' : '') + '>' + fill(c.label, data, ctx) + '</th>';
      }).join('') + '</tr></thead>';
      return '<table class="pk-table pk-b" style="' + styleOf(b.style) + '" data-bid="' + esc(b.id || '') + '">' +
        head + '<tbody>' + rows.join('') + '</tbody></table>';
    },
    /** ช่องลงนามหลายช่องเรียงกัน */
    sign: function (b, data, ctx) {
      const cols = b.cols || [];
      const sub = styleOf(b.subStyle);
      const inner = cols.map(function (c) {
        // เส้นลงชื่อยืดเต็มช่อง (จุดไข่ปลาไม่ล้นบรรทัดเมื่อช่องแคบ)
        return '<div><div class="pk-sigl"><span>' + fill(b.line || 'ลงชื่อ', data, ctx) + '</span><i></i></div>' + fill(c.role, data, ctx) + '<br>(' + fill(c.name, data, ctx) + ')' +
          (c.sub !== undefined ? '<small class="pk-fit" style="' + sub + '">' + fill(c.sub, data, ctx) + '&nbsp;</small>' : '') +
          (c.date !== undefined ? '<small style="' + sub + '">' + fill(c.date, data, ctx) + '</small>' : '') + '</div>';
      }).join('');
      return '<div class="pk-sign pk-b" style="grid-template-columns:repeat(' + Math.max(1, cols.length) + ',minmax(0,1fr));' + styleOf(b.style) + '" data-bid="' + esc(b.id || '') + '">' + inner + '</div>';
    },
    /** หลายบรรทัดเป็นกลุ่ม (เช่น ช่องผู้รับวัสดุ) */
    lines: function (b, data, ctx) {
      return '<div class="pk-b ' + (b.box ? 'pk-recv' : '') + '" style="' + styleOf(b.style) + '" data-bid="' + esc(b.id || '') + '">' +
        (b.lines || []).map(function (l) { return '<div>' + fill(l, data, ctx) + '</div>'; }).join('') + '</div>';
    },
    /** ส่วนที่ระบบสร้างเอง (เช่น ป้ายเตือนข้อมูลฝึก) */
    slot: function (b, data, ctx) { const f = ctx.slots[b.name]; return f ? (f(data, b, ctx) || '') : ''; },
    spacer: function (b) { return '<div style="height:' + (Number(b.height) || 12) + 'pt"></div>'; },
    pagebreak: function () { return '<div style="break-after:page;page-break-after:always"></div>'; }
    // ต่อยอด: เพิ่มชนิดบล็อกใหม่ที่นี่ แล้วเพิ่มในหน้าแก้แม่แบบ (PrintHub)
  };

  /**
   * สร้าง HTML ของเอกสาร 1 แผ่น
   * @param tpl   แม่แบบ JSON
   * @param data  ข้อมูล (คีย์ภาษาไทย ตรงกับ {{…}} ในแม่แบบ)
   * @param opts  { slots:{ชื่อ:fn}, assetBase:'.../assets/', markUnknown:bool, sample:bool }
   * @return { html, unknown:[คีย์ที่แม่แบบเรียกแต่ไม่มีในข้อมูล] }
   */
  function render(tpl, data, opts) {
    opts = opts || {}; data = data || {};
    const base = opts.assetBase || '';
    const ctx = {
      unknown: {}, markUnknown: !!opts.markUnknown, slots: opts.slots || {},
      asset: function (f) { return (opts.assets && opts.assets[f]) || base + f; }
    };
    const pg = tpl.page || {};
    const m = (pg.margins || [2.5, 2, 2, 3]).map(Number);
    let body = (tpl.blocks || []).map(function (b) {
      if (b.hidden) return '';
      if (b.if && !data[b.if]) return '';
      if (b.ifNot && data[b.ifNot]) return '';
      const f = BLOCKS[b.type];
      return f ? f(b, data, ctx) : '';
    }).join('');
    if (tpl.numerals === 'thai') body = thaiNumHtml(body);
    const stamp = pg.stamp ? fill(pg.stamp, data, ctx) : '';
    const df = tpl.font || {};
    const html = '<div class="pk-sheet' + (pg.orientation === 'landscape' ? ' pk-land' : '') + (opts.sample ? ' pk-sample' : '') + '" data-tpl="' + esc(tpl.id || '') + '" style="' +
      '--pk-mt:' + m[0] + 'cm;--pk-mr:' + m[1] + 'cm;--pk-mb:' + m[2] + 'cm;--pk-ml:' + m[3] + 'cm;' +
      (df.size ? 'font-size:' + Number(df.size) + 'pt;' : '') + (df.lineHeight ? 'line-height:' + Number(df.lineHeight) + ';' : '') + '">' +
      body + '<div class="pk-pagefoot"><span class="pk-stamp">' + (tpl.numerals === 'thai' ? thaiNumHtml(stamp) : stamp) + '</span><span class="pk-pgno"></span></div></div>';
    return { html: html, unknown: Object.keys(ctx.unknown), stampText: stamp.replace(/<[^>]+>/g, '') };
  }

  /* ───────────── จัดหน้าและสั่งพิมพ์ (ยกมาจากระบบวัสดุ 1.7.4) ───────────── */
  /** ย่อตัวอักษร .pk-fit ให้อยู่บรรทัดเดียว เล็กสุด 11 pt แล้วค่อยขึ้นบรรทัดใหม่ */
  function fitText(rootEl) {
    Array.prototype.forEach.call(rootEl.querySelectorAll('.pk-fit'), function (el) {
      el.style.whiteSpace = 'nowrap'; el.style.fontSize = '';
      let pt = parseFloat(getComputedStyle(el).fontSize) * 0.75;
      while (el.scrollWidth > el.clientWidth + 1 && pt > 11) { pt -= 0.5; el.style.fontSize = pt + 'pt'; }
      if (el.scrollWidth > el.clientWidth + 1) el.style.whiteSpace = 'normal';
    });
  }
  /** ประมาณจำนวนหน้า (ความสูงเนื้อหา ÷ ความสูงพื้นที่พิมพ์) */
  function pagesOf(sheet, page) {
    page = page || {};
    const m = (page.margins || [2.5, 2, 2, 3]).map(Number);
    const mm = 96 / 25.4;
    const pageH = (page.orientation === 'landscape' ? 210 : 297) * mm - (m[0] + m[2]) * 10 * mm;
    let bottom = 0;
    Array.prototype.forEach.call(sheet.children, function (c) {
      if (c.classList.contains('pk-pagefoot')) return;
      bottom = Math.max(bottom, c.offsetTop + c.offsetHeight);
    });
    const top = parseFloat(getComputedStyle(sheet).paddingTop) || 0;
    return Math.max(1, Math.ceil((bottom - top - 2) / pageH));
  }
  /** ย่อแผ่นให้พอดีความกว้างกล่องตัวอย่าง (มือถือ) */
  function scaleToFit(box) {
    const sheets = box.querySelectorAll('.pk-sheet'); if (!sheets.length) return;
    sheets.forEach(function (sh) { sh.style.transform = ''; sh.style.marginBottom = ''; });
    const s = Math.min(1, (box.clientWidth - 24) / sheets[0].offsetWidth);
    let h = 0;
    sheets.forEach(function (sh) {
      sh.style.transformOrigin = 'top left';
      sh.style.transform = s < 1 ? 'scale(' + s + ')' : '';
      sh.style.marginBottom = s < 1 ? (-(sh.offsetHeight * (1 - s)) + 16) + 'px' : '16px';
      h += sh.offsetHeight * s + 16;
    });
    box.style.height = s < 1 ? (h + 24) + 'px' : '';
  }
  /**
   * สั่งพิมพ์: ตั้ง @page ตามแม่แบบ · ข้อความซ้ายล่างทุกหน้า · เลขหน้าเมื่อเกิน 1 หน้า
   * (เลขหน้า/ข้อความขอบกระดาษแสดงใน Chrome — แนะนำพิมพ์จาก Chrome)
   */
  function print(sheetsHtml, page, opts) {
    page = page || {}; opts = opts || {};
    let rootEl = document.getElementById('pk-print-root');
    if (!rootEl) { rootEl = document.createElement('div'); rootEl.id = 'pk-print-root'; document.body.appendChild(rootEl); }
    rootEl.innerHTML = sheetsHtml;
    Array.prototype.forEach.call(rootEl.querySelectorAll('.pk-sheet'), function (sh) { sh.style.transform = ''; sh.style.marginBottom = ''; });
    let st = document.getElementById('pk-page-style');
    if (!st) { st = document.createElement('style'); st.id = 'pk-page-style'; document.head.appendChild(st); }
    const m = (page.margins || [2.5, 2, 2, 3]).map(function (x) { return Number(x) + 'cm'; }).join(' ');
    const font = 'font-family:"PK Sarabun","TH Sarabun New",serif;font-size:13pt;color:#333;vertical-align:top;padding-top:4mm;';
    const q = function (t) { return '"' + String(t).replace(/["\\]/g, '') + '"'; };
    st.textContent =
      '@media print{body>*:not(#pk-print-root){display:none!important}#pk-print-root{display:block!important}}' +
      '@media screen{#pk-print-root{display:none}}' +
      '@page{size:A4 ' + (page.orientation === 'landscape' ? 'landscape' : 'portrait') + ';margin:' + m + ';' +
      (opts.pages > 1 && page.pageNumbers !== false ? '@bottom-right{content:"หน้า " counter(page) "/" counter(pages);' + font + '}' : '') +
      (opts.stamp ? '@bottom-left{content:' + q(opts.stamp) + ';' + font + '}' : '') + '}';
    const imgs = Array.prototype.slice.call(rootEl.querySelectorAll('img'));
    const ready = [document.fonts && document.fonts.ready ? document.fonts.ready : null]
      .concat(imgs.map(function (im) { return im.decode ? im.decode().catch(function () {}) : null; }));
    return Promise.all(ready).then(function () { return new Promise(function (r) { setTimeout(function () { window.print(); r(); }, 60); }); });
  }

  root.PrintKit = {
    VERSION: VERSION, render: render, print: print, pagesOf: pagesOf, fitText: fitText, scaleToFit: scaleToFit,
    esc: esc, thaiNum: thaiNum, arabicNum: arabicNum, thDate: thDate, thDateS: thDateS, thDateParts: thDateParts, thDateTime: thDateTime, idCard: idCard,
    STYLE_KEYS: STYLE_KEYS, BLOCKS: BLOCKS, FILTERS: FILTERS
  };
})(typeof window !== 'undefined' ? window : this);
