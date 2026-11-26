(()=>{'use strict';
const $=id=>document.getElementById(id),device=window.MusicDevice,app=window.musicProfileApp;
const screen=$('pinScreen'),code=$('pinCode'),confirm=$('pinConfirm'),submit=$('pinSubmit'),message=$('pinMessage'),modeButton=$('pinReset');
let creating=false,session=null,revision=0,dirty=0,saved=0,timer=null,saving=null,conflict=false,legacyRecord=null;
let autoRefreshRunning=false,lastAutoRefresh=0;
try{legacyRecord=JSON.parse(localStorage.getItem('my-music-pin-v1')||'null')}catch{}
const legacyOwner=()=>localStorage.getItem('music-legacy-owner-account-v1');
function showRecover(){const b=$('legacyRecover');if(b)b.hidden=!session||!(localStorage.getItem('music-private-legacy-backup-v1')||localStorage.getItem('my-music-library-v2-web')||localStorage.getItem('my-music-playlists-v1'))}

function status(text){$('status').textContent=text}
function quotaLabel(){const q=session?.quota;return q?(q.pool==='owner'?'มือถือรหัสหลัก ':'เครื่องรหัสอื่น ')+q.used+'/'+q.limit:'เครื่อง '+session.devices+'/10'}
function ui(){
 $('pinHeading').textContent=creating?'สร้างรหัสคลังใหม่':'เข้าสู่คลังเพลงส่วนตัว';
 $('pinDescription').textContent=creating?'รหัสใหม่เริ่มด้วยคลังว่าง แยกจากรหัสอื่น':'ใช้รหัส 6 หลักของคุณ เพื่อเปิดเฉพาะเพลงและ Playlist ของรหัสนี้';
 $('pinConfirmWrap').hidden=!creating;submit.textContent=creating?'สร้างรหัสและเข้าคลัง':'เข้าสู่คลังเพลง';modeButton.hidden=false;modeButton.textContent=creating?'มีรหัสแล้ว · เข้าสู่ระบบ':'สร้างรหัสใหม่ · เริ่มคลังว่าง';
 $('pinPrivacyNote').textContent='สิทธิ์ใช้งานทั่วไปจำกัด 6 เครื่อง · คลังเพลงส่วนตัวแยกตามรหัส'+(legacyRecord&&!legacyOwner()?' · มีคลังเดิมบนเครื่องนี้ ให้กรอก PIN เดิมเพื่อย้ายเพลง':'');
}
function setLocked(){clearTimeout(timer);lastAutoRefresh=0;creating=false;session=null;revision=0;dirty=0;saved=0;conflict=false;app.clear();code.value='';confirm.value='';screen.hidden=false;document.documentElement.classList.add('pin-locked');$('outBtn').hidden=true;$('profileReload').hidden=true;$('profileRelease').hidden=true;$('legacyRecover').hidden=true;status('กรุณาเข้าสู่ระบบด้วยรหัสส่วนตัว');ui()}
async function deriveLegacy(pin,salt,usage='bits'){
 const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,usage==='bits'?['deriveBits']:['deriveKey']);
 const algorithm={name:'PBKDF2',hash:'SHA-256',salt,iterations:250000};
 return usage==='bits'?new Uint8Array(await crypto.subtle.deriveBits(algorithm,material,256)):crypto.subtle.deriveKey(algorithm,material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function unhex(value){if(!/^[0-9a-f]+$/.test(value||'')||value.length%2)throw Error('ข้อมูลรหัสเดิมไม่สมบูรณ์');return new Uint8Array(value.match(/.{2}/g).map(h=>parseInt(h,16)))}
function hex(bytes){return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('')}
async function matchesLegacy(pin){if(!legacyRecord||legacyOwner())return false;try{const actual=await deriveLegacy(pin,unhex(legacyRecord.salt)),expected=unhex(legacyRecord.hash);if(actual.length!==expected.length)return false;let diff=0;actual.forEach((v,i)=>diff|=v^expected[i]);return diff===0}catch{return false}}
function readLegacy(){const read=(key,fallback)=>{try{const v=JSON.parse(localStorage.getItem(key)||'null');return Array.isArray(v)?v:fallback}catch{return fallback}};return {songs:read('my-music-library-v2-web',[]),playlists:read('my-music-playlists-v1',[]),customCats:read('music-custom-categories-v1',[])}}
async function migrateLegacy(pin,library){
 if(!library.songs.length&&!library.playlists.length)return false;
 const result=await device.request('/api/library',{method:'PUT',token:session.token,data:{revision:0,data:library}});revision=result.revision;
 // Retain an encrypted, recoverable browser backup before removing the shared legacy keys.
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await deriveLegacy(pin,salt,'key');
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(library)));
 localStorage.setItem('music-private-legacy-backup-v1',JSON.stringify({version:1,salt:hex(salt),iv:hex(iv),ciphertext:hex(ciphertext)}));
 localStorage.setItem('music-legacy-owner-account-v1',session.accountId);
 for(const name of ['my-music-library-v2-web','my-music-playlists-v1','music-custom-categories-v1','my-music-pin-v1'])localStorage.removeItem(name);
 legacyRecord=null;return true;
}
// Migration-only path keeps the normal library locked in unsupported mobile browsers.
window.musicLegacyMigration=async pin=>{
 if(session)throw Error('กรุณาออกจากคลังก่อนย้ายข้อมูล');
 if(!/^\d{6}$/.test(pin)||!await matchesLegacy(pin))throw Error('PIN เดิมไม่ถูกต้อง ไม่ได้ย้ายข้อมูล');
 const legacy=readLegacy();if(!legacy.songs.length&&!legacy.playlists.length)throw Error('ไม่มีเพลงเดิมให้ย้ายในเบราว์เซอร์นี้');
 let temp;
 try{
  try{temp=await device.request('/api/auth/login',{method:'POST',data:{pin,label:'ย้ายคลังเดิม'}})}catch(e){if(e.status!==401)throw e;temp=await device.request('/api/auth/register',{method:'POST',data:{pin,label:'ย้ายคลังเดิม'}})}
  const library=await device.request('/api/library',{token:temp.token});
  if(library.revision!==0||library.data.songs.length||library.data.playlists.length)throw Error('รหัสนี้มีคลังกลางแล้ว จึงเก็บเพลงเดิมไว้โดยไม่เขียนทับ กรุณาเปิดด้วย Brave เพื่อตรวจสอบ');
  session=temp;await migrateLegacy(pin,legacy);
 }finally{
  session=null;
  if(temp)try{await device.request('/api/auth/logout',{method:'POST',token:temp.token})}catch{}
 }
 try{await device.release();return {released:true}}catch{return {released:false}}
};
async function loadLibrary(){const owner=session?.accountId,token=session?.token;if(!owner)return;const result=await device.request('/api/library',{token});if(session?.accountId!==owner)return;revision=result.revision;app.load(result.data);dirty=0;saved=0;conflict=false;lastAutoRefresh=Date.now();status('คลังส่วนตัว · แยกตามรหัส · '+quotaLabel());showRecover()}
// Refresh when returning to this tab and periodically while it stays visible.
// Never overwrite local edits, an active dialog, or another account's in-flight data.
async function refreshLibrarySafely(){
 if(!session||document.hidden||autoRefreshRunning||saving||dirty!==saved||conflict||!$('playlistDialog').hidden)return;
 if(Date.now()-lastAutoRefresh<20000)return;
 const owner=session.accountId,token=session.token;
 autoRefreshRunning=true;lastAutoRefresh=Date.now();
 try{
  const latest=await device.request('/api/library',{token});
  if(!session||session.accountId!==owner||session.token!==token||saving||dirty!==saved||conflict||!$('playlistDialog').hidden)return;
  if(String(latest.revision)===String(revision))return;
  if(!latest.data||!Array.isArray(latest.data.songs)||!Array.isArray(latest.data.playlists))throw Error('ข้อมูลคลังที่ได้รับไม่ครบ');
  if(typeof app.refresh==='function')app.refresh(latest.data);else app.load(latest.data);
  revision=latest.revision;
  status('ซิงก์คลังล่าสุดจากอีกเครื่องแล้ว · '+latest.data.songs.length+' เพลง · '+quotaLabel());
 }catch(e){if(session?.accountId===owner)status('ตรวจคลังล่าสุดไม่สำเร็จ · '+(e?.message||'กรุณาลองใหม่'))}
 finally{autoRefreshRunning=false}
}
function askForFreshLibrary(){if(session&&!document.hidden)refreshLibrarySafely()}
document.addEventListener('visibilitychange',askForFreshLibrary);
window.addEventListener('focus',askForFreshLibrary);
setInterval(askForFreshLibrary,90000);
function markDirty(){if(!session)return;dirty++;status('กำลังบันทึกคลังส่วนตัว…');clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),350)}
async function flush(){
 if(!session||dirty===saved)return;if(conflict)throw Error('กรุณาโหลดคลังล่าสุดก่อนบันทึก');if(saving){await saving;return flush()}
 const owner=session.accountId,version=dirty,data=app.snapshot(),expected=revision;
 saving=(async()=>{try{const result=await device.request('/api/library',{method:'PUT',token:session.token,data:{revision:expected,data}});if(session?.accountId!==owner)return;revision=result.revision;saved=version;status('บันทึกแล้ว · คลังส่วนตัว · '+quotaLabel())}catch(e){if(e.status===409)conflict=true;status(e.message+' · ข้อมูลที่แก้ไขยังไม่ถูกบันทึก');throw e}})();
 try{await saving}finally{saving=null}if(dirty!==saved)return flush();
}
window.musicAccountSave=markDirty;
window.musicAccountFlush=flush;
submit.onclick=async()=>{
 if(submit.disabled)return;if(window.MusicBrowser){await window.MusicBrowser.ready;if(submit.disabled)return;if(!window.MusicBrowser.isAllowed()){message.textContent='กรุณาเปิดระบบด้วย Brave';return}}const pin=code.value;if(!/^\d{6}$/.test(pin)){message.textContent='กรุณากรอกรหัส 6 หลัก';return}if(creating&&pin!==confirm.value){message.textContent='รหัสทั้งสองช่องไม่ตรงกัน';return}
 submit.disabled=true;message.textContent='กำลังตรวจสอบรหัสและทะเบียนเครื่อง…';
 try{
  if(!device||!app)throw Error('โหลดระบบไม่ครบ กรุณารีเฟรชหน้า');
  const legacy=await matchesLegacy(pin);
  if(creating&&legacy){creating=false;ui();}
  let result;
  try{result=await device.request(creating?'/api/auth/register':'/api/auth/login',{method:'POST',data:{pin,label:'มือถือ / คลังส่วนตัว'}})}catch(e){if(legacy&&e.status===401)result=await device.request('/api/auth/register',{method:'POST',data:{pin,label:'มือถือ / คลังส่วนตัว'}});else throw e}
  session=result;const library=await device.request('/api/library',{token:session.token});revision=library.revision;
  let migrated=false;
  if(legacy&&revision===0&&!library.data.songs.length&&!library.data.playlists.length)migrated=await migrateLegacy(pin,readLegacy());
  if(migrated){const fresh=await device.request('/api/library',{token:session.token});revision=fresh.revision;app.load(fresh.data)}else app.load(library.data);
  dirty=0;saved=0;conflict=false;lastAutoRefresh=Date.now();code.value='';confirm.value='';screen.hidden=true;document.documentElement.classList.remove('pin-locked');$('outBtn').hidden=false;$('outBtn').textContent='ออก / เปลี่ยนรหัส';$('profileReload').hidden=false;$('profileRelease').hidden=false;message.textContent='';status((migrated?'ย้ายเพลงเดิมแล้ว · ':'')+'คลังส่วนตัว · '+quotaLabel());showRecover();
 }catch(e){session=null;app.clear();message.textContent=e.message||'เข้าสู่ระบบไม่สำเร็จ';code.value='';confirm.value=''}finally{submit.disabled=false}
};
modeButton.onclick=()=>{creating=!creating;code.value='';confirm.value='';message.textContent='';ui()};
// Called by the welcome screen: 'login' = เข้าระบบ, 'create' = สร้างรหัสผ่าน.
window.musicPinMode=mode=>{if(session)return;creating=mode==='create';code.value='';confirm.value='';message.textContent='';ui()};
[code,confirm].forEach(el=>el.addEventListener('keydown',e=>{if(e.key==='Enter')submit.click()}));
$('outBtn').onclick=async()=>{try{await flush();const token=session?.token;setLocked();if(token)try{await device.request('/api/auth/logout',{method:'POST',token})}catch{message.textContent='ออกจากเครื่องนี้แล้ว · ไม่สามารถติดต่อบริการเพื่อปิดเซสชันเดิมได้'}}catch(e){status(e.message)}};

async function recoverLocalData(pin){
 const owner=legacyOwner();if(owner&&owner!==session?.accountId)throw Error('สำเนานี้เป็นของคลังรหัสอื่น');
 let backup=null;try{backup=JSON.parse(localStorage.getItem('music-private-legacy-backup-v1')||'null')}catch{}
 if(backup){
  if(backup.version!==1)throw Error('สำเนาข้อมูลเดิมไม่ถูกต้อง');
  try{
   const key=await deriveLegacy(pin,unhex(backup.salt),'key');
   const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(backup.iv)},key,unhex(backup.ciphertext));
   const data=JSON.parse(new TextDecoder().decode(raw));
   if(!Array.isArray(data.songs)||!Array.isArray(data.playlists))throw Error();
   return data;
  }catch{throw Error('ไม่สามารถเปิดสำเนาเก่าได้ โปรดตรวจ PIN เดิม')}
 }
 if(legacyRecord&&!owner&&!await matchesLegacy(pin))throw Error('รหัสไม่ตรงกับคลังเดิม');
 const data=readLegacy();if(!data.songs.length&&!data.playlists.length)throw Error('ไม่พบเพลงเก่าที่กู้คืนได้ใน Brave เครื่องนี้');
 return data;
}
function mergeRecovered(current,old){
 const songMap=new Map((current.songs||[]).filter(s=>s&&typeof s.id==='string').map(s=>[s.id,s]));
 let newSongs=0,newLists=0,newLinks=0;
 for(const s of old.songs||[]){
  if(!s||typeof s.id!=='string'||s.id.length!==11||typeof s.title!=='string')continue;
  if(!songMap.has(s.id)){songMap.set(s.id,{id:s.id,title:s.title.slice(0,250),category:String(s.category||'เพลงโปรด').slice(0,80)});newSongs++}
 }
 const lists=(current.playlists||[]).map(p=>({...p,songIds:[...(p.songIds||[])]}));
 const usedNames=new Set(lists.map(p=>String(p.name).toLowerCase()));
 for(const p of old.playlists||[]){
  if(!p||!Array.isArray(p.songIds)||typeof p.name!=='string')continue;
  const ids=[...new Set(p.songIds.filter(id=>songMap.has(id)))];
  const match=lists.find(x=>x.id===p.id&&p.id);
  if(match){const original=match.songIds.length;match.songIds=[...new Set([...match.songIds,...ids])];newLinks+=match.songIds.length-original}
  else{
   let title=p.name.slice(0,100)||'Playlist ที่กู้คืน',count=2;const base=title;
   while(usedNames.has(title.toLowerCase()))title=base.slice(0,85)+' ('+count+++')';
   usedNames.add(title.toLowerCase());
   let id=p.id;if(typeof id!=='string'||!id||lists.some(x=>x.id===id))id='recovered-'+crypto.randomUUID();
   lists.push({id,name:title,songIds:ids});newLists++;
  }
 }
 const customCats=[...new Set([...(current.customCats||[]),...(old.customCats||[])].filter(x=>typeof x==='string'))];
 return {data:{songs:[...songMap.values()],playlists:lists,customCats},newSongs,newLists,newLinks};
}
$('legacyRecover').onclick=async()=>{
 if(!session||conflict)return;
 if(dirty!==saved){status('มีข้อมูลยังไม่บันทึก กรุณารอระบบบันทึกก่อน');return}
 const btn=$('legacyRecover'),owner=session.accountId;btn.disabled=true;
 try{
  const pin=await app.confirm({type:'input',title:'ตรวจคลังเพลงเดิม',description:'กรอก PIN เดิมอีกครั้งเพื่อเปิดสำเนาเพลงใน Brave เครื่องนี้',label:'PIN เดิม',placeholder:'PIN 6 หลัก',okText:'ตรวจข้อมูล',validate:v=>/^[0-9]{6}$/.test(String(v))?'':'กรุณากรอก PIN 6 หลัก'});
  if(pin===null)return;
  const older=await recoverLocalData(pin);
  const latest=await device.request('/api/library',{token:session.token});
  if(session?.accountId!==owner)return;
  const merged=mergeRecovered(latest.data,older);
  if(!(merged.newSongs+merged.newLists+merged.newLinks)){
   await app.confirm({type:'notice',title:'ตรวจคลังเรียบร้อย',description:'ไม่พบรายการใหม่ที่ต้องรวม ข้อมูลเดิมไม่ถูกแก้ไข',okText:'รับทราบ'});return
  }
  const approved=await app.confirm({type:'confirm',title:'ยืนยันกู้คืนคลังเดิม',description:'พบเพลงเดิม '+(older.songs?.length||0)+' เพลง และ Playlist '+(older.playlists?.length||0)+' ชุด\nเพิ่มเพลงที่ขาด '+merged.newSongs+' เพลง · Playlist ใหม่ '+merged.newLists+' ชุด\nจะไม่ลบหรือเขียนทับเพลงปัจจุบัน',okText:'รวมข้อมูล'});
  if(!approved)return;
  if(session?.accountId!==owner||dirty!==saved)throw Error('สถานะคลังเปลี่ยน กรุณาตรวจอีกครั้ง');
  const savedResult=await device.request('/api/library',{method:'PUT',token:session.token,data:{revision:latest.revision,data:merged.data}});
  if(session?.accountId!==owner)return;
  revision=savedResult.revision;app.load(merged.data);dirty=0;saved=0;conflict=false;
  status('กู้คืนสำเร็จ · เพิ่ม '+merged.newSongs+' เพลง · '+quotaLabel());
  await app.confirm({type:'notice',title:'กู้คืนสำเร็จ',description:'รวมเพลงที่ขาดแล้ว โดยยังรักษาข้อมูลออนไลน์และสำเนาใน Brave',okText:'รับทราบ'});
 }catch(e){status('ไม่ได้เปลี่ยนข้อมูล · '+(e?.message||'กู้คืนไม่สำเร็จ'));await app.confirm({type:'notice',title:'กู้คืนยังไม่สำเร็จ',description:e?.message||'ตรวจสอบอีกครั้ง',okText:'รับทราบ'})}
 finally{btn.disabled=false;showRecover()}
};
$('profileReload').onclick=async()=>{if(dirty!==saved&&!await app.confirm({type:'confirm',title:'โหลดคลังล่าสุด',description:'รายการที่ยังไม่บันทึกบนเครื่องนี้จะถูกแทนด้วยข้อมูลล่าสุดของรหัสนี้',okText:'โหลดล่าสุด'}))return;try{await loadLibrary()}catch(e){status(e.message)}};
$('profileRelease').onclick=async()=>{if(!await app.confirm({type:'confirm',title:'ยกเลิกเครื่องนี้',description:'คืนสิทธิ์เครื่องนี้จากจำนวน 10 เครื่อง เพลงของรหัสคุณยังอยู่ เมื่อใช้อีกครั้งต้องลงทะเบียนใหม่',okText:'ยกเลิกเครื่องนี้'}))return;try{await flush();await device.release();setLocked();message.textContent='ยกเลิกเครื่องนี้แล้ว เพลงของคุณยังอยู่'}catch(e){status(e.message)}};
window.addEventListener('beforeunload',e=>{if(dirty!==saved){e.preventDefault();e.returnValue=''}});
window.addEventListener('pageshow',e=>{if(e.persisted){setLocked()}else askForFreshLibrary()});
ui();status('กรุณาเข้าสู่ระบบด้วยรหัสส่วนตัว');
})();
