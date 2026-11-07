/** Real database trial rounds. Copies are retained; no files are permanently deleted.
 * Controls are admin-only. Normal requisition/receipt handlers still use DB_ID.
 */
const REAL_TRIAL_KEY_='SUPPLY_REAL_TRIAL_V1';
const REAL_TRIAL_TX_=['REQUESTS','REQUEST_ITEMS','RETURNS','OPENINGS','RECEIPTS','RECEIPT_ITEMS',
  'ADJUSTMENTS','PO','PO_ITEMS','STOCK_LEDGER','STOCK_LOTS','STAT_MONTHLY','FY_CLOSING'];
function realTrialState_(){
  const raw=PropertiesService.getScriptProperties().getProperty(REAL_TRIAL_KEY_);
  if(!raw)return {epoch:'INITIAL',active:null,operations:[],archives:[]};
  try{const s=JSON.parse(raw);if(!s.epoch||!Array.isArray(s.operations)||!Array.isArray(s.archives))throw Error();return s;}
  catch(e){throw appErr_('REAL_TRIAL_STATE','สถานะรอบทดสอบจริงไม่ถูกต้อง กรุณาให้ผู้ดูแลตรวจสอบ');}
}
function realTrialSave_(s){s.operations=s.operations.slice(-6);s.archives=s.archives.slice(-6);PropertiesService.getScriptProperties().setProperty(REAL_TRIAL_KEY_,JSON.stringify(s));}
function realTrialEpoch_(){return realTrialState_().epoch;}
function realTrialDbId_(){return realTrialState_().current_db_id||'';}
function realTrialAdoptRestoredDb_(id){const s=realTrialState_();s.current_db_id=id;s.epoch=Utilities.getUuid();s.active=null;realTrialSave_(s);}
function realTrialPublic_(){const s=realTrialState_(),a=s.active;return {active:!!a,generation:a?a.generation:'',started_at:a?a.started_at:'',seeded:!!(a&&a.seeded),epoch:s.epoch};}
function realTrialGuard_(ctx){
  if(TRAINING_SCOPE_)return;
  if(!PropertiesService.getScriptProperties().getProperty(REAL_TRIAL_KEY_) && ctx && ctx.real_epoch === undefined && String(ctx.action||'').indexOf('realTrial.')!==0)return;
  if(!ctx||ctx.real_epoch!==realTrialEpoch_())throw appErr_('REAL_WORKSPACE_CHANGED','รอบข้อมูลจริงเปลี่ยนแล้ว กรุณารีเฟรชหน้าเว็บก่อนบันทึก ระบบไม่ได้ส่งร่างเก่าเข้าฐานข้อมูลใหม่');
}
function realTrialZero_(book){
  const read=function(name){const sh=book.getSheetByName(name);if(!sh)throw appErr_('REAL_TRIAL_SCHEMA','ฐานข้อมูลไม่ครบ: '+name);const n=sh.getLastRow();return n<2?[]:sh.getRange(2,1,n-1,SCHEMA[name].length).getValues().filter(function(r){return r[0]!=='';});};
  const h=SCHEMA.MATERIALS,rows=read('MATERIALS');
  const nonzero=rows.some(function(r){return ['balance','reserved','stock_value'].some(function(k){return Math.abs(num_(r[h.indexOf(k)]))>1e-9;});});
  const used=REAL_TRIAL_TX_.filter(function(n){return read(n).length>0;});
  return {ok:!nonzero&&!used.length,materials:rows.length,nonzero:nonzero,used:used};
}
function realTrialCopy_(id,title){return DriveApp.getFileById(id).makeCopy(title).getId();}
function realTrialFingerprint_(book){
  return sha_(JSON.stringify(Object.keys(SCHEMA).filter(function(n){return ['USERS','DEPARTMENTS','AUDIT_LOG'].indexOf(n)<0;}).map(function(n){
    const sh=book.getSheetByName(n),last=sh.getLastRow();return [n,last<2?[]:sh.getRange(2,1,last-1,SCHEMA[n].length).getValues()];
  })));
}
function realTrialKeepAccess_(from,to){
  // Preserve login/role/department references; all inventory/catalog edits are restored from the zero baseline.
  ['USERS','DEPARTMENTS'].forEach(function(n){const src=from.getSheetByName(n),dst=to.getSheetByName(n),width=SCHEMA[n].length;
    if(dst.getLastRow()>1)dst.getRange(2,1,dst.getLastRow()-1,width).clearContent();
    if(src.getLastRow()>1)dst.getRange(2,1,src.getLastRow()-1,width).setValues(src.getRange(2,1,src.getLastRow()-1,width).getValues());});
}
function realTrialDispatch_(e){
  let b;try{b=JSON.parse(e&&e.postData&&e.postData.contents||'{}');}catch(x){return null;}
  const a=String(b.action||'');if(a.indexOf('realTrial.')!==0)return null;
  let role='';try{
    TRAINING_SCOPE_=null;resetDb_();const u=requireSession_(b.token,false);role=u.role;
    if(['ADMIN','OFFICER'].indexOf(role)<0)throw appErr_('FORBIDDEN','เมนูนี้สำหรับผู้ดูแลและเจ้าหน้าที่พัสดุ');
    if(a!=='realTrial.status'&&role!=='ADMIN')throw appErr_('FORBIDDEN','เฉพาะแอดมินเท่านั้นที่เริ่ม เติม ล้าง หรือกู้คืนรอบทดสอบจริงได้');
    if(Object.prototype.hasOwnProperty.call(b,'training'))throw appErr_('REAL_TRIAL_MODE','กรุณาออกจากพื้นที่จำลองก่อนจัดการฐานข้อมูลจริง');
    const ctx={user:u,uuid:b.client_uuid,real_epoch:b.real_epoch,action:a},d=b.data||{};let out;
    if(a==='realTrial.status'){
      out=realTrialPublic_();out.zero=realTrialZero_(db_());out.can_reset=out.active;
      if(role==='ADMIN'){const archives=realTrialState_().archives;out.can_restore=archives.length>0;out.archive_generation=archives.length?archives[archives.length-1].generation:'';}
    }else if(a==='realTrial.seed')out=realTrialSeedOp_(ctx,d);
    else if(['realTrial.start','realTrial.reset','realTrial.restore'].indexOf(a)>=0)out=realTrialControl_(ctx,d);
    else throw appErr_('UNKNOWN_ACTION','ไม่รู้จักคำสั่งรอบทดสอบจริง');
    return json_({ok:true,data:out,realEpoch:realTrialEpoch_(),catalogVersion:ver_('CATALOG_VER'),dataVersion:ver_('DATA_VER')});
  }catch(err){return json_({ok:false,error:errOut_(err,role),realEpoch:realTrialEpoch_()});}
  finally{TRAINING_SCOPE_=null;resetDb_();}
}
function realTrialControl_(ctx,d){
  if(!/^[0-9a-zA-Z-]{16,64}$/.test(String(ctx.uuid||'')))throw appErr_('BAD_UUID','ไม่มีรหัสรายการ');
  const lock=LockService.getScriptLock();try{lock.waitLock(10000);}catch(e){throw appErr_('BUSY','มีรายการบันทึกอยู่ กรุณาลองใหม่');}
  try{
    TRAINING_SCOPE_=null;resetDb_();const s=realTrialState_(),hash=sha_(ctx.action+'|'+ctx.user.code+'|'+stableJson_(d));
    const replay=s.operations.filter(function(x){return x.uuid===ctx.uuid;})[0];
    if(replay){if(replay.hash!==hash)throw appErr_('UUID_REUSED','รหัสรายการถูกใช้แล้ว');return Object.assign({},replay.result,{_replayed:true});}
    realTrialGuard_(ctx);const live=db_(),id=live.getId(),p=PropertiesService.getScriptProperties();let out;
    if(ctx.action==='realTrial.start'){
      if(d.confirm!=='เริ่มทดสอบจริง')throw appErr_('CONFIRM_REQUIRED','พิมพ์ เริ่มทดสอบจริง เพื่อยืนยัน');
      if(s.active)throw appErr_('REAL_TRIAL_ACTIVE','มีรอบทดสอบจริงอยู่แล้ว');
      if(!realTrialZero_(live).ok)throw appErr_('REAL_TRIAL_NOT_ZERO','เริ่มรอบได้เมื่อยอดและเอกสารยังเป็น 0 เท่านั้น เพื่อไม่ให้ปะปนกับงานจริงเดิม');
      if(prop_('INFLIGHT')||Object.keys(repairsMap_()).length)throw appErr_('NEEDS_REPAIR','ต้องตรวจซ่อมรายการค้างก่อนเริ่มรอบ');
      const generation=Utilities.getUuid(),baseline=realTrialCopy_(id,'จุดเริ่มต้นยอด 0 ก่อนทดสอบจริง '+generation.slice(0,8));
      if(!realTrialZero_(SpreadsheetApp.openById(baseline)).ok)throw appErr_('REAL_TRIAL_BACKUP','สำเนาจุดเริ่มต้นไม่ผ่านการตรวจ');
      s.active={generation:generation,db_id:id,baseline_id:baseline,started_at:now_().toISOString(),started_by:ctx.user.code,seeded:false};
      s.epoch=Utilities.getUuid();out={active:true,generation:generation,started:true};
    }else{
      const restoring=ctx.action==='realTrial.restore';
      if(d.confirm!==(restoring?'กู้คืนก่อนล้าง':'ล้างกลับยอด 0'))throw appErr_('CONFIRM_REQUIRED','กรุณาพิมพ์ข้อความยืนยันให้ถูกต้อง');
      let source,baseline,round;
      if(restoring){
        if(s.active)throw appErr_('REAL_TRIAL_ACTIVE','ปิดรอบปัจจุบันก่อนกู้คืน');
        const archive=s.archives[s.archives.length-1];if(!archive)throw appErr_('NOT_FOUND','ไม่มีสำเนาก่อนล้าง');
        if(d.archive_generation!==archive.generation)throw appErr_('REAL_TRIAL_CHANGED','สำเนาเปลี่ยนแล้ว เปิดหน้านี้ใหม่');
        // Recovery must never overwrite subsequent operational work.
        if(!realTrialZero_(live).ok)throw appErr_('REAL_TRIAL_NOT_ZERO','มีงานหลังล้างแล้ว ไม่กู้ทับข้อมูลล่าสุด');
        if(!s.reset_guard||s.reset_guard.db_id!==id||s.reset_guard.hash!==realTrialFingerprint_(live))throw appErr_('REAL_TRIAL_CHANGED','มีการเพิ่มหรือแก้ข้อมูลหลังล้างแล้ว จึงไม่กู้ทับข้อมูลล่าสุด');
        source=archive.db_id;baseline=archive.baseline_id;round=archive.generation;
      }else{
        if(!s.active||d.generation!==s.active.generation||s.active.db_id!==id)throw appErr_('REAL_TRIAL_CHANGED','รอบทดสอบหรือฐานข้อมูลเปลี่ยนแล้ว กรุณาเปิดหน้านี้ใหม่');
        source=s.active.baseline_id;baseline=source;round=s.active.generation;
        if(!realTrialZero_(SpreadsheetApp.openById(source)).ok)throw appErr_('REAL_TRIAL_BASELINE','สำเนาจุดเริ่มต้นไม่ใช่ยอด 0 จึงไม่ล้างข้อมูล');
      }
      // Prepare and validate a separate file; pointer changes only after the complete copy is ready.
      const replacement=realTrialCopy_(source,(restoring?'กู้คืนรอบทดสอบจริง ':'ฐานจริงเริ่มต้นยอด 0 ')+now_().toISOString());
      if(replacement===id)throw appErr_('REAL_TRIAL_BACKUP','ไม่สามารถใช้สำเนาเดิมทับฐานจริง');
      const next=SpreadsheetApp.openById(replacement);realTrialKeepAccess_(live,next);SpreadsheetApp.flush();
      if(!restoring&&!realTrialZero_(next).ok)throw appErr_('REAL_TRIAL_RESET','สำเนาเริ่มต้นตรวจไม่ผ่าน ฐานจริงยังไม่เปลี่ยน');
      if(restoring)s.active={generation:round,db_id:replacement,baseline_id:baseline,started_at:now_().toISOString(),started_by:ctx.user.code,seeded:true};
      else{s.archives.push({generation:round,db_id:id,baseline_id:baseline,reset_at:now_().toISOString(),by:ctx.user.code});s.active=null;s.reset_guard={db_id:replacement,hash:realTrialFingerprint_(next)};}
      s.epoch=Utilities.getUuid();
      // One JSON property publishes authoritative DB pointer + round + epoch together, under the stock write lock.
      s.operations.push({uuid:ctx.uuid,hash:hash,result:{active:!!s.active,reset:!restoring,restored:restoring}});
      s.operations=s.operations.slice(-6);s.archives=s.archives.slice(-6);
      s.current_db_id=replacement;realTrialSave_(s);
      // Keep legacy/editor helpers synchronized; db_ and prop_ use the authoritative JSON pointer above.
      try{p.setProperties({DB_ID:replacement,DB_ID_PREVIOUS:id,INFLIGHT:'',REPAIRS:'{}'});}catch(syncError){Logger.log('Real-trial legacy pointer sync requires review');}
      resetDb_();bumpVer_('CATALOG_VER');bumpVer_('DATA_VER');
      audit_(ctx.user.code,ctx.action,'REAL_TRIAL',round,{previous_db_retained:true,reset_to_zero:!restoring,access_preserved:true});
      return {active:!!s.active,reset:!restoring,restored:restoring};
    }
    s.operations.push({uuid:ctx.uuid,hash:hash,result:out});realTrialSave_(s);
    audit_(ctx.user.code,ctx.action,'REAL_TRIAL',out.generation,{zero_baseline_saved:true});return out;
  }finally{TRAINING_SCOPE_=null;resetDb_();lock.releaseLock();}
}
function realTrialSeedOp_(ctx,d){
  if(d.confirm!=='เติมข้อมูลทดสอบจริง')throw appErr_('CONFIRM_REQUIRED','พิมพ์ เติมข้อมูลทดสอบจริง เพื่อยืนยัน');
  realTrialGuard_(ctx);
  const original=String(ctx.uuid||'');if(!/^[0-9a-zA-Z-]{16,64}$/.test(original))throw appErr_('BAD_UUID','ไม่มีรหัสรายการ');
  ctx.uuid=sha_('REAL|'+ctx.real_epoch+'|'+original);
  return runOp_(ctx,ctx.action,d,function(w){
    const s=realTrialState_(),a=s.active;
    if(!a||a.generation!==d.generation||a.db_id!==db_().getId())throw appErr_('REAL_TRIAL_CHANGED','ไม่มีรอบทดสอบจริงนี้');
    const tag='REALTEST-'+a.generation;
    const prior=T_('RECEIPTS').rows.filter(function(x){return String(x.invoice_no)===tag;})[0];
    if(prior)return {already_seeded:true,rcv_id:prior.rcv_id};
    const method=String(cfg_('cost_method',''));
    if(!method){if(['AVG','FIFO'].indexOf(d.cost_method)<0)throw appErr_('COST_METHOD_REQUIRED','เลือกวิธีคิดต้นทุนก่อนเติมข้อมูล');cfgSet_(w,'cost_method',d.cost_method);}
    const quote=trainingQuote_(),unitIds={};
    quote.forEach(function(x){[x.base_unit,x.unit].forEach(function(n){if(unitIds[n])return;let u=unitByName_(n);if(!u)u=w.insert('UNITS',{unit_id:newId_('UNIT'),name:n,aliases:'',active:true});unitIds[n]=u.unit_id;});});
    let cat=T_('CATEGORIES').rows.filter(function(x){return x.name==='วัสดุสำนักงาน'&&isTrue_(x.active);})[0];
    if(!cat)cat=w.insert('CATEGORIES',{cat_id:newId_('CAT'),name:'วัสดุสำนักงาน',order:1,active:true});
    const ts=now_(),items=quote.map(function(x,i){
      const id=newId_('MAT'),code='RT-'+a.generation.slice(0,6)+'-'+pad_(i+1,2);
      w.insert('MATERIALS',{mat_id:id,code:code,name:x.name,spec:'ทดสอบในฐานจริง '+tag,keywords:tag,type_id:'',cat_id:cat.cat_id,unit_id:unitIds[x.base_unit],
        reorder_point:0,reorder_qty:0,max_per_request:0,balance:0,reserved:0,stock_value:0,avg_cost:0,last_cost:0,active:true,created_at:ts,updated_at:ts});
      if(x.factor!==1)w.insert('MATERIAL_UNITS',{mu_id:newId_('MU'),mat_id:id,unit_id:unitIds[x.unit],factor_to_base:x.factor,is_default_purchase:true,active:true});
      return {mat_id:id,qty:x.qty,unit_id:unitIds[x.unit],unit_price:x.price};
    });
    const result=apiReceive_(ctx,{items:items,sup_name:'บริษัท สยามออฟฟิศซัพพลาย จำกัด (ข้อมูลทดสอบ)',invoice_no:tag,
      note:'ทดสอบฐานจริง: ก่อน VAT 6,811 บาท; VAT 476.77; รวม 7,287.77 — ต้นทุนในชุดนี้ก่อน VAT'},w);
    w.after(function(){const latest=realTrialState_();if(latest.active&&latest.active.generation===a.generation){latest.active.seeded=true;realTrialSave_(latest);}});
    return Object.assign(result,{materials:10,subtotal:6811});
  });
}

/** Owner installation checks; never exposed as API routes and never invent an app-user actor. */
function startRealTrialForOwner(){return realTrialOwner_('realTrial.start',{confirm:'เริ่มทดสอบจริง'});}
function seedRealTrialForOwner(){const s=realTrialState_();return realTrialOwner_('realTrial.seed',{confirm:'เติมข้อมูลทดสอบจริง',generation:s.active?s.active.generation:'',cost_method:'AVG'});}
function resetRealTrialForOwner(){const s=realTrialState_();return realTrialOwner_('realTrial.reset',{confirm:'ล้างกลับยอด 0',generation:s.active?s.active.generation:''});}
function realTrialOwner_(action,data){TRAINING_SCOPE_=null;resetDb_();const ctx={user:{code:'EDITOR_OWNER',name:'เจ้าของโครงการ (ตรวจรอบทดสอบจริง)',role:'ADMIN'},uuid:Utilities.getUuid(),action:action,real_epoch:realTrialEpoch_()};
 const result=action==='realTrial.seed'?realTrialSeedOp_(ctx,data):realTrialControl_(ctx,data);Logger.log(JSON.stringify(Object.assign({},result,{epoch:realTrialEpoch_()})));return result;}
