(()=>{'use strict';
/* Brave-only access (2026-11-23 v2).
   - Applies to every device (phone, tablet, computer).
   - The welcome screen stays visible in any browser; its "เข้าระบบ" / "สร้างรหัสผ่าน" buttons ask
     window.MusicBrowser. If this is not Brave, MusicBrowser.showGate() opens this sheet instead of the PIN screen.
   - ต่อยอด: change BRAVE_LINKS to point the install button somewhere else (e.g. an internal download folder). */
const ua=navigator.userAgent;
const ios=/iPhone|iPad|iPod/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const android=/Android/i.test(ua);
const mobile=ios||android||/Mobile/i.test(ua);
const target='https://checkfile2568-ops.github.io/rta-tuning/music/?v=brave-20261123';
const BRAVE_LINKS={ios:'https://apps.apple.com/app/id1052879175',android:'https://play.google.com/store/apps/details?id=com.brave.browser',desktop:'https://brave.com/download/'};
const store=ios?BRAVE_LINKS.ios:android?BRAVE_LINKS.android:BRAVE_LINKS.desktop;
const storeLabel=ios?'ติดตั้ง Brave จาก App Store':android?'ติดตั้ง Brave จาก Google Play':'ดาวน์โหลด Brave สำหรับคอมพิวเตอร์';
let resolveReady,allowed=false,checked=false,checking=null,panel=null;
const ready=new Promise(resolve=>{resolveReady=resolve});
const listeners=new Set();
async function isBrave(){
 if(/\bBrave(?:\/|\b)/i.test(ua))return true;
 try{if(navigator.userAgentData?.brands?.some(b=>/^Brave$/i.test(b.brand)))return true}catch{}
 try{return !!(await Promise.race([Promise.resolve(navigator.brave?.isBrave?.()),new Promise(resolve=>setTimeout(()=>resolve(false),2000))]))}catch{return false}
}
function openUrl(){return ios?'brave://open-url?url='+encodeURIComponent(target):android?'intent://'+target.slice(8)+'#Intent;scheme=https;package=com.brave.browser;S.browser_fallback_url='+encodeURIComponent(store)+';end':''}
function build(){
 if(panel)return panel;
 panel=document.createElement('section');panel.id='braveGate';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','braveGateTitle');
 panel.innerHTML=`<div class="brave-panel"><button id="braveBack" class="brave-back" type="button" aria-label="กลับหน้าแรก">← กลับ</button><span class="brave-symbol" aria-hidden="true">🦁</span><h1 id="braveGateTitle">เข้าระบบได้จาก Brave เท่านั้น</h1><p id="braveLead"></p><a id="braveOpen" class="brave-primary">เปิดด้วย Brave</a><a id="braveInstall" target="_blank" rel="noopener noreferrer"></a><button id="braveCopy" type="button">คัดลอกลิงก์ระบบ</button><button id="braveRetry" type="button">ตรวจสอบอีกครั้ง</button><p id="braveMessage" role="status" aria-live="polite"></p><input id="braveLink" readonly aria-label="ลิงก์ระบบสำหรับคัดลอก" hidden><details><summary>ตั้งให้ลิงก์เปิดด้วย Brave ครั้งต่อไป</summary><p id="braveDefault"></p><p>เครื่องอาจขอให้คุณยืนยันเปิดแอป การติดตั้งต้องกดยืนยันในร้านแอปด้วยตนเอง</p></details><details id="braveLegacy" hidden><summary>เพลงเดิมอยู่ในเบราว์เซอร์นี้?</summary><p>ย้ายเพลงเดิมเข้ารหัสเดิมก่อนเปลี่ยนไป Brave ขั้นตอนนี้ไม่เปิดคลังเพลงในเบราว์เซอร์นี้</p><label for="braveOldPin">PIN เดิม 6 หลัก</label><input id="braveOldPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"><button id="braveMigrate" type="button">ย้ายเพลงเดิมไปใช้กับ Brave</button></details><details id="braveReleaseBox" hidden><summary>คืนสิทธิ์เบราว์เซอร์เก่าจาก 10 เครื่อง</summary><p>เพลงที่บันทึกไว้กับรหัสยังอยู่ ใช้รหัสเดิมเข้าสู่ Brave ได้ หลังย้ายเพลงเดิมเสร็จแล้วจึงคืนสิทธิ์</p><button id="braveRelease" type="button">คืนสิทธิ์เบราว์เซอร์นี้</button></details><small>Brave เป็นเบราว์เซอร์แยกต่างหาก การตั้งค่าและข้อมูลที่เก็บเฉพาะเครื่องจะไม่ย้ายตามอัตโนมัติ</small></div>`;
 document.body.append(panel);
 const $=id=>document.getElementById(id),say=text=>{$('braveMessage').textContent=text};
 const launch=openUrl();
 $('braveLead').innerHTML=mobile?'เบราว์เซอร์นี้ไม่ใช่ Brave<br>กด “เปิดด้วย Brave” ถ้ายังไม่มีแอป ให้กดติดตั้งก่อน':'เบราว์เซอร์นี้ไม่ใช่ Brave<br>ดาวน์โหลดและติดตั้ง Brave แล้วคัดลอกลิงก์ระบบไปเปิดใน Brave';
 if(launch)$('braveOpen').href=launch;else $('braveOpen').hidden=true;
 $('braveInstall').href=store;$('braveInstall').textContent=storeLabel;if(!launch)$('braveInstall').classList.add('brave-primary');
 $('braveDefault').textContent=ios?'ไปที่การตั้งค่า iPhone → แอป → แอปเริ่มต้น → แอปเบราว์เซอร์ → Brave (บางรุ่นอยู่ใน การตั้งค่า → Brave → แอปเบราว์เซอร์เริ่มต้น)':android?'ไปที่การตั้งค่าเครื่อง → แอป → แอปเริ่มต้น → แอปเบราว์เซอร์ → Brave':'Windows: การตั้งค่า → แอป → แอปเริ่มต้น → Brave → ตั้งเป็นค่าเริ่มต้น · Mac: การตั้งค่าระบบ → เดสก์ท็อปและ Dock → เว็บเบราว์เซอร์เริ่มต้น → Brave';
 try{$('braveLegacy').hidden=!localStorage.getItem('my-music-pin-v1')||!!localStorage.getItem('music-legacy-owner-account-v1');$('braveReleaseBox').hidden=!localStorage.getItem('music-device-token-v1')}catch{}
 $('braveBack').onclick=hideGate;
 panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();hideGate()}});
 $('braveRetry').onclick=async()=>{say('กำลังตรวจสอบเบราว์เซอร์…');await check(true);if(allowed){hideGate()}else say('ยังไม่ใช่ Brave · '+(launch?'กด “เปิดด้วย Brave”':'เปิดลิงก์นี้ในโปรแกรม Brave'))};
 $('braveCopy').onclick=async()=>{try{await navigator.clipboard.writeText(target);say('คัดลอกแล้ว · เปิด Brave แล้ววางลิงก์ในช่องที่อยู่')}catch{const input=$('braveLink');input.hidden=false;input.value=target;input.focus();input.select();say('กดค้างที่ลิงก์แล้วเลือกคัดลอก จากนั้นนำไปเปิดใน Brave')}};
 let releaseAt=0;
 $('braveRelease').onclick=async()=>{if(Date.now()>releaseAt){releaseAt=Date.now()+6000;say('กด “คืนสิทธิ์เบราว์เซอร์นี้” อีกครั้งภายใน 6 วินาทีเพื่อยืนยัน');return}releaseAt=0;try{await window.MusicDevice.release();$('braveReleaseBox').hidden=true;say('คืนสิทธิ์แล้ว · เปิด Brave และใช้ PIN เดิม เพลงที่บันทึกกับรหัสยังอยู่')}catch(e){say(e.message)}};
 $('braveMigrate').onclick=async()=>{const btn=$('braveMigrate'),input=$('braveOldPin');btn.disabled=true;try{if(!window.musicLegacyMigration)throw Error('ระบบยังโหลดไม่ครบ กรุณารีเฟรช');say('กำลังย้ายเพลงเดิม…');const result=await window.musicLegacyMigration(input.value);$('braveLegacy').hidden=true;$('braveReleaseBox').hidden=!!result?.released;say(result?.released?'ย้ายเพลงเดิมแล้ว · เปิด Brave และเข้าสู่ระบบด้วย PIN เดิม':'ย้ายเพลงเดิมแล้ว · คืนสิทธิ์เครื่องเดิมไม่สำเร็จ ลองกดคืนสิทธิ์อีกครั้งก่อนเปิด Brave')}catch(e){say(e.message)}finally{input.value='';btn.disabled=false}};
 return panel;
}
let lastFocus=null;
function showGate(){build();lastFocus=document.activeElement;panel.hidden=false;document.getElementById('braveMessage').textContent='';requestAnimationFrame(()=>document.getElementById('braveBack')?.focus())}
function hideGate(){if(!panel)return;panel.hidden=true;lastFocus?.focus?.()}
async function check(force){
 if(checking&&!force)return checking;
 checking=(async()=>{allowed=await isBrave();checked=true;document.documentElement.classList.toggle('brave-blocked',!allowed);const pin=document.getElementById('pinScreen');if(pin)pin.inert=!allowed;listeners.forEach(fn=>{try{fn(allowed)}catch{}});resolveReady({allowed,mobile,brave:allowed});return allowed})();
 try{return await checking}finally{checking=null}
}
window.MusicBrowser={ready,isAllowed:()=>allowed,isChecked:()=>checked,showGate,hideGate,installUrl:store,installLabel:storeLabel,onChange:fn=>{listeners.add(fn);if(checked)fn(allowed)}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>check());else check();
})();
