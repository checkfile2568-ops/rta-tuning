/*  MMs — mms-gemini-client.js (v1.1)
 *  ตัวเรียก edge function mms-gemini-api (วิเคราะห์สื่อด้วย Gemini แบบทำงานทันที)
 *  แยกจาก mms-ai-client.js เดิมที่ใช้กับคิวงาน AI ของ Worker — ทั้งสองตัวอยู่ร่วมกันได้
 *
 *  หมายเหตุ: ส่ง apikey + Authorization ของ anon key ไปด้วยเสมอ
 *  เพื่อให้เรียกผ่านได้ทั้งกรณีที่ฟังก์ชันตั้ง Verify JWT เปิดหรือปิด
 *  การยืนยันตัวตนจริงของ MMs ยังใช้ x-mms-session เหมือนเดิม anon key ไม่ให้สิทธิ์อะไรเพิ่ม
 */
(()=>{'use strict';
const SB='https://hwzadnpaxiacucvjxmor.supabase.co';
const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3emFkbnBheGlhY3Vjdmp4bW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Njc5NTUsImV4cCI6MjEwMjM0Mzk1NX0.-MVztRABo3DuUv6_NAbJhaNgtOmSiSTvP5E4XOwCljE';
const EDGE=SB+'/functions/v1/mms-gemini-api';
const session=()=>localStorage.getItem('mms_session')||'';
async function api(action,payload={}){
  const s=session();if(!s)throw new Error('NO_SESSION');
  const r=await fetch(EDGE,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'apikey':ANON,
      'Authorization':'Bearer '+ANON,
      'x-mms-session':s
    },
    body:JSON.stringify({action,...payload})
  });
  const d=await r.json().catch(()=>({ok:false,error:'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง'}));
  if(r.status===401&&d?.error!=='Invalid JWT'){localStorage.removeItem('mms_session');throw new Error('SESSION_EXPIRED')}
  if(!r.ok)return {...d,ok:false,error:d.error||`ไม่สามารถเชื่อมต่อระบบได้ (HTTP ${r.status})`};
  return d;
}
window.MmsGemini={EDGE,session,api};
})();
