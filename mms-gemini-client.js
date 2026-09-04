/*  MMs — mms-gemini-client.js (v1.2)
 *  ตัวเรียก edge function mms-gemini-api (วิเคราะห์สื่อด้วย Gemini แบบทำงานทันที)
 *  แยกจาก mms-ai-client.js เดิมที่ใช้กับคิวงาน AI ของ Worker — ทั้งสองตัวอยู่ร่วมกันได้
 *
 *  v1.2  แยก 401 สองแบบออกจากกัน:
 *        - 401 จากฟังก์ชันเรา (มีฟิลด์ ok) = session ของ MMs หมดจริง → ล้าง session
 *        - 401 จากด่าน Verify JWT ของ Supabase (ไม่มีฟิลด์ ok) = ไม่เกี่ยวกับผู้ใช้
 *          → ห้ามล้าง session เด็ดขาด ไม่งั้นผู้ใช้จะถูกเตะออกจากระบบทั้งที่ล็อกอินอยู่
 *  v1.1  ส่ง apikey + Authorization ของ anon key เสมอ เพื่อผ่านด่าน Verify JWT
 *        anon key เป็นคีย์สาธารณะ ไม่ให้สิทธิ์เพิ่ม การยืนยันตัวตนจริงยังใช้ x-mms-session
 */
(()=>{'use strict';
const SB='https://hwzadnpaxiacucvjxmor.supabase.co';
const ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3emFkbnBheGlhY3Vjdmp4bW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Njc5NTUsImV4cCI6MjEwMjM0Mzk1NX0.-MVztRABo3DuUv6_NAbJhaNgtOmSiSTvP5E4XOwCljE';
const EDGE=SB+'/functions/v1/mms-gemini-api';
const session=()=>localStorage.getItem('mms_session')||'';

async function api(action,payload={}){
  const s=session();
  if(!s)throw new Error('NO_SESSION');
  let r,d;
  try{
    r=await fetch(EDGE,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'apikey':ANON,
        'Authorization':'Bearer '+ANON,
        'x-mms-session':s
      },
      body:JSON.stringify({action,...payload})
    });
  }catch(e){
    return {ok:false,error:'เชื่อมต่อบริการวิเคราะห์ไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่',code:'NETWORK_ERROR'};
  }
  d=await r.json().catch(()=>null);

  if(r.status===401){
    if(d&&typeof d.ok==='boolean'){
      // มาจากฟังก์ชันของเราเอง แปลว่า session ของ MMs หมดอายุจริง
      localStorage.removeItem('mms_session');
      throw new Error('SESSION_EXPIRED');
    }
    // 401 จากด่านหน้าของ Supabase — ยังไม่ได้เข้าถึงโค้ดของเราด้วยซ้ำ
    return {ok:false,
      error:'บริการวิเคราะห์ถูกปฏิเสธที่ด่าน JWT ของ Supabase (ไม่เกี่ยวกับการเข้าสู่ระบบ) — ตรวจว่าอัปโหลด mms-gemini-client.js รุ่นล่าสุดแล้วหรือยัง',
      code:'EDGE_JWT'};
  }
  if(r.status===404){
    return {ok:false,error:'ยังไม่ได้ติดตั้งฟังก์ชัน mms-gemini-api บน Supabase',code:'NOT_DEPLOYED'};
  }
  if(!d)return {ok:false,error:'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง',code:'INVALID_RESPONSE'};
  if(!r.ok)return {...d,ok:false,error:d.error||`ไม่สามารถเชื่อมต่อระบบได้ (HTTP ${r.status})`};
  return d;
}
window.MmsGemini={EDGE,session,api};
})();
