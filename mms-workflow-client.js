(()=>{
  'use strict';
  const EDGE='https://hwzadnpaxiacucvjxmor.supabase.co/functions/v1/mms-workflow-api';
  const DEFAULT_TIMEOUT_MS=15000;
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
  window.MmsWorkflow={EDGE,DEFAULT_TIMEOUT_MS,api,session};
})();
