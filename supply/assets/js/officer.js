/* ระบบบริหารวัสดุสำนักงาน · officer.js — งานเจ้าหน้าที่พัสดุ: คิวจ่าย · คลังวัสดุ/บัญชีวัสดุรายตัว · รับเข้า · ตรวจนับ ·
 * จุดสั่งซื้อ · ผู้จำหน่าย · ยอดยกมา · กระทบยอด/ตรวจซ่อม · ประวัติการใช้งาน */
'use strict';
const OA = ['OFFICER', 'ADMIN'];
const Officer = (function () {
  const S = App.S;
  function isOfficer() { return S.user.role === 'OFFICER'; }
  function unitOptions(m, sel) {
    const opts = [{ unit_id: m.unit_id, name: m.unit_name + ' (หน่วยหลัก)', factor: 1 }].concat(
      (S.catalog.material_units || []).filter(function (x) { return x.mat_id === m.mat_id; })
        .map(function (x) { return { unit_id: x.unit_id, name: x.unit_name + ' = ' + x.factor + ' ' + m.unit_name, factor: x.factor, def: x.is_default_purchase }; }));
    return opts.map(function (o) { return '<option value="' + U.esc(o.unit_id) + '" data-f="' + o.factor + '"' + (o.unit_id === sel ? ' selected' : '') + '>' + U.esc(o.name) + '</option>'; }).join('');
  }
  function factorOf(m, unitId) {
    if (unitId === m.unit_id) return 1;
    const x = (S.catalog.material_units || []).find(function (y) { return y.mat_id === m.mat_id && y.unit_id === unitId; });
    return x ? x.factor : 1;
  }
  function defaultUnit(m) {
    const x = (S.catalog.material_units || []).find(function (y) { return y.mat_id === m.mat_id && y.is_default_purchase; });
    return x ? x.unit_id : m.unit_id;
  }
  /** ค้นหาหน่วยจากชื่อหรือคำเรียกอื่น (ดรอปดาวน์พิมพ์ค้นหาได้) */
  function unitFromText(t) {
    t = String(t || '').trim();
    const us = (S.catalog.units || []).filter(function (u) { return u.active !== false; });
    return us.find(function (u) { return u.name === t; }) ||
      us.find(function (u) { return String(u.aliases || '').split(/[,;|]/).map(function (s) { return s.trim(); }).indexOf(t) >= 0; }) || null;
  }
  function unitDatalist(id) {
    return '<datalist id="' + id + '">' + (S.catalog.units || []).filter(function (u) { return u.active !== false; }).map(function (u) {
      return '<option value="' + U.esc(u.name) + '">' + U.esc(u.aliases || '') + '</option>' +
        String(u.aliases || '').split(/[,;|]/).filter(function (s) { return s.trim(); }).map(function (a) { return '<option value="' + U.esc(a.trim()) + '">= ' + U.esc(u.name) + '</option>'; }).join('');
    }).join('') + '</datalist>';
  }
  async function needCatalog() { if (!S.catalog || !('balance' in (S.catalog.materials[0] || { balance: 0 }))) await App.loadCatalog(true); }

  async function home(el) {
    const c = S.me.counts || {};
    el.innerHTML = '<div class="page-h"><h1>งานวันนี้</h1><p>' + U.thDate(new Date()) + ' · ' + U.esc(S.user.name) + '</p></div>' +
      (!S.cfg.cost_method ? '<div class="notice warn"><div><b>ยังไม่ได้เลือกวิธีคิดมูลค่าวัสดุ</b>ผู้ดูแลระบบต้องตั้งค่าก่อนบันทึกยอดยกมาและรับ-จ่าย</div></div>' : '') +
      '<div class="kpis today-kpis"><a class="kpi task-prep" href="#/queue" style="text-decoration:none"><small>รอจัดเตรียม</small><b>' + U.n(c.queuePrep || 0) + '</b><span>ใบ</span></a>' +
      '<a class="kpi task-ready" href="#/queue" style="text-decoration:none"><small>พร้อมรับ (รอส่งมอบ)</small><b>' + U.n(c.queueReady || 0) + '</b><span>ใบ</span></a>' +
      '<a class="kpi task-reorder" href="#/reorder" style="text-decoration:none"><small>ถึงจุดสั่งซื้อ</small><b>' + U.n(c.reorder || 0) + '</b><span>รายการ</span></a>' +
      (S.cfg.approval_enabled ? '<a class="kpi task-approval" href="#/approve" style="text-decoration:none"><small>รออนุมัติ</small><b>' + U.n(c.approvals || 0) + '</b><span>ใบ</span></a>' : '') + '</div>' +
      '<div class="row" style="margin-bottom:18px"><a class="btn primary lg" href="#/queue">' + ICON('truck') + 'คิวจ่ายวัสดุ</a><a class="btn lg" href="#/receive">' + ICON('inbox') + 'รับเข้า</a>' +
      '<a class="btn lg" href="#/count">' + ICON('clip') + 'ตรวจนับ</a><a class="btn lg" href="#/req">' + ICON('box') + 'เบิกของตนเอง</a></div>' +
      '<div class="card today-chart-card"><div><h3>สถานะคิวคำขอปัจจุบัน</h3><p class="small muted">จำนวนใบที่ยังรอดำเนินการ ณ เวลาที่โหลดข้อมูล</p><div id="today-legend"></div></div><div class="today-chart" id="today-chart"><canvas id="today-canvas" role="img" aria-label="กราฟสถานะคิวคำขอปัจจุบัน"></canvas></div></div>' +
      '<div class="card"><h3>คิวคำขอเบิกพัสดุ</h3><div id="q5"><div class="skel"></div></div></div>' +
      (window.Notification && Notification.permission === 'default' ? '<p class="small muted">ระบบตรวจคำขอใหม่ทุก 1 นาทีขณะเปิดหน้านี้ไว้ <button class="btn sm" id="nt">เปิดการแจ้งเตือนบนเครื่องนี้</button></p>' : '');
    drawTodayChart(el, c);
    const nt = U.$('#nt');
    if (nt) nt.onclick = function () { Notification.requestPermission().then(function () { nt.parentNode.remove(); }); };
    try {
      const q = (await API.call('queue')).filter(function (r) { return r.status !== 'PENDING_APPROVAL'; }).slice(0, 5);
      U.$('#q5').innerHTML = q.length ? q.map(function (r) {
        return '<div class="row" style="padding:10px 0;border-bottom:1px solid var(--line-2)"><div><b>' + U.esc(r.req_no) + '</b> <span class="muted small">' + U.esc(r.requester_name) + ' · ' + U.esc(r.dept_name) +
          ' · ' + r.items.length + ' รายการ · ' + (r.age_days || 0) + ' วันทำการ</span></div><span class="spacer"></span>' + stBadge(r.status) + '</div>';
      }).join('') : '<p class="muted">ไม่มีคิวค้าง</p>';
    } catch (e) { U.$('#q5').innerHTML = App.errorBox(e); }
  }
  let todayChart = null;
  async function drawTodayChart(el, c) {
    if (todayChart) { todayChart.destroy(); todayChart = null; }
    const entries = [
      {label:'รอจัดเตรียม',value:Number(c.queuePrep)||0,color:'#C58A21'},
      {label:'พร้อมรับ',value:Number(c.queueReady)||0,color:'#23836A'}
    ].concat(S.cfg.approval_enabled ? [{label:'รออนุมัติ',value:Number(c.approvals)||0,color:'#7662B7'}] : []);
    el.querySelector('#today-legend').innerHTML = entries.map(function(x) { return '<p class="today-legend-row"><i style="background:' + x.color + '" aria-hidden="true"></i><span>' + x.label + '</span><b>' + U.n(x.value) + ' ใบ</b></p>'; }).join('');
    const holder = el.querySelector('#today-chart');
    if (!entries.some(function(x) { return x.value > 0; })) { holder.innerHTML = '<div class="today-chart-empty">' + ICON('check') + '<b>ไม่มีคำขอค้าง</b><span>ทุกสถานะเป็น 0 ใบ</span></div>'; return; }
    try {
      await U.loadScript('assets/vendor/chart.umd.js');
      if (!el.isConnected || !holder.isConnected || !el.querySelector('#today-canvas')) return;
      todayChart = new Chart(el.querySelector('#today-canvas'), {
        type:'doughnut',data:{labels:entries.map(function(x){return x.label;}),datasets:[{data:entries.map(function(x){return x.value;}),backgroundColor:entries.map(function(x){return x.color;}),borderWidth:3,borderColor:'#fff'}]},
        options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){return ctx.label + ': ' + U.n(ctx.raw) + ' ใบ';}}}}}
      });
    } catch (e) { if (holder.isConnected) holder.innerHTML = '<p class="small muted">แสดงกราฟไม่ได้ ดูจำนวนจริงจากรายการสถานะข้างต้นได้</p>'; }
  }
  /** แจ้งเจ้าหน้าที่พัสดุเมื่อมีคำขอเข้ามา (ในระบบ — LINE เป็นจุดต่อยอด) ตรวจทุก 60 วินาทีขณะเปิดหน้าอยู่ */
  let watching = false;
  function watch() {
    if (watching) return;
    watching = true;
    let last = (S.me.counts || {}).queuePrep || 0;
    const title = function (n) { document.title = (n ? '(' + n + ') ' : '') + document.title.replace(/^\(\d+\) /, ''); };
    title(last);
    setInterval(async function () {
      if (document.hidden || document.querySelector('.modal-wrap')) return;
      const me = await App.refreshMe();
      if (!me) return;
      const n = me.counts.queuePrep || 0;
      if (n > last) {
        U.toast('มีคำขอเบิกใหม่ ' + (n - last) + ' ใบ · รอจัดเตรียมทั้งหมด ' + n + ' ใบ', 'info', 7000);
        try { if (window.Notification && Notification.permission === 'granted') new Notification(U.APP_NAME, { body: 'มีคำขอเบิกใหม่ ' + (n - last) + ' ใบ' }); } catch (e) { /**/ }
      }
      last = n;
      title(n);
    }, 60000);
  }
  return { home: home, watch: watch, isOfficer: isOfficer, unitOptions: unitOptions, factorOf: factorOf, defaultUnit: defaultUnit,
           unitFromText: unitFromText, unitDatalist: unitDatalist, needCatalog: needCatalog };
})();

/* ---------------------------------------------------------------- คิวจ่ายวัสดุ */
App.view('queue', {
  title: 'คิวจ่ายวัสดุ', roles: OA,
  render: async function (el) {
    const S = App.S;
    const F = S.forms.queue = S.forms.queue || { tab: 'PENDING_PREP' };
    el.innerHTML = '<div class="page-h row"><div><h1>คิวจ่ายวัสดุ</h1><p>เรียงจากยื่นก่อน · เตรียมของแล้วแตะ "เตรียมพร้อมรับ" · ส่งของจริงแล้วแตะ "ยืนยันส่งมอบ"</p></div><span class="spacer"></span>' +
      '<button class="btn" id="rf">' + ICON('refresh') + 'รีเฟรช</button></div><div class="seg" id="tab"></div><div id="list" style="margin-top:16px"><div class="skel"></div><div class="skel"></div></div>';
    let rows = [];
    const officer = S.user.role === 'OFFICER';
    const lim = function (i) { return i.qty_approved !== null ? i.qty_approved : i.qty_req; };
    const draw = function () {
      const n = function (st) { return rows.filter(function (r) { return r.status === st; }).length; };
      const tabs = [['PENDING_PREP', 'รอจัดเตรียม'], ['READY', 'พร้อมรับ']];
      if (S.cfg.approval_enabled || n('PENDING_APPROVAL')) tabs.push(['PENDING_APPROVAL', 'รออนุมัติ']);
      U.$('#tab').innerHTML = tabs.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (F.tab === t[0] ? 'on' : '') + '">' + t[1] + ' (' + n(t[0]) + ')</button>'; }).join('');
      const list = rows.filter(function (r) { return r.status === F.tab; });
      const alert = S.cfg.lead_alert_days || 3;
      U.$('#list').innerHTML = list.length ? list.map(function (r) {
        const prep = r.status === 'PENDING_PREP';
        return '<div class="card req-card" data-id="' + U.esc(r.req_id) + '"><div class="top"><div><h3>' + U.esc(r.req_no) + '</h3><span class="muted small">' + U.esc(r.requester_name) +
          (r.requester_position ? ' (' + U.esc(r.requester_position) + ')' : '') + ' · ' + U.esc(r.dept_name) + ' · ยื่น ' + U.thDateTime(r.created_at) + '</span></div><span class="spacer"></span>' +
          (r.age_days > alert ? '<span class="badge out">ค้าง ' + r.age_days + ' วันทำการ</span>' : '<span class="badge gray nodot">' + (r.age_days || 0) + ' วันทำการ</span>') + stBadge(r.status) + '</div>' +
          (r.purpose ? '<p class="small">วัตถุประสงค์: ' + U.esc(r.purpose) + '</p>' : '') +
          '<div class="tablewrap" style="margin-top:10px"><table class="t"><thead><tr><th>วัสดุ</th><th class="num">ขอ</th><th class="num">คงเหลือ</th><th class="num">' + (prep ? 'เตรียม' : 'เตรียมไว้') + '</th></tr></thead><tbody>' +
          r.items.map(function (i) {
            const short = i.balance < lim(i);
            return '<tr><td>' + U.esc(i.name) + '</td><td class="num">' + U.n(lim(i)) + ' ' + U.esc(i.unit_name) + '</td><td class="num"' + (short ? ' style="color:var(--out);font-weight:700"' : '') + '>' + U.n(i.balance) + '</td>' +
              '<td class="num">' + (prep && officer ? '<input class="input num" type="number" min="0" max="' + lim(i) + '" value="' + Math.min(lim(i), Math.max(0, i.balance)) + '" data-item="' + U.esc(i.item_id) + '">' : U.n(i.qty_ready)) + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          (officer && r.status !== 'PENDING_APPROVAL' ? '<div class="acts">' + (prep ? '<button class="btn primary" data-a="ready">' + ICON('check') + 'เตรียมพร้อมรับ</button><button class="btn" data-a="issue">ส่งมอบทันที</button>'
            : '<button class="btn primary" data-a="issue">' + ICON('truck') + 'ยืนยันส่งมอบ</button>') +
            '<a class="btn" href="#/print/' + U.esc(r.req_id) + '">' + ICON('print') + 'พิมพ์</a><button class="btn ghost" data-a="cancel">ยกเลิก</button></div>' : '') + '</div>';
      }).join('') : '<div class="empty">' + ICON('truck') + '<p>ไม่มีคำขอในคิวนี้</p></div>';
    };
    const load = async function () {
      try { rows = await API.call('queue'); draw(); } catch (e) { U.$('#list').innerHTML = App.errorBox(e); }
    };
    U.$('#tab').onclick = function (e) { const b = e.target.closest('[data-t]'); if (b) { F.tab = b.dataset.t; draw(); } };
    U.$('#rf').onclick = load;
    U.$('#list').onclick = async function (e) {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const card = b.closest('.card');
      const r = rows.find(function (x) { return x.req_id === card.dataset.id; });
      const a = b.dataset.a;
      try {
        if (a === 'ready') {
          const items = U.$$('input[data-item]', card).map(function (i) { return { item_id: i.dataset.item, qty_ready: Number(i.value) }; });
          b.classList.add('busy');
          await API.write('prepareRequest', { req_id: r.req_id, items: items });
          U.toast(r.req_no + ' พร้อมรับแล้ว — ผู้ขอเห็นสถานะทันที', 'ok');
        } else if (a === 'issue') {
          const inputs = {};
          U.$$('input[data-item]', card).forEach(function (i) { inputs[i.dataset.item] = Number(i.value); });
          const v = await U.modal({
            title: 'ยืนยันส่งมอบ ' + r.req_no, ok: 'ยืนยันส่งมอบ',
            html: '<p class="small muted">ตัดสต๊อกเมื่อกดยืนยัน — ทำเมื่อส่งของให้ผู้รับจริงแล้วเท่านั้น</p>' +
              '<label class="field"><span>ชื่อผู้รับของ</span><input class="input" name="receiver" required value="' + U.esc(r.requester_name) + '"></label>' +
              '<div class="tablewrap"><table class="t"><thead><tr><th>วัสดุ</th><th class="num">อนุมัติ/ขอ</th><th class="num">จ่ายจริง</th></tr></thead><tbody>' + r.items.map(function (i) {
                const def = inputs[i.item_id] !== undefined ? inputs[i.item_id] : (i.qty_ready !== null ? i.qty_ready : Math.min(lim(i), i.balance));
                return '<tr><td>' + U.esc(i.name) + '</td><td class="num">' + U.n(lim(i)) + '</td><td class="num"><input class="input num" type="number" min="0" max="' + lim(i) + '" name="q_' + U.esc(i.item_id) + '" value="' + def + '"></td></tr>';
              }).join('') + '</tbody></table></div><p class="small muted">จ่ายน้อยกว่าที่ขอได้ — ใบจะปิดเป็น "จ่ายแล้ว" และคืนยอดจองส่วนที่เหลือ</p>',
            validate: function (v) { if (!v.receiver.trim()) return 'กรุณาระบุชื่อผู้รับ'; return ''; }
          });
          if (!v) return;
          const items = r.items.map(function (i) { return { item_id: i.item_id, qty_issued: Number(v['q_' + i.item_id]) }; });
          const res = await API.write('issueRequest', { req_id: r.req_id, receiver_name: v.receiver, items: items });
          U.toast('ส่งมอบ ' + r.req_no + ' แล้ว' + (res.partial ? ' (บางส่วน)' : ''), 'ok');
          if (await U.confirm('พิมพ์ใบเบิก', 'พิมพ์ใบเบิก ' + U.esc(r.req_no) + ' พร้อมชื่อเจ้าหน้าที่พัสดุหรือไม่', 'พิมพ์')) { location.hash = '#/print/' + r.req_id; return; }
        } else if (a === 'cancel') {
          const v = await U.modal({ title: 'ยกเลิก ' + r.req_no, ok: 'ยกเลิกคำขอ', danger: true,
            html: (r.status === 'READY' ? '<div class="notice warn"><div>ใบนี้เตรียมของไว้แล้ว — นำของกลับเข้าจุดจัดเก็บ (ยอดคงเหลือไม่เปลี่ยนเพราะยังไม่ได้ตัด)</div></div>' : '') +
              '<label class="field"><span>เหตุผล</span><textarea class="input" name="reason" required></textarea></label>' });
          if (!v) return;
          await API.write('cancelRequest', { req_id: r.req_id, reason: v.reason });
          U.toast('ยกเลิกแล้ว', 'ok');
        }
        App.refreshMe(); App.refreshCatalog().catch(function () {});
        await load();
      } catch (er) { b.classList.remove('busy'); U.toast(er.message, 'err', 5000); }
    };
    await load();
    const timer = setInterval(function () { if (!document.body.contains(U.$('#list'))) clearInterval(timer); else if (!document.querySelector('.modal-wrap')) load(); }, 60000);
  }
});

/* ---------------------------------------------------------------- คลังวัสดุ */
App.view('stock', {
  title: 'คลังวัสดุ', roles: OA,
  render: async function (el) {
    const S = App.S;
    const F = S.forms.stock = S.forms.stock || { q: '', cat: '', f: 'all' };
    await Officer.needCatalog();
    el.innerHTML = '<div class="page-h row"><div><h1>คลังวัสดุ</h1><p>คงเหลือ = ยอดจาก ledger · จอง = คำขอค้าง · พร้อมเบิก = คงเหลือ − จอง</p></div><span class="spacer"></span>' +
      (Officer.isOfficer() ? '<a class="btn primary" href="#/mat/new">' + ICON('plus') + 'เพิ่มวัสดุ</a>' : '') + '<button class="btn" id="xl">' + ICON('download') + 'Excel</button></div>' +
      '<div class="row" style="margin-bottom:12px"><div class="search" style="flex:1;min-width:240px;margin:0">' + ICON('search') + '<input id="q" type="search" placeholder="ค้นหาชื่อ รหัส หรือคำค้น" value="' + U.esc(F.q) + '"></div>' +
      '<select class="input" id="cat" style="width:auto"><option value="">ทุกหมวด</option>' + (S.catalog.categories || []).map(function (c) { return '<option value="' + U.esc(c.cat_id) + '"' + (F.cat === c.cat_id ? ' selected' : '') + '>' + U.esc(c.name) + '</option>'; }).join('') + '</select>' +
      '<div class="seg" id="flt">' + [['all', 'ทั้งหมด'], ['low', 'ใกล้หมด'], ['out', 'หมด'], ['off', 'ปิดใช้งาน']].map(function (x) { return '<button data-f="' + x[0] + '" class="' + (F.f === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div></div>' +
      '<div class="tablewrap"><table class="t"><thead><tr><th>รหัส</th><th>วัสดุ</th><th>หน่วย</th><th class="num">คงเหลือ</th><th class="num">จอง</th><th class="num">พร้อมเบิก</th><th class="num">จุดสั่งซื้อ</th><th class="num">ต้นทุนเฉลี่ย</th><th class="num">มูลค่า (บาท)</th><th>สถานะ</th></tr></thead><tbody id="tb"></tbody></table></div><p class="small muted" id="sum"></p>';
    let shown = [];
    const draw = function () {
      let rows = S.catalog.materials;
      if (F.q) rows = rows.filter(function (m) { return U.match(m._s, F.q); });
      if (F.cat) rows = rows.filter(function (m) { return m.cat_id === F.cat; });
      if (F.f === 'off') rows = rows.filter(function (m) { return m.active === false; });
      else { rows = rows.filter(function (m) { return m.active !== false; }); if (F.f === 'low') rows = rows.filter(function (m) { return m.lvl === 'low'; }); if (F.f === 'out') rows = rows.filter(function (m) { return m.lvl === 'out'; }); }
      shown = rows;
      let val = 0;
      U.$('#tb').innerHTML = rows.map(function (m) {
        val += m.stock_value || 0;
        return '<tr class="click" data-id="' + U.esc(m.mat_id) + '"><td>' + U.esc(m.code) + '</td><td><b>' + U.esc(m.name) + '</b>' + (m.spec ? '<br><small class="muted">' + U.esc(m.spec) + '</small>' : '') + '</td><td>' + U.esc(m.unit_name) + '</td>' +
          '<td class="num">' + U.n(m.balance) + '</td><td class="num">' + U.n(m.reserved) + '</td><td class="num"><b>' + U.n(m.available) + '</b></td><td class="num">' + U.n(m.reorder_point) + '</td>' +
          '<td class="num">' + U.money(m.avg_cost) + '</td><td class="num">' + U.money(m.stock_value) + '</td><td>' + (m.active === false ? '<span class="badge gray">ปิดใช้งาน</span>' : U.badge(m.lvl)) + '</td></tr>';
      }).join('') || '<tr><td colspan="10" class="empty">ไม่พบวัสดุ</td></tr>';
      U.$('#sum').textContent = rows.length + ' รายการ · มูลค่ารวม ' + U.money(val) + ' บาท · ข้อมูล ณ ' + U.thDateTime(S.catAt);
    };
    draw();
    U.$('#q').oninput = function () { F.q = this.value; draw(); };
    U.$('#cat').onchange = function () { F.cat = this.value; draw(); };
    U.$('#flt').onclick = function (e) { const b = e.target.closest('[data-f]'); if (!b) return; F.f = b.dataset.f; U.$$('#flt button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw(); };
    U.$('#tb').onclick = function (e) { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = '#/mat/' + tr.dataset.id; };
    U.$('#xl').onclick = function () {
      U.exportXlsx('วัสดุคงเหลือ ' + U.ymd(), [{ name: 'วัสดุคงเหลือ', head: ['รหัส', 'วัสดุ', 'หมวด', 'หน่วย', 'คงเหลือ', 'จอง', 'พร้อมเบิก', 'จุดสั่งซื้อ', 'ต้นทุนเฉลี่ย', 'มูลค่า'],
        rows: shown.map(function (m) { return [m.code, m.name, (S.cats[m.cat_id] || {}).name || '', m.unit_name, m.balance, m.reserved, m.available, m.reorder_point, m.avg_cost, m.stock_value]; }) }]);
    };
  }
});

/* ---------------------------------------------------------------- วัสดุรายตัว: แก้ไข + หน่วยซื้อ + บัญชีวัสดุ */
App.view('mat', {
  title: 'วัสดุ', roles: OA,
  render: async function (el, params) {
    const S = App.S;
    await Officer.needCatalog();
    const id = params[0];
    const m = id === 'new' ? { mat_id: '', code: '', name: '', spec: '', keywords: '', cat_id: '', type_id: '', unit_id: '', unit_name: '', reorder_point: 0, reorder_qty: 0, max_per_request: 0, image_url: '', active: true } : S.idx[id];
    if (!m) { el.innerHTML = '<div class="notice err"><div>ไม่พบวัสดุ</div></div>'; return; }
    const ro = !Officer.isOfficer();
    const mus = (S.catalog.material_units || []).filter(function (x) { return x.mat_id === m.mat_id; });
    const dis = ro ? ' disabled' : '';
    el.innerHTML = '<div class="page-h row"><div><h1>' + (m.mat_id ? U.esc(m.name) : 'เพิ่มวัสดุ') + '</h1><p>' + (m.mat_id ? 'รหัส ' + U.esc(m.code) + ' · คงเหลือ ' + U.n(m.balance) + ' ' + U.esc(m.unit_name) + ' · จอง ' + U.n(m.reserved) : 'รหัสวัสดุออกให้อัตโนมัติถ้าเว้นว่าง') + '</p></div><span class="spacer"></span><a class="btn" href="#/stock">กลับ</a></div>' +
      '<form class="card" id="mf"><div class="grid2"><label class="field"><span>ชื่อวัสดุ *</span><input class="input" name="name" required maxlength="150" value="' + U.esc(m.name) + '"' + dis + '></label>' +
      '<label class="field"><span>รหัสวัสดุ</span><input class="input" name="code" maxlength="30" placeholder="อัตโนมัติ" value="' + U.esc(m.code) + '"' + dis + '></label></div>' +
      '<label class="field"><span>รายละเอียด/ขนาด</span><input class="input" name="spec" maxlength="300" value="' + U.esc(m.spec) + '"' + dis + '></label>' +
      '<label class="field"><span>คำค้นเพิ่มเติม</span><input class="input" name="keywords" maxlength="300" placeholder="เช่น ชื่อเรียกอื่น ยี่ห้อ" value="' + U.esc(m.keywords) + '"' + dis + '><small>ช่วยให้ผู้ขอเบิกค้นเจอเร็วขึ้น</small></label>' +
      '<div class="grid3"><label class="field"><span>หมวดหมู่</span><select class="input" name="cat_id"' + dis + '><option value="">—</option>' + (S.catalog.categories || []).map(function (c) { return '<option value="' + U.esc(c.cat_id) + '"' + (c.cat_id === m.cat_id ? ' selected' : '') + '>' + U.esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>ประเภท</span><select class="input" name="type_id"' + dis + '><option value="">—</option>' + (S.catalog.types || []).map(function (t) { return '<option value="' + U.esc(t.type_id) + '"' + (t.type_id === m.type_id ? ' selected' : '') + '>' + U.esc(t.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>หน่วยหลัก (ใช้เบิก/คงเหลือ) *</span><input class="input" name="unit" list="ul" required value="' + U.esc(m.unit_name) + '"' + dis + ' placeholder="พิมพ์ค้นหา เช่น รีม กล่อง"><small id="uh"></small></label></div>' +
      Officer.unitDatalist('ul') +
      '<div class="grid3"><label class="field"><span>จุดสั่งซื้อ</span><input class="input" type="number" min="0" name="reorder_point" value="' + m.reorder_point + '"' + dis + '></label>' +
      '<label class="field"><span>จำนวนสั่งซื้อต่อครั้ง</span><input class="input" type="number" min="0" name="reorder_qty" value="' + m.reorder_qty + '"' + dis + '></label>' +
      '<label class="field"><span>เบิกได้ไม่เกินต่อครั้ง (0 = ไม่จำกัด)</span><input class="input" type="number" min="0" name="max_per_request" value="' + m.max_per_request + '"' + dis + '></label></div>' +
      '<label class="field"><span>ลิงก์รูปภาพ (ถ้ามี)</span><input class="input" name="image_url" type="url" value="' + U.esc(m.image_url) + '"' + dis + '></label>' +
      '<h3>หน่วยซื้อ/รับเข้า และอัตราแปลง</h3><p class="small muted">ตั้งครั้งเดียว ใช้ตอนรับเข้า เช่น 1 กล่อง = 12 ด้าม · เอกสารเก่าเก็บอัตราเดิมไว้ ไม่เปลี่ยนตาม</p>' +
      '<div id="mus">' + mus.map(function (x) { return muRow(x.unit_name, x.factor, x.is_default_purchase, ro); }).join('') + '</div>' +
      (ro ? '' : '<button type="button" class="btn sm" id="addmu">' + ICON('plus') + 'เพิ่มหน่วยซื้อ</button>') +
      (ro ? '' : '<div class="row end" style="margin-top:16px">' + (m.mat_id ? '<button type="button" class="btn ghost" id="tog">' + (m.active === false ? 'เปิดใช้งาน' : 'ปิดใช้งาน') + '</button>' : '') + '<button class="btn primary lg">บันทึก</button></div>') + '</form>' +
      (m.mat_id ? '<div class="card"><div class="row"><h3 style="margin:0">บัญชีวัสดุ (รับ-จ่ายรายตัว)</h3><span class="spacer"></span><select class="input" id="fy" style="width:auto"></select><button class="btn sm" id="lx">' + ICON('download') + 'Excel</button></div><div id="led" style="margin-top:12px"><div class="skel"></div></div></div>' : '');
    function muRow(name, f, def, ro2) {
      return '<div class="row mu" style="margin-bottom:8px"><input class="input" list="ul" name="mu_unit" placeholder="หน่วยซื้อ" value="' + U.esc(name || '') + '" style="max-width:200px"' + (ro2 ? ' disabled' : '') + '>' +
        '<span>= </span><input class="input" type="number" min="0" step="any" name="mu_f" value="' + (f || '') + '" style="max-width:120px"' + (ro2 ? ' disabled' : '') + '><span class="mu-base">' + U.esc(m.unit_name || 'หน่วยหลัก') + '</span>' +
        '<label class="row small"><input type="checkbox" name="mu_def"' + (def ? ' checked' : '') + (ro2 ? ' disabled' : '') + '>ค่าเริ่มต้นรับเข้า</label>' + (ro2 ? '' : '<button type="button" class="iconbtn" data-rm>' + ICON('x') + '</button>') + '</div>';
    }
    const f = U.$('#mf');
    const add = U.$('#addmu');
    if (add) add.onclick = function () { U.$('#mus').insertAdjacentHTML('beforeend', muRow('', '', false, false)); };
    U.$('#mus').onclick = function (e) { if (e.target.closest('[data-rm]')) e.target.closest('.mu').remove(); };
    f.unit.oninput = function () { const u = Officer.unitFromText(this.value); U.$('#uh').textContent = this.value && !u ? 'ไม่พบหน่วยนี้ — ติดต่อผู้ดูแลระบบเพิ่มคำมาตรฐาน' : ''; };
    f.onsubmit = async function (e) {
      e.preventDefault();
      const unit = Officer.unitFromText(f.unit.value);
      if (!unit) { U.toast('กรุณาเลือกหน่วยหลักจากรายการ', 'err'); return; }
      const units = [];
      for (const r of U.$$('.mu', f)) {
        const t = r.querySelector('[name=mu_unit]').value.trim();
        if (!t) continue;
        const uu = Officer.unitFromText(t);
        if (!uu) { U.toast('ไม่พบหน่วย "' + t + '"', 'err'); return; }
        units.push({ unit_id: uu.unit_id, factor: Number(r.querySelector('[name=mu_f]').value), is_default_purchase: r.querySelector('[name=mu_def]').checked });
      }
      const d = { mat_id: m.mat_id || undefined, name: f.name.value, code: f.code.value, spec: f.spec.value, keywords: f.keywords.value, cat_id: f.cat_id.value, type_id: f.type_id.value,
                  unit_id: unit.unit_id, reorder_point: Number(f.reorder_point.value), reorder_qty: Number(f.reorder_qty.value), max_per_request: Number(f.max_per_request.value),
                  image_url: f.image_url.value, units: units };
      try {
        const r = await API.write('saveMaterial', d);
        U.toast('บันทึกแล้ว รหัส ' + r.code, 'ok');
        await App.refreshCatalog();
        location.hash = '#/mat/' + r.mat_id;
        if (m.mat_id) App.render();
      } catch (er) { U.toast(er.message, 'err', 5000); }
    };
    const tog = U.$('#tog');
    if (tog) tog.onclick = async function () {
      try { await API.write('setMaterialActive', { mat_id: m.mat_id, active: m.active === false }); U.toast('บันทึกแล้ว', 'ok'); await App.refreshCatalog(); App.render(); }
      catch (er) { U.toast(er.message, 'err', 5000); }
    };
    if (!m.mat_id) return;
    const fyNow = U.fy();
    U.$('#fy').innerHTML = '<option value="0">ทุกปีงบประมาณ</option>' + [fyNow, fyNow - 1, fyNow - 2].map(function (y) { return '<option value="' + y + '"' + (y === fyNow ? ' selected' : '') + '>ปีงบประมาณ ' + y + '</option>'; }).join('');
    let led = null;
    const loadLed = async function () {
      try {
        led = await API.call('ledger', { mat_id: m.mat_id, fy: Number(U.$('#fy').value) });
        U.$('#led').innerHTML = led.rows.length ? '<div class="tablewrap"><table class="t"><thead><tr><th>วันที่</th><th>รายการ</th><th>เลขที่</th><th>ส่วนงาน</th><th class="num">รับ</th><th class="num">จ่าย</th><th class="num">คงเหลือ</th><th class="num">ต้นทุน/หน่วย</th><th class="num">มูลค่าคงเหลือ</th></tr></thead><tbody>' +
          led.rows.map(function (r) {
            return '<tr><td>' + U.thShort(r.ts) + '</td><td>' + U.esc(r.type_th) + '</td><td>' + U.esc(r.ref_no) + '</td><td>' + U.esc(r.dept_name) + '</td><td class="num">' + (r.qty_in ? U.n(r.qty_in) : '') + '</td>' +
              '<td class="num">' + (r.qty_out ? U.n(r.qty_out) : '') + '</td><td class="num"><b>' + U.n(r.balance_after) + '</b></td><td class="num">' + U.money(r.unit_cost) + '</td><td class="num">' + U.money(r.value_after) + '</td></tr>';
          }).join('') + '</tbody></table></div><p class="small muted">วิธีคิดมูลค่า: ' + (led.cost_method === 'FIFO' ? 'เข้าก่อนออกก่อน (FIFO)' : 'ถัวเฉลี่ยถ่วงน้ำหนัก') + '</p>' : '<p class="muted">ไม่มีความเคลื่อนไหวในช่วงนี้</p>';
      } catch (e) { U.$('#led').innerHTML = App.errorBox(e); }
    };
    U.$('#fy').onchange = loadLed;
    U.$('#lx').onclick = function () {
      if (!led) return;
      U.exportXlsx('บัญชีวัสดุ ' + m.code, [{ name: 'บัญชีวัสดุ', head: ['วันที่', 'รายการ', 'เลขที่', 'ส่วนงาน', 'รับ', 'จ่าย', 'คงเหลือ', 'ต้นทุนต่อหน่วย', 'มูลค่าคงเหลือ', 'ผู้บันทึก'],
        rows: led.rows.map(function (r) { return [U.thShort(r.ts), r.type_th, r.ref_no, r.dept_name, r.qty_in || '', r.qty_out || '', r.balance_after, r.unit_cost, r.value_after, r.by]; }) }]);
    };
    loadLed();
  }
});

/* ---------------------------------------------------------------- รับเข้า (ไม่มี PO) */
App.view('receive', {
  title: 'รับเข้า', roles: ['OFFICER'],
  render: async function (el) {
    const S = App.S;
    await Officer.needCatalog();
    if (!S.cfg.cost_method) { el.innerHTML = '<h1>รับเข้า</h1><div class="notice warn"><div><b>ยังไม่ได้เลือกวิธีคิดมูลค่าวัสดุ</b>ผู้ดูแลระบบต้องตั้งค่าก่อน</div></div>'; return; }
    const F = S.forms.receive = S.forms.receive || { sup: '', date: U.ymd(), inv: '', note: '', lines: [] };
    let masters = { suppliers: [] };
    try { masters = await API.call('masters'); } catch (e) { /**/ }
    const sups = (masters.suppliers || []).filter(function (s) { return s.active; });
    el.innerHTML = '<div class="page-h"><h1>รับเข้าวัสดุ</h1><p>ไม่มีใบสั่งซื้อ · ราคาล่าสุดเติมให้ ตรวจราคาจริงก่อนบันทึก · ระบบแปลงหน่วยซื้อเป็นหน่วยหลักให้</p></div>' +
      '<div class="card"><div class="grid3"><label class="field"><span>ผู้จำหน่าย</span><input class="input" id="sup" list="sl" value="' + U.esc(F.sup) + '" placeholder="พิมพ์บางส่วนของชื่อร้าน"><datalist id="sl">' +
      sups.map(function (s) { return '<option value="' + U.esc(s.name) + '">'; }).join('') + '</datalist><small>ไม่พบในรายการ = เพิ่มร้านใหม่ให้อัตโนมัติ</small></label>' +
      '<label class="field"><span>วันที่รับ</span><input class="input" type="date" id="dt" max="' + U.ymd() + '" value="' + U.esc(F.date) + '"><small id="dth"></small></label>' +
      '<label class="field"><span>เลขใบส่งของ/ใบกำกับ</span><input class="input" id="inv" value="' + U.esc(F.inv) + '"></label></div>' +
      '<label class="field"><span>เพิ่มรายการ</span><input class="input" id="pick" list="ml" placeholder="พิมพ์ชื่อหรือรหัสวัสดุ แล้วเลือก"><datalist id="ml">' +
      S.catalog.materials.filter(function (m) { return m.active !== false; }).map(function (m) { return '<option value="' + U.esc(m.code + ' · ' + m.name) + '">'; }).join('') + '</datalist></label>' +
      '<div class="tablewrap"><table class="t"><thead><tr><th>วัสดุ</th><th>หน่วยที่รับ</th><th class="num">จำนวน</th><th class="num">ราคา/หน่วย</th><th class="num">รวม (บาท)</th><th></th></tr></thead><tbody id="lines"></tbody>' +
      '<tfoot><tr><th colspan="4" class="num">รวมทั้งสิ้น</th><th class="num" id="tot">0.00</th><th></th></tr></tfoot></table></div>' +
      '<label class="field" style="margin-top:12px"><span>หมายเหตุ</span><input class="input" id="note" value="' + U.esc(F.note) + '"></label>' +
      '<div class="row end"><button class="btn ghost" id="clr">ล้างฟอร์ม</button><button class="btn primary lg" id="save">' + ICON('inbox') + 'บันทึกรับเข้า</button></div></div>' +
      '<div class="card"><h3>รับเข้าล่าสุด</h3><div id="recent"><div class="skel"></div></div></div>';
    const conv = function (l) {
      const m = S.idx[l.mat_id], f = Officer.factorOf(m, l.unit_id);
      return f !== 1 && Number(l.qty) ? '= ' + U.n(Number(l.qty) * f) + ' ' + U.esc(m.unit_name) : '';
    };
    const total = function () {
      U.$('#tot').textContent = U.money(F.lines.reduce(function (a, l) { return a + (Number(l.qty) || 0) * (Number(l.price) || 0); }, 0));
    };
    const draw = function () {
      let tot = 0;
      U.$('#lines').innerHTML = F.lines.map(function (l, i) {
        const m = S.idx[l.mat_id];
        const f = Officer.factorOf(m, l.unit_id);
        const t = (Number(l.qty) || 0) * (Number(l.price) || 0);
        tot += t;
        return '<tr data-i="' + i + '"><td><b>' + U.esc(m.name) + '</b><br><small class="muted">คงเหลือ ' + U.n(m.balance) + ' ' + U.esc(m.unit_name) + '</small></td>' +
          '<td><select class="input" data-k="unit_id">' + Officer.unitOptions(m, l.unit_id) + '</select></td>' +
          '<td class="num"><input class="input num" type="number" min="0" step="any" data-k="qty" value="' + U.esc(l.qty) + '"><br><small class="muted conv">' + conv(l) + '</small></td>' +
          '<td class="num"><input class="input num" type="number" min="0" step="0.01" data-k="price" value="' + U.esc(l.price) + '"></td><td class="num lt">' + U.money(t) + '</td>' +
          '<td><button class="iconbtn" data-rm aria-label="นำออก">' + ICON('x') + '</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="muted">ยังไม่มีรายการ — พิมพ์ชื่อวัสดุในช่องด้านบน</td></tr>';
      U.$('#tot').textContent = U.money(tot);
      U.$('#dth').textContent = F.date ? U.thDate(F.date + 'T00:00:00') : '';
    };
    draw();
    const bind = function (id, k) { U.$(id).oninput = function () { F[k] = this.value; if (k === 'date') draw(); }; };
    bind('#sup', 'sup'); bind('#dt', 'date'); bind('#inv', 'inv'); bind('#note', 'note');
    U.$('#pick').onchange = function () {
      const code = this.value.split(' · ')[0];
      const m = S.catalog.materials.find(function (x) { return x.code === code; });
      if (!m) return;
      const unit = Officer.defaultUnit(m);
      F.lines.push({ mat_id: m.mat_id, unit_id: unit, qty: '', price: m.last_cost ? Math.round(m.last_cost * Officer.factorOf(m, unit) * 100) / 100 : '' });
      this.value = '';
      draw();
      const ins = U.$$('#lines input[data-k=qty]'); if (ins.length) ins[ins.length - 1].focus();
    };
    U.$('#lines').addEventListener('input', function (e) {
      const k = e.target.dataset.k; if (!k || k === 'unit_id') return;
      const tr = e.target.closest('tr');
      const l = F.lines[Number(tr.dataset.i)];
      l[k] = e.target.value;
      tr.querySelector('.conv').innerHTML = conv(l);                       // แก้เฉพาะช่องคำนวณ ไม่วาดตารางใหม่
      tr.querySelector('.lt').textContent = U.money((Number(l.qty) || 0) * (Number(l.price) || 0));
      total();
    });
    U.$('#lines').addEventListener('change', function (e) {
      if (e.target.dataset.k !== 'unit_id') return;
      const l = F.lines[Number(e.target.closest('tr').dataset.i)];
      const m = S.idx[l.mat_id];
      l.unit_id = e.target.value;
      if (m.last_cost) l.price = Math.round(m.last_cost * Officer.factorOf(m, l.unit_id) * 100) / 100;
      draw();
    });
    U.$('#lines').addEventListener('click', function (e) { if (e.target.closest('[data-rm]')) { F.lines.splice(Number(e.target.closest('tr').dataset.i), 1); draw(); } });
    U.$('#clr').onclick = function () { S.forms.receive = null; App.render(); };
    U.$('#save').onclick = async function () {
      if (!F.lines.length) { U.toast('ยังไม่มีรายการ', 'warn'); return; }
      const bad = F.lines.find(function (l) { return !(Number(l.qty) > 0) || l.price === '' || !(Number(l.price) >= 0); });
      if (bad) { U.toast('กรุณากรอกจำนวนและยืนยันราคาต่อหน่วยให้ครบทุกรายการ', 'err'); return; }
      const sum = F.lines.map(function (l) { const m = S.idx[l.mat_id]; const f = Officer.factorOf(m, l.unit_id); return '<li>' + U.esc(m.name) + ' — ' + U.n(l.qty) + ' × ' + U.money(l.price) + (f !== 1 ? ' (= ' + U.n(l.qty * f) + ' ' + U.esc(m.unit_name) + ')' : '') + '</li>'; }).join('');
      if (!(await U.confirm('ยืนยันบันทึกรับเข้า', '<ul>' + sum + '</ul>รวม ' + U.$('#tot').textContent + ' บาท', 'บันทึกรับเข้า'))) return;
      const btn = this; btn.classList.add('busy');
      const sup = sups.find(function (s) { return s.name === F.sup.trim(); });
      try {
        const r = await API.write('receive', { sup_id: sup ? sup.sup_id : '', sup_name: sup ? '' : F.sup.trim(), rcv_date: F.date, invoice_no: F.inv, note: F.note,
          items: F.lines.map(function (l) { return { mat_id: l.mat_id, unit_id: l.unit_id, qty: Number(l.qty), unit_price: Number(l.price) }; }) });
        U.toast('บันทึกรับเข้า ' + r.rcv_no + ' แล้ว รวม ' + U.money(r.total) + ' บาท', 'ok', 5000);
        S.forms.receive = null;
        await App.refreshCatalog();
        App.render();
      } catch (er) { btn.classList.remove('busy'); U.toast(er.message, 'err', 6000); }
    };
    try {
      const rc = await API.call('receipts', { limit: 10 });
      U.$('#recent').innerHTML = rc.length ? '<div class="tablewrap"><table class="t"><thead><tr><th>เลขที่</th><th>วันที่</th><th>ผู้จำหน่าย</th><th>ใบส่งของ</th><th>รายการ</th><th class="num">รวม (บาท)</th></tr></thead><tbody>' +
        rc.map(function (r) { return '<tr><td>' + U.esc(r.rcv_no) + '</td><td>' + U.thShort(r.rcv_date + 'T00:00:00') + '</td><td>' + U.esc(r.sup_name || '-') + '</td><td>' + U.esc(r.invoice_no) + '</td><td>' +
          r.items.map(function (i) { return U.esc(i.name) + ' ' + U.n(i.qty) + ' ' + U.esc(i.unit); }).join('<br>') + '</td><td class="num">' + U.money(r.total) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="muted">ยังไม่มีการรับเข้า</p>';
    } catch (e) { U.$('#recent').innerHTML = App.errorBox(e); }
  }
});

/* ---------------------------------------------------------------- ตรวจนับ / ปรับยอด */
App.view('count', {
  title: 'ตรวจนับ', roles: ['OFFICER'],
  render: async function (el) {
    const S = App.S;
    await Officer.needCatalog();
    const F = S.forms.count = S.forms.count || { q: '', cat: '', counted: {}, reason: '' };
    el.innerHTML = '<div class="page-h"><h1>ตรวจนับ / ปรับยอด</h1><p>กรอกเฉพาะรายการที่นับได้ไม่ตรงกับระบบ — ช่องว่าง = ตรงกับระบบ · นับได้ต้องไม่น้อยกว่ายอดจองค้าง</p></div>' +
      '<div class="row" style="margin-bottom:12px"><div class="search" style="flex:1;min-width:240px;margin:0">' + ICON('search') + '<input id="q" type="search" placeholder="ค้นหาวัสดุ" value="' + U.esc(F.q) + '"></div>' +
      '<select class="input" id="cat" style="width:auto"><option value="">ทุกหมวด</option>' + (S.catalog.categories || []).map(function (c) { return '<option value="' + U.esc(c.cat_id) + '"' + (F.cat === c.cat_id ? ' selected' : '') + '>' + U.esc(c.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="tablewrap"><table class="t"><thead><tr><th>รหัส</th><th>วัสดุ</th><th>หน่วย</th><th class="num">ยอดระบบ</th><th class="num">จอง</th><th class="num">นับได้</th><th class="num">ส่วนต่าง</th></tr></thead><tbody id="tb"></tbody></table></div>' +
      '<div class="card" style="margin-top:16px"><label class="field"><span>เหตุผล / เลขที่บันทึกการตรวจนับ *</span><input class="input" id="rs" value="' + U.esc(F.reason) + '"></label>' +
      '<div class="row"><span id="cnt" class="muted"></span><span class="spacer"></span><button class="btn ghost" id="clr">ล้างค่าที่กรอก</button><button class="btn primary lg" id="save">บันทึกปรับยอด</button></div></div>';
    const changed = function () {
      return Object.keys(F.counted).filter(function (id) { const m = S.idx[id]; return m && F.counted[id] !== '' && Number(F.counted[id]) !== m.balance; });
    };
    const draw = function () {
      let rows = S.catalog.materials.filter(function (m) { return m.active !== false || m.balance > 0; });
      if (F.q) rows = rows.filter(function (m) { return U.match(m._s, F.q); });
      if (F.cat) rows = rows.filter(function (m) { return m.cat_id === F.cat; });
      U.$('#tb').innerHTML = rows.map(function (m) {
        const v = F.counted[m.mat_id];
        const d = v === undefined || v === '' ? '' : Number(v) - m.balance;
        return '<tr data-id="' + U.esc(m.mat_id) + '"><td>' + U.esc(m.code) + '</td><td>' + U.esc(m.name) + '</td><td>' + U.esc(m.unit_name) + '</td><td class="num">' + U.n(m.balance) + '</td><td class="num">' + U.n(m.reserved) + '</td>' +
          '<td class="num"><input class="input num" type="number" min="0" value="' + (v === undefined ? '' : U.esc(v)) + '" placeholder="ตรง"></td>' +
          '<td class="num" style="font-weight:700;color:' + (d === '' || d === 0 ? 'inherit' : d > 0 ? 'var(--ok)' : 'var(--out)') + '">' + (d === '' ? '' : (d > 0 ? '+' : '') + U.n(d)) + '</td></tr>';
      }).join('');
      U.$('#cnt').textContent = 'ปรับยอด ' + changed().length + ' รายการ';
    };
    draw();
    U.$('#q').oninput = function () { F.q = this.value; draw(); };
    U.$('#cat').onchange = function () { F.cat = this.value; draw(); };
    U.$('#rs').oninput = function () { F.reason = this.value; };
    U.$('#tb').addEventListener('input', function (e) {
      const tr = e.target.closest('tr[data-id]'); if (!tr) return;
      const m = S.idx[tr.dataset.id];
      F.counted[m.mat_id] = e.target.value;
      const td = tr.lastElementChild;
      const d = e.target.value === '' ? '' : Number(e.target.value) - m.balance;
      td.textContent = d === '' ? '' : (d > 0 ? '+' : '') + U.n(d);
      td.style.color = d === '' || d === 0 ? 'inherit' : d > 0 ? 'var(--ok)' : 'var(--out)';
      U.$('#cnt').textContent = 'ปรับยอด ' + changed().length + ' รายการ';
    });
    U.$('#clr').onclick = function () { F.counted = {}; draw(); };
    U.$('#save').onclick = async function () {
      const ids = changed();
      if (!ids.length) { U.toast('ยังไม่มีรายการที่นับได้ไม่ตรง', 'warn'); return; }
      if (!F.reason.trim()) { U.toast('กรุณาระบุเหตุผลหรือเลขที่บันทึกการตรวจนับ', 'err'); return; }
      const html = '<ul>' + ids.map(function (id) { const m = S.idx[id]; const d = Number(F.counted[id]) - m.balance; return '<li>' + U.esc(m.name) + ': ' + U.n(m.balance) + ' → ' + U.n(F.counted[id]) + ' (' + (d > 0 ? '+' : '') + d + ')</li>'; }).join('') + '</ul>';
      if (!(await U.confirm('ยืนยันปรับยอด ' + ids.length + ' รายการ', html, 'บันทึกปรับยอด'))) return;
      try {
        const r = await API.write('adjust', { reason: F.reason, items: ids.map(function (id) { return { mat_id: id, qty_counted: Number(F.counted[id]) }; }) });
        U.toast('บันทึกปรับยอด ' + r.adj_no + ' แล้ว', 'ok');
        S.forms.count = null;
        await App.refreshCatalog();
        App.render();
      } catch (er) {
        const extra = er.details && er.details.items ? ': ' + er.details.items.map(function (x) { return (x.name || '') + ' ' + x.message; }).join(' · ') : '';
        U.toast(er.message + extra, 'err', 8000);
      }
    };
  }
});

/* ---------------------------------------------------------------- จุดสั่งซื้อ */
App.view('reorder', {
  title: 'จุดสั่งซื้อ', roles: OA,
  render: async function (el) {
    el.innerHTML = '<div class="page-h row"><div><h1>วัสดุถึงจุดสั่งซื้อ</h1><p>พร้อมเบิก ≤ จุดสั่งซื้อ · จำนวนแนะนำคิดจากอัตราเบิกเฉลี่ย 90 วัน (หน่วยหลัก)</p></div><span class="spacer"></span><button class="btn" id="xl">' + ICON('download') + 'Excel</button></div>' +
      '<div class="notice info"><div>การสร้างใบสั่งซื้อจากรายการนี้อยู่ในเฟส 2 — ตอนนี้ใช้รายการนี้ประกอบการจัดซื้อ แล้วบันทึก "รับเข้า" เมื่อของมาถึง</div></div><div id="t"><div class="skel"></div></div>';
    const rows = await API.call('reorderList');
    U.$('#t').innerHTML = rows.length ? '<div class="tablewrap"><table class="t"><thead><tr><th>รหัส</th><th>วัสดุ</th><th class="num">คงเหลือ</th><th class="num">จอง</th><th class="num">พร้อมเบิก</th><th class="num">จุดสั่งซื้อ</th><th class="num">พอใช้ (วัน)</th><th class="num">แนะนำสั่ง</th><th class="num">ราคาล่าสุด</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + U.esc(r.code) + '</td><td>' + U.esc(r.name) + '</td><td class="num">' + U.n(r.balance) + '</td><td class="num">' + U.n(r.reserved) + '</td><td class="num"><b>' + U.n(r.available) + '</b></td><td class="num">' + U.n(r.reorder_point) + '</td>' +
        '<td class="num">' + (r.days_cover === null ? '—' : U.n(r.days_cover)) + '</td><td class="num"><b>' + U.n(r.suggest) + '</b> ' + U.esc(r.unit_name) + '</td><td class="num">' + U.money(r.last_cost) + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="empty">' + ICON('check') + '<p>ไม่มีวัสดุถึงจุดสั่งซื้อ</p></div>';
    U.$('#xl').onclick = function () {
      U.exportXlsx('วัสดุถึงจุดสั่งซื้อ ' + U.ymd(), [{ name: 'ถึงจุดสั่งซื้อ', head: ['รหัส', 'วัสดุ', 'หน่วย', 'คงเหลือ', 'จอง', 'พร้อมเบิก', 'จุดสั่งซื้อ', 'พอใช้ (วัน)', 'แนะนำสั่ง', 'ราคาล่าสุด'],
        rows: rows.map(function (r) { return [r.code, r.name, r.unit_name, r.balance, r.reserved, r.available, r.reorder_point, r.days_cover === null ? '' : r.days_cover, r.suggest, r.last_cost]; }) }]);
    };
  }
});

/* ---------------------------------------------------------------- ผู้จำหน่าย */
App.view('suppliers', {
  title: 'ผู้จำหน่าย', roles: OA,
  render: async function (el) {
    const ms = await API.call('masters');
    const rows = ms.suppliers || [];
    const ro = !Officer.isOfficer();
    el.innerHTML = '<div class="page-h row"><div><h1>ผู้จำหน่าย</h1><p>ร้านที่ปิดใช้งานยังเก็บประวัติไว้</p></div><span class="spacer"></span>' + (ro ? '' : '<button class="btn primary" id="add">' + ICON('plus') + 'เพิ่มร้าน</button>') + '</div>' +
      '<div class="tablewrap"><table class="t"><thead><tr><th>ชื่อร้าน</th><th>โทร</th><th>เลขผู้เสียภาษี</th><th>ผู้ติดต่อ</th><th>สถานะ</th></tr></thead><tbody id="tb">' +
      rows.map(function (s) { return '<tr class="click" data-id="' + U.esc(s.sup_id) + '"><td><b>' + U.esc(s.name) + '</b><br><small class="muted">' + U.esc(s.address) + '</small></td><td>' + U.esc(s.phone) + '</td><td>' + U.esc(s.tax_id) + '</td><td>' + U.esc(s.contact) + '</td><td>' + (s.active ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge gray">ปิดใช้งาน</span>') + '</td></tr>'; }).join('') +
      '</tbody></table></div>' + (rows.length ? '' : '<p class="muted">ยังไม่มีผู้จำหน่าย — เพิ่มได้ที่นี่หรือพิมพ์ชื่อร้านใหม่ตอนรับเข้า</p>');
    const edit = async function (s) {
      if (ro) return;
      s = s || { name: '', address: '', phone: '', tax_id: '', contact: '', active: true };
      const v = await U.modal({ title: s.sup_id ? 'แก้ไขผู้จำหน่าย' : 'เพิ่มผู้จำหน่าย', ok: 'บันทึก',
        html: '<label class="field"><span>ชื่อร้าน *</span><input class="input" name="name" required value="' + U.esc(s.name) + '"></label><label class="field"><span>ที่อยู่</span><textarea class="input" name="address">' + U.esc(s.address) + '</textarea></label>' +
          '<div class="grid2"><label class="field"><span>โทร</span><input class="input" name="phone" value="' + U.esc(s.phone) + '"></label><label class="field"><span>เลขประจำตัวผู้เสียภาษี (13 หลัก)</span><input class="input" name="tax_id" inputmode="numeric" value="' + U.esc(s.tax_id) + '"></label></div>' +
          '<label class="field"><span>ผู้ติดต่อ</span><input class="input" name="contact" value="' + U.esc(s.contact) + '"></label><label class="row"><input type="checkbox" name="active"' + (s.active ? ' checked' : '') + '> ใช้งาน</label>' });
      if (!v) return;
      try { await API.write('saveSupplier', Object.assign({ sup_id: s.sup_id }, v)); U.toast('บันทึกแล้ว', 'ok'); App.render(); } catch (er) { U.toast(er.message, 'err'); }
    };
    const add = U.$('#add'); if (add) add.onclick = function () { edit(null); };
    U.$('#tb').onclick = function (e) { const tr = e.target.closest('tr[data-id]'); if (tr) edit(rows.find(function (s) { return s.sup_id === tr.dataset.id; })); };
  }
});

/* ---------------------------------------------------------------- ยอดยกมา (นำเข้า Excel ครั้งเดียว) */
const OPEN_COLS = ['รหัส', 'ชื่อวัสดุ', 'หมวด', 'หน่วยนับ', 'จำนวน', 'ต้นทุนต่อหน่วย', 'จุดสั่งซื้อ', 'จำนวนสั่งซื้อ', 'จำกัดต่อครั้ง', 'รายละเอียด'];
const OPEN_KEYS = ['code', 'name', 'category', 'unit', 'qty', 'unit_cost', 'reorder_point', 'reorder_qty', 'max_per_request', 'spec'];
App.view('opening', {
  title: 'ยอดยกมา', roles: OA,
  render: async function (el) {
    const S = App.S;
    await Officer.needCatalog();
    const F = S.forms.opening = S.forms.opening || { rows: [], done: {}, source: '' };
    el.innerHTML = '<div class="page-h"><h1>นำเข้ายอดยกมา</h1><p>นำเข้าบัญชีวัสดุเดิมครั้งเดียว พร้อมจำนวนและต้นทุนต่อหน่วยที่ตรวจรับรองแล้ว — วัสดุที่มีความเคลื่อนไหวในระบบแล้วนำเข้าซ้ำไม่ได้</p></div>' +
      (S.cfg.cost_method ? '<div class="notice info"><div>วิธีคิดมูลค่า: <b>' + (S.cfg.cost_method === 'FIFO' ? 'เข้าก่อนออกก่อน (FIFO)' : 'ถัวเฉลี่ยถ่วงน้ำหนัก (AVG)') + '</b> — ล็อกหลังมีรายการแรก</div></div>'
        : '<div class="notice warn"><div><b>ยังไม่ได้เลือกวิธีคิดมูลค่าวัสดุ</b>ผู้ดูแลระบบต้องเลือกที่ "ตั้งค่าระบบ" ก่อนนำเข้า</div></div>') +
      '<div class="card"><h3>1. เตรียมไฟล์</h3><p class="small muted">คอลัมน์: ' + OPEN_COLS.join(' · ') + ' (แถวแรกเป็นหัวคอลัมน์) · หน่วยนับต้องตรงกับหน่วยมาตรฐานหรือคำเรียกอื่น</p>' +
      '<p>รองรับไฟล์ <b>.xlsx, .xls และ .csv</b> (อ่านชีตแรก แถวแรกเป็นชื่อคอลัมน์ตามแม่แบบ) หรือวางข้อความที่คัดลอกจาก Excel — ไฟล์ .csv ภาษาไทยใช้ได้ทั้งแบบ UTF-8 และแบบที่ Excel ภาษาไทยบันทึก</p>' +
      '<p class="small muted">วัสดุเดียวกันมียอดหลายราคา (เช่น FIFO เหลือหลายล็อต) ให้กรอกหลายแถวด้วยรหัสหรือชื่อเดียวกัน ระบบบันทึกเป็นหลายล็อต · วัสดุที่มีในทะเบียนแล้วแต่ยังไม่เคยรับ-จ่าย ใส่รหัสเดิม (เช่น MAT-001) ระบบจะปรับชื่อ หน่วย และรายละเอียดตามแถวที่นำเข้า</p>' +
      '<div class="tablewrap"><table class="t"><thead><tr><th>คอลัมน์</th><th>ข้อมูลที่กรอก</th></tr></thead><tbody>' +
      '<tr><td>รหัส</td><td>รหัสเดิมของวัสดุ ถ้ามีให้ใช้รหัสเดิม เช่น MAT-001; ว่างได้สำหรับวัสดุใหม่</td></tr>' +
      '<tr><td>ชื่อวัสดุ</td><td>ชื่อวัสดุ (ต้องกรอก)</td></tr>' +
      '<tr><td>หมวด</td><td>ชื่อหมวด เช่น วัสดุสำนักงาน; ว่างได้</td></tr>' +
      '<tr><td>หน่วยนับ</td><td>หน่วยมาตรฐาน เช่น รีม แผ่น อัน ด้าม (ต้องกรอก)</td></tr>' +
      '<tr><td>จำนวน</td><td>ยอดคงเหลือเดิม จำนวนเต็มตั้งแต่ 0; ว่าง = 0</td></tr>' +
      '<tr><td>ต้นทุนต่อหน่วย</td><td>ต้นทุนเดิมต่อหน่วย บาท ตั้งแต่ 0; ว่าง = 0</td></tr>' +
      '<tr><td>จุดสั่งซื้อ</td><td>จุดแจ้งเตือนสั่งซื้อ จำนวนเต็มตั้งแต่ 0; ว่าง = 0</td></tr>' +
      '<tr><td>จำนวนสั่งซื้อ</td><td>จำนวนแนะนำสั่งซื้อ จำนวนเต็มตั้งแต่ 0; ว่าง = 0</td></tr>' +
      '<tr><td>จำกัดต่อครั้ง</td><td>จำนวนเบิกสูงสุดต่อครั้ง จำนวนเต็ม; ว่างหรือ 0 = ไม่จำกัด</td></tr>' +
      '<tr><td>รายละเอียด</td><td>รายละเอียดเพิ่มเติม ว่างได้</td></tr>' +
      '</tbody></table></div>' +
      '<div class="template-downloads"><a class="btn primary" href="assets/templates/opening-original.xlsx" download="แม่แบบยอดยกมา-ต้นฉบับ.xlsx">' + ICON('download') + 'ไฟล์ต้นฉบับ Excel (.xlsx)</a><a class="btn" href="assets/templates/opening-original.csv" download="แม่แบบยอดยกมา-ต้นฉบับ.csv">' + ICON('download') + 'ไฟล์ต้นฉบับ CSV (.csv)</a><button class="btn" id="tpl">' + ICON('download') + 'แม่แบบพร้อมแถวตัวอย่าง</button></div><p class="small muted">เก็บไฟล์ต้นฉบับไว้ แล้วทำสำเนาสำหรับกรอกข้อมูล · ไฟล์ต้นฉบับมีหัวตาราง 10 ช่อง ไม่มีข้อมูลตัวอย่างปะปน · ไฟล์แม่แบบพร้อมตัวอย่างต้องลบแถวตัวอย่างก่อนนำเข้า · ระบบยังรับ .xls เดิมได้</p><h4>ตัวอย่างรูปแบบตาราง</h4><div class="tablewrap"><table class="t opening-example"><thead><tr>' + OPEN_COLS.map(function(c){return '<th>' + c + '</th>';}).join('') + '</tr></thead><tbody><tr><td>MAT-001</td><td>กระดาษ A4 80 แกรม</td><td>วัสดุสำนักงาน</td><td>รีม</td><td>10</td><td>110.00</td><td>5</td><td>20</td><td>5</td><td>ตัวอย่างการกรอก ไม่ใช่ยอดจริง</td></tr></tbody></table></div></div>' +
      '<div class="card"><h3>2. เลือกไฟล์และตรวจ</h3><p class="small muted">เลือกไฟล์ วางข้อความ หรือเพิ่มทีละรายการ — ทุกทางรวมเข้ารายการตรวจเดียวกัน</p><input type="file" id="file" accept=".xlsx,.xls,.csv" class="input"><div id="pv" style="margin-top:12px"></div></div>' +
      '<div class="card"><h3>หรือวางข้อความ</h3><p class="small muted">วางข้อมูลพร้อมหัวคอลัมน์ตามแม่แบบ คั่นแต่ละช่องด้วย Tab และขึ้นบรรทัดใหม่แต่ละรายการ ตรวจตัวอย่างก่อนนำเข้า ข้อมูลจะรวมกับรายการที่เตรียมไว้</p><textarea class="input" id="opening-text" rows="5" aria-label="ข้อความยอดยกมา"></textarea><button class="btn" id="opening-text-add">ตรวจและเพิ่มข้อความ</button></div>' +
      '<div class="card"><h3>หรือเพิ่มทีละรายการ</h3><form id="opening-single"><div class="grid2">' + OPEN_COLS.map(function (c, i) { return '<label class="field"><span>' + c + (i === 1 || i === 3 ? ' *' : '') + '</span><input class="input" name="' + OPEN_KEYS[i] + '"' + (i >= 4 && i <= 8 ? ' type="number" min="0" step="' + (i === 5 ? 'any' : '1') + '"' : '') + (i === 1 || i === 3 ? ' required' : '') + '></label>'; }).join('') + '</div><button class="btn primary">เพิ่มเข้ารายการตรวจ</button></form></div>' +
      '<div class="card"><h3>3. ยืนยันนำเข้า</h3><label class="field"><span>แหล่งข้อมูลและผู้รับรองยอด *</span><input class="input" id="src" value="' + U.esc(F.source) + '" placeholder="เช่น บัญชีวัสดุ ณ 30 ก.ย. 2569 รับรองโดย ..."></label>' +
      '<button class="btn primary lg" id="go"' + (S.cfg.cost_method ? '' : ' disabled') + '>' + ICON('upload') + 'นำเข้ายอดยกมา</button><div id="res" style="margin-top:12px"></div></div>';
    const unitOk = function (t) { return !!Officer.unitFromText(t); };
    const draw = function () {
      if (!F.rows.length) { U.$('#pv').innerHTML = ''; return; }
      recheck();
      const bad = F.rows.filter(function (r) { return r._err && !F.done[r.line]; }).length;
      const mats = new Set(F.rows.map(function (r) { return r._g || ('x' + r.line); })).size;
      U.$('#pv').innerHTML = '<p>' + F.rows.length + ' แถว (' + mats + ' รายการวัสดุ) · ' + (bad ? '<b style="color:var(--out)">มีปัญหา ' + bad + ' แถว</b>' : 'ตรวจเบื้องต้นผ่าน') + ' · นำเข้าแล้ว ' + Object.keys(F.done).length + ' แถว' +
        ' <button class="btn sm ghost" id="opening-clear">ล้างรายการตรวจ</button></p>' +
        '<div class="tablewrap" style="max-height:420px"><table class="t"><thead><tr><th>แถว</th>' + OPEN_COLS.slice(0, 6).map(function (c) { return '<th>' + c + '</th>'; }).join('') + '<th>ตรวจ</th><th></th></tr></thead><tbody>' +
        F.rows.map(function (r) { return '<tr><td>' + r.line + '</td><td>' + U.esc(r.code) + '</td><td>' + U.esc(r.name) + '</td><td>' + U.esc(r.category) + '</td><td>' + U.esc(r.unit) + '</td><td class="num">' + U.esc(r.qty) + '</td><td class="num">' + U.esc(r.unit_cost) + '</td>' +
          '<td>' + (F.done[r.line] ? '<span class="badge ok">นำเข้าแล้ว</span>' : r._err ? '<span style="color:var(--out)">' + U.esc(r._err) + '</span>' : '<span class="badge gray nodot">พร้อม</span>' + (r._note ? ' <span class="small muted">' + U.esc(r._note) + '</span>' : '')) + '</td>' +
          '<td>' + (F.done[r.line] ? '' : '<button class="btn sm ghost" data-del="' + r.line + '" aria-label="ลบแถว ' + r.line + '">ลบ</button>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      U.$('#pv tbody').onclick = function (e) {
        const b = e.target.closest('[data-del]'); if (!b) return;
        const line = Number(b.dataset.del);
        F.rows = F.rows.filter(function (r) { return r.line !== line; });
        draw();
      };
      U.$('#opening-clear').onclick = async function () {
        if (!(await U.confirm('ล้างรายการตรวจ', 'ลบรายการที่เตรียมไว้ทั้งหมด ' + F.rows.length + ' แถว (ยอดที่นำเข้าแล้วไม่ถูกลบ)', 'ล้างรายการ', true))) return;
        F.rows = []; F.done = {}; U.$('#file').value = ''; draw();
      };
    };
    draw();
    U.$('#src').oninput = function () { F.source = this.value; };
    U.$('#tpl').onclick = function () {
      U.exportXlsx('แม่แบบยอดยกมา', [{ name: 'ยอดยกมา', head: OPEN_COLS, rows: [['', 'ตัวอย่าง: กระดาษ A4 80 แกรม', 'วัสดุสำนักงาน', 'รีม', 10, 110, 5, 20, 5, 'ข้อมูลสมมติ — ลบแถวนี้ก่อนนำเข้า']] }]);
    };
    function validateOpening(o) {
        if (!o.name) return null;
        o._err = '';
        if (!unitOk(o.unit)) o._err = 'ไม่รู้จักหน่วย "' + o.unit + '"';
        else if (o.qty !== '' && !(Number(o.qty) >= 0 && Math.floor(Number(o.qty)) === Number(o.qty))) o._err = 'จำนวนไม่ถูกต้อง';
        else if (o.unit_cost !== '' && !(Number.isFinite(Number(o.unit_cost)) && Number(o.unit_cost) >= 0)) o._err = 'ต้นทุนไม่ถูกต้อง';
        else if (S.catalog.materials.some(function (m) { return (o.code ? m.code === o.code : m.name === o.name) && (m.balance || 0) > 0; })) o._err = 'มียอดในระบบแล้ว';
      return o;
    }
    /** แถวรหัสเดียวกัน หรือชื่อเดียวกัน (ไม่ระบุรหัส) = วัสดุเดียวกัน หลายล็อต — ตรงกับการตรวจฝั่งเซิร์ฟเวอร์ */
    function recheck() {
      const byCode = {}, byName = {};
      const nk = function (x) { return String(x).replace(/\s+/g, ' ').trim(); };
      F.rows.forEach(function (r) {
        r._note = ''; r._g = '';
        if (F.done[r.line]) return;
        validateOpening(r);
        if (!r._err && r._srv) r._err = r._srv;
        if (r._err) return;
        const n = nk(r.name);
        let g = r.code ? byCode[r.code] : byName[n];
        if (!g && r.code && byName[n] && byName[n].code !== r.code) { r._err = 'ชื่อซ้ำกับแถว ' + byName[n].line + ' ที่ใช้รหัสอื่น'; return; }
        if (g) {
          if (r.code && nk(g.name) !== n) { r._err = 'รหัสซ้ำกับแถว ' + g.line + ' แต่ชื่อต่างกัน'; return; }
          if (Officer.unitFromText(g.unit) !== Officer.unitFromText(r.unit)) { r._err = 'หน่วยนับไม่ตรงกับแถว ' + g.line; return; }
          g.n++; r._g = g.key; r._note = 'ล็อตที่ ' + g.n + ' ของวัสดุในแถว ' + g.line;
          return;
        }
        g = { key: 'g' + r.line, line: r.line, code: r.code, name: r.name, unit: r.unit, n: 1 };
        if (r.code) byCode[r.code] = g;
        byName[n] = g;
        r._g = g.key;
      });
    }
    function nextLine() { return F.rows.reduce(function (mx, r) { return Math.max(mx, r.line); }, 1); }
    /** อ่านไฟล์ — .csv ถอดรหัสเอง (UTF-8 มี/ไม่มี BOM, UTF-16, Windows-874 ของ Excel ภาษาไทย) */
    async function readBook(file) {
      const buf = await file.arrayBuffer();
      if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') return XLSX.read(buf);
      const u8 = new Uint8Array(buf);
      let text;
      if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) text = new TextDecoder('utf-8').decode(u8.subarray(3));
      else if (u8[0] === 0xFF && u8[1] === 0xFE) text = new TextDecoder('utf-16le').decode(u8.subarray(2));
      else if (u8[0] === 0xFE && u8[1] === 0xFF) text = new TextDecoder('utf-16be').decode(u8.subarray(2));
      else {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(u8); }
        catch (e) { text = new TextDecoder('windows-874').decode(u8); }
      }
      return XLSX.read(text, { type: 'string', raw: true });
    }
    function parseOpeningRows(aoa, append) {
      const head = (aoa[0] || []).map(function (h) { return String(h).trim(); });
      const idx = OPEN_COLS.map(function (c) { return head.indexOf(c); });
      if (idx[1] < 0 || idx[3] < 0) throw new Error('ต้องมีหัวคอลัมน์ชื่อวัสดุและหน่วยนับ');
      let next = append ? nextLine() : 1;
      return aoa.slice(1).map(function(r) {
        const o = { line: ++next };
        OPEN_KEYS.forEach(function(k,j) { o[k] = idx[j] >= 0 ? String(r[idx[j]] === undefined ? '' : r[idx[j]]).trim() : ''; });
        return validateOpening(o);
      }).filter(Boolean);
    }
    U.$('#opening-text-add').onclick = function() {
      try {
        const value = U.$('#opening-text').value.trim();
        if (!value) throw new Error('กรุณาวางข้อความก่อน');
        const rows = parseOpeningRows(value.split(/\r?\n/).map(function(line) { return line.split('\t'); }), true);
        if (!rows.length) throw new Error('ไม่พบรายการวัสดุ');
        F.rows = F.rows.concat(rows); draw(); U.$('#opening-text').value = '';
        U.toast('เพิ่ม ' + rows.length + ' แถวในรายการตรวจแล้ว', 'ok');
      } catch (e) { U.toast(e.message, 'err', 6000); }
    };
    U.$('#opening-single').onsubmit = function(e) {
      e.preventDefault();
      const o = { line: nextLine() + 1 };
      const data = new FormData(this);
      OPEN_KEYS.forEach(function(k) { o[k] = String(data.get(k) || '').trim(); });
      const row = validateOpening(o);
      if (!row || row._err) { U.toast(row && row._err || 'กรุณากรอกชื่อวัสดุ', 'err', 6000); return; }
      F.rows.push(row); draw();
      if (row._err) { U.toast(row._err, 'err', 6000); F.rows.pop(); draw(); return; }
      this.reset(); U.toast('เพิ่มในรายการตรวจแล้ว ยังไม่ได้บันทึกยอดยกมา' + (row._note ? ' (' + row._note + ')' : ''), 'ok');
    };
    U.$('#file').onchange = async function () {
      const file = this.files[0]; if (!file) return;
      try {
        await U.loadScript('assets/vendor/xlsx.full.min.js');
        const wb = await readBook(file);
        const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
        const head = (aoa[0] || []).map(function (h) { return String(h).replace(/^\uFEFF/, '').trim(); });
        aoa[0] = head;
        const idx = OPEN_COLS.map(function (c) { return head.indexOf(c); });
        if (idx[1] < 0 || idx[3] < 0) { U.toast('ไม่พบคอลัมน์ "ชื่อวัสดุ" หรือ "หน่วยนับ" ในแถวแรก — ใช้แม่แบบ หรือบันทึกเป็น .xlsx แล้วลองใหม่', 'err', 7000); return; }
        const rows = parseOpeningRows(aoa, F.rows.length > 0);
        if (!rows.length) { U.toast('ไม่พบรายการวัสดุในไฟล์', 'err'); return; }
        F.rows = F.rows.concat(rows);
        draw();
        U.toast('เพิ่มจากไฟล์ ' + rows.length + ' แถว' + (F.rows.length > rows.length ? ' (รวมกับรายการเดิม)' : ''), 'ok');
      } catch (er) { U.toast('อ่านไฟล์ไม่ได้: ' + er.message, 'err', 7000); }
      finally { this.value = ''; }
    };
    U.$('#go').onclick = async function () {
      recheck();
      const todo = F.rows.filter(function (r) { return !r._err && !F.done[r.line]; });
      if (!todo.length) { U.toast('ไม่มีแถวที่พร้อมนำเข้า', 'warn'); return; }
      const nBad = F.rows.filter(function (r) { return r._err && !F.done[r.line]; }).length;
      if (nBad && !(await U.confirm('มีแถวที่มีปัญหา', 'มี ' + nBad + ' แถวที่มีปัญหา จะนำเข้าเฉพาะ ' + todo.length + ' แถวที่พร้อม — แถวที่มีปัญหาแก้แล้วนำเข้าภายหลังได้', 'นำเข้าเฉพาะแถวที่พร้อม'))) return;
      /* แบ่งชุดละไม่เกิน 80 แถว โดยไม่แยกล็อตของวัสดุเดียวกันออกจากกัน */
      const groups = [];
      const gi = {};
      todo.forEach(function (r) { const k = r._g || ('x' + r.line); if (!(k in gi)) { gi[k] = groups.length; groups.push([]); } groups[gi[k]].push(r); });
      const batches = [];
      groups.forEach(function (g) {
        const cur = batches[batches.length - 1];
        if (cur && cur.length + g.length <= 80) cur.push.apply(cur, g); else batches.push(g.slice());
      });
      if (!F.source.trim()) { U.toast('กรุณาระบุแหล่งข้อมูลและผู้รับรองยอด', 'err'); return; }
      if (!(await U.confirm('ยืนยันนำเข้ายอดยกมา', 'นำเข้า ' + todo.length + ' แถว — บันทึกเป็นยอดยกมา (OPEN) ลงบัญชีวัสดุ', 'นำเข้า'))) return;
      const btn = this; btn.classList.add('busy');
      const out = [];
      let sent = 0;
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        sent += batch.length;
        U.$('#res').innerHTML = '<p>กำลังนำเข้า ' + sent + '/' + todo.length + ' …</p>';
        try {
          const r = await API.write('importOpenings', { source: F.source, rows: batch.map(function (x) { const o = Object.assign({}, x); delete o._err; delete o._note; delete o._g; return o; }) });
          batch.forEach(function (x) { F.done[x.line] = r.batch_no; });
          out.push(r.batch_no + ': สร้างวัสดุใหม่ ' + r.created + (r.updated ? ' · ปรับรายการเดิม ' + r.updated : '') + ' · ลงยอดยกมา ' + r.opened + ' ล็อต');
        } catch (er) {
          if (er.details && er.details.items) {
            er.details.items.forEach(function (x) { const row = F.rows.find(function (y) { return y.line === x.line; }); if (row) row._srv = x.message; });
            out.push('หยุดที่ชุด ' + (i + 1) + ': ' + er.message + ' — ' + er.details.items.slice(0, 5).map(function (x) { return 'แถว ' + x.line + ' ' + x.message; }).join(' · '));
          } else out.push('หยุดที่ชุด ' + (i + 1) + ': ' + er.message);
          break;
        }
      }
      btn.classList.remove('busy');
      U.$('#res').innerHTML = '<div class="notice info"><div>' + out.map(U.esc).join('<br>') + '</div></div>';
      draw();
      App.refreshCatalog().catch(function () {});
    };
  }
});

/* ---------------------------------------------------------------- กระทบยอด / ตรวจซ่อม */
App.view('reconcile', {
  title: 'กระทบยอด', roles: OA,
  render: async function (el) {
    const admin = App.S.user.role === 'ADMIN';
    el.innerHTML = '<div class="page-h row"><div><h1>กระทบยอด' + (admin ? ' / ตรวจซ่อม' : '') + '</h1><p>ledger คือความจริง — ตรวจยอดคงเหลือ ยอดจอง มูลค่า ล็อต และรายการซ้ำ</p></div><span class="spacer"></span><button class="btn" id="rf">' + ICON('refresh') + 'ตรวจอีกครั้ง</button></div><div id="rep"><div class="skel"></div></div>' +
      (admin ? '<div class="card"><h3>รายการที่บันทึกไม่ครบ (รอตรวจซ่อม)</h3><div id="rp"><div class="skel"></div></div></div>' : '');
    const load = async function () {
      const r = await API.call('reconcile');
      U.$('#rep').innerHTML = (r.ok ? '<div class="notice ok"><div><b>ข้อมูลตรงกันทั้งหมด</b>ตรวจ ' + U.n(r.materials) + ' วัสดุ · ledger ' + U.n(r.ledger_rows) + ' แถว · ' + U.thDateTime(r.checked_at) + '</div></div>'
        : '<div class="notice warn"><div><b>พบรายการต้องตรวจ</b>ค่าสำเนาไม่ตรง ' + r.diffs.length + ' · ledger ซ้ำ ' + r.duplicates.length + ' · รอตรวจซ่อม ' + r.repairs.length + '</div></div>') +
        (r.diffs.length ? '<div class="tablewrap"><table class="t"><thead><tr><th>วัสดุ</th><th class="num">คงเหลือ (สำเนา/ledger)</th><th class="num">จอง (สำเนา/คำขอค้าง)</th><th>ปัญหา</th></tr></thead><tbody>' +
          r.diffs.map(function (d) { return '<tr><td>' + U.esc(d.code + ' ' + d.name) + '</td><td class="num">' + U.n(d.balance) + ' / ' + U.n(d.ledger_balance) + '</td><td class="num">' + U.n(d.reserved) + ' / ' + U.n(d.open_reserved) + '</td><td>' + U.esc(d.issues.join(', ')) + '</td></tr>'; }).join('') +
          '</tbody></table></div><div class="row end" style="margin:12px 0"><button class="btn primary" id="fix">แก้ค่าสำเนาให้ตรง ledger</button></div>' : '') +
        (r.duplicates.length ? '<div class="notice err"><div><b>ledger ซ้ำ</b>' + r.duplicates.map(function (x) { return U.esc(x.type + ' ' + x.ref_no + ' (#' + x.ledger_id + ')'); }).join(', ') + ' — ต้องตรวจด้วยมือ</div></div>' : '');
      const fix = U.$('#fix');
      if (fix) fix.onclick = async function () {
        if (!(await U.confirm('แก้ค่าสำเนา', 'ปรับยอดคงเหลือ/ยอดจอง/มูลค่าในตารางวัสดุให้ตรงกับ ledger และคำขอค้าง (ไม่แก้ ledger)', 'แก้ไข'))) return;
        try { const x = await API.write('reconcileFix', {}); U.toast('แก้แล้ว ' + x.fixed + ' รายการ', 'ok'); App.refreshCatalog().catch(function () {}); load(); } catch (er) { U.toast(er.message, 'err', 6000); }
      };
      if (!admin) return;
      const rp = await API.call('repairs');
      U.$('#rp').innerHTML = rp.length ? rp.map(function (x) {
        return '<div class="card flat"><b>' + U.esc(x.action) + '</b> โดย ' + U.esc(x.actor) + ' · ' + U.thDateTime(x.at) + '<br><span class="small muted">' + U.esc(x.note) + '</span><br>' +
          '<span class="small">วัสดุ: ' + U.esc(x.materials.join(', ') || '-') + '</span><br><span class="small muted">แผน: ' + U.esc(x.plan ? x.plan.updates.length + ' แถวแก้ไข, ' + x.plan.appends.join(', ') : 'ไม่มี') + '</span>' +
          '<div class="acts"><button class="btn" data-m="rollback" data-u="' + U.esc(x.uuid) + '">ย้อนรายการนี้</button><button class="btn" data-m="complete" data-u="' + U.esc(x.uuid) + '">ทำต่อให้ครบ</button></div></div>';
      }).join('') : '<p class="muted">ไม่มีรายการรอตรวจซ่อม</p>';
      U.$('#rp').onclick = async function (e) {
        const b = e.target.closest('[data-m]'); if (!b) return;
        const txt = b.dataset.m === 'rollback' ? 'คืนค่าทุกแถวที่รายการนี้แก้ และลบแถวที่รายการนี้เพิ่ม — ผู้ทำรายการส่งใหม่ได้ด้วยรหัสเดิม' : 'เขียนส่วนที่เหลือตามแผนให้ครบ และปิดรายการเป็นสำเร็จ';
        if (!(await U.confirm(b.textContent, txt, 'ยืนยัน', b.dataset.m === 'rollback'))) return;
        try { await API.call('repairOp', { uuid: b.dataset.u, mode: b.dataset.m }); U.toast('ตรวจซ่อมแล้ว', 'ok'); App.refreshMe(); load(); } catch (er) { U.toast(er.message, 'err', 6000); }
      };
    };
    U.$('#rf').onclick = load;
    await load();
  }
});

/* ---------------------------------------------------------------- ประวัติการใช้งาน */
App.view('audit', {
  title: 'ประวัติการใช้งาน', roles: OA,
  render: async function (el) {
    el.innerHTML = '<div class="page-h"><h1>ประวัติการใช้งาน (Audit log)</h1><p>ใคร ทำอะไร เมื่อไร กับเอกสารไหน</p></div><div class="search">' + ICON('search') + '<input id="q" type="search" placeholder="ค้นหาชื่อ การกระทำ เลขเอกสาร"></div><div id="t"><div class="skel"></div></div>';
    const load = async function (q) {
      const rows = await API.call('auditLog', { q: q || '', limit: 300 });
      U.$('#t').innerHTML = '<div class="tablewrap"><table class="t"><thead><tr><th>เวลา</th><th>ผู้ใช้</th><th>การกระทำ</th><th>รายการ</th><th>รายละเอียด</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr><td>' + U.thDateTime(r.ts) + '</td><td>' + U.esc(r.user_name || r.user_code) + '</td><td>' + U.esc(r.action) + '</td><td>' + U.esc(r.entity) + ' ' + U.esc(r.entity_id) + '</td><td class="small">' + U.esc(r.detail).slice(0, 300) + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    };
    U.$('#q').oninput = U.debounce(function () { load(this.value); }, 400);
    await load('');
  }
});
