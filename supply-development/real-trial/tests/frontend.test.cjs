const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {parseHTML}=require(process.env.LINKEDOM_PATH || 'linkedom');
const web=process.env.WEB_ROOT || path.resolve(__dirname,'../../../supply');
const code=n=>fs.readFileSync(path.join(web,'assets/js',n),'utf8');
function storage(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};}
function api(){let reply='EPOCH-A';const calls=[],ctx=vm.createContext({window:{APP_CONFIG:{API_URL:'https://example.test/api'}},localStorage:storage(),sessionStorage:storage(),indexedDB:{open(){throw Error();}},navigator:{onLine:true},setTimeout,clearTimeout,U:{uuid:()=>require('crypto').randomUUID()},fetch:async(u,o)=>{calls.push(JSON.parse(o.body));return {text:async()=>JSON.stringify({ok:true,data:{},realEpoch:reply})};}});
 vm.runInContext(code('store.js')+'\n'+code('api.js')+'\nthis.x={Store,API,Outbox}',ctx);return {...ctx.x,calls,reply:x=>reply=x};}
test('live cart, catalog and outbox are isolated by server epoch and independent of practice generation',async()=>{
 const e=api();await e.API.call('me');e.Store.ls.set('cart:U014',{old:1});await e.Store.set('catalog:U014',{old:true});e.Store.setEpoch('EPOCH-B');assert.equal(e.Store.ls.get('cart:U014',null),null);assert.equal(await e.Store.get('catalog:U014'),undefined);
 e.Store.ls.set('cart:U014',{fresh:1});e.API.setTraining('12345678-1234-1234-1234-123456789abc');assert.equal(e.Store.ls.get('cart:U014',null),null);e.API.setTraining('');assert.equal(e.Store.ls.get('cart:U014').fresh,1);
});
test('old tab sees epoch change, keeps its old epoch, and cannot send any live write',async()=>{
 const e=api();await e.API.call('me');let notified=0;e.API.on('workspace',()=>notified++);e.reply('EPOCH-B');await e.API.call('catalog');assert.equal(e.API.epoch(),'EPOCH-A');assert.equal(notified,1);
 await assert.rejects(()=>e.API.write('receive',{}),x=>x.code==='REAL_WORKSPACE_CHANGED');assert.equal(e.calls.length,2);
});
test('outbox records its epoch and refuses cross-round submission even if called directly',async()=>{
 const e=api();await e.API.call('me');e.Outbox.load('U014');const it=e.Outbox.add({items:[]});assert.equal(it.real_epoch,'EPOCH-A');it.real_epoch='OLD';await assert.rejects(()=>e.Outbox.send(it),x=>x.code==='REAL_WORKSPACE_CHANGED');assert.equal(e.calls.length,1);
});
function ui(role,scope='',active=true){const {document}=parseHTML('<html><body><div id="v"></div></body></html>'),views={},calls=[];const r={active,generation:'ROUND',seeded:false,can_restore:false,zero:{ok:!active,materials:5}};
 const ctx=vm.createContext({document,location:{reload(){},hash:''},API:{scope:()=>scope,call:async(a,d,o)=>{calls.push({a,d,o});return r;}},App:{S:{user:{role}},view:(k,v)=>views[k]=v,render(){},refreshMe:async()=>{}},U:{$:s=>document.querySelector(s),n:x=>x,uuid:()=> '12345678-1234-1234-1234-123456789abc',toast(){},modal:async()=>({confirm:'ผิด'})}});
 vm.runInContext(code('real-trial.js'),ctx);return {document,ctx,calls,render:()=>views['real-trial'].render(document.querySelector('#v'))};}
test('only admin gets real-trial controls; officer gets operational guidance, practice requires explicit exit',async()=>{
 const a=ui('ADMIN');await a.render();assert.ok(a.document.querySelector('#rt-reset'));const o=ui('OFFICER');await o.render();assert.equal(o.document.querySelector('#rt-reset'),null);
 const p=ui('ADMIN','PRACTICE');await p.render();assert.equal(p.calls.length,0);assert.ok(p.document.querySelector('[data-act="training-leave"]'));
});
test('reset requires the exact typed phrase and sends generation plus a guarded workspace switch',async()=>{
 const e=ui('ADMIN');await e.render();await e.document.querySelector('#rt-reset').onclick();assert.equal(e.calls.length,1);
 e.ctx.U.modal=async()=>({confirm:'ล้างกลับยอด 0'});await e.document.querySelector('#rt-reset').onclick();assert.equal(e.calls.length,2);const r=e.calls[1];assert.equal(r.a,'realTrial.reset');assert.equal(r.d.generation,'ROUND');assert.equal(r.o.workspaceSwitch,true);assert.equal(r.o.write,true);
});
