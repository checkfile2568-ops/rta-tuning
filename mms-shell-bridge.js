(()=>{
'use strict';
const embedded=window.self!==window.top;
function closeMenu(){
  if(embedded){
    window.parent.postMessage({source:'MMs',type:'CLOSE_WORKSPACE'},'*');
    return true;
  }
  location.href='media.html#menus';
  return false;
}
window.MmsShell={embedded,closeMenu};
window.addEventListener('DOMContentLoaded',()=>{
  document.documentElement.classList.toggle('mms-embedded',embedded);
  document.querySelectorAll('[data-mms-back]').forEach(b=>b.remove());
  document.querySelectorAll('[data-mms-close]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();closeMenu()}));
  document.querySelector('.mms-float-back')?.remove();
});
})();