'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {parseHTML}=require(process.env.LINKEDOM_PATH || 'linkedom');
const web=process.env.WEB_ROOT || path.resolve(__dirname,'../../../supply');
const gen='12345678-1234-1234-1234-123456789abc';
function storage(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};}
function code(n){return fs.readFileSync(path.join(web,'assets/js',n),'utf8');}
function env(){
 const local=storage(),session=storage(),calls=[];
 const ctx=vm.createContext({window:{APP_CONFIG:{API_URL:'https://example.test/api'}},localStorage:local,sessionStorage:session,
 indexedDB:{open(){throw Error('memory fallback');}},navigator:{onLine:true},setTimeout,clearTimeout,console,
 U:{uuid:()=>require('crypto').randomUUID()},fetch:async(url,opt)=>{calls.push(JSON.parse(opt.body));return {ok:true,text:async()=>JSON.stringify({ok:true,data:{ok:true}})};}});
 vm.runInContext(code('store.js')+'\n'+code('api.js')+'\nthis.x={Store,API,Outbox};',ctx);
 return {ctx,...ctx.x,local,session,calls};
}
test('catalog, cart and outbox storage remain separate across practice, live and generations',async()=>{
 const e=env();e.Store.ls.set('cart:U014',{real:1});await e.Store.set('catalog:U014',{live:true});
 e.API.setTraining(gen);e.Store.ls.set('cart:U014',{practice:1});await e.Store.set('catalog:U014',{training:true});
 assert.equal(e.Store.ls.get('cart:U014').practice,1);assert.equal((await e.Store.get('catalog:U014')).training,true);
 e.API.setTraining('');assert.equal(e.Store.ls.get('cart:U014').real,1);assert.equal((await e.Store.get('catalog:U014')).live,true);
 e.API.setTraining('abcdefab-1234-1234-1234-123456789abc');assert.equal(e.Store.ls.get('cart:U014',null),null);
});
test('training requests carry exact generation; management and auth use real session; cross-mode outbox refuses send',async()=>{
 const e=env();e.API.setToken('synthetic-token');e.API.setTraining(gen);
 await e.API.call('catalog');await e.API.call('training.status');await e.API.call('login');
 assert.equal(e.calls[0].training,gen);assert.equal(e.calls[1].training,undefined);assert.equal(e.calls[2].training,undefined);
 e.Outbox.load('U014');const it=e.Outbox.add({items:[]});assert.equal(it.scope,gen);
 e.API.setTraining('');await assert.rejects(()=>e.Outbox.send(it),x=>x.code==='SCOPE_CHANGED');
 assert.equal(e.calls.length,3);
});
function ui(role,scope,active){
 const {document}=parseHTML('<html><body><div id="v"></div></body></html>'),views={};
 const status={active,generation:active?gen:'',created_at:'2026-11-07',quote:[{name:'ตัวอย่าง',qty:15,unit:'รีม',price:120,total:1800}],supplier:'ผู้จำหน่ายตัวอย่าง',subtotal:6811,vat:476.77,total:7287.77};
 const context=vm.createContext({document,window:{},location:{},App:{S:{user:{role}},view:(name,v)=>views[name]=v},API:{scope:()=>scope,call:async()=>status},Outbox:{pending:()=>[]},U:{$:s=>document.querySelector(s),esc:s=>String(s??'').replace(/</g,'&lt;'),thDateTime:x=>x,n:x=>x,money:x=>Number(x).toFixed(2)}});
 vm.runInContext(code('training.js'),context);return {document,views,context};
}
test('only admins see create/clear; officers see enter and quotation; inactive controls are disabled',async()=>{
 for(const [role,active] of [['ADMIN',false],['ADMIN',true],['OFFICER',true]]){
  const e=ui(role,'',active),el=e.document.querySelector('#v');await e.views.training.render(el);
  const create=e.document.querySelector('#training-create'),clear=e.document.querySelector('#training-clear');
  if(role==='ADMIN'){assert.ok(create);assert.ok(clear);assert.equal(create.hasAttribute('disabled'),active);assert.equal(clear.hasAttribute('disabled'),!active);}
  else {assert.equal(create,null);assert.equal(clear,null);assert.ok(e.document.querySelector('#training-enter'));}
  assert.match(el.textContent,/6811.00/);assert.match(el.textContent,/120 ด้าม/);
 }
});
test('cleared generation stays visibly in practice and never silently falls back to live',async()=>{
 const e=ui('OFFICER',gen,false),el=e.document.querySelector('#v');await e.views.training.render(el);
 assert.match(el.textContent,/ชุดฝึกเดิมถูกล้างแล้ว/);assert.ok(e.document.querySelector('[data-act="training-leave"]'));
});

test('admin creation disables controls, shows real waiting text, and allows the slow seed request',async()=>{
 const e=ui('ADMIN','',false),el=e.document.querySelector('#v');await e.views.training.render(el);
 let resolve,options,action;e.context.U.confirm=async()=>true;e.context.U.uuid=()=>gen;e.context.U.toast=()=>{};e.context.App.render=()=>{};
 e.context.API.call=(a,d,o)=>{action=a;options=o;return new Promise(r=>{resolve=r;});};
 const button=e.document.querySelector('#training-create');await button.onclick();
 assert.equal(action,'training.create');assert.equal(options.timeout,120000);assert.equal(options.write,true);
 assert.equal(button.disabled,true);assert.match(e.document.querySelector('#training-progress').textContent,/กำลังสร้างชุดฝึก/);
 resolve({active:true});await new Promise(setImmediate);
 assert.equal(button.disabled,false);assert.equal(e.document.querySelector('#training-progress').textContent,'');
});
