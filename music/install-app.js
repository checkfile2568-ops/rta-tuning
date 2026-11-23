(()=>{
 'use strict';
 let pending=null,dialog=null,previous=null,installed=false;
 const standalone=()=>installed||!!navigator.standalone||!!window.matchMedia?.('(display-mode: standalone)').matches;
 const sync=()=>document.querySelectorAll('[data-install-app]').forEach(b=>b.hidden=standalone());
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();pending=e;sync()});
 window.addEventListener('appinstalled',()=>{installed=true;pending=null;close();sync()});
 function close(){if(!dialog)return;dialog.close();previous?.focus()}
 function instructions(){
  previous=document.activeElement;
  if(!dialog){
   dialog=document.createElement('dialog');dialog.id='musicInstallDialog';dialog.setAttribute('aria-labelledby','installHeading');
   dialog.innerHTML='<h2 id="installHeading">ติดตั้ง Music YouTube</h2><p>เพิ่มไอคอนบนหน้าจอ เปิดใช้งานได้เหมือนแอป</p><ol><li>บน Android ให้เปิดเว็บนี้ใน <strong>Brave</strong></li><li>กดเมนู <strong>⋮</strong> ของ Brave แล้วเลือก <strong>ติดตั้งแอป</strong> หรือ <strong>เพิ่มลงหน้าจอหลัก</strong></li><li>กด <strong>ติดตั้ง / เพิ่ม</strong> เพื่อยืนยัน</li></ol><p>บนคอมพิวเตอร์: กดไอคอนติดตั้งในแถบที่อยู่ หรือเมนูติดตั้งของเบราว์เซอร์</p><p class="install-note">ใช้รหัสเดิมเข้าใช้งาน ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อค้นหาและเล่นเพลง</p><button type="button" id="closeMusicInstall">เข้าใจแล้ว</button>';
   document.body.append(dialog);dialog.querySelector('button').addEventListener('click',close);dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close()}});
  }
  dialog.showModal();
 }
 async function install(){
  if(standalone())return;
  if(!pending){instructions();return}
  const prompt=pending;pending=null;
  try{await prompt.prompt();const choice=await prompt.userChoice;if(choice.outcome!=='accepted')instructions()}catch{instructions()}
 }
 function button(label){const b=document.createElement('button');b.type='button';b.dataset.installApp='';b.textContent=label;b.addEventListener('click',install);return b}
 function setup(){
  const actions=document.querySelector('.entry-actions');if(actions){const b=button('↓ ติดตั้งแอป');b.id='musicInstall';actions.append(b)}
  const menu=document.getElementById('headerMorePanel');if(menu)menu.append(button('↓ ติดตั้งแอป'));
  sync();window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change',sync);
  if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./service-worker.js',{scope:'./',updateViaCache:'none'}).catch(()=>{});
 }
 if(document.readyState!=='complete')document.addEventListener('DOMContentLoaded',()=>queueMicrotask(setup));else queueMicrotask(setup);
})();
