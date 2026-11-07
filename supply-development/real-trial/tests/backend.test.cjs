const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {createEnv}=require('../../training/tests/gas-mock.cjs');
function setup(){
 const env=createEnv({gasDir:process.env.GAS_TEST_DIR || path.join(__dirname,'../test-gas'),strictLock:true});env.call('setup');env.call('setupDemo');
 const tx=['REQUESTS','REQUEST_ITEMS','RETURNS','OPENINGS','RECEIPTS','RECEIPT_ITEMS','ADJUSTMENTS','PO','PO_ITEMS','STOCK_LEDGER','STOCK_LOTS','STAT_MONTHLY','FY_CLOSING'];
 const book=env.books[env.props.DB_ID];tx.forEach(n=>{book.getSheetByName(n).data.splice(1);});
 const m=book.getSheetByName('MATERIALS'),h=m.data[0];for(const r of m.data.slice(1))for(const k of ['balance','reserved','stock_value','avg_cost','last_cost'])r[h.indexOf(k)]=0;
 env.call('resetDb_');const login=(code,pin)=>good(env.post({action:'login',data:{code,pin}})).token;
 return {env,a:login('D004','3690'),o:login('D003','1470'),u:login('D001','1357'),baseline:JSON.stringify(m.data)};
}
function good(r){assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;}
function bad(r,c){assert.equal(r.ok,false);assert.equal(r.error.code,c);}
function call(s,token,action,data={},epoch,uuid){return s.env.post({action,token,data,real_epoch:epoch??s.env.call('realTrialEpoch_'),client_uuid:uuid||crypto.randomUUID()});}
function start(s,uuid){return good(call(s,s.a,'realTrial.start',{confirm:'เริ่มทดสอบจริง'},undefined,uuid));}
function seed(s,r,uuid){return good(call(s,s.a,'realTrial.seed',{confirm:'เติมข้อมูลทดสอบจริง',generation:r.generation,cost_method:'AVG'},undefined,uuid));}
function reset(s,r,uuid){return good(call(s,s.a,'realTrial.reset',{confirm:'ล้างกลับยอด 0',generation:r.generation},undefined,uuid));}
function book(s){return s.env.books[s.env.call('prop_','DB_ID')];}
function rows(s,n){const sh=book(s).getSheetByName(n),[h,...rest]=sh.data;return rest.filter(x=>x[0]).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])));}
test('admin controls only; start requires exact confirmation and zero stock/documents',()=>{
 const s=setup();bad(call(s,s.o,'realTrial.start',{confirm:'เริ่มทดสอบจริง'}),'FORBIDDEN');bad(call(s,s.u,'realTrial.status'),'FORBIDDEN');
 bad(call(s,s.a,'realTrial.start',{}),'CONFIRM_REQUIRED');
 const sh=book(s).getSheetByName('MATERIALS'),ci=sh.data[0].indexOf('balance');sh.data[1][ci]=1;
 bad(call(s,s.a,'realTrial.start',{confirm:'เริ่มทดสอบจริง'}),'REAL_TRIAL_NOT_ZERO');sh.data[1][ci]=0;
 const uuid=crypto.randomUUID(),r=start(s,uuid);assert.equal(r.active,true);assert.equal(start(s,uuid)._replayed,true);
 bad(call(s,s.a,'realTrial.start',{confirm:'เริ่มทดสอบจริง'}),'REAL_TRIAL_ACTIVE');
});
test('seed posts a real receipt and stock; retry cannot duplicate; real users request, issue and return',()=>{
 const s=setup(),r=start(s),uuid=crypto.randomUUID(),x=seed(s,r,uuid);assert.equal(x.total,6811);assert.equal(seed(s,r,uuid)._replayed,true);assert.equal(seed(s,r).already_seeded,true);
 assert.equal(rows(s,'RECEIPTS').length,1);const m=rows(s,'MATERIALS').find(x=>x.name.includes('Double A'));
 assert.equal(m.balance,15);const pen=rows(s,'MATERIALS').find(x=>x.keywords&&x.name.includes('กล่อง 10 ด้าม'));assert.equal(pen.balance,120);assert.equal(pen.avg_cost,8.5);
 const req=good(call(s,s.o,'submitRequest',{items:[{mat_id:m.mat_id,qty:2}],purpose:'ทดสอบจริง'}));
 good(call(s,s.o,'prepareRequest',{req_id:req.req_id}));good(call(s,s.o,'issueRequest',{req_id:req.req_id,receiver_name:'ผู้รับทดสอบ'}));
 const detail=good(call(s,s.o,'getRequest',{req_id:req.req_id}));good(call(s,s.o,'returnItems',{req_id:req.req_id,reason:'ทดสอบคืน',items:[{item_id:detail.items[0].item_id,qty:1}]}));
 assert.equal(rows(s,'MATERIALS').find(x=>x.mat_id===m.mat_id).balance,14);assert.equal(good(call(s,s.o,'reconcile')).ok,true);
});
test('reset returns all inventory edits/additions to the zero baseline, preserves latest access and archives full trial',()=>{
 const s=setup(),r=start(s);seed(s,r);const old=book(s).getId();
 const material=good(call(s,s.o,'catalog')).materials[0];good(call(s,s.o,'saveMaterial',{...material,name:'แก้ไขระหว่างทดสอบ',unit_id:material.unit_id,cat_id:material.cat_id,units:[]}));
 const users=book(s).getSheetByName('USERS'),h=users.data[0],u=users.data.find(x=>x[0]==='D001');u[h.indexOf('position')]='ตำแหน่งล่าสุด';
 const uuid=crypto.randomUUID();reset(s,r,uuid);assert.equal(good(call(s,s.a,'realTrial.reset',{confirm:'ล้างกลับยอด 0',generation:r.generation},undefined,uuid))._replayed,true);
 assert.notEqual(book(s).getId(),old);assert.ok(s.env.books[old]);assert.equal(s.env.books[old].getSheetByName('RECEIPTS').getLastRow(),2);
 assert.equal(JSON.stringify(book(s).getSheetByName('MATERIALS').data),s.baseline);assert.equal(rows(s,'RECEIPTS').length,0);assert.equal(rows(s,'REQUESTS').length,0);
 assert.equal(rows(s,'USERS').find(x=>x.user_code==='D001').position,'ตำแหน่งล่าสุด');assert.equal(good(call(s,s.o,'reconcile')).ok,true);
 assert.equal(good(call(s,s.o,'realTrial.status')).zero.ok,true);
});
test('stale tabs and successful pre-reset UUIDs fail closed after reset; missing epoch cannot write',()=>{
 const s=setup(),r=start(s),epoch=s.env.call('realTrialEpoch_'),id=crypto.randomUUID();seed(s,r);const m=rows(s,'MATERIALS')[0];
 good(call(s,s.o,'saveMaterial',{...m,name:m.name,units:[]},epoch,id));reset(s,r);
 bad(call(s,s.o,'saveMaterial',{...m,name:m.name,units:[]},epoch,id),'REAL_WORKSPACE_CHANGED');
 bad(s.env.post({token:s.o,action:'submitRequest',client_uuid:crypto.randomUUID(),data:{items:[]}}),'REAL_WORKSPACE_CHANGED');
 const before=JSON.stringify(book(s).getSheetByName('MATERIALS').data);bad(call(s,s.o,'receive',{items:[]},epoch),'REAL_WORKSPACE_CHANGED');assert.equal(JSON.stringify(book(s).getSheetByName('MATERIALS').data),before);
});
test('practice workspace remains active and unchanged after real trial/reset; training can still issue',()=>{
 const s=setup(),practice=good(call(s,s.a,'training.create',{confirm:'CREATE_TRAINING'})),before=s.env.props.SUPPLY_TRAINING_V1;
 const r=start(s);seed(s,r);reset(s,r);assert.equal(s.env.props.SUPPLY_TRAINING_V1,before);
 const tr=(action,data={})=>s.env.post({action,token:s.o,data,training:practice.generation,client_uuid:crypto.randomUUID()});
 const q=good(tr('queue'));good(tr('issueRequest',{req_id:q[0].req_id,receiver_name:'ทดสอบจำลอง'}));assert.equal(good(tr('reconcile')).ok,true);assert.equal(good(call(s,s.o,'realTrial.status')).zero.ok,true);
});
test('recover latest pre-reset archive through admin UI action without permanent deletion',()=>{
 const s=setup(),r=start(s);seed(s,r);reset(s,r);
 const status=good(call(s,s.a,'realTrial.status'));assert.equal(status.can_restore,true);
 good(call(s,s.a,'realTrial.restore',{confirm:'กู้คืนก่อนล้าง',archive_generation:status.archive_generation}));assert.equal(rows(s,'RECEIPTS').length,1);assert.equal(good(call(s,s.o,'reconcile')).ok,true);
 const live=good(call(s,s.a,'realTrial.status'));assert.equal(live.active,true);reset(s,live);assert.equal(good(call(s,s.o,'realTrial.status')).zero.ok,true);
});
test('copy failure leaves active database pointer and stock intact',()=>{
 const s=setup(),r=start(s);seed(s,r);const id=book(s).getId(),before=JSON.stringify(book(s).getSheetByName('MATERIALS').data);
 const original=s.env.ctx.DriveApp.getFileById;s.env.ctx.DriveApp.getFileById=()=>{throw Error('simulated backup failure');};
 assert.equal(call(s,s.a,'realTrial.reset',{confirm:'ล้างกลับยอด 0',generation:r.generation}).ok,false);
 s.env.ctx.DriveApp.getFileById=original;assert.equal(book(s).getId(),id);assert.equal(JSON.stringify(book(s).getSheetByName('MATERIALS').data),before);
});
test('restore refuses to overwrite new catalog edits even when stock is still zero',()=>{
 const s=setup(),r=start(s);seed(s,r);reset(s,r);const status=good(call(s,s.a,'realTrial.status')),m=good(call(s,s.o,'catalog')).materials[0];
 good(call(s,s.o,'saveMaterial',{...m,name:'งานใหม่หลังล้าง',units:[]}));
 bad(call(s,s.a,'realTrial.restore',{confirm:'กู้คืนก่อนล้าง',archive_generation:status.archive_generation}),'REAL_TRIAL_CHANGED');
 assert.equal(rows(s,'MATERIALS').find(x=>x.mat_id===m.mat_id).name,'งานใหม่หลังล้าง');
});
test('LINE notifications are suppressed during the real trial without changing saved LINE settings',()=>{
 const s=setup();start(s);s.env.props.LINE_CHANNEL_TOKEN='synthetic';s.env.props.LINE_TO='synthetic';
 const cfg=book(s).getSheetByName('CONFIG'),line=cfg.data.find(x=>x[0]==='line_notify_enabled');line[1]=true;s.env.call('resetDb_');
 let sent=0;s.env.ctx.UrlFetchApp.fetch=()=>{sent++;throw Error('should not send');};
 s.env.call('notifyNewRequest_',{},1);assert.equal(sent,0);assert.equal(line[1],true);
});
