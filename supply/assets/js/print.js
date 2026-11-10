/* ระบบบริหารวัสดุสำนักงาน · print.js — ใบเบิกวัสดุ A4 แนวตั้ง (TH Sarabun New 16 pt) ดูตัวอย่างก่อนพิมพ์ทุกครั้ง
 * ชื่อผู้ขอเบิก ตำแหน่ง ส่วนงาน หัวหน้าส่วน = snapshot ณ วันที่ยื่น · ชื่อเจ้าหน้าที่พัสดุ = ตอนส่งมอบ · ไม่แสดงราคา */
'use strict';
const PrintDoc = (function () {
  const dots = '..................................';
  /** ข้อความท้ายกระดาษซ้ายล่าง (ใบเบิก) */
  function stamp() { return 'พิมพ์จาก' + U.APP_NAME + ' ' + U.thDateTime(new Date()); }
  /** ระยะขอบตามระเบียบงานสารบรรณ (ซม.): บน ขวา ล่าง ซ้าย — ซ้าย 3 ขวา 2 */
  const OFFICIAL = [2.5, 2, 2, 3];
  /** ตำแหน่ง/ส่วนงานที่ยาว: ลดขนาดตัวอักษรให้อยู่บรรทัดเดียว ถ้าเล็กสุดแล้วยังไม่พอ ให้ขึ้นบรรทัดที่ 2 */
  function fitText(root) {
    Array.prototype.forEach.call(root.querySelectorAll('.fit'), function (el) {
      el.style.whiteSpace = 'nowrap'; el.style.fontSize = '';
      let pt = parseFloat(getComputedStyle(el).fontSize) * 0.75;
      while (el.scrollWidth > el.clientWidth + 1 && pt > 11) { pt -= 0.5; el.style.fontSize = pt + 'pt'; }
      if (el.scrollWidth > el.clientWidth + 1) el.style.whiteSpace = 'normal';
    });
  }
  /** ประมาณจำนวนหน้าของแผ่นในหน้าตัวอย่าง (ความสูงเนื้อหา ÷ ความสูงพื้นที่พิมพ์) */
  function pagesOf(sheet, marginsCm, landscape) {
    const mm = 96 / 25.4;
    const pageH = (landscape ? 210 : 297) * mm - (marginsCm[0] + marginsCm[2]) * 10 * mm;
    let bottom = 0;
    Array.prototype.forEach.call(sheet.children, function (c) {
      if (c.classList.contains('pagefoot')) return;
      bottom = Math.max(bottom, c.offsetTop + c.offsetHeight);
    });
    const top = parseFloat(getComputedStyle(sheet).paddingTop) || 0;
    return Math.max(1, Math.ceil((bottom - top - 2) / pageH));
  }
  function d(v) { return v ? U.thDate(v) : '...../...../.....'; }

  /* ── print-kit (ฐานกลางแม่แบบเอกสารที่ปริ้นฮับ) · 1.8.0 ──
   * ใช้แม่แบบจากปริ้นฮับเมื่อมีฉบับที่เผยแพร่แล้วเท่านั้น
   * ไม่มี / อ่านไม่ได้ / backend ยังไม่มีคำสั่ง printTemplates → ใช้แบบเดิมด้านล่าง (ไม่พัง) */
  let PKT = null;
  async function loadTemplates() {
    if (PKT) return PKT;
    try { const r = await API.call('printTemplates'); PKT = (r && r.templates) || {}; }
    catch (e) { PKT = {}; }
    return PKT;
  }
  function pkTpl(id) { return window.PrintKit && PKT && PKT[id] && PKT[id].tpl ? PKT[id].tpl : null; }
  /** ระยะขอบใบเบิก: ตามแม่แบบที่เผยแพร่ (ถ้ามี) ไม่งั้นตามระเบียบ */
  function slipMargins() { const t = pkTpl('supply.req'); return t && t.page && t.page.margins ? t.page.margins.map(Number) : OFFICIAL; }
  function pkReq(r, qr, tpl) {
    const data = PrintKitSupply.reqData(r, App.S.cfg, U.APP_NAME);
    data['ป้ายเตือน'] = API.scope() ? 'ข้อมูลตัวอย่างสำหรับฝึกใช้งาน — ห้ามใช้เป็นเอกสารเบิกจ่ายจริง'
      : (App.S.me && App.S.me.realTrial && App.S.me.realTrial.active ? 'รอบทดสอบบนฐานข้อมูลจริง' : '');
    const out = PrintKit.render(tpl, data, {
      assetBase: 'assets/img/',
      slots: {
        flags: function (x) { return x['ป้ายเตือน'] ? '<div class="pk-flag">' + U.esc(x['ป้ายเตือน']) + '</div>' : ''; },
        qr: function () { return qr ? qr + '<small>สแกนเปิดใบนี้</small>' : ''; }
      }
    });
    // ให้หน้าพิมพ์เดิมของระบบรู้จักแผ่น (.sheet) ช่องย่อตัวอักษร (.fit) และเลขหน้า (.pgno)
    return out.html.replace('class="pk-sheet', 'class="sheet pk-sheet').replace('class="pk-pagefoot"', 'class="pk-pagefoot pagefoot"')
      .replace('class="pk-pgno"', 'class="pk-pgno pgno"').replace(/class="pk-fit"/g, 'class="pk-fit fit"');
  }

  /** qr = SVG จาก U.qrSvg(U.reqLink(req_id)) — ว่างได้ */
  function reqSheet(r, qr) {
    const tpl = pkTpl('supply.req');
    if (tpl) { try { return pkReq(r, qr, tpl); } catch (e) { /* แม่แบบมีปัญหา → ใช้แบบเดิม */ } }
    const rows = r.items.map(function (i, n) {
      return '<tr><td class="c">' + (n + 1) + '</td><td>' + U.esc(i.name) + '</td><td class="c">' + U.esc(i.unit_name) + '</td><td class="c">' + U.n(i.qty_approved !== null ? i.qty_approved : i.qty_req) + '</td>' +
        '<td class="c">' + (i.qty_issued !== null ? U.n(i.qty_issued - (i.qty_returned || 0)) : '') + '</td><td>' + (i.qty_returned ? 'จ่าย ' + U.n(i.qty_issued) + ' คืน/แก้ ' + U.n(i.qty_returned) : '') + '</td></tr>';
    });
    while (rows.length < 8) rows.push('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>');
    return '<div class="sheet req">' +
      (API.scope() ? '<div style="border:2px solid #a66b00;text-align:center;font-weight:bold;padding:6px">ข้อมูลตัวอย่างสำหรับฝึกใช้งาน — ห้ามใช้เป็นเอกสารเบิกจ่ายจริง</div>' : '') +
      (!API.scope() && App.S.me && App.S.me.realTrial && App.S.me.realTrial.active ? '<div style="border:2px solid #bf6230;text-align:center;font-weight:bold;padding:6px">รอบทดสอบบนฐานข้อมูลจริง</div>' : '') +
      '<div class="head"><div class="seal"><img src="assets/img/court-seal.webp" alt="ตราศาลจังหวัดลพบุรี"></div><div><h1>ใบเบิกวัสดุ</h1><p class="org">' + U.esc(r.org_name || App.S.cfg.org_name || 'ศาลจังหวัดลพบุรี') + '</p></div>' +
      '<div class="qr">' + (qr ? qr + '<small>สแกนเปิดใบนี้</small>' : '') + '</div></div>' +
      '<div class="meta"><span>ใบเบิกวัสดุ <b>' + U.esc(r.dept_name || '-') + '</b></span><span>เลขที่ <b>' + U.esc(r.req_no) + '</b></span></div>' +
      '<div class="meta"><span></span><span>วันที่ ' + U.thDate(r.created_at) + '</span></div>' +
      '<p class="indent">ข้าพเจ้า ' + U.esc(r.requester_name) + ' ตำแหน่ง ' + U.esc(r.requester_position || '-') + ' ' +
      'มีความประสงค์ขอเบิกวัสดุตามรายการต่อไปนี้ เพื่อ' + U.esc(r.purpose || 'ใช้ในราชการ') + '</p>' +
      '<table><thead><tr><th style="width:9%">ลำดับ</th><th>รายการ</th><th style="width:13%">หน่วยนับ</th><th style="width:13%">จำนวนที่<br>เบิก</th><th style="width:13%">จำนวนที่<br>จ่าย</th><th style="width:15%">หมายเหตุ</th></tr></thead>' +
      '<tbody>' + rows.join('') + '</tbody></table>' +
      '<div class="sign">' +
      '<div>ลงชื่อ' + dots + '<br>ผู้ขอเบิก<br>(' + U.esc(r.requester_name) + ')<small class="fit">' + U.esc(r.requester_position || '') + '</small><small>วันที่ ' + d(r.created_at) + '</small></div>' +
      '<div>ลงชื่อ' + dots + '<br>หัวหน้าส่วน<br>(' + (r.head_name ? U.esc(r.head_name) : dots) + ')<small class="fit">' + U.esc(r.dept_name || '') + '</small><small>วันที่ ' + d(r.approved_at) + '</small></div>' +
      '<div>ลงชื่อ' + dots + '<br>เจ้าหน้าที่พัสดุ<br>(' + (r.issuer_name ? U.esc(r.issuer_name) : dots) + ')<small>&nbsp;</small><small>วันที่ ' + d(r.issued_at) + '</small></div></div>' +
      '<div class="recv"><div>ได้รับวัสดุตามรายการข้างต้นถูกต้องครบถ้วนแล้ว</div><div>ลงชื่อ' + dots + 'ผู้รับวัสดุ</div>' +
      '<div>(' + (r.receiver_name ? U.esc(r.receiver_name) : dots) + ')</div><div>วันที่ ' + d(r.issued_at) + '</div></div>' +
      (r.edit_count ? '<p style="font-size:14pt">หมายเหตุ: แก้ไขจำนวนที่จ่าย ' + r.edit_count + ' ครั้ง ล่าสุด ' + U.thDateTime(r.edited_at) + ' โดย ' + U.esc(r.edited_name) + ' เหตุผล ' + U.esc(r.edit_reason) + '</p>' : '') +
      '<div class="foot pagefoot"><span>' + U.esc(stamp()) + '</span><span class="pgno"></span></div></div>';
  }
  /** ใบจัดเตรียมวัสดุรวม: รวมรายการจากหลายใบ เรียงตามหมวด → รหัส · มีช่องติ๊กและจำนวนแยกตามใบ */
  function pickSheet(reqs) {
    const S = App.S;
    const lim = function (i) { return i.qty_approved !== null && i.qty_approved !== undefined ? i.qty_approved : i.qty_req; };
    const groups = {};
    reqs.forEach(function (r) {
      r.items.forEach(function (i) {
        const q = r.status === 'READY' && i.qty_ready !== null ? i.qty_ready : lim(i);
        if (!(q > 0)) return;
        const m = (S.idx && S.idx[i.mat_id]) || {};
        const cat = (S.cats && S.cats[m.cat_id] || {}).name || 'อื่น ๆ';
        const key = i.mat_id + '|' + i.unit_name;
        const g = groups[cat] = groups[cat] || {};
        const x = g[key] = g[key] || { code: m.code || '', name: i.name, unit: i.unit_name, total: 0, balance: i.balance, per: [] };
        x.total += q;
        x.per.push('<span class="nw">' + U.esc(r.req_no) + ' ×' + U.n(q) + '</span>');
      });
    });
    const cats = Object.keys(groups).sort(function (a, b) { return a === 'อื่น ๆ' ? 1 : b === 'อื่น ๆ' ? -1 : a.localeCompare(b, 'th'); });
    let n = 0;
    const body = cats.map(function (c) {
      const rows = Object.keys(groups[c]).map(function (k) { return groups[c][k]; })
        .sort(function (a, b) { return String(a.code).localeCompare(String(b.code), 'th', { numeric: true }) || a.name.localeCompare(b.name, 'th'); });
      return '<tr class="grp"><td colspan="7"><b>' + U.esc(c) + '</b> (' + rows.length + ' รายการ)</td></tr>' + rows.map(function (x) {
        n++;
        const short = typeof x.balance === 'number' && x.balance < x.total;
        return '<tr><td class="c">☐</td><td class="c">' + n + '</td><td class="nw">' + U.esc(x.code) + '</td><td>' + U.esc(x.name) + '</td><td class="c">' + U.esc(x.unit) + '</td>' +
          '<td class="r"><b>' + U.n(x.total) + '</b>' + (short ? '<br><small class="nw">เหลือ ' + U.n(x.balance) + '</small>' : '') + '</td><td class="small">' + x.per.join(' · ') + '</td></tr>';
      }).join('');
    }).join('');
    const list = reqs.map(function (r) {
      return '<tr><td>' + U.esc(r.req_no) + '</td><td>' + U.esc(r.requester_name) + '</td><td>' + U.esc(r.dept_name || '') + '</td><td class="c">' + r.items.length + '</td><td>' + U.thDateTime(r.created_at) + '</td></tr>';
    }).join('');
    return '<div class="sheet pick" style="--m:' + (S.cfg.print_margin_cm || 2) + 'cm">' +
      (API.scope() ? '<div style="border:2px solid #a66b00;text-align:center;font-weight:bold;padding:6px">ข้อมูลตัวอย่างสำหรับฝึกใช้งาน</div>' : '') +
      '<h1>ใบจัดเตรียมวัสดุ (รวม ' + reqs.length + ' ใบ)</h1><p class="org">' + U.esc(S.cfg.org_name || 'ศาลจังหวัดลพบุรี') + '</p>' +
      '<div class="meta"><span>พิมพ์เมื่อ ' + U.thDateTime(new Date()) + '</span><span>ผู้พิมพ์ ' + U.esc(S.user.name) + '</span></div>' +
      '<table><thead><tr><th style="width:5%">✓</th><th style="width:5%">ที่</th><th style="width:13%">รหัส</th><th>รายการ</th><th style="width:9%">หน่วย</th><th style="width:9%">รวม</th><th style="width:27%">แยกตามใบเบิก</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="7" class="c">ไม่มีรายการ</td></tr>') + '</tbody></table>' +
      '<p><b>ใบเบิกที่รวมในใบนี้</b></p><table class="list"><thead><tr><th>เลขที่</th><th>ผู้ขอเบิก</th><th>ส่วนงาน</th><th style="width:10%">รายการ</th><th>ยื่นเมื่อ</th></tr></thead><tbody>' + list + '</tbody></table>' +
      '<div class="sign one"><div>ลงชื่อ' + dots + 'ผู้จัดเตรียม<br>(' + U.esc(S.user.name) + ') วันที่ ...../...../.....</div></div>' +
      '<div class="foot"><span>ใบจัดเตรียมใช้ภายในงานพัสดุ — ไม่ใช่หลักฐานการจ่าย</span><span>' + U.esc(U.APP_NAME) + '</span></div></div>';
  }
  /** opts: { margins:[บน,ขวา,ล่าง,ซ้าย] ซม., pages: จำนวนหน้า (>1 จึงพิมพ์เลขหน้า), stamp: ข้อความซ้ายล่างทุกหน้า } */
  function print(sheetHtml, marginCm, landscape, opts) {
    opts = opts || {};
    const root = U.$('#print-root');
    root.innerHTML = sheetHtml;
    let st = U.$('#page-style');
    if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); }
    const m = opts.margins ? opts.margins.map(function (x) { return x + 'cm'; }).join(' ') : (marginCm || 2) + 'cm';
    const font = 'font-family: "PrintTHSN", "PrintSarabun", serif; font-size: 13pt; color: #333; vertical-align: top; padding-top: 4mm;';
    const q = function (t) { return '"' + String(t).replace(/["\\]/g, '') + '"'; };
    st.textContent = '@page { size: A4 ' + (landscape ? 'landscape' : 'portrait') + '; margin: ' + m + ';' +
      (opts.pages > 1 ? ' @bottom-right { content: "หน้า " counter(page) "/" counter(pages); ' + font + ' }' : '') +
      (opts.stamp ? ' @bottom-left { content: ' + q(opts.stamp) + '; ' + font + ' }' : '') + ' }';
    // รอภาพ (ตราศาล) ถอดรหัสเสร็จก่อนสั่งพิมพ์ (1.7.4)
    const imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
    Promise.all(imgs.map(function (im) { return im.decode ? im.decode().catch(function () {}) : null; }))
      .then(function () { setTimeout(function () { window.print(); }, 50); });
  }
  return { reqSheet: reqSheet, pickSheet: pickSheet, print: print, pagesOf: pagesOf, fitText: fitText, OFFICIAL: OFFICIAL, stamp: stamp,
           loadTemplates: loadTemplates, slipMargins: slipMargins };
})();

App.view('print', {
  title: 'พิมพ์ใบเบิก',
  render: async function (el, params) {
    el.innerHTML = '<div class="page-h row noprint"><div><h1>ใบเบิกวัสดุ</h1><p>ตรวจตัวอย่างก่อนพิมพ์ · บันทึกเป็น PDF ได้จากหน้าต่างพิมพ์</p></div><span class="spacer"></span>' +
      '<button class="btn" onclick="history.back()">กลับ</button><button class="btn primary lg" id="pr">' + ICON('print') + 'พิมพ์ / บันทึก PDF</button></div><div class="print-preview" id="pv"><div class="skel"></div></div>';
    let html = '', margin = App.S.cfg.print_margin_cm || 2, landscape = false, slip = false;
    if (params[0] === 'monthly') {
      const M = App.S.forms.monthlyPrint;
      if (!M || !M.rep) { location.replace('#/monthly'); return; }
      U.$('.page-h h1').textContent = 'รายงานวัสดุคงเหลือ ' + M.rep.label;
      html = Monthly.sheetHtml(M.rep, M.showVal, M.info || {});
      margin = 1.5; landscape = !!M.showVal;
    } else if (params[0] === 'batch') {
      const B = App.S.forms.batchPrint;
      if (!B || !B.rows || !B.rows.length) {
        el.innerHTML = '<h1>พิมพ์ใบเตรียมของ</h1><div class="notice warn"><div><b>ยังไม่ได้เลือกใบเบิก</b>เลือกจากหน้า คิวจ่ายวัสดุ แล้วกด "พิมพ์ใบเตรียมของ"</div></div><a class="btn" href="#/queue">ไปคิวจ่ายวัสดุ</a>';
        return;
      }
      U.$('.page-h h1').textContent = B.mode === 'pick' ? 'ใบจัดเตรียมวัสดุ (รวม)' : 'ใบเบิก ' + B.rows.length + ' ใบ';
      if (B.mode === 'pick') html = PrintDoc.pickSheet(B.rows);
      else {
        await PrintDoc.loadTemplates();
        const qrs = await Promise.all(B.rows.map(function (r) { return U.qrSvg(U.reqLink(r.req_id)); }));
        html = B.rows.map(function (r, i) { return PrintDoc.reqSheet(r, qrs[i]); }).join('');
        slip = true;
      }
    } else {
      const both = await Promise.all([API.call('getRequest', { req_id: params[0] }), PrintDoc.loadTemplates()]);
      const r = both[0];
      html = PrintDoc.reqSheet(r, await U.qrSvg(U.reqLink(r.req_id)));
      slip = true;
    }
    const pv = U.$('#pv');
    pv.innerHTML = html;
    const fit = function () {
      const sheets = U.$$('.sheet', pv); if (!sheets.length) return;
      const w = pv.clientWidth - 44, full = sheets[0].offsetWidth;
      const s = Math.min(1, w / full);
      let h = 0;
      sheets.forEach(function (sh) {
        sh.style.transform = s < 1 ? 'scale(' + s + ')' : '';
        sh.style.transformOrigin = 'top left';
        sh.style.marginBottom = s < 1 ? (-(sh.offsetHeight * (1 - s)) + 16) + 'px' : '';
        h += sh.offsetHeight * s + 16;
      });
      pv.style.height = s < 1 ? (h + 28) + 'px' : '';
    };
    fit();
    window.addEventListener('resize', fit);
    // ใบเบิก: ขอบตามระเบียบงานสารบรรณ · ข้อความซ้ายล่างทุกหน้า · เลขหน้าเมื่อมีมากกว่า 1 หน้า (พิมพ์ใบเดียว)
    const sheets = U.$$('.sheet', pv);
    const margins = slip ? PrintDoc.slipMargins() : [margin, margin, margin, margin];
    // นับหน้าหลังโหลดฟอนต์เสร็จ (ฟอนต์สำรองกว้างกว่า ทำให้นับเกิน)
    const count = function () {
      PrintDoc.fitText(pv);
      const n = sheets.length === 1 ? PrintDoc.pagesOf(sheets[0], margins, landscape) : 1;
      const pg = sheets.length === 1 ? U.$('.pgno', sheets[0]) : null;
      if (pg) pg.textContent = n > 1 ? 'ทั้งหมด ' + n + ' หน้า' : '';
      return n;
    };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(count); else count();
    U.$('#pr').onclick = function () {
      const n = count();
      // พิมพ์จากหน้าตัวอย่างที่ปรับขนาดตัวอักษรแล้ว (ตัดการย่อขนาดหน้าจอออก)
      const clone = pv.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('.sheet'), function (sh) { sh.style.transform = ''; sh.style.marginBottom = ''; });
      PrintDoc.print(clone.innerHTML, margin, landscape, { margins: margins, pages: n, stamp: slip ? PrintDoc.stamp() : '' });
    };
  }
});


