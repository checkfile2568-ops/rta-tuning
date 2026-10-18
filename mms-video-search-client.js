(()=>{'use strict';
const EDGE='https://hwzadnpaxiacucvjxmor.supabase.co/functions/v1/mms-video-search-api';
const session=()=>localStorage.getItem('mms_session')||'';
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(action,payload={},options={}){
  const token=session();if(!token)throw new Error('NO_SESSION');
  const timeout=Math.max(3000,Math.min(30000,Number(options.timeout)||12000));
  let lastError;
  for(let attempt=0;attempt<2;attempt++){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const response=await fetch(EDGE,{method:'POST',headers:{'Content-Type':'application/json','x-mms-session':token},body:JSON.stringify({action,...payload}),signal:controller.signal});
      const data=await response.json().catch(()=>({ok:false,error:'ตอบกลับจากระบบไม่ถูกต้อง'}));
      if(response.status===401){localStorage.removeItem('mms_session');throw new Error('SESSION_EXPIRED')}
      if(response.status>=500&&attempt===0){lastError=new Error(data.error||'SERVER_ERROR');await sleep(350);continue}
      return data;
    }catch(error){
      if(error?.message==='SESSION_EXPIRED')throw error;
      lastError=error?.name==='AbortError'?new Error('NETWORK_TIMEOUT'):error;
      if(attempt===0){await sleep(350);continue}
    }finally{clearTimeout(timer)}
  }
  throw lastError||new Error('NETWORK_ERROR');
}
window.MmsVideoSearch={EDGE,session,api};
})();
