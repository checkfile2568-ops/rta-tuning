'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createEnv}=require('./gas-mock.cjs');
const path=require('node:path');
const crypto=require('node:crypto');
function setup(){
 const env=createEnv({gasDir:process.env.GAS_TEST_DIR || path.join(__dirname,'../test-gas'),strictLock:true});env.call('setup');env.call('setupDemo');
 const login=(code,pin)=>good(env.post({action:'login',data:{code,pin}})).token;
 return {env,a:login('D004','3690'),o:login('D003','1470'),u:login('D001','1357')};
}
function good(r){assert.equal(r.ok,true,JSON.stringify(r.error));return r.data;}
function denied(r,code){assert.equal(r.ok,false);assert.equal(r.error.code,code);}
function call(s,token,action,data={},training,uuid){const b={token,action,data,client_uuid:uuid||crypto.randomUUID()};if(training!==undefined)b.training=training;return s.env.post(b);}
function create(s,uuid){return good(call(s,s.a,'training.create',{confirm:'CREATE_TRAINING'},undefined,uuid));}
function rows(s,id,name){const sh=s.env.books[id].getSheetByName(name),v=sh.data,h=v[0];return v.slice(1).filter(r=>r[0]).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])));}
function stockHash(s){const b=s.env.books[s.env.props.DB_ID];return JSON.stringify(b.sheets.filter(x=>!['AUDIT_LOG','USERS','DEMO_ACCOUNTS'].includes(x.name)).map(x=>[x.name,x.data]));}

test('only admin creates/clears; real authentication still required; active-create is idempotent',()=>{
 const s=setup();denied(call(s,'bad','training.status'),'SESSION_EXPIRED');denied(call(s,s.u,'training.status'),'FORBIDDEN');
 denied(call(s,s.o,'training.create',{confirm:'CREATE_TRAINING'}),'FORBIDDEN');
 denied(call(s,s.a,'training.create',{}),'CONFIRM_REQUIRED');
 const before=stockHash(s),uuid=crypto.randomUUID(),r=create(s,uuid);assert.equal(r.active,true);assert.equal(r.subtotal,6811);
 const books=Object.keys(s.env.books).length;assert.equal(create(s,uuid).generation,r.generation);assert.equal(create(s).generation,r.generation);
 assert.equal(Object.keys(s.env.books).length,books);assert.equal(stockHash(s),before);
 denied(call(s,s.o,'training.clear',{confirm:'CLEAR_TRAINING',generation:r.generation}),'FORBIDDEN');
});
test('seed quote, pack conversion, real receipt ledger, pending/ready requests reconcile without live writes',()=>{
 const s=setup(),before=stockHash(s),r=create(s),state=JSON.parse(s.env.props.SUPPLY_TRAINING_V1),id=state.active.id;
 assert.notEqual(id,s.env.props.DB_ID);assert.equal(rows(s,id,'MATERIALS').length,10);
 const mats=good(call(s,s.o,'catalog',{},r.generation)).materials;
 assert.equal(mats.find(m=>m.code==='TRAIN-003').balance,120);assert.equal(mats.find(m=>m.code==='TRAIN-003').avg_cost,8.5);
 assert.equal(mats.reduce((a,m)=>a+m.stock_value,0),6811);
 const rc=good(call(s,s.o,'receipts',{},r.generation));assert.equal(rc.length,1);assert.equal(rc[0].total,6811);
 const q=good(call(s,s.o,'queue',{},r.generation));assert.equal(q.length,2);
 assert.ok(q.some(x=>x.status==='PENDING_PREP'));assert.ok(q.some(x=>x.status==='READY'));
 assert.equal(good(call(s,s.o,'reconcile',{},r.generation)).ok,true);assert.equal(stockHash(s),before);
});
test('officer prepare/issue/return operate on shared training DB; uuid replay and live/training cache isolation',()=>{
 const s=setup(),r=create(s),before=stockHash(s),uuid=crypto.randomUUID();
 // Warm live catalog first: training keys must not return its materials or cached reports.
 const live=good(call(s,s.o,'catalog'));assert.ok(!live.materials.some(m=>m.code==='TRAIN-001'));
 good(call(s,s.o,'dashboard'));
 const queue=good(call(s,s.o,'queue',{},r.generation)),req=queue.find(x=>x.status==='PENDING_PREP');
 good(call(s,s.o,'prepareRequest',{req_id:req.req_id},r.generation));
 const issued=good(call(s,s.o,'issueRequest',{req_id:req.req_id,receiver_name:'ผู้รับของตัวอย่าง'},r.generation,uuid));
 assert.equal(issued.status,'ISSUED');assert.equal(good(call(s,s.o,'issueRequest',{req_id:req.req_id,receiver_name:'ผู้รับของตัวอย่าง'},r.generation,uuid))._replayed,true);
 const detail=good(call(s,s.o,'getRequest',{req_id:req.req_id},r.generation));
 const first=detail.items[0];
 good(call(s,s.o,'returnItems',{req_id:req.req_id,reason:'คืนตัวอย่าง',items:[{item_id:first.item_id,qty:1}]},r.generation));
 assert.equal(good(call(s,s.o,'reconcile',{},r.generation)).ok,true);
 const cat=good(call(s,s.o,'catalog',{},r.generation));assert.equal(cat.materials.find(x=>x.code==='TRAIN-001').balance,14);
 assert.equal(stockHash(s),before);
});
test('clear archives only practice; old generations fail closed; new generation starts from exact quote',()=>{
 const s=setup(),r=create(s),before=stockHash(s),id=JSON.parse(s.env.props.SUPPLY_TRAINING_V1).active.id;
 denied(call(s,s.a,'training.clear',{confirm:'CLEAR_TRAINING',generation:'wrong'}),'TRAINING_CHANGED');
 const clear=good(call(s,s.a,'training.clear',{confirm:'CLEAR_TRAINING',generation:r.generation}));assert.equal(clear.active,false);
 assert.ok(s.env.books[id]);assert.equal(rows(s,id,'MATERIALS').length,10);
 denied(call(s,s.o,'catalog',{},r.generation),'TRAINING_CHANGED');
 denied(call(s,s.o,'receive',{items:[]},r.generation),'TRAINING_CHANGED');
 denied(call(s,s.o,'receive',{},true),'TRAINING_REQUIRED');
 const next=create(s);assert.notEqual(next.generation,r.generation);assert.equal(stockHash(s),before);
 assert.equal(good(call(s,s.o,'reconcile',{},next.generation)).ok,true);
});
test('training cannot change credentials, roles, users, config, backups or send LINE',()=>{
 const s=setup(),r=create(s);
 for(const a of ['saveAccess','forceLogout','changePin','saveProfile','saveConfig','backupNow','repairOp','login'])denied(call(s,s.a,a,{},r.generation),'TRAINING_ACTION_BLOCKED');
 denied(call(s,s.a,'receive',{items:[]},r.generation),'FORBIDDEN');
 const before=stockHash(s);good(call(s,s.o,'me',{},r.generation));assert.equal(stockHash(s),before);
});
test('injected seed failure never publishes an incomplete practice database or touches production stock',()=>{
 const s=setup(),before=stockHash(s);s.env.setFault('before_apply');
 denied(call(s,s.a,'training.create',{confirm:'CREATE_TRAINING'}),'NEEDS_REPAIR');
 assert.equal(good(call(s,s.a,'training.status')).active,false);assert.equal(stockHash(s),before);
 assert.equal(s.env.props.INFLIGHT,undefined);assert.equal(s.env.props.REPAIRS,undefined);
 s.env.setFault('');const r=create(s);assert.equal(r.active,true);
 assert.equal(good(call(s,s.o,'reconcile',{},r.generation)).ok,true);
});
test('the same client UUID is independent across live and training operations',()=>{
 const s=setup(),r=create(s),uuid=crypto.randomUUID(),before=stockHash(s);
 const train=good(call(s,s.o,'receive',{items:[{mat_id:'TRAIN-001',qty:1,unit_price:120}]},r.generation,uuid));assert.ok(train.rcv_id);
 // Existing write data in the live DB under this UUID must not be replayed from the training cache.
 const cat=good(call(s,s.o,'catalog')),m=cat.materials[0];
 const live=good(call(s,s.o,'receive',{items:[{mat_id:m.mat_id,qty:1,unit_price:120}]},undefined,uuid));
 assert.notEqual(live.rcv_id,train.rcv_id);assert.notEqual(stockHash(s),before);
 assert.equal(good(call(s,s.o,'reconcile',{},r.generation)).ok,true);
});
