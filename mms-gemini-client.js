/*  MMs — mms-gemini-client.js
 *  ตัวเรียก edge function mms-gemini-api (วิเคราะห์สื่อด้วย Gemini แบบทำงานทันที)
 *  แยกจาก mms-ai-client.js เดิมที่ใช้กับคิวงาน AI ของ Worker — ทั้งสองตัวอยู่ร่วมกันได้
 */
(()=>{'use strict';
const EDGE='https://hwzadnpaxiacucvjxmor.supabase.co/functions/v1/mms-gemini-api';
const session=()=>localStorage.getItem('mms_session')||'';
async function api(action,payload={}){
  const s=session();if(!s)throw new Error('NO_SESSION');
  const r=await fetch(EDGE,{method:'POST',headers:{'Content-Type':'application/json','x-mms-session':s},body:JSON.stringify({action,...payload})});
  const d=await r.json().catch(()=>({ok:false,error:'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง'}));
  if(r.status===401){localStorage.removeItem('mms_session');throw new Error('SESSION_EXPIRED')}
  if(!r.ok)return {...d,ok:false,error:d.error||`ไม่สามารถเชื่อมต่อระบบได้ (HTTP ${r.status})`};
  return d;
}
window.MmsGemini={EDGE,session,api};
})();
