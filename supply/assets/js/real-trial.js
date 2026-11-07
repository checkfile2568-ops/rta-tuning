'use strict';
const RealTrial=(function(){
 function banner(r){if(!r||!r.active)return '';return '<div role="status" class="sample-data-banner"><b>ข้อมูลตัวอย่าง</b></div>';}
 return {banner:banner};
})();
App.view('real-trial',{
 title:'ทดสอบฐานจริง / ล้างกลับยอด 0',roles:['ADMIN','OFFICER'],
 render:async function(el){
  el.innerHTML='<div class="page-h"><h1>ทดสอบบนฐานข้อมูลจริง</h1><p>ใช้หน้าเบิก–รับเข้า–จ่ายและสถิติปกติของระบบ ยอดและเอกสารมีผลในฐานจริง</p></div>';
  if(API.scope()){el.innerHTML+='<div class="notice warn"><div><b>ขณะนี้อยู่ในพื้นที่จำลอง</b>กรุณากลับคลังจริงก่อนจัดการรอบทดสอบจริง</div></div><button class="btn" data-act="training-leave">กลับคลังจริง</button>';return;}
  const r=await API.call('realTrial.status'),admin=App.S.user.role==='ADMIN';
  el.innerHTML+='<div class="notice '+(r.active?'warn':'info')+'"><div><b>'+(r.active?'เปิดรอบทดสอบจริงอยู่':'ยังไม่เปิดรอบทดสอบจริง')+'</b>'+(r.active?'ทุกคนใช้หน้าเบิกปกติ ไม่ต้องกดเข้าพื้นที่จำลอง':'เริ่มรอบได้เมื่อยอดคงคลังและเอกสารเป็น 0 เท่านั้น')+'</div></div>'+
   '<div class="card"><h3>ลำดับทดสอบ</h3><ol><li>แอดมินเริ่มรอบจากยอด 0 ระบบบันทึกสำเนาจุดเริ่มต้นไว้</li><li>เติมข้อมูลจากใบเสนอราคา 10 รายการ หรือรับเข้า/เพิ่มวัสดุเอง</li><li>ผู้ใช้ใช้บัญชีตนเองเบิกตามปกติ เจ้าหน้าที่จัดเตรียม–จ่าย–รับคืน และตรวจสถิติ/กระทบยอด</li><li>จบทดสอบให้แอดมินล้างกลับยอด 0 แล้วนำเข้ายอดจริงก่อนเริ่มใช้งานประจำ</li></ol></div>'+
   '<div class="card"><h3>การล้างกลับจุดเริ่มต้น</h3><p>ล้างใบเบิก รับเข้า จ่าย รับคืน ปรับยอด สถิติ และย้อนการเพิ่ม/แก้ไขวัสดุ ผู้จำหน่าย หน่วย หมวด และการตั้งค่าระหว่างรอบกลับเป็นค่าก่อนเริ่มรอบ ยอดคงคลังกลับเป็น 0</p><p><b>คงบัญชี สิทธิ์ และส่วนงานล่าสุดไว้</b> และไม่ล้างพื้นที่จำลองเดิม สำเนารอบก่อนล้างยังอยู่และกู้คืนล่าสุดได้หากยังไม่มีงานใหม่หลังล้าง</p><p>ทะเบียนวัสดุปัจจุบันมี '+U.n(r.zero.materials)+' รายการ · '+(r.zero.ok?'ปัจจุบันยอด/เอกสารเป็น 0':'ปัจจุบันมีข้อมูลรับ–จ่ายหรือยอดในระบบ')+'</p>'+
   (admin?'<div class="row" style="flex-wrap:wrap"><button class="btn primary" id="rt-start"'+(r.active||!r.zero.ok?' disabled':'')+'>เริ่มรอบทดสอบจริง</button><button class="btn" id="rt-seed"'+(!r.active||r.seeded?' disabled':'')+'>เติมตัวอย่าง 10 รายการในฐานจริง</button><button class="btn" id="rt-reset"'+(!r.active?' disabled':'')+'>ล้างข้อมูลทดสอบจริง กลับยอด 0</button><button class="btn" id="rt-restore"'+(!r.can_restore||r.active||!r.zero.ok?' disabled':'')+'>กู้คืนก่อนล้างล่าสุด</button></div>':'<p class="muted">เฉพาะแอดมินจัดการเริ่ม เติม ล้าง และกู้คืน เจ้าหน้าที่ใช้เมนูรับเข้า คิวจ่าย และเบิกของตนเองตามสิทธิ์เดิม</p>')+
   '<p id="rt-progress" role="status" aria-live="polite"></p></div>'+
   '<div class="card"><h3>แยกจากข้อมูลจำลองเดิม</h3><p>เมนูทดลองใช้งานยังสร้างและล้างชุดจำลองแยกต่างหากได้ การล้างในหน้านี้มีผลต่อรอบทดสอบในฐานจริงเท่านั้น</p><a class="btn" href="#/training">เปิดพื้นที่จำลองเดิม</a> <a class="btn" href="#/stock">ดูคลังจริง</a> <a class="btn" href="#/req">เบิกวัสดุตามปกติ</a></div>';
  if(!admin)return;
  let pending=false,lastAction='',uuid='';
  async function act(action,confirmation,title,description,extra){
   if(pending)return;
   const form=await U.modal({title:title,ok:'ยืนยัน',html:'<p>'+description+'</p><label class="field"><span>พิมพ์ <b>'+confirmation+'</b> เพื่อยืนยัน</span><input class="input" name="confirm" required autocomplete="off"></label>'+(action==='realTrial.seed'?'<label class="field"><span>วิธีต้นทุน (ใช้เมื่อยังไม่ได้ตั้งค่า)</span><select class="input" name="cost_method"><option value="AVG">ถัวเฉลี่ยถ่วงน้ำหนัก</option><option value="FIFO">เข้าก่อนออกก่อน</option></select></label>':'')});
   if(!form)return;if(String(form.confirm||'').trim()!==confirmation){U.toast('ข้อความยืนยันไม่ตรง','err');return;}
   pending=true;const buttons=[...el.querySelectorAll('button')],disabled=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);
   const progress=U.$('#rt-progress');progress.textContent='กำลังดำเนินการและตรวจสำเนา กรุณารอสักครู่…';
   if(lastAction!==action){lastAction=action;uuid=U.uuid();}
   try{await API.call(action,Object.assign({confirm:confirmation,generation:r.generation,cost_method:form.cost_method},extra||{}),{write:true,uuid:uuid,timeout:120000,workspaceSwitch:action!=='realTrial.seed'});
    U.toast('ดำเนินการสำเร็จ','ok');if(action==='realTrial.seed'){await App.refreshMe();App.render();}else{location.hash='#/real-trial';location.reload();}
   }catch(e){U.toast(e.message,'err',8000);}
   finally{pending=false;if(progress.isConnected)progress.textContent='';buttons.forEach((b,i)=>{if(b.isConnected)b.disabled=disabled[i];});}
  }
  U.$('#rt-start').onclick=()=>act('realTrial.start','เริ่มทดสอบจริง','เริ่มรอบบนฐานจริง','ทุกบัญชีจะทำรายการในฐานจริง ระบบบันทึกสำเนายอด 0 ก่อนเริ่มรอบ');
  U.$('#rt-seed').onclick=()=>act('realTrial.seed','เติมข้อมูลทดสอบจริง','เติมตัวอย่างลงฐานจริง','สร้างวัสดุ 10 รายการและรับเข้าตามใบเสนอราคา ก่อน VAT รวม 6,811 บาท ปากกา 12 กล่อง = 120 ด้าม จากนี้ให้ผู้ใช้เบิกด้วยบัญชีจริงของตนเอง');
  U.$('#rt-reset').onclick=()=>act('realTrial.reset','ล้างกลับยอด 0','ล้างรอบทดสอบจริง','ย้อนข้อมูลวัสดุและเอกสารที่เพิ่ม/แก้ระหว่างรอบทั้งหมดกลับสำเนาจุดเริ่มต้นยอด 0 ทุกคนต้องเปิดหน้าล่าสุด ร่างเก่าจะไม่ถูกส่งกลับเข้ามา คงบัญชี สิทธิ์ และส่วนงาน พร้อมเก็บรอบก่อนล้างไว้กู้คืน');
  U.$('#rt-restore').onclick=()=>act('realTrial.restore','กู้คืนก่อนล้าง','กู้คืนรอบก่อนล้างล่าสุด','นำรอบที่ทดสอบกลับมาใช้งาน โดยคงบัญชีและสิทธิ์ล่าสุด ต้องยังไม่มีงานหลังล้างเท่านั้น',{archive_generation:r.archive_generation});
 }
});

