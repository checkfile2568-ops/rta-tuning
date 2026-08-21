import { createClient } from 'npm:@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'content-type,x-mms-session,apikey,authorization',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Content-Type':'application/json; charset=utf-8'
};
const URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const enc=new TextEncoder();
const out=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:cors});
const hex=(b:Uint8Array)=>[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
async function sha256(s:string){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))))}

async function sessionFrom(req:Request,body:any){
  const raw=req.headers.get('x-mms-session')||body?.session||'';
  if(!raw)return null;
  const h=await sha256(raw);
  const {data:s}=await db.from('mms_sessions').select('id,user_id,expires_at').eq('token_hash',h).gt('expires_at',new Date().toISOString()).maybeSingle();
  if(!s)return null;
  const {data:user}=await db.from('mms_users').select('id,display_name,role,active').eq('id',s.user_id).maybeSingle();
  if(!user?.active)return null;
  await db.from('mms_sessions').update({last_seen_at:new Date().toISOString()}).eq('id',s.id);
  return {session:s,user,raw};
}
async function requireSession(req:Request,body:any){const c=await sessionFrom(req,body);if(!c)throw new Error('UNAUTHORIZED');return c}
function owned(q:any,ctx:any,column='owner_id'){return ctx.user.role==='admin'?q:q.eq(column,ctx.user.id)}
async function audit(ctx:any,action:string,entity_type:string,entity_id?:string|null,detail:any={},project_id?:string|null,media_file_id?:string|null){
  await db.from('mms_audit_events').insert({actor_id:ctx.user.id,action,entity_type,entity_id:entity_id||null,detail,project_id:project_id||null,media_file_id:media_file_id||null});
}
async function mediaFor(ctx:any,id:string){
  let q=db.from('media_files').select('*').eq('id',id).is('purged_at',null);
  q=owned(q,ctx);
  const {data,error}=await q.maybeSingle();
  if(error)throw error;
  return data;
}
async function activeAiWorkers(){
  const cutoff=new Date(Date.now()-120000).toISOString();
  const {data,error}=await db.from('mms_worker_nodes').select('worker_id,status,version,last_seen_at,capabilities').gte('last_seen_at',cutoff).in('status',['online','busy']).order('last_seen_at',{ascending:false});
  if(error)throw error;
  return data||[];
}
function jobTypes(workers:any[]){
  const set=new Set<string>();
  for(const w of workers){for(const j of (w?.capabilities?.job_types||[]))set.add(String(j));}
  return [...set];
}
async function queueJob(ctx:any,file:any,module:string,jobType:string,input:any,key:string){
  const existing=await db.from('mms_processing_jobs').select('*').eq('idempotency_key',key).maybeSingle();
  if(existing.error)throw existing.error;
  if(existing.data){
    if(['failed','cancelled'].includes(existing.data.status)){
      const {data,error}=await db.from('mms_processing_jobs').update({status:'queued',progress:0,error_message:null,worker_id:null,locked_at:null,next_retry_at:null,input,updated_at:new Date().toISOString()}).eq('id',existing.data.id).select().single();
      if(error)throw error;
      return data;
    }
    return existing.data;
  }
  const {data,error}=await db.from('mms_processing_jobs').insert({owner_id:file.owner_id,project_id:file.project_id,media_file_id:file.id,module,job_type:jobType,status:'queued',priority:80,input,idempotency_key:key}).select().single();
  if(error)throw error;
  await audit(ctx,'ai_job_queued','processing_job',data.id,{job_type:jobType},file.project_id,file.id);
  return data;
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const body=await req.json().catch(()=>({}));
    const action=String(body.action||'capabilities');
    const ctx=await requireSession(req,body);

    if(action==='capabilities'){
      const workers=await activeAiWorkers();
      const types=jobTypes(workers);
      return out({ok:true,workers,job_types:types,audio_transcribe:types.includes('audio_transcribe'),football_highlight_scan:types.includes('football_highlight_scan')});
    }

    if(action==='preview-url'){
      const id=String(body.media_file_id||'');
      const file=await mediaFor(ctx,id);
      if(!file)return out({ok:false,error:'ไม่พบไฟล์หรือไม่มีสิทธิ์'},404);
      if(file.upload_status!=='ready')return out({ok:false,error:'ไฟล์ยังไม่พร้อมใช้งาน'},409);
      const expires=Math.max(60,Math.min(3600,Number(body.expires_in)||1200));
      const {data,error}=await db.storage.from('mms-media').createSignedUrl(file.storage_path,expires);
      if(error||!data?.signedUrl)throw error||new Error('SIGNED_URL_FAILED');
      return out({ok:true,url:data.signedUrl,file:{id:file.id,original_name:file.original_name,media_type:file.media_type,duration_ms:file.duration_ms}});
    }

    if(action==='request-audio-transcript'){
      const id=String(body.media_file_id||'');
      const file=await mediaFor(ctx,id);
      if(!file)return out({ok:false,error:'ไม่พบไฟล์หรือไม่มีสิทธิ์'},404);
      if(file.upload_status!=='ready')return out({ok:false,error:'ไฟล์ยังไม่พร้อมใช้งาน'},409);
      if(!['audio','video'].includes(file.media_type))return out({ok:false,error:'รองรับเฉพาะไฟล์เสียงหรือวิดีโอ'},400);
      const language=String(body.language||'th').slice(0,16);
      const model=String(body.model||'small').slice(0,32);
      const job=await queueJob(ctx,file,'audio','audio_transcribe',{language,model,source_path:file.storage_path},`audio-transcribe:${file.id}:${language}:${model}:v1`);
      return out({ok:true,job});
    }

    if(action==='request-football-scan'){
      const id=String(body.media_file_id||'');
      const file=await mediaFor(ctx,id);
      if(!file)return out({ok:false,error:'ไม่พบไฟล์หรือไม่มีสิทธิ์'},404);
      if(file.upload_status!=='ready')return out({ok:false,error:'ไฟล์ยังไม่พร้อมใช้งาน'},409);
      if(file.media_type!=='video')return out({ok:false,error:'Football AI ใช้กับไฟล์วิดีโอเท่านั้น'},400);
      const settings={
        preset:'football',
        sample_seconds:Math.max(0.5,Math.min(5,Number(body.sample_seconds)||1.5)),
        pre_roll_ms:Math.max(0,Math.min(30000,Number(body.pre_roll_ms)||8000)),
        post_roll_ms:Math.max(0,Math.min(45000,Number(body.post_roll_ms)||12000)),
        max_candidates:Math.max(5,Math.min(60,Number(body.max_candidates)||24)),
        goal_heuristic:!!body.goal_heuristic
      };
      const key=`football-scan:${file.id}:${settings.sample_seconds}:${settings.pre_roll_ms}:${settings.post_roll_ms}:v1`;
      const job=await queueJob(ctx,file,'video','football_highlight_scan',{source_path:file.storage_path,...settings},key);
      return out({ok:true,job,notice:settings.goal_heuristic?'Goal heuristic เป็นค่าเสริม ต้องยืนยันผลโดยผู้ใช้':'ระบบจะสร้าง Highlight candidates และไม่เรียกเป็น Goal จนกว่าจะมีตัวบ่งชี้เพียงพอ'});
    }

    if(action==='findings'){
      const mediaId=String(body.media_file_id||'');
      if(mediaId){const f=await mediaFor(ctx,mediaId);if(!f)return out({ok:false,error:'ไม่พบไฟล์หรือไม่มีสิทธิ์'},404);}
      let q=db.from('mms_ai_findings').select('*').order('start_ms',{ascending:true}).limit(Math.min(500,Math.max(1,Number(body.limit)||300)));
      if(mediaId)q=q.eq('media_file_id',mediaId);
      if(body.module)q=q.eq('module',String(body.module));
      if(body.finding_type)q=q.eq('finding_type',String(body.finding_type));
      if(body.review_status)q=q.eq('review_status',String(body.review_status));
      if(ctx.user.role!=='admin'&&!mediaId){
        const {data:mine}=await db.from('media_files').select('id').eq('owner_id',ctx.user.id).is('purged_at',null);
        const ids=(mine||[]).map((x:any)=>x.id);
        q=ids.length?q.in('media_file_id',ids):q.eq('media_file_id','00000000-0000-0000-0000-000000000000');
      }
      const {data,error}=await q;if(error)throw error;
      return out({ok:true,findings:data||[]});
    }

    if(action==='job-status'){
      const id=String(body.id||'');
      let q=db.from('mms_processing_jobs').select('*').eq('id',id);q=owned(q,ctx);
      const {data,error}=await q.maybeSingle();if(error)throw error;if(!data)return out({ok:false,error:'ไม่พบงาน'},404);
      return out({ok:true,job:data});
    }

    if(action==='review-finding'){
      const id=String(body.id||'');
      const status=['confirmed','rejected','corrected'].includes(String(body.review_status))?String(body.review_status):'';
      if(!status)return out({ok:false,error:'สถานะไม่ถูกต้อง'},400);
      const {data:f,error:fe}=await db.from('mms_ai_findings').select('*').eq('id',id).maybeSingle();if(fe)throw fe;if(!f)return out({ok:false,error:'ไม่พบผล AI'},404);
      const media=await mediaFor(ctx,String(f.media_file_id||''));if(!media)return out({ok:false,error:'ไม่มีสิทธิ์'},403);
      const correction=body.correction&&typeof body.correction==='object'?body.correction:{};
      const {data,error}=await db.from('mms_ai_findings').update({review_status:status,reviewed_by:ctx.user.id,reviewed_at:new Date().toISOString(),correction}).eq('id',id).select().single();if(error)throw error;
      await audit(ctx,'ai_finding_reviewed','ai_finding',id,{status,correction},f.project_id,f.media_file_id);
      return out({ok:true,finding:data});
    }

    return out({ok:false,error:'Unknown action'},400);
  }catch(e){
    const msg=e instanceof Error?e.message:String(e);console.error(e);
    if(msg==='UNAUTHORIZED')return out({ok:false,error:'กรุณาเข้าสู่ระบบใหม่'},401);
    return out({ok:false,error:'เกิดข้อผิดพลาดของระบบ',detail:msg},500);
  }
});
