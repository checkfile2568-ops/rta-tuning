import os,time,json,tempfile,subprocess,uuid,math,wave,shutil
from pathlib import Path
from urllib.parse import quote
import requests

SUPABASE_URL=os.environ['SUPABASE_URL'].rstrip('/')
SERVICE_KEY=os.environ['SUPABASE_SERVICE_ROLE_KEY']
WORKER_ID=os.getenv('WORKER_ID',f'mms-ai-{uuid.uuid4().hex[:8]}')
POLL=float(os.getenv('POLL_SECONDS','3'))
BUCKET=os.getenv('MEDIA_BUCKET','mms-media')
VERSION='0.1.0'
HEAD={'apikey':SERVICE_KEY,'Authorization':f'Bearer {SERVICE_KEY}'}
REST=f'{SUPABASE_URL}/rest/v1'

try:
    from faster_whisper import WhisperModel
    HAVE_WHISPER=True
except Exception:
    WhisperModel=None;HAVE_WHISPER=False
try:
    import cv2
    import numpy as np
    HAVE_CV=True
except Exception:
    cv2=None;np=None;HAVE_CV=False
try:
    from ultralytics import YOLO
    HAVE_YOLO=True
except Exception:
    YOLO=None;HAVE_YOLO=False

JOB_TYPES=[]
if HAVE_WHISPER:JOB_TYPES.append('audio_transcribe')
if HAVE_CV and shutil.which('ffmpeg'):JOB_TYPES.append('football_highlight_scan')

_WHISPER=None
_YOLO=None

def req(method,url,**kw):
    h=dict(HEAD);h.update(kw.pop('headers',{}));r=requests.request(method,url,headers=h,timeout=kw.pop('timeout',120),**kw);r.raise_for_status();return r

def table_get(table,params):return req('GET',f'{REST}/{table}',params=params).json()
def table_patch(table,filters,payload):
    params={k:f'eq.{v}' for k,v in filters.items()};return req('PATCH',f'{REST}/{table}',params=params,json=payload,headers={'Content-Type':'application/json','Prefer':'return=representation'}).json()
def table_insert(table,payload):return req('POST',f'{REST}/{table}',json=payload,headers={'Content-Type':'application/json','Prefer':'return=representation'}).json()
def table_delete(table,params):return req('DELETE',f'{REST}/{table}',params=params,headers={'Prefer':'return=minimal'})
def table_upsert(table,payload,on_conflict=None):
    params={'on_conflict':on_conflict} if on_conflict else None
    return req('POST',f'{REST}/{table}',params=params,json=payload,headers={'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=representation'}).json()
def rpc(name,payload):
    r=req('POST',f'{REST}/rpc/{name}',json=payload,headers={'Content-Type':'application/json'});return r.json() if r.text else None

def now():return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
def heartbeat(status='online',job_id=None,error=None):
    payload={'worker_id':WORKER_ID,'worker_type':'ai','status':status,'current_job_id':job_id,'version':VERSION,'last_seen_at':now(),
             'capabilities':{'job_types':JOB_TYPES,'speech_to_text':HAVE_WHISPER,'football_highlights':HAVE_CV,'yolo_optional':HAVE_YOLO,'human_review_required':True},
             'metadata':{'error':error} if error else {}}
    table_upsert('mms_worker_nodes',payload,'worker_id')

def claim():
    if not JOB_TYPES:return None
    return rpc('mms_claim_processing_job',{'p_worker_id':WORKER_ID,'p_job_types':JOB_TYPES})
def job_update(jid,**patch):patch['updated_at']=now();return table_patch('mms_processing_jobs',{'id':jid},patch)
def job_status(jid):
    rows=table_get('mms_processing_jobs',{'id':f'eq.{jid}','select':'status','limit':'1'});return rows[0]['status'] if rows else None

def media(mid):
    rows=table_get('media_files',{'id':f'eq.{mid}','select':'*','limit':'1'});return rows[0] if rows else None

def download(path,dst,job_id=None):
    url=f"{SUPABASE_URL}/storage/v1/object/authenticated/{BUCKET}/{quote(path,safe='/')}"
    with req('GET',url,stream=True,timeout=3600) as r,open(dst,'wb') as f:
        last=time.time()
        for chunk in r.iter_content(8*1024*1024):
            if chunk:f.write(chunk)
            if job_id and time.time()-last>2:
                if job_status(job_id)=='cancelled':raise RuntimeError('JOB_CANCELLED')
                heartbeat('busy',job_id);last=time.time()

def safe_progress(job,p):
    if job_status(job['id'])=='cancelled':raise RuntimeError('JOB_CANCELLED')
    job_update(job['id'],progress=max(0,min(99,int(p))));heartbeat('busy',job['id'])

def transcript_model(model_name):
    global _WHISPER
    if _WHISPER is None:
        device=os.getenv('WHISPER_DEVICE','cpu')
        compute=os.getenv('WHISPER_COMPUTE_TYPE','int8' if device=='cpu' else 'float16')
        _WHISPER=WhisperModel(model_name,device=device,compute_type=compute)
    return _WHISPER

def process_audio_transcribe(job,m):
    inp=job.get('input') or {};lang=str(inp.get('language') or 'th');model_name=str(inp.get('model') or os.getenv('WHISPER_MODEL','small'))
    with tempfile.TemporaryDirectory() as td:
        src=str(Path(td)/('source'+(Path(m.get('original_name') or '').suffix or '.bin')));wav=str(Path(td)/'audio.wav')
        safe_progress(job,5);download(m['storage_path'],src,job['id']);safe_progress(job,15)
        p=subprocess.run(['ffmpeg','-y','-i',src,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav],capture_output=True,text=True)
        if p.returncode!=0:raise RuntimeError('AUDIO_NORMALIZE_FAILED: '+p.stderr[-3000:])
        safe_progress(job,22)
        model=transcript_model(model_name)
        segments,info=model.transcribe(wav,language=lang,beam_size=5,vad_filter=True,word_timestamps=False)
        rows=[];texts=[]
        for idx,seg in enumerate(segments,1):
            if idx%5==0:safe_progress(job,min(88,22+idx))
            text=(seg.text or '').strip()
            if not text:continue
            start_ms=round(float(seg.start)*1000);end_ms=round(float(seg.end)*1000);texts.append(text)
            rows.append({'project_id':m.get('project_id'),'media_file_id':m['id'],'module':'audio','finding_type':'transcript_segment',
                         'title':f'ถอดข้อความช่วง {idx}','detail':text,'position_text':f'{seg.start:.2f}-{seg.end:.2f}s','start_ms':start_ms,'end_ms':end_ms,
                         'confidence':None,'model_name':'faster-whisper','model_version':model_name,'review_status':'pending',
                         'payload':{'job_id':job['id'],'language':getattr(info,'language',lang),'segment_index':idx}})
        if rows:
            table_delete('mms_ai_findings',{'media_file_id':f"eq.{m['id']}",'module':'eq.audio','finding_type':'eq.transcript_segment','review_status':'eq.pending','model_name':'eq.faster-whisper'})
            for i in range(0,len(rows),100):table_insert('mms_ai_findings',rows[i:i+100])
        safe_progress(job,95)
        full='\n'.join(texts)
        job_update(job['id'],progress=100,status='completed',completed_at=now(),output={'language':getattr(info,'language',lang),'model':model_name,'segments':len(rows),'text':full})

def read_rms_windows(wav_path,window_ms=1000):
    vals=[]
    with wave.open(wav_path,'rb') as w:
        rate=w.getframerate();channels=w.getnchannels();width=w.getsampwidth();frames=max(1,int(rate*window_ms/1000))
        if width!=2:return vals
        import array
        t=0
        while True:
            data=w.readframes(frames)
            if not data:break
            a=array.array('h');a.frombytes(data)
            if channels>1:a=array.array('h',a[::channels])
            if not a:continue
            rms=math.sqrt(sum(int(x)*int(x) for x in a)/len(a));vals.append((t,rms));t+=window_ms
    return vals

def norm_scores(items):
    if not items:return {}
    vals=[float(v) for _,v in items];lo=min(vals);hi=max(vals);span=max(1e-9,hi-lo)
    return {int(t):(float(v)-lo)/span for t,v in items}

def scene_scores(video_path,sample_seconds=1.5,job=None):
    cap=cv2.VideoCapture(video_path);fps=cap.get(cv2.CAP_PROP_FPS) or 25.0;frame_count=cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0;duration=frame_count/fps if fps else 0
    step=max(1,int(fps*sample_seconds));scores=[];prev=None;i=0;read=0
    while True:
        cap.set(cv2.CAP_PROP_POS_FRAMES,i);ok,frame=cap.read()
        if not ok:break
        small=cv2.resize(frame,(192,108));hist=cv2.calcHist([small],[0,1],None,[16,16],[0,256,0,256]);cv2.normalize(hist,hist)
        if prev is not None:
            d=cv2.compareHist(prev,hist,cv2.HISTCMP_BHATTACHARYYA);scores.append((round((i/fps)*1000),float(d)))
        prev=hist;i+=step;read+=1
        if job and read%40==0:safe_progress(job,min(58,28+read//4))
        if duration and i/fps>duration:break
    cap.release();return scores

def get_yolo():
    global _YOLO
    if not HAVE_YOLO or os.getenv('FOOTBALL_USE_YOLO','0')!='1':return None
    if _YOLO is None:_YOLO=YOLO(os.getenv('FOOTBALL_YOLO_MODEL','yolov8n.pt'))
    return _YOLO

def yolo_context(video_path,t_ms):
    model=get_yolo()
    if model is None:return {'ball':0,'persons':0}
    cap=cv2.VideoCapture(video_path);cap.set(cv2.CAP_PROP_POS_MSEC,float(t_ms));ok,frame=cap.read();cap.release()
    if not ok:return {'ball':0,'persons':0}
    r=model.predict(frame,verbose=False,conf=0.25,max_det=80)[0];names=r.names;persons=0;ball=0
    for c in r.boxes.cls.tolist():
        n=str(names.get(int(c),''))
        if n=='person':persons+=1
        elif n=='sports ball':ball+=1
    return {'ball':ball,'persons':persons}

def merge_candidates(audio,scene,max_candidates=24):
    an=norm_scores(audio);sn=norm_scores(scene);keys=sorted(set([int(k//1000*1000) for k in an]+[int(k//1000*1000) for k in sn]))
    out=[]
    for k in keys:
        av=max((v for t,v in an.items() if abs(t-k)<=1500),default=0);sv=max((v for t,v in sn.items() if abs(t-k)<=2000),default=0)
        score=.62*av+.38*sv
        if score>=.55:out.append([k,score,av,sv])
    out.sort(key=lambda x:x[1],reverse=True)
    chosen=[]
    for x in out:
        if all(abs(x[0]-c[0])>7000 for c in chosen):chosen.append(x)
        if len(chosen)>=max_candidates:break
    return sorted(chosen,key=lambda x:x[0])

def process_football_scan(job,m):
    inp=job.get('input') or {};sample=float(inp.get('sample_seconds') or 1.5);pre=int(inp.get('pre_roll_ms') or 8000);post=int(inp.get('post_roll_ms') or 12000);maxc=int(inp.get('max_candidates') or 24);goal_heuristic=bool(inp.get('goal_heuristic'))
    with tempfile.TemporaryDirectory() as td:
        src=str(Path(td)/('source'+(Path(m.get('original_name') or '').suffix or '.mp4')));wav=str(Path(td)/'audio.wav')
        safe_progress(job,5);download(m['storage_path'],src,job['id']);safe_progress(job,16)
        p=subprocess.run(['ffmpeg','-y','-i',src,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav],capture_output=True,text=True)
        audio=[]
        if p.returncode==0:audio=read_rms_windows(wav,1000)
        safe_progress(job,28);scene=scene_scores(src,sample,job);safe_progress(job,62)
        candidates=merge_candidates(audio,scene,maxc);rows=[];yolo_active=get_yolo() is not None
        for idx,(t,base,av,sv) in enumerate(candidates,1):
            ctx=yolo_context(src,t);bonus=min(.12,ctx['persons']/22*.08)+(.08 if ctx['ball'] else 0);score=min(.99,base+bonus)
            possible_goal=goal_heuristic and score>=.84 and av>=.72 and (ctx['ball']>0 if yolo_active else score>=.9)
            ftype='goal_candidate' if possible_goal else 'highlight_candidate';title='⚽ Goal candidate — ต้องยืนยัน' if possible_goal else '⭐ AI Highlight candidate'
            rows.append({'project_id':m.get('project_id'),'media_file_id':m['id'],'module':'video','finding_type':ftype,'title':title,
                         'detail':'AI คัดจังหวะจากความเปลี่ยนแปลงของภาพ + พลังเสียง'+(' + YOLO context' if yolo_active else ''),
                         'position_text':f'{t/1000:.1f}s','start_ms':max(0,t-pre),'end_ms':t+post,'confidence':round(score,4),
                         'model_name':'mms-football-highlight-fusion','model_version':VERSION,'review_status':'pending',
                         'payload':{'job_id':job['id'],'event_ms':t,'audio_score':round(av,4),'scene_score':round(sv,4),'yolo':ctx,'goal_heuristic':goal_heuristic,'human_review_required':True}})
            safe_progress(job,min(92,64+idx*2))
        if rows:
            table_delete('mms_ai_findings',{'media_file_id':f"eq.{m['id']}",'module':'eq.video','finding_type':'in.(highlight_candidate,goal_candidate)','review_status':'eq.pending','model_name':'eq.mms-football-highlight-fusion'})
            table_insert('mms_ai_findings',rows)
        job_update(job['id'],progress=100,status='completed',completed_at=now(),output={'candidates':len(rows),'goal_candidates':sum(1 for r in rows if r['finding_type']=='goal_candidate'),'method':'audio+scene'+('+yolo' if yolo_active else ''),'human_review_required':True})

def process(job):
    m=media(job.get('media_file_id'))
    if not m:raise RuntimeError('MEDIA_FILE_NOT_FOUND')
    jt=job.get('job_type')
    if jt=='audio_transcribe':return process_audio_transcribe(job,m)
    if jt=='football_highlight_scan':return process_football_scan(job,m)
    raise RuntimeError('UNSUPPORTED_JOB_TYPE:'+str(jt))

def main():
    if not JOB_TYPES:
        print('No AI capability available. Install requirements.');return
    heartbeat('online')
    while True:
        try:
            job=claim()
            if not job:heartbeat('online');time.sleep(POLL);continue
            heartbeat('busy',job['id']);job_update(job['id'],progress=max(1,int(job.get('progress') or 0)))
            try:
                process(job)
            except Exception as e:
                if str(e)=='JOB_CANCELLED':job_update(job['id'],status='cancelled',error_message=None)
                else:
                    cur=table_get('mms_processing_jobs',{'id':f"eq.{job['id']}",'select':'attempts,max_attempts','limit':'1'})
                    attempts=int(cur[0].get('attempts') or 1) if cur else 1;maxa=int(cur[0].get('max_attempts') or 3) if cur else 3
                    if attempts<maxa:job_update(job['id'],status='queued',worker_id=None,locked_at=None,next_retry_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(time.time()+min(300,30*attempts))),error_message=str(e)[:3000])
                    else:job_update(job['id'],status='failed',completed_at=now(),error_message=str(e)[:3000])
                heartbeat('error',None,str(e)[:500]);time.sleep(2)
            finally:heartbeat('online')
        except KeyboardInterrupt:break
        except Exception as e:
            try:heartbeat('error',None,str(e)[:500])
            except Exception:pass
            time.sleep(max(3,POLL))

if __name__=='__main__':main()
