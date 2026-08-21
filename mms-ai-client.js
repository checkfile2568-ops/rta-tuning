(()=>{'use strict';
const EDGE='https://hwzadnpaxiacucvjxmor.supabase.co/functions/v1/mms-ai-api';
const session=()=>localStorage.getItem('mms_session')||'';
async function api(action,payload={}){
  const s=session();if(!s)throw new Error('NO_SESSION');
  const r=await fetch(EDGE,{method:'POST',headers:{'Content-Type':'application/json','x-mms-session':s},body:JSON.stringify({action,...payload})});
  const d=await r.json().catch(()=>({ok:false,error:'API error'}));
  if(r.status===401){localStorage.removeItem('mms_session');throw new Error('SESSION_EXPIRED')}
  return d;
}
window.MmsAI={EDGE,session,api};
})();
