/* ระบบบริหารวัสดุสำนักงาน · receive-import.js — นำเข้ารายการรับเข้าจากไฟล์ (Excel/CSV) หรือวางจาก Excel
 *  1 ไฟล์ = 1 ใบรับเข้า (ผู้จำหน่าย วันที่ เลขใบส่งของ กรอกที่หัวฟอร์ม)
 *  จับคู่ 4 ชั้น: รหัสตรง → ชื่อตรง/ชื่อที่เคยจำ (คำค้น) → ชื่อใกล้เคียง (ต้องยืนยัน) → ไม่พบ (เลือกเอง/สร้างใหม่/ข้าม)
 *  ตรวจแล้วเติมลงตารางรับเข้าเดิม — ยังไม่บันทึกจนกว่าเจ้าหน้าที่กด "บันทึกรับเข้า"
 *  ชื่อที่ยืนยันแล้วและติ๊ก "จำชื่อนี้" เก็บต่อท้ายคำค้นของวัสดุ ครั้งหน้าจับคู่ได้เอง */
'use strict';
const RcvImport = (function () {
  const S = App.S;
  const MAX_LINES = 60;                       // ตรงกับข้อจำกัดของเซิร์ฟเวอร์ต่อ 1 ใบรับเข้า
  const NEAR = 0.45, HINT = 0.25;             // เกณฑ์ "ใกล้เคียง" และ "มีคำแนะนำ"
  const TPL_HEAD = ['รหัสวัสดุ', 'ชื่อวัสดุ', 'หน่วย', 'จำนวน', 'ราคาต่อหน่วย', 'ราคารวม'];

  /* ------------------------------------------------------------ ทำให้ข้อความเทียบกันได้ */
  const THD = '๐๑๒๓๔๕๖๗๘๙';
  function digits(s) { return String(s).replace(/[๐-๙]/g, function (c) { return String(THD.indexOf(c)); }); }
  function clean(s) { return digits(String(s === undefined || s === null ? '' : s)).normalize('NFC').replace(/[​-‍﻿]/g, '').trim(); }
  /** คีย์เทียบชื่อ: ตัดช่องว่าง เครื่องหมาย ตัวพิมพ์ใหญ่เล็ก ×/x */
  function nk(s) { return clean(s).toLowerCase().replace(/×/g, 'x').replace(/[\s.,\-_/\\()[\]{}"'“”‘’*#:;+!?|]+/g, ''); }
  function num(v) {
    if (typeof v === 'number') return v;
    const t = clean(v).replace(/[,\s฿]|บาท/g, '');
    return t === '' ? NaN : Number(t);
  }
  function aliasesOf(m) { return String(m.keywords || '').split(/[,;|\n]/).map(function (s) { return s.trim(); }).filter(function (s) { return nk(s).length >= 2; }); }

  /* ------------------------------------------------------------ ดัชนีวัสดุ + ความใกล้เคียง */
  function bigrams(k) { const out = {}; for (let i = 0; i < k.length - 1; i++) { const g = k.substr(i, 2); out[g] = (out[g] || 0) + 1; } return out; }
  function dice(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const A = bigrams(a), B = bigrams(b);
    let inter = 0, na = 0, nb = 0;
    Object.keys(A).forEach(function (g) { na += A[g]; if (B[g]) inter += Math.min(A[g], B[g]); });
    Object.keys(B).forEach(function (g) { nb += B[g]; });
    let s = 2 * inter / (na + nb);
    const sh = a.length < b.length ? a : b, lo = a.length < b.length ? b : a;
    if (sh.length >= 4 && lo.indexOf(sh) >= 0) s = Math.max(s, 0.6 + 0.4 * sh.length / lo.length);   // ชื่อสั้นอยู่ในชื่อยาว
    return s;
  }
  function buildIndex() {
    const mats = S.catalog.materials.filter(function (m) { return m.active !== false; });
    const byCode = {}, byKey = {};
    const keys = mats.map(function (m) {
      const ks = [nk(m.name), nk(m.name + ' ' + (m.spec || ''))].concat(aliasesOf(m).map(nk)).filter(Boolean);
      byCode[String(m.code || '').trim().toUpperCase()] = m;
      ks.forEach(function (k, i) { if (!byKey[k]) byKey[k] = { m: m, how: i < 2 ? 'name' : 'alias' }; });
      return { m: m, ks: ks };
    });
    return { byCode: byCode, byKey: byKey, keys: keys };
  }
  function candidates(ix, name) {
    const k = nk(name);
    if (!k) return [];
    return ix.keys.map(function (x) { return { mat_id: x.m.mat_id, score: Math.max.apply(null, x.ks.map(function (y) { return dice(k, y); })) }; })
      .filter(function (c) { return c.score >= HINT; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 3);
  }

  /* ------------------------------------------------------------ อ่านไฟล์ / ข้อความวาง */
  async function readBook(file) {
    await U.loadScript('assets/vendor/xlsx.full.min.js');
    const buf = await file.arrayBuffer();
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return XLSX.read(buf);
    const u8 = new Uint8Array(buf);
    let text;
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) text = new TextDecoder('utf-8').decode(u8.subarray(3));
    else if (u8[0] === 0xFF && u8[1] === 0xFE) text = new TextDecoder('utf-16le').decode(u8.subarray(2));
    else if (u8[0] === 0xFE && u8[1] === 0xFF) text = new TextDecoder('utf-16be').decode(u8.subarray(2));
    else { try { text = new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { text = new TextDecoder('windows-874').decode(u8); } }
    return XLSX.read(text, { type: 'string', raw: true });
  }
  /** หาแถวหัวตารางและคอลัมน์ (รองรับหัวคอลัมน์จากใบส่งของทั่วไป) */
  function columns(head) {
    const h = head.map(function (x) { return nk(x); });
    const col = { code: -1, name: -1, unit: -1, qty: -1, price: -1, total: -1 };
    const take = function (key, re, not) { if (col[key] >= 0) return; const i = h.findIndex(function (x, j) { return x && re.test(x) && !(not && not.test(x)) && Object.keys(col).every(function (k) { return col[k] !== j; }); }); if (i >= 0) col[key] = i; };
    take('total', /ราคารวม|จำนวนเงิน|มูลค่า|^รวมเงิน|^amount|^total/);
    take('price', /ราคา|หน่วยละ|price/);
    take('qty', /^จำนวน|^qty|quantity/);
    take('unit', /หน่วย|^unit/, /ราคา/);
    take('code', /^รหัส|^code/);
    take('name', /ชื่อ|รายการ|รายละเอียด|^item|description/);
    return col;
  }
  function rowsFromAoa(aoa) {
    aoa = aoa.map(function (r) { return (r || []).map(function (c) { return c === undefined || c === null ? '' : c; }); })
      .filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    if (!aoa.length) throw new Error('ไม่พบข้อมูลในไฟล์');
    let hi = -1, col = null;
    for (let i = 0; i < Math.min(10, aoa.length); i++) {
      const c = columns(aoa[i]);
      if (c.name >= 0 && c.qty >= 0) { hi = i; col = c; break; }
    }
    if (hi < 0) {   // ไม่มีหัวตาราง → ถือว่าเรียงตามไฟล์ตัวอย่าง
      col = aoa[0].length >= 5 ? { code: 0, name: 1, unit: 2, qty: 3, price: 4, total: 5 } : { code: -1, name: 0, unit: 1, qty: 2, price: 3, total: -1 };
    }
    const get = function (r, k) { return col[k] >= 0 ? r[col[k]] : ''; };
    const out = [], skipped = [];
    aoa.slice(hi + 1).forEach(function (r, i) {
      const line = hi + 2 + i;
      const o = { line: line, code: clean(get(r, 'code')), name: clean(get(r, 'name')), unit: clean(get(r, 'unit')),
                  qty: num(get(r, 'qty')), price: num(get(r, 'price')), total: num(get(r, 'total')) };
      if (!o.name && !o.code) return;
      if (!o.code && /^(รวม|ยอดรวม|รวมทั้งสิ้น|รวมเงิน|ภาษี|vat|ส่วนลด|หมายเหตุ)/i.test(o.name) && !(o.qty > 0)) { skipped.push(line); return; }
      out.push(o);
    });
    return { rows: out, skipped: skipped, header: hi >= 0 };
  }

  /* ------------------------------------------------------------ จับคู่แต่ละบรรทัด */
  function unitFor(m, text) {
    const t = clean(text);
    if (!t) return { unit_id: Officer.defaultUnit(m), flag: '' };
    const u = Officer.unitFromText(t);
    const ok = u && (u.unit_id === m.unit_id || (S.catalog.material_units || []).some(function (x) { return x.mat_id === m.mat_id && x.unit_id === u.unit_id; }));
    return ok ? { unit_id: u.unit_id, flag: '' } : { unit_id: Officer.defaultUnit(m), flag: 'หน่วย "' + t + '" ไม่ตรงกับหน่วยของวัสดุนี้ — ตรวจหน่วย' };
  }
  function setMat(r, m) {
    r.mat_id = m ? m.mat_id : '';
    r.unitFlag = ''; r.priceFlag = '';
    if (!m) return;
    const u = unitFor(m, r.raw.unit);
    r.unit_id = u.unit_id; r.unitFlag = u.flag;
    let p = r.raw.price;
    if (!(p >= 0) && r.raw.total >= 0 && r.raw.qty > 0) p = Math.round(r.raw.total / r.raw.qty * 10000) / 10000;
    if (!(p >= 0)) { p = m.last_cost ? Math.round(m.last_cost * Officer.factorOf(m, r.unit_id) * 100) / 100 : ''; r.priceFlag = m.last_cost ? 'ราคาครั้งก่อน — ตรวจราคา' : 'ไม่มีราคา — กรอกราคา'; }
    r.price = p;
  }
  function match(rows) {
    const ix = buildIndex();
    const seen = {};
    return rows.map(function (raw) {
      const r = { line: raw.line, raw: raw, status: 'none', how: '', mat_id: '', cand: [], confirmed: false, remember: false,
                  unit_id: '', qty: raw.qty > 0 ? raw.qty : '', price: '', notes: [] };
      let m = raw.code ? ix.byCode[raw.code.toUpperCase()] : null;
      if (m) { r.status = 'ok'; r.how = 'code'; if (raw.name && nk(raw.name) !== nk(m.name) && dice(nk(raw.name), nk(m.name)) < NEAR) r.notes.push('รหัสตรง แต่ชื่อในไฟล์ต่างจากชื่อวัสดุ'); }
      else {
        const hit = ix.byKey[nk(raw.name)];
        if (hit) { m = hit.m; r.status = 'ok'; r.how = hit.how; if (raw.code) r.notes.push('ไม่พบรหัส ' + raw.code + ' — จับคู่จากชื่อ'); }
      }
      if (!m) {
        r.cand = candidates(ix, raw.name);
        if (r.cand.length && r.cand[0].score >= NEAR) { r.status = 'near'; r.how = 'fuzzy'; m = S.idx[r.cand[0].mat_id]; r.remember = true; }
        else { r.status = 'none'; r.remember = true; }
        if (raw.code) r.notes.push('ไม่พบรหัส ' + raw.code);
      }
      setMat(r, m);
      if (!(raw.qty > 0)) r.notes.push('จำนวนไม่ถูกต้อง');
      if (m) { if (seen[m.mat_id]) r.notes.push('วัสดุซ้ำกับบรรทัด ' + seen[m.mat_id]); else seen[m.mat_id] = r.line; }
      return r;
    });
  }
  function ready(r) {
    if (r.status === 'skip') return true;
    return !!r.mat_id && (r.status === 'ok' || r.confirmed) && Number(r.qty) > 0 && r.price !== '' && Number(r.price) >= 0;
  }

  /* ------------------------------------------------------------ หน้าตรวจผลนำเข้า */
  let ctx = null;   // { F, root, onApply }
  function badge(r) {
    if (r.status === 'skip') return '<span class="badge gray nodot">ข้าม</span>';
    if (r.status === 'ok') return '<span class="badge ok">' + ({ code: 'รหัสตรง', name: 'ชื่อตรง', alias: 'ชื่อที่จำไว้' }[r.how] || 'ตรง') + '</span>';
    if (r.status === 'near') return r.confirmed ? '<span class="badge ok">ยืนยันแล้ว</span>' : '<span class="badge low">ใกล้เคียง · รอยืนยัน</span>';
    return r.mat_id && r.confirmed ? '<span class="badge ok">เลือกแล้ว</span>' : '<span class="badge out">ไม่พบ</span>';
  }
  function matSelect(r) {
    const opts = [];
    const add = function (id, label) { if (!opts.some(function (o) { return o[0] === id; })) opts.push([id, label]); };
    if (r.mat_id && S.idx[r.mat_id]) add(r.mat_id, S.idx[r.mat_id].code + ' · ' + S.idx[r.mat_id].name);
    r.cand.forEach(function (c) { const m = S.idx[c.mat_id]; if (m) add(c.mat_id, m.code + ' · ' + m.name + ' (ใกล้เคียง ' + Math.round(c.score * 100) + '%)'); });
    return '<select class="input" data-k="mat">' + (r.mat_id ? '' : '<option value="">— เลือกวัสดุ —</option>') +
      opts.map(function (o) { return '<option value="' + U.esc(o[0]) + '"' + (o[0] === r.mat_id ? ' selected' : '') + '>' + U.esc(o[1]) + '</option>'; }).join('') +
      '<option value="__find">ค้นหาวัสดุอื่น…</option><option value="__new">+ สร้างวัสดุใหม่</option><option value="__skip">ข้ามบรรทัดนี้</option></select>' +
      (r.finding ? '<input class="input" data-k="find" list="ri-ml" placeholder="พิมพ์ชื่อหรือรหัส แล้วเลือก" style="margin-top:6px">' : '');
  }
  function rowHtml(r, i) {
    const m = r.mat_id ? S.idx[r.mat_id] : null;
    const skip = r.status === 'skip';
    const learn = !skip && m && r.how !== 'code' && r.how !== 'name' && r.how !== 'alias' && nk(r.raw.name) && nk(r.raw.name) !== nk(m.name);
    return '<tr data-i="' + i + '" class="' + (ready(r) ? '' : 'ri-todo') + (skip ? ' ri-skip' : '') + '"><td class="num">' + r.line + '</td>' +
      '<td><b>' + U.esc(r.raw.name || '—') + '</b>' + (r.raw.code ? '<br><small class="muted">รหัส ' + U.esc(r.raw.code) + '</small>' : '') +
      (r.raw.unit ? '<br><small class="muted">หน่วย ' + U.esc(r.raw.unit) + '</small>' : '') + '</td>' +
      '<td>' + badge(r) + (r.status === 'near' && !r.confirmed ? ' <button type="button" class="btn sm" data-a="ok">ยืนยัน</button>' : '') +
      (skip ? ' <button type="button" class="btn sm ghost" data-a="unskip">นำกลับ</button>' : '<div style="margin-top:6px">' + matSelect(r) + '</div>') +
      (r.notes.length ? '<small class="ri-note">' + r.notes.map(U.esc).join(' · ') + '</small>' : '') + '</td>' +
      '<td>' + (m && !skip ? '<select class="input" data-k="unit_id">' + Officer.unitOptions(m, r.unit_id) + '</select>' + (r.unitFlag ? '<small class="ri-note">' + U.esc(r.unitFlag) + '</small>' : '') : '') + '</td>' +
      '<td class="num">' + (skip ? '' : '<input class="input num" type="number" min="0" step="any" data-k="qty" value="' + U.esc(r.qty) + '">') + '</td>' +
      '<td class="num">' + (skip ? '' : '<input class="input num" type="number" min="0" step="0.01" data-k="price" value="' + U.esc(r.price) + '">' + (r.priceFlag ? '<small class="ri-note">' + U.esc(r.priceFlag) + '</small>' : '')) + '</td>' +
      '<td>' + (learn ? '<label class="check small"><input type="checkbox" data-k="remember"' + (r.remember ? ' checked' : '') + '> จำชื่อนี้</label>' : '') + '</td></tr>';
  }
  function draw() {
    const I = ctx.F.imp;
    if (!I) { ctx.root.innerHTML = ''; return; }
    const n = { ok: 0, near: 0, none: 0, skip: 0 };
    I.rows.forEach(function (r) { n[r.status === 'near' && r.confirmed ? 'ok' : (r.status === 'none' && r.mat_id && r.confirmed ? 'ok' : r.status)]++; });
    const todo = I.rows.filter(function (r) { return !ready(r); }).length;
    const use = I.rows.filter(function (r) { return r.status !== 'skip'; }).length;
    const over = ctx.F.lines.length + use > MAX_LINES;
    ctx.root.innerHTML = '<div class="card ri"><div class="row"><div><h3 style="margin:0">ตรวจผลนำเข้า · ' + U.esc(I.source) + '</h3>' +
      '<span class="small muted">' + I.rows.length + ' บรรทัด · ตรง ' + n.ok + ' · รอยืนยัน ' + n.near + ' · ไม่พบ ' + n.none + ' · ข้าม ' + n.skip +
      (I.skipped.length ? ' · ข้ามแถวสรุปยอดในไฟล์ (บรรทัด ' + I.skipped.join(', ') + ')' : '') + '</span></div><span class="spacer"></span>' +
      (n.near ? '<button type="button" class="btn sm" id="ri-okall">ยืนยันที่ใกล้เคียงทั้งหมด</button>' : '') + '</div>' +
      '<div class="tablewrap" style="margin-top:10px"><table class="t ri-t"><thead><tr><th class="num">บรรทัด</th><th>ชื่อในไฟล์</th><th>วัสดุในคลัง</th><th>หน่วยที่รับ</th><th class="num">จำนวน</th><th class="num">ราคา/หน่วย</th><th></th></tr></thead><tbody>' +
      I.rows.map(rowHtml).join('') + '</tbody></table></div>' +
      '<datalist id="ri-ml">' + S.catalog.materials.filter(function (m) { return m.active !== false; }).map(function (m) { return '<option value="' + U.esc(m.code + ' · ' + m.name) + '">'; }).join('') + '</datalist>' +
      (over ? '<div class="notice err"><div><b>เกิน ' + MAX_LINES + ' รายการต่อใบรับเข้า</b>ใบนี้จะมี ' + (ctx.F.lines.length + use) + ' รายการ — แบ่งไฟล์เป็นหลายใบ หรือข้ามบางบรรทัด</div></div>' : '') +
      '<div class="row end" style="margin-top:10px"><span class="small muted">' + (todo ? 'เหลือ ' + todo + ' บรรทัดที่ต้องเลือก/ยืนยัน/กรอกให้ครบ' : 'พร้อมเติมลงใบรับเข้า') + '</span>' +
      '<button type="button" class="btn ghost" id="ri-cancel">ยกเลิกการนำเข้า</button>' +
      '<button type="button" class="btn primary" id="ri-apply"' + (todo || over || !use ? ' disabled' : '') + '>เติมลงใบรับเข้า (' + use + ' รายการ)</button></div></div>';
  }
  async function createMat(r) {
    const cats = S.catalog.categories || [];
    const v = await U.modal({
      title: 'สร้างวัสดุใหม่', ok: 'สร้างและเลือก',
      html: '<label class="field"><span>ชื่อวัสดุ *</span><input class="input" name="name" required maxlength="150" value="' + U.esc(r.raw.name) + '"></label>' +
        '<div class="grid2"><label class="field"><span>หมวดหมู่</span><select class="input" name="cat"><option value="">—</option>' + cats.map(function (c) { return '<option value="' + U.esc(c.cat_id) + '">' + U.esc(c.name) + '</option>'; }).join('') + '</select></label>' +
        '<label class="field"><span>หน่วยหลัก *</span><input class="input" name="unit" list="ri-ul" required value="' + U.esc(r.raw.unit) + '" placeholder="เช่น รีม กล่อง"></label></div>' + Officer.unitDatalist('ri-ul') +
        '<p class="small muted">รหัสวัสดุออกให้อัตโนมัติ · ตั้งหน่วยซื้อ/จุดสั่งซื้อเพิ่มได้ภายหลังที่หน้าวัสดุ</p>',
      validate: function (val) { if (!val.name.trim()) return 'กรุณากรอกชื่อวัสดุ'; if (!Officer.unitFromText(val.unit)) return 'ไม่พบหน่วย "' + val.unit + '" — เลือกจากรายการ'; return ''; }
    });
    if (!v) return;
    try {
      const res = await API.write('saveMaterial', { name: v.name.trim(), code: '', spec: '', keywords: '', cat_id: v.cat, type_id: '', unit_id: Officer.unitFromText(v.unit).unit_id,
        reorder_point: 0, reorder_qty: 0, max_per_request: 0, image_url: '' });
      await App.refreshCatalog();
      U.toast('สร้างวัสดุ ' + res.code + ' แล้ว', 'ok');
      r.status = 'none'; r.confirmed = true; r.how = 'new'; r.remember = false;
      setMat(r, S.idx[res.mat_id]);
    } catch (er) { U.toast(er.message, 'err', 6000); }
  }
  /** จำชื่อในไฟล์ไว้ในคำค้นของวัสดุ (ไม่แตะหน่วยซื้อ) — ไม่สำเร็จไม่ขวางการรับเข้า */
  async function learn(rows) {
    const plan = {};
    rows.forEach(function (r) {
      const m = S.idx[r.mat_id];
      if (!r.remember || !m || r.status === 'skip' || r.how === 'code' || r.how === 'name' || r.how === 'alias' || r.how === 'new') return;
      const name = clean(r.raw.name), k = nk(name);
      if (!k || k === nk(m.name) || aliasesOf(m).some(function (a) { return nk(a) === k; })) return;
      (plan[m.mat_id] = plan[m.mat_id] || []).indexOf(name) < 0 && plan[m.mat_id].push(name);
    });
    let ok = 0, fail = 0;
    for (const id of Object.keys(plan)) {
      const m = S.idx[id];
      const kw = [String(m.keywords || '').trim()].concat(plan[id]).filter(Boolean).join(', ');
      if (kw.length > 300) { fail++; continue; }
      try {
        await API.write('saveMaterial', { mat_id: m.mat_id, name: m.name, code: m.code, spec: m.spec || '', keywords: kw, cat_id: m.cat_id || '', type_id: m.type_id || '',
          unit_id: m.unit_id, reorder_point: Number(m.reorder_point) || 0, reorder_qty: Number(m.reorder_qty) || 0, max_per_request: Number(m.max_per_request) || 0, image_url: m.image_url || '' });
        ok++;
      } catch (e) { fail++; }
    }
    if (ok || fail) { await App.refreshCatalog().catch(function () {}); U.toast('จำชื่อจากใบส่งของแล้ว ' + ok + ' วัสดุ' + (fail ? ' · จำไม่ได้ ' + fail + ' (คำค้นยาวเกินหรือบันทึกไม่สำเร็จ)' : ''), fail ? 'warn' : 'ok', 5000); }
  }
  function bind() {
    const root = ctx.root;
    root.onclick = async function (e) {
      const I = ctx.F.imp; if (!I) return;
      if (e.target.id === 'ri-cancel') { ctx.F.imp = null; draw(); return; }
      if (e.target.id === 'ri-okall') { I.rows.forEach(function (r) { if (r.status === 'near') r.confirmed = true; }); draw(); return; }
      if (e.target.id === 'ri-apply') {
        const rows = I.rows.filter(function (r) { return r.status !== 'skip'; });
        if (!rows.every(ready) || ctx.F.lines.length + rows.length > MAX_LINES) return;
        e.target.classList.add('busy');
        await learn(rows);
        rows.forEach(function (r) { ctx.F.lines.push({ mat_id: r.mat_id, unit_id: r.unit_id, qty: Number(r.qty), price: Number(r.price) }); });
        ctx.F.imp = null;
        draw(); ctx.onApply();
        U.toast('เติม ' + rows.length + ' รายการลงใบรับเข้าแล้ว — ตรวจแล้วกด "บันทึกรับเข้า"', 'ok', 5000);
        return;
      }
      const b = e.target.closest('[data-a]'); if (!b) return;
      const r = I.rows[Number(b.closest('tr').dataset.i)];
      if (b.dataset.a === 'ok') r.confirmed = true;
      if (b.dataset.a === 'unskip') { r.status = r.prev || 'none'; }
      draw();
    };
    root.onchange = async function (e) {
      const I = ctx.F.imp; if (!I) return;
      const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      const r = I.rows[Number(tr.dataset.i)];
      const k = e.target.dataset.k;
      if (k === 'mat') {
        const v = e.target.value;
        r.finding = false;
        if (v === '__skip') { r.prev = r.status; r.status = 'skip'; }
        else if (v === '__find') { r.finding = true; draw(); const f = root.querySelector('tr[data-i="' + tr.dataset.i + '"] [data-k=find]'); if (f) f.focus(); return; }
        else if (v === '__new') { draw(); await createMat(r); }
        else if (v) { setMat(r, S.idx[v]); r.confirmed = true; if (r.status === 'ok' && r.how !== 'code') { r.how = 'fuzzy'; r.status = 'near'; } }
        draw(); return;
      }
      if (k === 'find') {
        const code = e.target.value.split(' · ')[0];
        const m = S.catalog.materials.find(function (x) { return x.code === code; });
        if (!m) return;
        r.finding = false; setMat(r, m); r.confirmed = true; if (r.status === 'ok') { r.status = 'near'; r.how = 'fuzzy'; }
        draw(); return;
      }
      if (k === 'unit_id') { const m = S.idx[r.mat_id]; r.unit_id = e.target.value; r.unitFlag = ''; if (r.priceFlag && m.last_cost) r.price = Math.round(m.last_cost * Officer.factorOf(m, r.unit_id) * 100) / 100; draw(); return; }
      if (k === 'remember') { r.remember = e.target.checked; return; }
    };
    root.oninput = function (e) {
      const I = ctx.F.imp; if (!I) return;
      const k = e.target.dataset.k; if (k !== 'qty' && k !== 'price') return;
      const r = I.rows[Number(e.target.closest('tr').dataset.i)];
      r[k] = e.target.value;
      if (k === 'price') r.priceFlag = '';
      const done = I.rows.filter(function (x) { return !ready(x); }).length;
      const apply = U.$('#ri-apply');
      e.target.closest('tr').classList.toggle('ri-todo', !ready(r));
      if (apply) apply.disabled = !!done || ctx.F.lines.length + I.rows.filter(function (x) { return x.status !== 'skip'; }).length > MAX_LINES;
    };
  }
  function load(parsed, source) {
    if (!parsed.rows.length) throw new Error('ไม่พบรายการวัสดุ' + (parsed.header ? '' : ' — ตรวจว่ามีคอลัมน์ "ชื่อวัสดุ" และ "จำนวน"'));
    ctx.F.imp = { source: source, rows: match(parsed.rows), skipped: parsed.skipped };
    draw();
    ctx.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ------------------------------------------------------------ ส่วนที่หน้ารับเข้าเรียกใช้ */
  function toolbarHtml() {
    return '<div class="ri-bar"><span class="small muted">เพิ่มหลายรายการ:</span>' +
      '<button type="button" class="btn sm" id="ri-tpl">' + ICON('download') + 'ไฟล์ตัวอย่าง</button>' +
      '<label class="btn sm" for="ri-file">' + ICON('upload') + 'นำเข้าไฟล์ Excel/CSV</label><input type="file" id="ri-file" accept=".xlsx,.xls,.csv" hidden>' +
      '<button type="button" class="btn sm" id="ri-paste">' + ICON('copy') + 'วางจาก Excel</button></div><div id="ri"></div>';
  }
  function mount(F, onApply) {
    ctx = { F: F, root: U.$('#ri'), onApply: onApply };
    bind(); draw();
    U.$('#ri-tpl').onclick = function () {
      const sample = S.catalog.materials.filter(function (m) { return m.active !== false; }).slice(0, 2).map(function (m) {
        return [m.code, m.name, m.unit_name, 10, m.last_cost || 0, ''];
      });
      sample.push(['', 'ชื่อตามใบส่งของ (ไม่มีรหัสก็ได้)', 'กล่อง', 2, 150, '']);
      U.exportXlsx('ตัวอย่างนำเข้ารับเข้า', [
        { name: 'รายการรับเข้า', head: TPL_HEAD, rows: sample, widths: [12, 40, 10, 10, 14, 14] },
        { name: 'คำอธิบาย', head: ['คอลัมน์', 'คำอธิบาย'], rows: [
          ['รหัสวัสดุ', 'ไม่บังคับ — ถ้าตรงกับรหัสในคลัง ระบบจับคู่ทันที'],
          ['ชื่อวัสดุ', 'บังคับ — ใช้ชื่อตามใบส่งของได้ ชื่อไม่ตรงระบบจะเสนอวัสดุที่ใกล้เคียงให้ยืนยัน'],
          ['หน่วย', 'หน่วยที่รับจริง เช่น กล่อง รีม — ว่าง = หน่วยรับเข้าเริ่มต้นของวัสดุ'],
          ['จำนวน', 'บังคับ มากกว่า 0'],
          ['ราคาต่อหน่วย', 'ราคาต่อหน่วยที่รับ — ว่างได้ถ้ามีราคารวม (ระบบหารให้) หรือใช้ราคาครั้งก่อนแล้วตรวจอีกครั้ง'],
          ['ราคารวม', 'ไม่บังคับ'],
          ['หมายเหตุ', '1 ไฟล์ = 1 ใบรับเข้า (ไม่เกิน ' + MAX_LINES + ' รายการ) · ผู้จำหน่าย วันที่ เลขใบส่งของ กรอกที่หน้ารับเข้า · ยังไม่บันทึกจนกว่าจะกด "บันทึกรับเข้า"']] }]);
    };
    U.$('#ri-file').onchange = async function () {
      const file = this.files[0]; this.value = '';
      if (!file) return;
      try {
        const wb = await readBook(file);
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
        load(rowsFromAoa(aoa), file.name);
      } catch (er) { U.toast('อ่านไฟล์ไม่ได้: ' + er.message, 'err', 7000); }
    };
    U.$('#ri-paste').onclick = async function () {
      const v = await U.modal({ title: 'วางรายการจาก Excel', ok: 'อ่านรายการ',
        html: '<p class="small muted">คัดลอกตารางจาก Excel (รวมแถวหัวคอลัมน์ถ้ามี) แล้ววางในช่องนี้ — ลำดับคอลัมน์ตามไฟล์ตัวอย่าง</p><textarea class="input" name="t" rows="8" placeholder="รหัสวัสดุ&#9;ชื่อวัสดุ&#9;หน่วย&#9;จำนวน&#9;ราคาต่อหน่วย"></textarea>',
        validate: function (val) { return val.t.trim() ? '' : 'กรุณาวางข้อความก่อน'; } });
      if (!v) return;
      try { load(rowsFromAoa(v.t.replace(/\r/g, '').split('\n').map(function (l) { return l.split('\t'); })), 'ข้อความที่วาง'); }
      catch (er) { U.toast(er.message, 'err', 6000); }
    };
  }
  return { toolbarHtml: toolbarHtml, mount: mount, _test: { nk: nk, dice: dice, columns: columns, rowsFromAoa: rowsFromAoa, match: match } };
})();
