const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {parseHTML}=require(process.env.LINKEDOM_PATH||'linkedom');
const web=path.resolve(__dirname,'../../supply');
function env(last=null){
 const {window,document}=parseHTML('<html><body><div id="root"></div><div id="view"></div></body></html>');
 const memory={last_acct:last},calls=[],wait={},charts=[],animation=[];
 const U={APP_NAME:'ระบบบริหารวัสดุสำนักงาน',esc:x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),$:s=>document.querySelector(s),$$:s=>[...document.querySelectorAll(s)],debounce:f=>f,n:x=>String(x),thDate:()=>'',loadScript:async()=>{},toast(){},thShort:()=>'',fy:()=>2570,exportXlsx:(...args)=>calls.push({action:'export',args})};
 const API={on(){},scope:()=>'',setToken(){},call:(a,d)=>{calls.push({action:a,data:d});if(a==='searchAccounts')return Promise.resolve([{code:'FIXTURE',name:'ชื่อทดสอบ',dept:'ส่วนงานทดสอบ'}]);if(a==='queue')return Promise.resolve([]);return new Promise((resolve,reject)=>wait[a]={resolve,reject});}};
 const ctx=vm.createContext({window,document,U,API,Store:{ls:{get:(k,f)=>memory[k]??f,set:(k,v)=>memory[k]=v,del:k=>delete memory[k]}},Outbox:{},location:{hash:'',reload(){}},sessionStorage:{getItem(){return null}},setTimeout:(f,ms)=>ms===650?(animation.push(f),0):ms<1000?setTimeout(f,ms):0,clearTimeout,console,FormData:class {constructor(form){this.form=form}get(k){return this.form.querySelector('[name="'+k+'"]').value}},Chart:function(canvas,opts){charts.push(opts);this.destroy=()=>{};}});
 vm.runInContext(fs.readFileSync(path.join(web,'assets/js/app.js'),'utf8')+'\nthis.x={App,Login,ICON}',ctx);
 ctx.x.App.afterLogin=async()=>{document.querySelector('#root').innerHTML='<p id="done">loaded</p>';};
 return {ctx,...ctx.x,window,document,U,calls,wait,charts,animation};
}
const tick=()=>new Promise(setImmediate);
test('name → PIN → change name preserves clay shell, brand, account selection and keypad',async()=>{
 const e=env();e.Login.show();const shell=e.document.querySelector('.clay-login'),brand=e.document.querySelector('.clay-brand');
 assert.ok(!shell.classList.contains('is-pin'));assert.match(shell.textContent,/ระบบบริหารวัสดุสำนักงานศาลจังหวัดลพบุรี/);assert.match(shell.textContent,/เบิกวัสดุ ติดตามสถานะ/);
 const q=e.document.querySelector('#q');q.value='ชื่อ';q.dispatchEvent(new e.window.Event('input'));await tick();e.document.querySelector('#res button').dispatchEvent(new e.window.Event('click',{bubbles:true}));
 assert.equal(e.document.querySelector('.clay-login'),shell);assert.equal(e.document.querySelector('.clay-brand'),brand);assert.ok(shell.classList.contains('is-pin'));assert.equal(e.document.querySelectorAll('#kp button').length,12);
 e.document.querySelector('#chg').onclick();assert.equal(e.document.querySelector('.clay-brand'),brand);assert.ok(!shell.classList.contains('is-pin'));assert.ok(e.document.querySelector('#q'));
});
test('wrong PIN restores input; retry locks duplicate keys through both real loading phases',async()=>{
 const e=env({code:'FIXTURE',name:'<ชื่อทดสอบ>',dept:'ส่วนงาน'});e.Login.show();assert.equal(e.document.querySelector('.who b').textContent,'<ชื่อทดสอบ>');
 function fill(){for(let i=0;i<4;i++)e.document.querySelector('#kp [data-k="0"]').dispatchEvent(new e.window.Event('click',{bubbles:true}));}
 fill();assert.equal(e.calls.length,1);assert.equal(e.document.querySelector('#login-wait').hidden,false);
 e.document.querySelector('#kp [data-k="1"]').dispatchEvent(new e.window.Event('click',{bubbles:true}));assert.equal(e.calls.length,1);
 e.wait.login.reject(Error('PIN ไม่ถูกต้อง'));await tick();assert.equal(e.document.querySelector('#login-wait').hidden,true);assert.equal(e.document.querySelectorAll('#dots .on').length,0);
 fill();e.wait.login.resolve({token:'fixture',user:{name:'ทดสอบ'}});await tick();assert.match(e.document.querySelector('#login-wait-phase').textContent,/PIN ถูกต้อง/);assert.ok(e.document.querySelector('#kp button').disabled);
 e.animation.splice(0).forEach(f=>f());await tick();assert.match(e.document.querySelector('#login-wait-phase').textContent,/กำลังโหลดข้อมูล/);assert.ok(e.document.querySelector('#kp button').disabled);
 assert.deepEqual(e.calls.slice(-2).map(x=>x.action),['me','catalog']);e.wait.me.resolve({});e.wait.catalog.resolve({});await tick();assert.ok(e.document.querySelector('#done'));
});
test('forced PIN change and session reauthentication keep authentication controls',async()=>{
 const e=env({code:'FIXTURE',name:'ทดสอบ',dept:'ส่วนงาน'});e.Login.show();const inp=e.document.querySelector('#pinin');inp.value='0000';inp.dispatchEvent(new e.window.Event('input'));e.wait.login.resolve({mustChangePin:true,user:{name:'ทดสอบ'}});await tick();assert.match(e.document.querySelector('#root').textContent,/ต้องตั้ง PIN ใหม่/);
 e.Login.overlay({code:'FIXTURE',name:'ทดสอบ',dept_name:'ส่วนงาน'});assert.ok(e.document.querySelector('#reauth #kp'));assert.equal(e.document.querySelector('#reauth #chg'),null);
});
test('today graph uses live count fixture, zero state never invents a slice',async()=>{
 const e=env();e.App.S.user={role:'OFFICER',name:'Fixture'};e.App.S.cfg={cost_method:'FIFO',approval_enabled:true};e.App.S.me={counts:{queuePrep:3,queueReady:2,reorder:4,approvals:1}};
 vm.runInContext(fs.readFileSync(path.join(web,'assets/js/officer.js'),'utf8')+'\nthis.officer=Officer',e.ctx);
 await e.ctx.officer.home(e.document.querySelector('#view'));await tick();assert.equal(e.charts.length,1);assert.deepEqual(Array.from(e.charts[0].data.datasets[0].data),[3,2,1]);assert.match(e.document.querySelector('#view').textContent,/คิวคำขอเบิกพัสดุ/);assert.equal(e.document.querySelectorAll('.today-kpis a').length,4);
 e.App.S.me.counts={};await e.ctx.officer.home(e.document.querySelector('#view'));assert.match(e.document.querySelector('#today-chart').textContent,/ไม่มีคำขอค้าง/);assert.equal(e.charts.length,1);
});
test('opening table and original file links remain, manual and TSV are previews only',async()=>{
 const e=env();e.App.S.user={role:'OFFICER',name:'Fixture'};e.App.S.cfg={cost_method:'FIFO'};e.App.S.catalog={materials:[],units:[{unit_id:'U1',name:'รีม'}]};e.App.S.forms={};
 vm.runInContext(fs.readFileSync(path.join(web,'assets/js/officer.js'),'utf8'),e.ctx);await e.App.S.views.opening.render(e.document.querySelector('#view'));
 assert.ok(e.document.querySelector('[href="assets/templates/opening-original.xlsx"][download]'));assert.ok(e.document.querySelector('[href="assets/templates/opening-original.csv"][download]'));assert.equal(e.document.querySelectorAll('.opening-example th').length,10);
 e.document.querySelector('#tpl').onclick();assert.equal(e.calls[0].action,'export');
 e.document.querySelector('#opening-text').value='ชื่อวัสดุ\tหน่วยนับ\tจำนวน\nกระดาษ\tรีม\t3';e.document.querySelector('#opening-text-add').onclick();assert.equal(e.App.S.forms.opening.rows[0].qty,'3');
 const form=e.document.querySelector('#opening-single');form.querySelector('[name=name]').value='กระดาษอีกแบบ';form.querySelector('[name=unit]').value='รีม';form.reset=()=>{};form.onsubmit({preventDefault(){}});assert.equal(e.App.S.forms.opening.rows.length,2);assert.ok(!e.calls.some(x=>x.action==='importOpenings'));
});
