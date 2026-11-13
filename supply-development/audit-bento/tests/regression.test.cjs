'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {parseHTML}=require(process.env.LINKEDOM_PATH||'linkedom');
const {IDBFactory}=require(process.env.FAKE_IDB_PATH||'fake-indexeddb');
const web=path.resolve(__dirname,'../../../supply'),source=n=>fs.readFileSync(path.join(web,'assets/js',n),'utf8');
function storage(){const m=new Map();return {m,get length(){return m.size},key:i=>[...m.keys()][i]??null,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}}
const epoch='11111111-1111-4111-8111-111111111111',gen='22222222-2222-4222-8222-222222222222';
function apiEnv(opts={}){
 const calls=[],local=opts.local||storage(),session=opts.session||storage();let next=0;
 const ctx=vm.createContext({window:{APP_CONFIG:{API_URL:'https://synthetic.invalid'},AbortController},App:{S:{user:{code:'U1'}}},localStorage:local,sessionStorage:session,indexedDB:opts.indexedDB||{open(){throw Error('memory fallback')}},navigator:{onLine:true},setTimeout,clearTimeout,AbortController,U:{uuid:()=>`synthetic-${++next}`},
 fetch:async(url,o)=>{const b=JSON.parse(o.body);calls.push(b);if(opts.fetch)return opts.fetch(b);return {text:async()=>JSON.stringify({ok:true,realEpoch:epoch,data:{ok:true}})}}});
 vm.runInContext(source('store.js')+'\n'+source('api.js')+'\nthis.x={Store,API};',ctx);
 return {...ctx.x,ctx,calls,local,session};
}
const response=(data={})=>({text:async()=>JSON.stringify({ok:true,realEpoch:epoch,data})});
test('receipt lost response retries same UUID after reload; changed draft is blocked until resolved',async()=>{
 const committed=new Map();let lose=true;
 const fetch=async b=>{if(b.action==='me')return response();if(!committed.has(b.client_uuid))committed.set(b.client_uuid,{rcv_no:'R1',total:1200});if(lose){lose=false;throw Error('response lost AFTER commit')}return response(committed.get(b.client_uuid))};
 let e=apiEnv({fetch});await e.API.call('me');const data={invoice_no:'SYNTHETIC',items:[{mat_id:'M1',qty:12,unit_price:100}]};
 await assert.rejects(()=>e.API.write('receive',data),x=>x.code==='NETWORK');const first=e.API.pendingWrite('receive').uuid;
 e=apiEnv({fetch,local:e.local,session:e.session});await e.API.call('me');
 await assert.rejects(()=>e.API.write('receive',{...data,invoice_no:'CHANGED'}),x=>x.code==='WRITE_UNRESOLVED');
 const r=await e.API.write('receive',data);assert.equal(r.rcv_no,'R1');assert.equal(committed.size,1);assert.equal(e.calls.at(-1).client_uuid,first);assert.equal(e.API.pendingWrite('receive'),null);
});
test('opening-import retries preserve batch UUID and coalesce double submit',async()=>{
 let resolve,attempt=0;const e=apiEnv({fetch:async b=>{if(b.action==='me')return response();attempt++;return new Promise(r=>resolve=r)}});await e.API.call('me');
 const d={source:'synthetic',rows:[{line:2,name:'paper',qty:3}]};const a=e.API.write('importOpenings',d),b=e.API.write('importOpenings',d);assert.equal(attempt,1);
 resolve(response({batch_no:'B1'}));assert.deepEqual(await a,await b);assert.equal(e.API.pendingWrite('importOpenings'),null);
});
test('known validation rejection allows correction; unknown server failure retains the original draft',async()=>{
 let code='BAD_QTY';const e=apiEnv({fetch:async b=>b.action==='me'?response():{text:async()=>JSON.stringify({ok:false,error:{code,message:code},realEpoch:epoch})}});await e.API.call('me');
 await assert.rejects(()=>e.API.write('receive',{items:[]}),x=>x.code==='BAD_QTY');assert.equal(e.API.pendingWrite('receive'),null);
 code='INTERNAL';await assert.rejects(()=>e.API.write('receive',{items:[{qty:1}]}));assert.ok(e.API.pendingWrite('receive'));
});
test('write fails before network when persistent storage is unavailable',async()=>{
 const local=storage();local.setItem=()=>{throw Error('storage full')};const e=apiEnv({local});await e.API.call('me');
 await assert.rejects(()=>e.API.write('receive',{items:[]}),x=>x.code==='STORAGE_UNAVAILABLE');assert.equal(e.calls.length,1);
});
test('opening row validation releases an uncommitted batch so rows can be corrected',async()=>{
 let error=true;const e=apiEnv({fetch:async b=>b.action==='me'?response():error?{text:async()=>JSON.stringify({ok:false,realEpoch:epoch,error:{code:'ITEM_ERRORS',message:'invalid synthetic row'}})}:response({batch_no:'B2'})});await e.API.call('me');
 await assert.rejects(()=>e.API.write('importOpenings',{source:'synthetic',rows:[{qty:-1}]}),x=>x.code==='ITEM_ERRORS');assert.equal(e.API.pendingWrite('importOpenings'),null);
 error=false;const r=await e.API.write('importOpenings',{source:'synthetic',rows:[{qty:2}]});assert.equal(r.batch_no,'B2');
});
test('late network failure cannot restore private draft after logout',async()=>{
 let reject;const e=apiEnv({fetch:async b=>b.action==='me'?response():new Promise((r,j)=>reject=j)});await e.API.call('me');e.API.setToken('old');
 const p=e.API.write('receive',{items:[]});e.API.setToken('');await e.Store.clearUser('U1');reject(Error('network'));await assert.rejects(()=>p);assert.equal(e.API.pendingWrite('receive'),null);
});
test('logout removes only exact user data in every scope from localStorage and real IndexedDB',async()=>{
 const e=apiEnv({indexedDB:new IDBFactory()});
 for(const g of ['',gen]){e.Store.setScope(g);for(const ep of ['',epoch]){e.Store.setEpoch(ep);for(const u of ['U1','U10']){for(const k of ['cart','purpose','outbox','write'])e.Store.ls.set(k+':'+u,{private:true});await e.Store.set('catalog:'+u,{private:true})}}}
 e.Store.ls.set('last_acct',{code:'U1'});await e.Store.clearUser('U1');
 assert.ok([...e.local.m.keys()].some(k=>k.endsWith(':U10')));assert.ok(![...e.local.m.keys()].some(k=>k.endsWith(':U1')));
 for(const g of ['',gen]){e.Store.setScope(g);for(const ep of ['',epoch]){e.Store.setEpoch(ep);assert.equal(await e.Store.get('catalog:U1'),undefined);assert.equal((await e.Store.get('catalog:U10')).private,true)}}
 assert.equal(e.Store.ls.get('last_acct').code,'U1');
});
function ui(){
 const {window,document}=parseHTML('<html><body><div id="v"></div></body></html>');window.HTMLElement.prototype.scrollIntoView=function(){};
 const mat={mat_id:'M1',code:'P1',name:'ปากกาน้ำเงิน',unit_id:'PEN',unit_name:'ด้าม',balance:0,last_cost:10,active:true};
 const S={user:{code:'U1',role:'OFFICER',dept_id:'D1',name:'บัญชีจำลอง'},forms:{},cfg:{cost_method:'FIFO'},me:{openMonths:[],counts:{}},catalog:{materials:[mat],units:[{unit_id:'PEN',name:'ด้าม'},{unit_id:'BOX',name:'กล่อง'}],categories:[],material_units:[]},idx:{M1:mat},depts:[]};
 const views={},exports=[],calls=[],ctx=vm.createContext({window,document,App:{S,view:(n,v)=>views[n]=v,refreshCatalog:async()=>S.catalog,render(){},errorBox:e=>e.message},ICON:()=>'',stBadge:()=>'',setTimeout,clearTimeout,Intl,Date,TextDecoder,API:{scope:()=>'',call:async a=>{calls.push(a);return []},write:async()=>({})},location:{hash:''}});
 vm.runInContext(source('util.js')+'\nthis.U=U;',ctx);ctx.U.confirm=async()=>true;ctx.U.toast=()=>{};ctx.U.exportXlsx=(name,sheets)=>exports.push({name,sheets});
 vm.runInContext(source('officer.js')+'\n'+source('receive-import.js')+'\nthis.RcvImport=RcvImport;',ctx);
 return {ctx,S,views,document,window,exports,calls};
}
test('unknown unit is blocked, including direct apply invocation, until explicit valid unit selection',async()=>{
 const e=ui(),F={lines:[]};e.document.querySelector('#v').innerHTML=e.ctx.RcvImport.toolbarHtml();e.ctx.U.modal=async()=>({t:'รหัสวัสดุ\tชื่อวัสดุ\tหน่วย\tจำนวน\tราคาต่อหน่วย\nP1\tปากกาน้ำเงิน\tกล่อง\t12\t100'});
 e.ctx.RcvImport.mount(F,()=>{});await e.document.querySelector('#ri-paste').onclick();assert.equal(F.imp.rows[0].unit_id,'');assert.equal(e.document.querySelector('#ri-apply').disabled,true);
 await e.document.querySelector('#ri').onclick({target:e.document.querySelector('#ri-apply')});assert.equal(F.lines.length,0);
 const select=e.document.querySelector('[data-k=unit_id]');select.querySelector('option[value=""]').selected=false;select.querySelector('option[value="PEN"]').selected=true;await e.document.querySelector('#ri').onchange({target:select});assert.equal(e.document.querySelector('#ri-apply').disabled,false);
 await e.document.querySelector('#ri').onclick({target:e.document.querySelector('#ri-apply')});assert.equal(F.lines[0].unit_id,'PEN');
});
test('registered conversion keeps 12 boxes = 120 pens, total 1200, with an updating preview',async()=>{
 const e=ui();e.S.catalog.material_units=[{mat_id:'M1',unit_id:'BOX',unit_name:'กล่อง',factor:10}];const F={lines:[]};
 e.document.querySelector('#v').innerHTML=e.ctx.RcvImport.toolbarHtml();e.ctx.U.modal=async()=>({t:'รหัสวัสดุ\tชื่อวัสดุ\tหน่วย\tจำนวน\tราคาต่อหน่วย\nP1\tปากกาน้ำเงิน\tกล่อง\t12\t100'});e.ctx.RcvImport.mount(F,()=>{});await e.document.querySelector('#ri-paste').onclick();
 assert.equal(e.document.querySelector('#ri-apply').disabled,false);assert.match(e.document.querySelector('[data-conversion]').textContent,/120 ด้าม/);assert.match(e.document.querySelector('[data-conversion]').textContent,/1,200/);
 const input=e.document.querySelector('[data-k=qty]');input.value='13';e.document.querySelector('#ri').oninput({target:input});assert.match(e.document.querySelector('[data-conversion]').textContent,/130 ด้าม/);
 await e.document.querySelector('#ri').onclick({target:e.document.querySelector('#ri-apply')});assert.equal(F.lines[0].unit_id,'BOX');assert.equal(F.lines[0].qty,13);
});
test('incomplete history blocks detail export and offers clearly labelled summary only',async()=>{
 const e=ui(),h={ts:'2026-11-01',req_no:'R1',name:'ปากกา',qty:1,unit:'ด้าม'};
 e.ctx.API.call=async()=>({history:[h],history_total:501,summary:[{name:'ปากกา',qty:501,times:501,unit:'ด้าม'}],dept_id:'D1',dept_name:'ส่วนงานจำลอง',my_dept_id:'D1',fy:2570});
 vm.runInContext(source('dash.js'),e.ctx);await e.views.dash.render(e.document.querySelector('#v'));assert.equal(e.document.querySelector('#xl').disabled,true);
 e.document.querySelector('#xl').onclick();assert.equal(e.exports.length,0);assert.doesNotMatch(e.document.querySelector('#v').textContent,/ส่งออก Excel เพื่อดูทั้งหมด/);
 e.document.querySelector('#xl-summary').onclick();assert.equal(e.exports[0].sheets.length,1);assert.match(e.exports[0].name,/ไม่มีรายละเอียดรายใบ/);
});
test('complete history beyond 500 records exports all details',async()=>{
 const e=ui(),history=Array.from({length:650},(_,i)=>({ts:'2026-11-01',req_no:'R'+i,name:'ปากกา',qty:1,unit:'ด้าม'}));
 e.ctx.API.call=async()=>({history,history_total:650,summary:[{name:'ปากกา',qty:650,times:650,unit:'ด้าม'}],kpi:{lines_issued:650},dept_id:'D1',dept_name:'ส่วนงานจำลอง',my_dept_id:'D1',fy:2570});vm.runInContext(source('dash.js'),e.ctx);
 await e.views.dash.render(e.document.querySelector('#v'));assert.equal(e.document.querySelector('#xl').disabled,false);e.document.querySelector('#xl').onclick();assert.equal(e.exports[0].sheets[1].rows.length,650);
});
test('receipt recovery restores immutable payload and uses original request after a refresh',async()=>{
 const e=ui(),p={uuid:'synthetic',data:{sup_name:'ร้านจำลอง',rcv_date:'2026-11-13',invoice_no:'INV1',note:'original',items:[{mat_id:'M1',unit_id:'PEN',qty:12,unit_price:100}]}};let written;
 e.ctx.API.pendingWrite=a=>a==='receive'?p:null;e.ctx.API.call=async a=>a==='masters'?{suppliers:[]}:[];e.ctx.API.write=async(a,d)=>{written=d;return {rcv_no:'R1',total:1200}};
 await e.views.receive.render(e.document.querySelector('#v'));assert.equal(e.document.querySelector('#sup').disabled,true);assert.match(e.document.querySelector('#save').textContent,/รายการเดิม/);
 await e.document.querySelector('#save').onclick();assert.equal(written,p.data);assert.equal(e.S.forms.receive,null);
});
test('admin Bento overview retains management destinations and renders real response values',async()=>{
 const e=ui();e.S.user.role='ADMIN';e.ctx.API.call=async()=>({can_value:true,kpi:{req_count:17,lines_issued:34,value_issued:1200,inventory_value:2500,inventory_items:2,lead_alert_days:3,open_over_days:0}});
 vm.runInContext(source('admin.js')+'\nthis.Admin=Admin;',e.ctx);await e.ctx.Admin.home(e.document.querySelector('#v'));
 assert.ok(e.document.querySelector('.bento-surface'));assert.equal(e.document.querySelector('#k').children.length,5);assert.match(e.document.querySelector('#k').textContent,/17/);
 for(const route of ['users','settings','backup','reconcile','training','real-trial'])assert.ok(e.document.querySelector('a[href="#/'+route+'"]'));
});
test('requester Bento shortcuts do not introduce management destinations',async()=>{
 const e=ui();e.S.user.role='USER';e.S.cart={};e.S.me.frequent=[];e.ctx.App.ROLE_TH={USER:'ผู้ขอเบิก'};e.ctx.App.saveCart=()=>{};
 vm.runInContext(source('user.js'),e.ctx);await e.views.home.render(e.document.querySelector('#v'));
 for(const route of ['my','dash','profile','req'])assert.ok(e.document.querySelector('a[href="#/'+route+'"]'));
 for(const route of ['users','settings','receive','reconcile'])assert.equal(e.document.querySelector('a[href="#/'+route+'"]'),null);
});
test('receipt fields are locked while the immutable request is in flight',async()=>{
 const e=ui();let pending=null,resolve;e.S.forms.receive={sup:'ร้านจำลอง',date:'2026-11-13',inv:'I1',note:'',lines:[{mat_id:'M1',unit_id:'PEN',qty:2,price:10}]};
 e.ctx.API.call=async a=>a==='masters'?{suppliers:[]}:[];e.ctx.API.pendingWrite=()=>pending;
 e.ctx.API.write=(a,d)=>{pending={uuid:'synthetic',data:d};return new Promise(r=>resolve=x=>{pending=null;r(x)})};
 await e.views.receive.render(e.document.querySelector('#v'));const operation=e.document.querySelector('#save').onclick();await new Promise(setImmediate);
 assert.equal(e.document.querySelector('#inv').disabled,true);assert.equal(e.document.querySelector('#pick').disabled,true);
 resolve({rcv_no:'R1',total:20});await operation;
});
