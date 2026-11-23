(()=>{'use strict';
const mobile=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const target='https://checkfile2568-ops.github.io/rta-tuning/music/?v=brave-20261123';
const store=ios?'https://apps.apple.com/app/id1052879175':'https://play.google.com/store/apps/details?id=com.brave.browser';
let resolveReady,allowed=!mobile,checking=false;
const ready=new Promise(resolve=>{resolveReady=resolve});
window.MusicBrowser={ready,isAllowed:()=>allowed};
if(mobile)document.documentElement.classList.add('brave-checking');
async function isBrave(){
 if(/\bBrave(?:\/|\b)/i.test(navigator.userAgent))return true;
 try{if(navigator.userAgentData?.brands?.some(b=>/^Brave$/i.test(b.brand)))return true}catch{}
 try{return !!(await Promise.race([Promise.resolve(navigator.brave?.isBrave?.()),new Promise(resolve=>setTimeout(()=>resolve(false),2000))]))}catch{return false}
}
document.addEventListener('DOMContentLoaded',async()=>{
 if(!mobile){resolveReady({allowed:true,mobile:false});return}
 const panel=document.createElement('section');panel.id='braveGate';panel.setAttribute('aria-label','เปิดระบบด้วย Brave');
 panel.innerHTML=`<div class="brave-panel"><span class="brave-symbol" aria-hidden="true">🦁</span><h1>เปิดระบบด้วย Brave</h1><p>ระบบบนมือถือใช้ผ่าน Brave<br>ติดตั้งแล้วเปิดลิงก์นี้ด้วย Brave เพื่อเข้าสู่คลังเพลงของคุณ</p><a id="braveOpen" class="brave-primary">เปิดด้วย Brave</a><a id="braveInstall" target="_blank" rel="noopener noreferrer">ติดตั้ง Brave</a><button id="braveCopy" type="button">คัดลอกลิงก์ระบบ</button><button id="braveRetry" type="button">ตรวจสอบอีกครั้ง</button><p id="braveMessage" role="status" aria-live="polite">กำลังตรวจสอบเบราว์เซอร์…</p><input id="braveLink" readonly aria-label="ลิงก์ระบบสำหรับคัดลอก" hidden><details><summary>ตั้งให้ลิงก์เปิดด้วย Brave ครั้งต่อไป</summary><p id="braveDefault"></p><p>เครื่องอาจขอให้คุณยืนยันเปิดแอป การติดตั้งต้องกดยืนยันในร้านแอปด้วยตนเอง</p></details><details id="braveLegacy" hidden><summary>เพลงเดิมอยู่ในเบราว์เซอร์นี้?</summary><p>ย้ายเพลงเดิมเข้ารหัสเดิมก่อนเปลี่ยนไป Brave ขั้นตอนนี้ไม่เปิดคลังเพลงในเบราว์เซอร์นี้</p><label for="braveOldPin">PIN เดิม 6 หลัก</label><input id="braveOldPin" type="password" inputmode="numeric" maxlength="6" autocomplete="off"><button id="braveMigrate" type="button">ย้ายเพลงเดิมไปใช้กับ Brave</button></details><details id="braveReleaseBox" hidden><summary>คืนสิทธิ์เบราว์เซอร์เก่าจาก 10 เครื่อง</summary><p>เพลงที่บันทึกไว้กับรหัสยังอยู่ ใช้รหัสเดิมเข้าสู่ Brave ได้ หลังย้ายเพลงเดิมเสร็จแล้วจึงคืนสิทธิ์</p><button id="braveRelease" type="button">คืนสิทธิ์เบราว์เซอร์นี้</button></details><small>Brave เป็นเบราว์เซอร์แยกต่างหาก การตั้งค่าและข้อมูลที่เก็บเฉพาะเครื่องจะไม่ย้ายตามอัตโนมัติ</small></div>`;
 document.body.append(panel);
 const $=id=>document.getElementById(id),say=text=>{$('braveMessage').textContent=text};
 $('braveOpen').href=ios?'brave://open-url?url='+encodeURIComponent(target):'intent://'+target.slice(8)+'#Intent;scheme=https;package=com.brave.browser;S.browser_fallback_url='+encodeURIComponent(store)+';end';
 $('braveInstall').href=store;$('braveInstall').textContent=ios?'ติดตั้ง Brave จาก App Store':'ติดตั้ง Brave จาก Google Play';
 $('braveDefault').textContent=ios?'ไปที่การตั้งค่า iPhone → แอป → แอปเริ่มต้น → แอปเบราว์เซอร์ → Brave (บางรุ่นอยู่ใน การตั้งค่า → Brave → แอปเบราว์เซอร์เริ่มต้น)':'ไปที่การตั้งค่าเครื่อง → แอป → แอปเริ่มต้น → แอปเบราว์เซอร์ → Brave';
 try{$('braveLegacy').hidden=!localStorage.getItem('my-music-pin-v1')||!!localStorage.getItem('music-legacy-owner-account-v1');$('braveReleaseBox').hidden=!localStorage.getItem('music-device-token-v1')}catch{}
 async function check(){if(checking)return;checking=true;allowed=await isBrave();document.documentElement.classList.remove('brave-checking');document.documentElement.classList.toggle('brave-required',!allowed);panel.hidden=allowed;const pin=$('pinScreen');if(pin)pin.inert=!allowed;resolveReady({allowed,mobile:true,brave:allowed});checking=false;if(!allowed)say('กด “เปิดด้วย Brave” หากยังไม่มีแอป ให้กดติดตั้งก่อน')}
 $('braveRetry').onclick=check;
 $('braveCopy').onclick=async()=>{try{await navigator.clipboard.writeText(target);say('คัดลอกแล้ว · เปิด Brave แล้ววางลิงก์ในช่องที่อยู่')}catch{const input=$('braveLink');input.hidden=false;input.value=target;input.focus();input.select();say('กดค้างที่ลิงก์แล้วเลือกคัดลอก จากนั้นนำไปเปิดใน Brave')}};
 let releaseAt=0;
 $('braveRelease').onclick=async()=>{if(Date.now()>releaseAt){releaseAt=Date.now()+6000;say('กด “คืนสิทธิ์เบราว์เซอร์นี้” อีกครั้งภายใน 6 วินาทีเพื่อยืนยัน');return}releaseAt=0;try{await window.MusicDevice.release();$('braveReleaseBox').hidden=true;say('คืนสิทธิ์แล้ว · เปิด Brave และใช้ PIN เดิม เพลงที่บันทึกกับรหัสยังอยู่')}catch(e){say(e.message)}};
 $('braveMigrate').onclick=async()=>{const btn=$('braveMigrate'),input=$('braveOldPin');btn.disabled=true;try{if(!window.musicLegacyMigration)throw Error('ระบบยังโหลดไม่ครบ กรุณารีเฟรช');say('กำลังย้ายเพลงเดิม…');const result=await window.musicLegacyMigration(input.value);$('braveLegacy').hidden=true;$('braveReleaseBox').hidden=!!result?.released;say(result?.released?'ย้ายเพลงเดิมแล้ว · เปิด Brave และเข้าสู่ระบบด้วย PIN เดิม':'ย้ายเพลงเดิมแล้ว · คืนสิทธิ์เครื่องเดิมไม่สำเร็จ ลองกดคืนสิทธิ์อีกครั้งก่อนเปิด Brave')}catch(e){say(e.message)}finally{input.value='';btn.disabled=false}};
 await check();
});
})();
