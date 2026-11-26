(()=>{'use strict';
const root=document.documentElement;
const currentFullscreen=()=>document.fullscreenElement||document.webkitFullscreenElement;
function notice(text){const el=document.getElementById('fullscreenNotice');if(el){el.textContent=text;el.hidden=!text}}
function enterFullscreen(){
 if(currentFullscreen())return Promise.resolve(true);
 const request=root.requestFullscreen||root.webkitRequestFullscreen;
 if(!request){notice('เครื่องนี้ไม่รองรับเต็มจอ ลองเพิ่มเว็บลงหน้าจอหลักเพื่อใช้แบบแอป');return Promise.resolve(false)}
 // Call synchronously from the click, before login/browser checks consume user activation.
 try{return Promise.resolve(request.call(root,{navigationUI:'hide'})).then(()=>{notice('');return true},()=>{notice('เปิดเต็มจอไม่ได้ในครั้งนี้ แตะปุ่มเต็มจอเพื่อลองอีกครั้ง');return false})}catch{notice('เปิดเต็มจอไม่ได้ในครั้งนี้ แตะปุ่มเต็มจอเพื่อลองอีกครั้ง');return Promise.resolve(false)}
}
window.MusicShell=Object.freeze({enterFullscreen});
function setup(){
 const header=document.getElementById('musicHeader');if(!header)return;
 const brand=header.firstElementChild,oldActions=brand.nextElementSibling,status=document.getElementById('status');brand.classList.add('shell-brand');
 const actions=document.createElement('div');actions.className='shell-actions';
 const fullscreen=document.createElement('button');fullscreen.id='fullscreenToggle';fullscreen.type='button';fullscreen.textContent='⛶';fullscreen.setAttribute('aria-label','เปิดเต็มจอ');fullscreen.title='เปิดเต็มจอ';
 const more=document.createElement('details');more.id='headerMore';const summary=document.createElement('summary');summary.setAttribute('aria-label','เมนูเพิ่มเติม');summary.title='เมนูเพิ่มเติม';summary.textContent='⋯';const panel=document.createElement('div');panel.id='headerMorePanel';
 for(const id of ['profileReload','legacyRecover','profileRelease','outBtn','authBtn','managePasskey']){const el=document.getElementById(id);if(el)panel.append(el)}
 more.append(summary,panel);actions.append(fullscreen,document.getElementById('themeBtn'),more);const secondary=document.createElement('div');secondary.className='shell-secondary';secondary.append(status,document.getElementById('wakeBtn'));header.append(actions,secondary);oldActions.remove();status.setAttribute('role','status');
 const hint=document.createElement('p');hint.id='fullscreenNotice';hint.hidden=true;hint.setAttribute('role','status');header.append(hint);
 function sync(){const full=!!currentFullscreen();fullscreen.textContent=full?'⊡':'⛶';fullscreen.setAttribute('aria-label',full?'ออกจากเต็มจอ':'เปิดเต็มจอ');fullscreen.title=full?'ออกจากเต็มจอ':'เปิดเต็มจอ';fullscreen.setAttribute('aria-pressed',String(full))}
 fullscreen.onclick=()=>{if(!currentFullscreen()){enterFullscreen();return}const exit=document.exitFullscreen||document.webkitExitFullscreen;try{Promise.resolve(exit?.call(document)).catch(()=>notice('ออกจากเต็มจอด้วยปุ่มย้อนกลับหรือ Esc ได้'))}catch{notice('ออกจากเต็มจอด้วยปุ่มย้อนกลับหรือ Esc ได้')}};
 document.addEventListener('fullscreenchange',sync);document.addEventListener('webkitfullscreenchange',sync);sync();
 document.getElementById('pinSubmit').addEventListener('click',()=>{if(!document.getElementById('pinSubmit').disabled)enterFullscreen()},{capture:true});
 document.addEventListener('click',e=>{if(!more.contains(e.target))more.open=false});
 panel.addEventListener('click',e=>{if(e.target.closest('button'))more.open=false});
 document.addEventListener('scroll',e=>{if(more.open&&!more.contains(e.target))more.open=false},{capture:true,passive:true});
 window.addEventListener('resize',()=>{more.open=false},{passive:true});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&more.open){more.open=false;summary.focus()}});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
