(()=>{'use strict';
const root=document.documentElement;root.classList.add('music-welcome');
function start(){
 const welcome=document.createElement('section');welcome.id='musicWelcome';welcome.setAttribute('aria-label','ยินดีต้อนรับสู่ Music YouTube');
 welcome.innerHTML=`<div class="entry-shell"><div class="entry-brand"><span class="entry-logo" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M12 8v16l13-8z" fill="currentColor"/><path d="M6 11v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span><span>Music YouTube</span></div><div class="entry-layout"><div class="entry-copy"><p class="entry-eyebrow">YOUR MUSIC. YOUR SPACE.</p><h1>Music<br><span>YouTube</span></h1><p class="entry-description">ทุกเพลงโปรด ในพื้นที่ของคุณ<br><span>เลือกเพลงที่ชอบ จัด Playlist ในแบบของคุณ</span></p><div class="entry-actions"><button id="musicEnter" type="button"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z" fill="currentColor"/></svg>เข้าระบบ</button><div id="musicBrowserNote" class="entry-browser-note" role="status" aria-live="polite">กำลังตรวจสอบเบราว์เซอร์…</div><a id="musicBraveInstall" class="entry-brave-install" target="_blank" rel="noopener noreferrer" hidden><span aria-hidden="true">🦁</span> ติดตั้ง Brave</a><div class="entry-create">ยังไม่มีรหัส? <button id="musicCreate" type="button">สร้างรหัสผ่าน</button></div></div></div><div class="entry-art" aria-hidden="true"><div class="entry-orbit orbit-one"></div><div class="entry-orbit orbit-two"></div><div class="entry-sleeve"><div class="entry-art-brand">M<span>Y</span></div><div class="entry-art-lines"></div><span class="entry-sleeve-caption">A SOUND OF YOUR OWN</span></div><div class="entry-record"><div class="entry-record-label"><svg viewBox="0 0 32 32"><path d="m12 8 13 8-13 8z" fill="currentColor"/></svg></div></div><div class="entry-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><span class="entry-art-caption">CURATED BY YOU.</span></div></div><div class="entry-footer"><span>พื้นที่ส่วนตัวสำหรับเพลงโปรด</span><span>Music YouTube</span></div></div>`;
 document.body.append(welcome);
 const button=document.getElementById('musicEnter'),create=document.getElementById('musicCreate'),note=document.getElementById('musicBrowserNote'),install=document.getElementById('musicBraveInstall'),MB=window.MusicBrowser;
 if(MB){install.href=MB.installUrl;install.lastChild.textContent=' '+MB.installLabel;
  MB.onChange(allowed=>{install.hidden=allowed;note.classList.toggle('is-blocked',!allowed);note.textContent=allowed?'เปิดผ่าน Brave แล้ว · เข้าสู่คลังเพลงด้วยรหัสของคุณ':'ระบบเข้าได้จาก Brave เท่านั้น · เบราว์เซอร์นี้ยังไม่ใช่ Brave'})}
 else note.textContent='เข้าสู่คลังเพลงส่วนตัวด้วยรหัสของคุณ';
 let busy=false;
 // mode: 'login' (เข้าระบบ) or 'create' (สร้างรหัสผ่าน). Non-Brave browsers get the Brave sheet instead of the PIN screen.
 async function go(mode){
  if(busy)return;
  if(MB&&MB.isChecked()&&!MB.isAllowed()){MB.showGate();return}
  if(!MB||MB.isAllowed())window.MusicShell?.enterFullscreen();
  busy=true;button.disabled=true;create.disabled=true;
  try{
   if(MB){await MB.ready;if(!MB.isAllowed()){MB.showGate();return}}
   window.musicPinMode?.(mode);
   welcome.hidden=true;root.classList.remove('music-welcome');
   const target=document.getElementById(mode==='create'?'pinCode':'pinHeading');if(target){if(target.id==='pinHeading')target.tabIndex=-1;target.focus({preventScroll:true})}
  }finally{busy=false;button.disabled=false;create.disabled=false}
 }
 button.onclick=()=>go('login');
 create.onclick=()=>go('create');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
