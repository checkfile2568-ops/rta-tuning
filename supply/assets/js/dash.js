/* ระบบบริหารวัสดุสำนักงาน · dash.js — ประวัติการเบิกของส่วนงาน + สถิติ (เปิดที่ส่วนงานของผู้ล็อกอิน เลือกส่วนงานอื่นได้)
 * มูลค่า (บาท) แสดงเฉพาะเจ้าหน้าที่พัสดุ/Admin — API ตัดฟิลด์มูลค่าออกก่อนส่งให้บทบาทอื่นอยู่แล้ว */
'use strict';
App.view('dash', {
  title: 'ประวัติและสถิติ',
  render: async function (el) {
    const S = App.S;
    const F = S.forms.dash = S.forms.dash || { dept: S.user.dept_id || 'ALL', fy: U.fy(), tab: 'hist', q: '' };
    const fyNow = U.fy();
    el.innerHTML = '<div class="page-h"><h1>ประวัติการเบิกและสถิติ</h1><p>ดูได้ว่าแต่ละส่วนงานเคยเบิกอะไรไปบ้าง · เริ่มที่ส่วนงานของคุณ</p></div>' +
      '<div class="row" style="margin-bottom:14px"><select class="input" id="dp" style="width:auto;min-width:220px"><option value="ALL">ทั้งศาล</option>' +
      S.depts.map(function (d) { return '<option value="' + U.esc(d.dept_id) + '"' + (d.dept_id === F.dept ? ' selected' : '') + '>' + U.esc(d.name) + (d.dept_id === S.user.dept_id ? ' (ส่วนงานของฉัน)' : '') + '</option>'; }).join('') + '</select>' +
      '<select class="input" id="fy" style="width:auto">' + [fyNow, fyNow - 1, fyNow - 2].map(function (y) { return '<option value="' + y + '"' + (y === F.fy ? ' selected' : '') + '>ปีงบประมาณ ' + y + '</option>'; }).join('') + '</select>' +
      '<span class="spacer"></span><div class="seg" id="tab"><button data-t="hist">ประวัติการเบิก</button><button data-t="stat">สรุปสถิติ</button></div></div><div id="body"><div class="skel"></div><div class="skel"></div></div>';
    if (F.dept === 'ALL') U.$('#dp').value = 'ALL';
    let d = null;
    const charts = [];
    const drawHist = function () {
      const rows = d.history.filter(function (h) { return !F.q || U.match(h.name + ' ' + h.req_no + ' ' + h.requester, F.q); });
      const sum = d.summary.filter(function (s) { return !F.q || U.match(s.name, F.q); });
      U.$('#body').innerHTML = '<div class="search">' + ICON('search') + '<input id="hq" type="search" placeholder="ค้นหาชื่อวัสดุ เลขใบ หรือผู้เบิก" value="' + U.esc(F.q) + '"></div>' +
        '<div class="card"><div class="row"><h3 style="margin:0">สรุปต่อวัสดุ · ' + U.esc(d.dept_name) + ' · ปีงบประมาณ ' + d.fy + '</h3><span class="spacer"></span><button class="btn sm" id="xl">' + ICON('download') + 'Excel</button></div>' +
        (sum.length ? '<div class="tablewrap" style="margin-top:10px;max-height:340px"><table class="t"><thead><tr><th>วัสดุ</th><th class="num">รวมที่ได้รับ</th><th class="num">จำนวนครั้ง</th><th>เบิกล่าสุด</th></tr></thead><tbody>' +
          sum.map(function (s) { return '<tr><td>' + U.esc(s.name) + '</td><td class="num"><b>' + U.n(s.qty) + '</b> ' + U.esc(s.unit) + '</td><td class="num">' + U.n(s.times) + '</td><td>' + U.thShort(s.last) + '</td></tr>'; }).join('') + '</tbody></table></div>'
          : '<p class="muted">ยังไม่มีการเบิกในช่วงนี้</p>') + '</div>' +
        '<div class="card"><h3>รายการที่ได้รับ (ล่าสุดก่อน)</h3>' + (rows.length ? '<div class="tablewrap"><table class="t"><thead><tr><th>วันที่</th><th>เลขที่ใบเบิก</th>' + (d.dept_id === 'ALL' ? '<th>ส่วนงาน</th>' : '') + '<th>ผู้เบิก</th><th>วัสดุ</th><th class="num">จำนวนที่ได้รับ</th></tr></thead><tbody>' +
          rows.map(function (h) { return '<tr><td>' + U.thShort(h.ts) + '</td><td>' + U.esc(h.req_no) + '</td>' + (d.dept_id === 'ALL' ? '<td>' + U.esc(h.dept_name) + '</td>' : '') + '<td>' + (h.requester ? U.esc(h.requester) : '<span class="muted">—</span>') + '</td><td>' + U.esc(h.name) + '</td>' +
            '<td class="num">' + U.n(h.qty) + ' ' + U.esc(h.unit) + (h.returned ? ' <small class="muted">(คืน ' + h.returned + ')</small>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>' +
          (d.history_total > d.history.length ? '<p class="small muted">แสดง ' + d.history.length + ' จาก ' + d.history_total + ' รายการ — ส่งออก Excel เพื่อดูทั้งหมด</p>' : '') : '<p class="muted">ไม่มีรายการ</p>') +
        (d.dept_id !== d.my_dept_id && !d.can_value ? '<p class="small muted">ชื่อผู้เบิกแสดงเฉพาะส่วนงานของคุณ</p>' : '') + '</div>';
      U.$('#hq').oninput = U.debounce(function () { F.q = this.value; drawHist(); const i = U.$('#hq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250);
      U.$('#xl').onclick = function () {
        U.exportXlsx('ประวัติการเบิก ' + d.dept_name + ' ปีงบ ' + d.fy, [
          { name: 'สรุปต่อวัสดุ', head: ['วัสดุ', 'รวมที่ได้รับ', 'หน่วย', 'จำนวนครั้ง', 'เบิกล่าสุด'], rows: d.summary.map(function (s) { return [s.name, s.qty, s.unit, s.times, U.thShort(s.last)]; }) },
          { name: 'รายการ', head: ['วันที่', 'เลขที่ใบเบิก', 'ส่วนงาน', 'ผู้เบิก', 'วัสดุ', 'จำนวน', 'หน่วย', 'คืน'], rows: d.history.map(function (h) { return [U.thShort(h.ts), h.req_no, h.dept_name, h.requester, h.name, h.qty, h.unit, h.returned || '']; }) }]);
      };
    };
    const drawStat = async function () {
      const k = d.kpi;
      const st = k.by_status || {};
      U.$('#body').innerHTML = '<div class="kpis">' + Admin.kpi('จำนวนใบเบิก', U.n(k.req_count), 'รอจัดเตรียม ' + (st.PENDING_PREP || 0) + ' · พร้อมรับ ' + (st.READY || 0) + ' · จ่ายแล้ว ' + (st.ISSUED || 0) + ' · ยกเลิก ' + (st.CANCELLED || 0)) +
        Admin.kpi('รายการที่จ่าย', U.n(k.lines_issued), U.n(k.materials_used) + ' ชนิดวัสดุ') +
        Admin.kpi('เวลาเฉลี่ยยื่นถึงส่งมอบ', k.avg_lead_days === null ? '—' : k.avg_lead_days + ' วัน', 'วันทำการ · มัธยฐาน ' + (k.median_lead_days === null ? '—' : k.median_lead_days) + ' · ค้างเกิน ' + k.lead_alert_days + ' วัน ' + k.open_over_days + ' ใบ') +
        (d.can_value ? Admin.kpi('มูลค่าเบิกจ่าย', U.money(k.value_issued), 'บาท') + Admin.kpi('มูลค่าคงคลัง ณ วันนี้', U.money(k.inventory_value), 'บาท · ' + U.n(k.inventory_items) + ' รายการมียอด') +
          Admin.kpi('ถึงจุดสั่งซื้อ ณ วันนี้', U.n(k.reorder_now), 'หมดคลัง ' + k.out_now + ' รายการ') : '') + '</div>' +
        '<div class="grid2"><div class="card"><h3>แนวโน้มรายเดือน (ต.ค.–ก.ย.)</h3><div class="chartbox"><canvas id="c1"></canvas></div></div>' +
        '<div class="card"><h3>Top 10 วัสดุ (จำนวนครั้งที่เบิก)</h3><div class="chartbox"><canvas id="c2"></canvas></div></div></div>' +
        (d.dept_id === 'ALL' ? '<div class="card"><h3>การเบิกตามส่วนงาน</h3><div class="chartbox"><canvas id="c3"></canvas></div></div>' : '') +
        (d.can_value && d.by_cat && d.by_cat.length ? '<div class="card"><h3>มูลค่าเบิกจ่ายตามหมวด (บาท)</h3><div class="chartbox"><canvas id="c4"></canvas></div></div>' : '') +
        '<p class="small muted">ตัวเลขทั้งหมดคำนวณจากบัญชีความเคลื่อนไหวและใบเบิก ไม่มีการกรอกยอดสรุปเอง · แดชบอร์ดเต็ม (ABC ผู้จำหน่าย ส่งออก PDF) อยู่ในเฟส 3</p>';
      try { await U.loadScript('assets/vendor/chart.umd.js'); } catch (e) { return; }
      Chart.defaults.font.family = "'NotoThai', sans-serif";
      Chart.defaults.color = '#33455F';
      const navy = '#173B66', gold = '#C6A15B';
      charts.push(new Chart(U.$('#c1'), { type: 'line', data: { labels: d.months, datasets: [
        { label: 'ใบเบิก', data: d.monthly.map(function (m) { return m.reqs; }), borderColor: navy, backgroundColor: navy, tension: .3 },
        { label: 'รายการที่จ่าย', data: d.monthly.map(function (m) { return m.lines; }), borderColor: gold, backgroundColor: gold, tension: .3 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } }));
      charts.push(new Chart(U.$('#c2'), { type: 'bar', data: { labels: d.top.map(function (t) { return t.name; }), datasets: [{ label: 'ครั้ง', data: d.top.map(function (t) { return t.times; }), backgroundColor: navy, borderRadius: 6 }] },
        options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } }));
      if (U.$('#c3')) charts.push(new Chart(U.$('#c3'), { type: 'bar', data: { labels: d.by_dept.map(function (x) { return x.name; }), datasets: [{ label: 'รายการที่จ่าย', data: d.by_dept.map(function (x) { return x.lines; }), backgroundColor: gold, borderRadius: 6 }] },
        options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, onClick: function (e, els) { if (els.length) { F.dept = d.by_dept[els[0].index].dept_id; F.tab = 'hist'; App.render(); } } } }));
      if (U.$('#c4')) charts.push(new Chart(U.$('#c4'), { type: 'bar', data: { labels: d.by_cat.map(function (x) { return x.name; }), datasets: [{ label: 'บาท', data: d.by_cat.map(function (x) { return x.value; }), backgroundColor: navy, borderRadius: 6 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { display: false } } } }));
    };
    const draw = function () {
      charts.splice(0).forEach(function (c) { c.destroy(); });
      U.$$('#tab button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === F.tab); });
      if (F.tab === 'hist') drawHist(); else drawStat();
    };
    const load = async function () {
      U.$('#body').innerHTML = '<div class="skel"></div><div class="skel"></div>';
      try { d = await API.call('dashboard', { dept_id: F.dept, fy: F.fy }); draw(); } catch (e) { U.$('#body').innerHTML = App.errorBox(e); }
    };
    U.$('#dp').onchange = function () { F.dept = this.value; load(); };
    U.$('#fy').onchange = function () { F.fy = Number(this.value); load(); };
    U.$('#tab').onclick = function (e) { const b = e.target.closest('[data-t]'); if (b && d) { F.tab = b.dataset.t; draw(); } };
    U.$$('#tab button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === F.tab); });
    await load();
  }
});
