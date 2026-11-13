const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync(__dirname+'/../../supply/assets/js/app.js','utf8');
function context(){
 const root={innerHTML:''},ctx=vm.createContext({document:{body:root,getElementById:()=>root,addEventListener(){}},window:{addEventListener(){}},U:{APP_NAME:'ระบบบริหารวัสดุสำนักงาน',$:()=>null,esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;')},API:{on(){}}});
 let instrumented=src.replace('S: S, ROLE_TH: ROLE_TH,','_navFor:navFor, _navHtml:navHtml, S: S, ROLE_TH: ROLE_TH,').replace('return { show: show, pickDept:', 'return { _frame:frame, show: show, pickDept:');
 vm.runInContext(instrumented+'\nthis.x={App,Login}',ctx);return ctx.x;
}
test('name and PIN keep current clay brand and explicit login step states',()=>{
 const {Login}=context();const n=Login._frame('<input id="q">',1),p=Login._frame('<div class="keypad"></div>',2);
 assert.match(n,/clay-login/);assert.match(n,/court-seal.webp/);assert.match(n,/<input id="q">/);assert.doesNotMatch(n,/clay-login is-pin/);assert.match(p,/clay-login is-pin/);assert.match(p,/aria-current="step"/);assert.match(p,/ระบบบริหารวัสดุสำนักงาน/);
});
test('role menus keep all original destinations and request counts',()=>{
 const {App}=context();App.S.me={counts:{queuePrep:1,queueReady:2}};
 const officer=App._navFor({role:'OFFICER'});assert.equal(officer.find(x=>x[0]==='queue')[3],3);
 for(const role of ['OFFICER','ADMIN']){const items=App._navFor({role});const html=App._navHtml(items,'home');for(const item of items.filter(x=>x[0]!=='-'))assert.ok(html.includes('href="#/'+item[0]+'"'));assert.match(html,/class="on"/);}
 assert.ok(!App._navFor({role:'USER'}).some(x=>x[0]==='users'));
});
test('sample banner uses requested exact label and stays absent outside a trial',()=>{
 const ctx=vm.createContext({App:{view(){}},U:{},API:{}});vm.runInContext(fs.readFileSync(__dirname+'/../../supply/assets/js/real-trial.js','utf8')+'\nthis.x=RealTrial',ctx);
 assert.equal(ctx.x.banner({active:false}),'');const html=ctx.x.banner({active:true});assert.match(html,/<b>ข้อมูลตัวอย่าง<\/b>/);assert.ok(!html.includes('รับ–เบิก–จ่ายมีผล'));
});
