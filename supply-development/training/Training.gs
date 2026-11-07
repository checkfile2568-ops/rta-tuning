/** Shared disposable practice workspace. Authentication always uses the production DB.
 * Install together with the guarded hooks in integrate.py. No production row is deleted.
 */
let TRAINING_SCOPE_ = null;
const TRAINING_KEY_ = 'SUPPLY_TRAINING_V1';
const TRAINING_ACTIONS_ = ['me','catalog','masters','saveMaterial','setMaterialActive','saveCategory','saveUnit',
  'saveSupplier','submitRequest','cancelRequest','myRequests','getRequest','approvals','approveRequest',
  'rejectRequest','queue','prepareRequest','issueRequest','returnItems','receive','receipts','adjust',
  'importOpenings','ledger','reorderList','reconcile','repairs','dashboard','auditLog'];

function trainingQuote_() {
  return [
    ['กระดาษถ่ายเอกสาร A4 80 แกรม (Double A)',15,'รีม',120,'รีม',1],
    ['กรรไกรตัดกระดาษ 7 นิ้ว (ตราช้าง)',10,'อัน',45,'อัน',1],
    ['ปากกาลูกลื่น 0.5 มม. (กล่อง 10 ด้าม)',12,'กล่อง',85,'ด้าม',10],
    ['แฟ้มพลาสติก 2 ห่วง A4 สัน 2 นิ้ว',15,'เล่ม',65,'เล่ม',1],
    ['เครื่องเย็บกระดาษ No.10',10,'เครื่อง',75,'เครื่อง',1],
    ['ลวดเย็บกระดาษ No.10 (กล่อง)',15,'กล่อง',18,'กล่อง',1],
    ['เทปกาวใส 3/4 นิ้ว (แกน 3 นิ้ว)',12,'ม้วน',25,'ม้วน',1],
    ['ปากกาเน้นข้อความ คละสี',10,'ด้าม',22,'ด้าม',1],
    ['กระดาษโน้ตกาว Post-it 3x3 นิ้ว',15,'ห่อ',30,'ห่อ',1],
    ['ปากกาลบคำผิด ชนิดหัวเข็ม',12,'ด้าม',48,'ด้าม',1]
  ].map(function (r,i) { return { code:'TRAIN-'+pad_(i+1,3),name:r[0],qty:r[1],unit:r[2],price:r[3],
    base_unit:r[4],factor:r[5],total:r[1]*r[3] }; });
}
function trainingState_() {
  const s = PropertiesService.getScriptProperties().getProperty(TRAINING_KEY_);
  if (!s) return { active:null, operations:[], archived:[] };
  try { const x=JSON.parse(s); if (!Array.isArray(x.operations)||!Array.isArray(x.archived)) throw Error(); return x; }
  catch(e) { throw appErr_('TRAINING_STATE_ERROR','สถานะพื้นที่ฝึกไม่ถูกต้อง กรุณาให้ผู้ดูแลตรวจสอบ'); }
}
function trainingSaveState_(s) {
  s.operations=s.operations.slice(-8); s.archived=s.archived.slice(-8);
  PropertiesService.getScriptProperties().setProperty(TRAINING_KEY_,JSON.stringify(s));
}
function trainingPublic_(s) {
  const r=s.active;
  return { active:!!r,generation:r?r.generation:'',created_at:r?r.created_at:'',created_by:r?r.created_by:'',
    quotation:'QT-2026/1107',supplier:'บริษัท สยามออฟฟิศซัพพลาย จำกัด (ตัวอย่าง)',
    materials:10,subtotal:6811,vat:476.77,total:7287.77,cost_basis:'EXCLUDE_VAT',
    storage:'SHARED_SEPARATE_DATABASE',archive_retained:true };
}
function trainingPropertyKey_(key) {
  return TRAINING_SCOPE_ && /^(CATALOG_VER|DATA_VER|INFLIGHT|REPAIRS)$/.test(key)
    ? 'TR_'+TRAINING_SCOPE_.generation+'_'+key : key;
}
function trainingCacheKey_(key) { return TRAINING_SCOPE_ ? 'TR_'+TRAINING_SCOPE_.generation+'_'+key : key; }
function trainingAssertCurrent_() {
  if (!TRAINING_SCOPE_ || TRAINING_SCOPE_.building) return;
  const r=trainingState_().active;
  if (!r || r.generation!==TRAINING_SCOPE_.generation || r.id!==TRAINING_SCOPE_.id)
    throw appErr_('TRAINING_CHANGED','แอดมินล้างหรือสร้างชุดฝึกใหม่แล้ว กรุณากลับเมนูทดลองใช้งาน');
}
function trainingUse_(record) {
  const real=PropertiesService.getScriptProperties().getProperty('DB_ID');
  if (!record || !record.id || record.id===real) throw appErr_('TRAINING_DB_ERROR','ไม่สามารถใช้ฐานข้อมูลจริงเป็นพื้นที่ฝึกได้');
  TRAINING_SCOPE_=record; resetDb_();
}
function trainingUser_(u) { return Object.assign({},u,{dept_id:'TRAIN_DEPT',position:u.position||'ผู้ทดลองใช้งาน'}); }
function trainingDispatch_(e) {
  TRAINING_SCOPE_=null;
  let body;
  try { body=JSON.parse(e && e.postData && e.postData.contents || '{}'); } catch(x) { return null; }
  const action=String(body.action||'');
  if (action.indexOf('training.')!==0 && !Object.prototype.hasOwnProperty.call(body,'training')) return null;
  const t0=Date.now(); let role='';
  try {
    resetDb_();
    // Validate the existing session BEFORE selecting a practice database. No training credentials exist.
    const realUser=requireSession_(body.token,false); role=realUser.role;
    if (['ADMIN','OFFICER'].indexOf(role)<0) throw appErr_('FORBIDDEN','พื้นที่ฝึกสำหรับแอดมินและเจ้าหน้าที่พัสดุเท่านั้น');
    const ctx={user:realUser,action:action,uuid:body.client_uuid};
    const d=body.data && typeof body.data==='object'?body.data:{};
    let result;
    if (action==='training.status') result=Object.assign(trainingPublic_(trainingState_()),{quote:trainingQuote_()});
    else if (action==='training.create'||action==='training.clear') {
      if(role!=='ADMIN') throw appErr_('FORBIDDEN','เฉพาะแอดมินเท่านั้นที่สร้างหรือล้างชุดฝึกได้');
      result=trainingManage_(ctx,d);
    } else {
      // An invalid/old practice flag NEVER falls through to the live handler.
      if (typeof body.training!=='string'||!body.training) throw appErr_('TRAINING_REQUIRED','ต้องระบุชุดฝึกที่ใช้งาน');
      if(TRAINING_ACTIONS_.indexOf(action)<0) throw appErr_('TRAINING_ACTION_BLOCKED','คำสั่งนี้ใช้ไม่ได้ในพื้นที่ฝึก กรุณาออกจากพื้นที่ฝึกก่อน');
      const record=trainingState_().active;
      if(!record||record.generation!==body.training) throw appErr_('TRAINING_CHANGED','ชุดฝึกนี้ถูกล้างแล้ว หรือมีชุดใหม่ กรุณากลับเมนูทดลองใช้งาน');
      const route=routes_()[action];
      if(!route||route.auth===false) throw appErr_('TRAINING_ACTION_BLOCKED','คำสั่งนี้ไม่รองรับในพื้นที่ฝึก');
      if(route.roles&&route.roles.indexOf(role)<0) throw appErr_('FORBIDDEN','บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');
      trainingUse_(record);ctx.user=trainingUser_(realUser);
      if(route.write) {
        if(!/^[0-9a-zA-Z-]{16,64}$/.test(String(body.client_uuid||''))) throw appErr_('BAD_UUID','คำขอไม่มีรหัสรายการ');
        ctx.uuid=sha_('TRAINING|'+record.generation+'|'+body.client_uuid);
        result=runOp_(ctx,action,d,function(w){return route.fn(ctx,d,w);});
      } else result=route.fn(ctx,d);
      if(action==='me') {result.needDept=false;result.needPosition=false;result.cfg.training=true;}
    }
    return json_({ok:true,data:result,catalogVersion:ver_('CATALOG_VER'),dataVersion:ver_('DATA_VER'),ms:Date.now()-t0,training:!!TRAINING_SCOPE_});
  } catch(err) {return json_({ok:false,error:errOut_(err,role),ms:Date.now()-t0});}
  finally { TRAINING_SCOPE_=null; resetDb_(); }
}
function trainingManage_(ctx,d) {
  if(!/^[0-9a-zA-Z-]{16,64}$/.test(String(ctx.uuid||''))) throw appErr_('BAD_UUID','คำขอไม่มีรหัสรายการ');
  const lock=LockService.getScriptLock();
  try{lock.waitLock(10000);}catch(e){throw appErr_('BUSY','กำลังมีรายการบันทึก กรุณาลองใหม่');}
  try {
    const state=trainingState_(),hash=sha_(ctx.action+'|'+ctx.user.code+'|'+stableJson_(d));
    const prior=state.operations.filter(function(x){return x.uuid===ctx.uuid;})[0];
    if(prior) {if(prior.hash!==hash)throw appErr_('UUID_REUSED','รหัสรายการนี้ถูกใช้แล้ว');return Object.assign({},prior.result,{_replayed:true});}
    let result;
    if(ctx.action==='training.create') {
      if(d.confirm!=='CREATE_TRAINING') throw appErr_('CONFIRM_REQUIRED','กรุณายืนยันสร้างชุดฝึก');
      if(state.active) result=Object.assign(trainingPublic_(state),{already_active:true});
      else {
        const record={generation:Utilities.getUuid(),id:'',created_at:now_().toISOString(),created_by:ctx.user.code};
        const book=SpreadsheetApp.create('ชุดฝึกเบิกวัสดุ — ตัวอย่าง QT-2026-1107 — '+record.generation.slice(0,8));
        record.id=book.getId();
        trainingUse_(Object.assign({},record,{building:true}));
        try {trainingSeed_(ctx,book);}
        finally {TRAINING_SCOPE_=null;resetDb_();}
        // Publish the pointer only after every seed transaction and reconciliation succeeds.
        state.active=record; result=trainingPublic_(state);
      }
    } else {
      if(d.confirm!=='CLEAR_TRAINING') throw appErr_('CONFIRM_REQUIRED','กรุณายืนยันล้างชุดฝึก');
      if(state.active && d.generation!==state.active.generation) throw appErr_('TRAINING_CHANGED','ชุดฝึกเปลี่ยนแล้ว กรุณาเปิดหน้านี้ใหม่');
      if(state.active) state.archived.push(Object.assign({},state.active,{cleared_at:now_().toISOString(),cleared_by:ctx.user.code}));
      state.active=null; result=Object.assign(trainingPublic_(state),{cleared:true});
    }
    state.operations.push({uuid:ctx.uuid,hash:hash,result:result});trainingSaveState_(state);
    // Audit is intentionally in the live ADMIN log; no stock, requests or account rows are changed there.
    audit_(ctx.user.code,ctx.action,'TRAINING',result.generation||d.generation||'',{quotation:'QT-2026/1107',archived:ctx.action==='training.clear'});
    return result;
  } finally {TRAINING_SCOPE_=null;resetDb_();lock.releaseLock();}
}
function trainingSeedRows_(book,name,objects) {
  if(!objects.length)return;
  const head=SCHEMA[name];book.getSheetByName(name).getRange(2,1,objects.length,head.length)
    .setValues(objects.map(function(o){return head.map(function(k){return cell_(o[k]);});}));
}
function trainingSeedOp_(actor,action,data) {
  resetDb_();const ctx={user:actor,action:action,uuid:Utilities.getUuid()},w=new Writer_(ctx.uuid);
  const result=routes_()[action].fn(ctx,data,w);
  commit_(w,ctx,action,sha_(action+'|'+stableJson_(data)),result);
  resetDb_();return result;
}
function trainingSeed_(ctx,book) {
  book.setSpreadsheetTimeZone(TZ);
  Object.keys(SCHEMA).forEach(function(n){ensureSheet_(book,n,SCHEMA[n]);});
  const q=trainingQuote_(),ts=now_();
  const config=SEED_CONFIG.map(function(r){return {key:r[0],value:r[1],note:r[2]};});
  const values={cost_method:'AVG',org_name:'ศาลจังหวัดลพบุรี — ข้อมูลตัวอย่าง',app_name:'ระบบเบิกวัสดุ · พื้นที่ฝึก',
    approval_enabled:false,line_notify_enabled:false,requests_paused:false,request_rule:'ONE_PENDING',show_qty_to_user:true,
    prefix_REQ:'ตัวอย่าง-บก',prefix_RCV:'ตัวอย่าง-รบ',prefix_OPN:'ตัวอย่าง-ยก',prefix_RET:'ตัวอย่าง-คืน',prefix_ADJ:'ตัวอย่าง-ปรับ'};
  config.forEach(function(r){if(Object.prototype.hasOwnProperty.call(values,r.key))r.value=values[r.key];});
  trainingSeedRows_(book,'CONFIG',config);
  trainingSeedRows_(book,'DEPARTMENTS',[{dept_id:'TRAIN_DEPT',name:'ส่วนงานทดลอง (ตัวอย่าง)',order:1,active:true}]);
  trainingSeedRows_(book,'USERS',[{user_code:'TRAIN-USER1',full_name:'ผู้ขอเบิกตัวอย่าง 1',dept_id:'TRAIN_DEPT',role:'USER'},
    {user_code:'TRAIN-USER2',full_name:'ผู้ขอเบิกตัวอย่าง 2',dept_id:'TRAIN_DEPT',role:'USER'}]);
  const names=['รีม','อัน','กล่อง','ด้าม','เล่ม','เครื่อง','ม้วน','ห่อ'],units={};
  names.forEach(function(n,i){units[n]='TRAIN-U'+(i+1);});
  trainingSeedRows_(book,'UNITS',names.map(function(n){return {unit_id:units[n],name:n,aliases:'',active:true};}));
  trainingSeedRows_(book,'CATEGORIES',[{cat_id:'TRAIN-C1',name:'วัสดุสำนักงาน (ตัวอย่าง)',order:1,active:true}]);
  trainingSeedRows_(book,'MAT_TYPES',[{type_id:'TRAIN-T1',name:'วัสดุสิ้นเปลือง',active:true}]);
  trainingSeedRows_(book,'SUPPLIERS',[{sup_id:'TRAIN-SUP1',name:'บริษัท สยามออฟฟิศซัพพลาย จำกัด (ตัวอย่าง)',active:true}]);
  trainingSeedRows_(book,'MATERIALS',q.map(function(x,i){return {mat_id:x.code,code:x.code,name:x.name,
    spec:'ข้อมูลตัวอย่าง QT-2026/1107'+(x.factor>1?' · 1 กล่อง = 10 ด้าม':''),keywords:'ตัวอย่าง ทดลอง',
    type_id:'TRAIN-T1',cat_id:'TRAIN-C1',unit_id:units[x.base_unit],reorder_point:i===0?5:2,reorder_qty:10,max_per_request:0,
    balance:0,reserved:0,stock_value:0,avg_cost:0,last_cost:0,active:true,created_at:ts,updated_at:ts};}));
  trainingSeedRows_(book,'MATERIAL_UNITS',[{mu_id:'TRAIN-MU3',mat_id:'TRAIN-003',unit_id:units['กล่อง'],factor_to_base:10,is_default_purchase:true,active:true}]);
  resetDb_();
  const officer=Object.assign(trainingUser_(ctx.user),{role:'OFFICER'}); // Internal seed actor; never returned as a new session/role.
  trainingSeedOp_(officer,'receive',{sup_id:'TRAIN-SUP1',rcv_date:ymd_(ts),invoice_no:'ตัวอย่าง QT-2026/1107',
    note:'ตัวอย่าง: ก่อน VAT 6,811.00 / VAT 476.77 / รวม 7,287.77 บาท · ต้นทุนในชุดฝึกยังไม่รวม VAT',
    items:q.map(function(x){return {mat_id:x.code,qty:x.qty,unit_id:units[x.unit],unit_price:x.price};})});
  const user1={code:'TRAIN-USER1',name:'ผู้ขอเบิกตัวอย่าง 1',role:'USER',dept_id:'TRAIN_DEPT',position:'ผู้ขอเบิกตัวอย่าง'};
  const user2=Object.assign({},user1,{code:'TRAIN-USER2',name:'ผู้ขอเบิกตัวอย่าง 2'});
  trainingSeedOp_(user1,'submitRequest',{purpose:'ข้อมูลตัวอย่าง: ฝึกจัดเตรียมและส่งมอบ',items:[{mat_id:'TRAIN-001',qty:2},{mat_id:'TRAIN-003',qty:5}]});
  const ready=trainingSeedOp_(user2,'submitRequest',{purpose:'ข้อมูลตัวอย่าง: ฝึกส่งมอบหรือยกเลิก',items:[{mat_id:'TRAIN-002',qty:1},{mat_id:'TRAIN-004',qty:2}]});
  trainingSeedOp_(officer,'prepareRequest',{req_id:ready.req_id});
  const report=reconcileReport_();
  if(!report.ok)throw appErr_('TRAINING_SEED_FAILED','ยอดชุดฝึกไม่ผ่านการกระทบยอด');
}
