/* Shared practice data. Never impersonates an administrator or stores a PIN. */
'use strict';
const Training = (function () {
  function banner() {
    return '<div role="status" style="position:sticky;top:0;z-index:200;background:#fff4cc;color:#5a3900;padding:10px 16px;border-bottom:2px solid #c8a45a;display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
      '<div style="flex:1"><b>พื้นที่ฝึก · ข้อมูลตัวอย่าง</b><br><small>แยกจากคลังจริง · เอกสารใช้ฝึกเท่านั้น</small></div><a class="btn sm" href="#/training">คู่มือทดลอง</a><button class="btn sm" data-act="training-leave">กลับคลังจริง</button></div>';
  }
  async function switchMode(generation) {
    if (Outbox.pending().length) { U.toast('มีคำขอค้างส่งในพื้นที่นี้ กรุณาจัดการคำขอค้างก่อนสลับพื้นที่', 'err', 6000); return; }
    // A hard reload discards outstanding callbacks and reloads the correctly namespaced drafts/catalog.
    API.setTraining(generation); location.hash = '#/training'; location.reload();
  }
  async function leave() {
    if (!API.scope()) return;
    if (await U.confirm('กลับคลังจริง', 'จะกลับไปใช้งานข้อมูลจริง ร่างในพื้นที่ฝึกเก็บแยกไว้และจะไม่ถูกส่งเข้าคลังจริง', 'กลับคลังจริง')) await switchMode('');
  }
  function money(v) { return U.money(v); }
  return { banner: banner, leave: leave, switchMode: switchMode, money: money };
})();

App.view('training', {
  title: 'ทดลองใช้งาน', roles: ['ADMIN','OFFICER'],
  render: async function (el) {
    const isAdmin = App.S.user.role === 'ADMIN';
    el.innerHTML = '<div class="page-h"><h1>ทดลองใช้งานระบบวัสดุ</h1><p>ชุดตัวอย่างจากใบเสนอราคา QT-2026/1107 · เจ้าหน้าที่ทดลองรับเข้า เบิก จัดเตรียม ส่งมอบ รับคืน และดูรายงาน</p></div><div id="training-body"><div class="skel"></div></div>';
    let r;
    try { r = await API.call('training.status'); }
    catch (e) {
      const msg = e.code === 'UNKNOWN_ACTION' ? 'ยังไม่ได้ติดตั้งคำสั่งพื้นที่ฝึกที่ API ข้อมูลคลังจริงยังใช้งานได้ตามเดิม' : e.message;
      U.$('#training-body').innerHTML = '<div class="notice warn"><div><b>พื้นที่ฝึกยังไม่พร้อม</b>' + U.esc(msg) + '</div></div>';
      return;
    }
    const current = !!API.scope(), same = current && API.scope() === r.generation;
    const rows = r.quote || [];
    U.$('#training-body').innerHTML =
      '<div class="notice ' + (current ? 'warn' : 'info') + '"><div><b>' + (current ? 'ขณะนี้อยู่ในพื้นที่ฝึก' : 'ขณะนี้อยู่ในระบบจริง') + '</b>' +
      (current ? 'ข้อมูลที่บันทึกในพื้นที่นี้ใช้ฝึกเท่านั้น ไม่รวมกับยอดคลังจริง' : 'กดเข้าพื้นที่ฝึกก่อนเริ่มทดลอง รายการตัวอย่างจะแยกจากคลังจริง') + '</div></div>' +
      (current && !same ? '<div class="notice err"><div><b>ชุดฝึกเดิมถูกล้างแล้ว</b>กรุณาเข้าชุดปัจจุบัน หรือกลับคลังจริง ระบบจะไม่ส่งรายการเก่าเข้าข้อมูลจริง</div></div>' : '') +
      '<div class="card"><h3>จัดการชุดฝึก</h3><p>' + (r.active ? 'มีชุดฝึกพร้อมใช้ · สร้างเมื่อ ' + U.thDateTime(r.created_at) : 'ยังไม่มีชุดฝึก ให้แอดมินกดสร้างชุดข้อมูลตัวอย่าง') + '</p><div class="row" style="flex-wrap:wrap">' +
      (isAdmin ? '<button class="btn primary" id="training-create"' + (r.active ? ' disabled' : '') + '>สร้างข้อมูลตัวอย่าง 10 รายการ</button>' : '') +
      (r.active && !same ? '<button class="btn primary" id="training-enter">เข้าพื้นที่ฝึก</button>' : '') +
      (same ? '<a class="btn primary" href="#/queue">ทดลองคิวจ่ายวัสดุ</a><a class="btn" href="#/stock">ดูคลังตัวอย่าง</a>' : '') +
      (isAdmin ? '<button class="btn" id="training-clear"' + (!r.active ? ' disabled' : '') + '>ล้างชุดฝึก</button>' : '') +
      (current ? '<button class="btn" data-act="training-leave">กลับคลังจริง</button>' : '') + '</div>' +
      '<p id="training-progress" role="status" aria-live="polite"></p><p class="small muted">เฉพาะแอดมินสร้างและล้างได้ เจ้าหน้าที่พัสดุใช้ชุดร่วมกันได้จากเครื่องอื่น · ล้างแล้วชุดเดิมจะปิดใช้งานและเก็บสำเนาไว้กู้คืน ข้อมูลจริงและบัญชีผู้ใช้ไม่ถูกล้าง</p></div>' +
      '<div class="card"><h3>เริ่มทดลองอย่างไร</h3><ol><li>แอดมินกดสร้างข้อมูลตัวอย่าง แล้วเจ้าหน้าที่กดเข้าพื้นที่ฝึก</li>' +
      '<li>ตรวจคลัง 10 รายการ และประวัติรับเข้า 1 ใบตามใบเสนอราคา</li><li>เปิดคิวจ่าย มีตัวอย่างรอจัดเตรียม 1 ใบ และพร้อมรับ 1 ใบ ให้ลองจัดเตรียม → ส่งมอบ พร้อมระบุชื่อผู้รับ</li>' +
      '<li>ลองเบิกของตนเอง รับเข้าเพิ่ม รับคืน ตรวจนับ และตรวจยอดในสถิติ/ประวัติ</li><li>กลับหน้านี้ให้แอดมินล้างชุดฝึก แล้วกดสร้างใหม่เพื่อเริ่มรอบถัดไป</li></ol>' +
      '<p class="small muted">ชุดเริ่มต้นใช้ต้นทุนถัวเฉลี่ยและไม่เปิดขั้นอนุมัติ เอกสารมีคำว่า “ตัวอย่าง” และข้อความห้ามใช้เบิกจ่ายจริง</p></div>' +
      '<div class="card"><h3>ข้อมูลจากใบเสนอราคา</h3><p>' + U.esc(r.supplier) + '</p><div class="tablewrap"><table class="t"><thead><tr><th>รายการ</th><th>จำนวน</th><th>หน่วยซื้อ</th><th>ราคา/หน่วย</th><th>รวม</th></tr></thead><tbody>' +
      rows.map(function (x) { return '<tr><td>' + U.esc(x.name) + '</td><td>' + U.n(x.qty) + '</td><td>' + U.esc(x.unit) + '</td><td>' + U.money(x.price) + '</td><td>' + U.money(x.total) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p>ก่อน VAT <b>' + U.money(r.subtotal) + '</b> บาท · VAT 7% <b>' + U.money(r.vat) + '</b> บาท · รวม <b>' + U.money(r.total) + '</b> บาท</p>' +
      '<p class="small muted">ต้นทุนวัสดุในชุดฝึกใช้ราคาก่อน VAT รวม 6,811 บาท · ปากกา 12 กล่อง × 10 ด้าม = 120 ด้าม ต้นทุน 8.50 บาท/ด้าม · จำนวนคงเหลือหลังทดลองจะเปลี่ยนตามรายการที่บันทึก</p></div>';
    let pending = false, opUUID = null, opAction = '';
    async function mutate(action, data, button) {
      if (pending) return;
      pending = true;
      const controls = Array.from(el.querySelectorAll('#training-create,#training-clear,#training-enter'));
      const previous = controls.map(function (b) { return b.disabled; });
      controls.forEach(function (b) { b.disabled = true; });
      const progress = U.$('#training-progress');
      progress.textContent = action === 'training.create' ? 'กำลังสร้างชุดฝึก กรุณารอสักครู่ อาจใช้เวลาประมาณ 1 นาที…' : 'กำลังล้างชุดฝึกและเก็บสำเนา…';
      // Keep a UUID after network uncertainty; a repeated click replays the same server operation.
      if (opAction !== action) { opAction = action; opUUID = U.uuid(); }
      try {
        await API.call(action, data, { write: true, uuid: opUUID, timeout: 120000 });
        U.toast(action === 'training.create' ? 'สร้างชุดฝึกแล้ว' : 'ล้างชุดฝึกแล้ว เก็บสำเนาชุดเก่าไว้', 'ok');
        if (action === 'training.clear' && API.scope()) { API.setTraining(''); location.reload(); }
        else App.render();
      } catch (e) { U.toast(e.message, 'err', 7000); }
      finally { pending = false; if (progress.isConnected) progress.textContent = ''; controls.forEach(function (b, i) { if (b.isConnected) b.disabled = previous[i]; }); }
    }
    const create = U.$('#training-create'), clear = U.$('#training-clear'), enter = U.$('#training-enter');
    if (create) create.onclick = async function () {
      if (await U.confirm('สร้างชุดข้อมูลตัวอย่าง', 'สร้างคลังฝึก 10 รายการ รับเข้าตามใบเสนอราคา และคำขอตัวอย่าง 2 ใบ ในฐานข้อมูลแยก ทุกยอดใช้ฝึกเท่านั้น', 'สร้างชุดฝึก')) mutate('training.create', { confirm: 'CREATE_TRAINING' }, create);
    };
    if (clear) clear.onclick = async function () {
      if (await U.confirm('ล้างชุดฝึก', 'ปิดชุดฝึกที่ทุกคนกำลังใช้ ร่างของชุดนี้จะส่งต่อไม่ได้ เก็บสำเนาชุดเก่าไว้กู้คืน และไม่ล้างข้อมูลคลังจริง', 'ล้างชุดฝึก', true)) mutate('training.clear', { confirm: 'CLEAR_TRAINING', generation: r.generation }, clear);
    };
    if (enter) enter.onclick = async function () {
      if (await U.confirm('เข้าพื้นที่ฝึก', 'จากนี้รายการที่รับเข้า เบิก และจ่ายจะใช้ข้อมูลตัวอย่างร่วมกับเจ้าหน้าที่คนอื่น มีแถบสีเหลืองแสดงตลอดการฝึก', 'เข้าพื้นที่ฝึก')) await Training.switchMode(r.generation);
    };
  }
});
