const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {parseHTML}=require(process.env.LINKEDOM_PATH || 'linkedom');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../../../supply/assets/js/app.js'),'utf8').split('const Login = ')[1];
const account={code:'U014',name:'พัสดุ ส่วนคลัง',dept:'ส่วนคลัง',ready:true};
function setup(){
 const {window,document}=parseHTML('<html><body><div id="root"></div></body></html>');window.HTMLElement.prototype.focus=function(){};
 let now=1000;class Clock extends Date{static now(){return now;}}
 const root=document.querySelector('#root'),calls=[],requests=[];
 const ctx=vm.createContext({window,document,ROOT:()=>root,App:{S:{cfg:{}}},U:{$:s=>document.querySelector(s),$$:s=>[...document.querySelectorAll(s)],esc:s=>String(s??''),debounce:f=>f},Store:{ls:{get:()=>null}},ICON:()=>'',API:{call:(action,data)=>{calls.push({action,data});return new Promise((resolve,reject)=>requests.push({resolve,reject}));}},Date:Clock,setTimeout,clearTimeout,console});
 vm.runInContext('var Login = '+source,ctx);ctx.Login.show();
 return {window,document,root,calls,requests,advance:ms=>now+=ms,input(q){const f=document.querySelector('#q');f.value=q;f.dispatchEvent(new window.Event('input'));},refresh(){document.querySelector('#acct-refresh').click();},tick:()=>new Promise(setImmediate)};
}
test('empty searches are not cached; same name can find a newly added account without reload',async()=>{
 const e=setup();e.input('พัสดุ');e.requests[0].resolve([]);await e.tick();assert.match(e.root.textContent,/ไม่พบชื่อ/);
 e.input('พัสดุ');assert.equal(e.calls.length,2);e.requests[1].resolve([account]);await e.tick();assert.match(e.root.textContent,/พัสดุ ส่วนคลัง/);
});
test('positive cache expires, and refresh bypasses it immediately',async()=>{
 const e=setup();e.input('พัสดุ');e.requests[0].resolve([account]);await e.tick();
 e.input('พัสดุ');await e.tick();assert.equal(e.calls.length,1);
 e.refresh();assert.equal(e.calls.length,2);e.requests[1].resolve([account]);await e.tick();
 e.advance(30001);e.input('พัสดุ');assert.equal(e.calls.length,3);e.requests[2].resolve([account]);await e.tick();
});
test('late responses cannot overwrite the current search or leave refresh disabled',async()=>{
 const e=setup();e.input('พั');e.input('พัสดุ');e.requests[1].resolve([account]);await e.tick();e.requests[0].resolve([]);await e.tick();
 assert.match(e.root.textContent,/พัสดุ ส่วนคลัง/);assert.equal(e.document.querySelector('#acct-refresh').disabled,false);
});
test('invisible paste characters are removed and the found account opens its PIN step',async()=>{
 const e=setup();e.input(' พัสดุ\u200b ');assert.equal(e.calls[0].data.q,'พัสดุ');e.requests[0].resolve([account]);await e.tick();
 e.document.querySelector('#res button').click();assert.ok(e.document.querySelector('#kp'));assert.match(e.root.textContent,/พัสดุ ส่วนคลัง/);
});
test('network failure is shown as failure and can be retried, without a false not-found result',async()=>{
 const e=setup();e.input('พัสดุ');e.requests[0].reject(Error('เชื่อมต่อไม่ได้'));await e.tick();assert.equal(e.document.querySelector('#err').textContent,'เชื่อมต่อไม่ได้');assert.equal(e.document.querySelector('#acct-refresh').disabled,false);
 e.refresh();e.requests[1].resolve([account]);await e.tick();assert.match(e.root.textContent,/พัสดุ ส่วนคลัง/);assert.equal(e.document.querySelector('#err').textContent,'');
});
