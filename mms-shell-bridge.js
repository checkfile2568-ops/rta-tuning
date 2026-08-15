(()=>{
'use strict';
const embedded=window.self!==window.top;
function send(type){
  if(embedded){window.parent.postMessage({source:'MMs',type},'*');return true}
  return false;
}
function goMenu(){if(!send('BACK_TO_MENU'))location.href='media.html#menus'}
function closeMenu(){if(!send('CLOSE_WORKSPACE'))location.href='media.html#menus'}
window.MmsShell={embedded,goMenu,closeMenu};
window.addEventListener('DOMContentLoaded',()=>{
  document.documentElement.classList.toggle('mms-embedded',embedded);
  document.querySelectorAll('[data-mms-back]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();goMenu()}));
  document.querySelectorAll('[data-mms-close]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();closeMenu()}));
  if(!document.querySelector('.mms-float-back')){
    const b=document.createElement('button');
    b.type='button';b.className='mms-float-back';b.setAttribute('aria-label','กลับไปเลือกเมนู');
    b.innerHTML='↑ <span>เมนู</span>';b.addEventListener('click',goMenu);document.body.appendChild(b);
  }
});
})();