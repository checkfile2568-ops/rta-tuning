(()=>{
  'use strict';
  const EDGE='https://hwzadnpaxiacucvjxmor.supabase.co/functions/v1/mms-pro-api';
  const DEFAULT_TIMEOUT_MS=12000;
  const session=()=>localStorage.getItem('mms_session')||'';
  async function api(action,payload={},options={}){
    const s=session();
    if(!s)throw new Error('NO_SESSION');
    const timeoutMs=Math.min(Math.max(Number(options.timeoutMs)||DEFAULT_TIMEOUT_MS,1000),60000);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const r=await fetch(EDGE,{method:'POST',headers:{'Content-Type':'application/json','x-mms-session':s},body:JSON.stringify({action,...payload}),signal:controller.signal});
      const d=await r.json().catch(()=>({ok:false,error:'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง',code:'INVALID_RESPONSE'}));
      if(r.status===401){localStorage.removeItem('mms_session');throw new Error('SESSION_EXPIRED')}
      if(!r.ok)return {...d,ok:false,error:d.error||`ไม่สามารถเชื่อมต่อระบบได้ (HTTP ${r.status})`,code:d.code||`HTTP_${r.status}`,retryable:r.status>=500};
      return d;
    }catch(error){
      if(error?.name==='AbortError')return {ok:false,error:'ระบบตอบกลับช้ากว่าปกติ กรุณาลองใหม่',code:'TIMEOUT',retryable:true};
      if(error?.message==='SESSION_EXPIRED')throw error;
      return {ok:false,error:'เชื่อมต่อระบบไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่',code:'NETWORK_ERROR',retryable:true};
    }finally{clearTimeout(timer)}
  }
  function bytes(n){n=Number(n)||0;if(n<1024)return n+' B';const u=['KB','MB','GB','TB'];let i=-1;do{n/=1024;i++}while(n>=1024&&i<u.length-1);return n.toFixed(n>=100?0:n>=10?1:2)+' '+u[i]}
  function dt(v){if(!v)return '—';return new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(new Date(v))}
  function ms(v){v=Number(v);if(!Number.isFinite(v))return '—';const s=Math.max(0,v/1000),m=Math.floor(s/60),sec=Math.floor(s%60),mil=Math.round((s-Math.floor(s))*1000);return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}.${String(mil).padStart(3,'0')}`}
  function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  window.MmsPro={EDGE,DEFAULT_TIMEOUT_MS,session,api,bytes,dt,ms,esc};
})();
