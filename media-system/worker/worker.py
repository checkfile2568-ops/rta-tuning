import os,time,json,hashlib,tempfile,subprocess,uuid,select,socket
from pathlib import Path
from urllib.parse import quote
import requests

SUPABASE_URL=os.environ['SUPABASE_URL'].rstrip('/')
SERVICE_KEY=os.environ['SUPABASE_SERVICE_ROLE_KEY']
WORKER_ID=os.getenv('WORKER_ID','').strip()
if not WORKER_ID:
    raise RuntimeError('WORKER_ID is required. Set a different ID on every worker host.')
WORKER_LABEL=os.getenv('WORKER_LABEL',WORKER_ID).strip() or WORKER_ID
HOSTNAME=socket.gethostname()
POLL=max(0.5,float(os.getenv('POLL_SECONDS','3')))
HEARTBEAT_SECONDS=max(5.0,float(os.getenv('HEARTBEAT_SECONDS','15')))
BUCKET=os.getenv('MEDIA_BUCKET','mms-media')
VERSION='0.4.1'
JOB_TYPES=['proxy_generate','checksum_compute','video_export','cctv_analyze']
HEAD={'apikey':SERVICE_KEY,'Authorization':f'Bearer {SERVICE_KEY}'}
REST=f'{SUPABASE_URL}/rest/v1'

def req(method,url,**kw):
    h=dict(HEAD);h.update(kw.pop('headers',{}));r=requests.request(method,url,headers=h,timeout=kw.pop('timeout',120),**kw);r.raise_for_status();return r

def table_get(table,params):return req('GET',f'{REST}/{table}',params=params).json()
def table_patch(table,filters,payload):
    params={k:f'eq.{v}' for k,v in filters.items()};return req('PATCH',f'{REST}/{table}',params=params,json=payload,headers={'Content-Type':'application/json','Prefer':'return=representation'}).json()
def table_insert(table,payload):return req('POST',f'{REST}/{table}',json=payload,headers={'Content-Type':'application/json','Prefer':'return=representation'}).json()
def table_upsert(table,payload,on_conflict=None):
    params={'on_conflict':on_conflict} if on_conflict else None
    return req('POST',f'{REST}/{table}',params=params,json=payload,headers={'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=representation'}).json()
def rpc(name,payload):
    r=req('POST',f'{REST}/rpc/{name}',json=payload,headers={'Content-Type':'application/json'});return r.json() if r.text else None

def now():return time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
def heartbeat(status='online',job_id=None,error=None):
    metadata={'label':WORKER_LABEL,'hostname':HOSTNAME,'mode':'active-any-node'}
    if error:metadata['error']=error
    payload={'worker_id':WORKER_ID,'worker_type':'media','status':status,'current_job_id':job_id,'version':VERSION,'last_seen_at':now(),'capabilities':{'job_types':JOB_TYPES,'ffmpeg':True,'opencv':True,'yolo':True,'cancel':True,'live_progress':True,'media_set_export':True,'video_enhance':True},'metadata':metadata}
    table_upsert('mms_worker_nodes',payload,'worker_id')

def claim():return rpc('mms_claim_processing_job',{'p_worker_id':WORKER_ID,'p_job_types':JOB_TYPES})
def job_update(jid,**patch):patch['updated_at']=now();return table_patch('mms_processing_jobs',{'id':jid},patch)
def job_status(jid):
    rows=table_get('mms_processing_jobs',{'id':f'eq.{jid}','select':'status','limit':'1'});return rows[0]['status'] if rows else None

def media(mid):
    if not mid:return None
    rows=table_get('media_files',{'id':f'eq.{mid}','select':'*','limit':'1'});return rows[0] if rows else None

def media_set(sid):
    if not sid:return None
    rows=table_get('mms_media_sets',{'id':f'eq.{sid}','select':'*','limit':'1'});return rows[0] if rows else None

def media_set_parts(sid):
    return table_get('media_files',{'media_set_id':f'eq.{sid}','upload_status':'eq.ready','purged_at':'is.null','select':'*','order':'segment_index.asc'})

def download(path,dst,job_id=None):
    url=f"{SUPABASE_URL}/storage/v1/object/authenticated/{BUCKET}/{quote(path,safe='/')}"
    with req('GET',url,stream=True,timeout=3600) as r,open(dst,'wb') as f:
        last=time.time()
        for chunk in r.iter_content(8*1024*1024):
            if chunk:f.write(chunk)
            if job_id and time.time()-last>2:
                if job_status(job_id)=='cancelled':raise RuntimeError('JOB_CANCELLED')
                heartbeat('busy',job_id);last=time.time()

def upload(path,src,mime='application/octet-stream'):
    url=f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{quote(path,safe='/')}";size=os.path.getsize(src)
    with open(src,'rb') as f:req('POST',url,data=f,headers={'Content-Type':mime,'x-upsert':'true','Content-Length':str(size)},timeout=3600)

def sha256_file(path,job_id=None):
    h=hashlib.sha256();last=time.time()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(8*1024*1024),b''):
            h.update(chunk)
            if job_id and time.time()-last>2:
                if job_status(job_id)=='cancelled':raise RuntimeError('JOB_CANCELLED')
                heartbeat('busy',job_id);last=time.time()
    return h.hexdigest()

def ffprobe(path):
    p=subprocess.run(['ffprobe','-v','error','-print_format','json','-show_format','-show_streams',path],capture_output=True,text=True,check=True)
    j=json.loads(p.stdout);vs=next((s for s in j.get('streams',[]) if s.get('codec_type')=='video'),{});aus=next((s for s in j.get('streams',[]) if s.get('codec_type')=='audio'),{})
    fps=None
    try:
        a,b=(vs.get('avg_frame_rate') or '0/1').split('/');fps=float(a)/float(b) if float(b) else None
    except Exception:pass
    dur=vs.get('duration') or j.get('format',{}).get('duration')
    return {'duration_ms':round(float(dur)*1000) if dur else None,'width':vs.get('width'),'height':vs.get('height'),'fps':fps,'codec':vs.get('codec_name'),'audio_codec':aus.get('codec_name')}

def run_ffmpeg(cmd,job,duration_ms,p0=25,p1=86):
    cmd=cmd[:-1]+['-progress','pipe:1','-nostats',cmd[-1]] if cmd[-1].lower().endswith(('.mp4','.mkv','.mov')) else cmd
    p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1);last_db=0.0;duration_us=max(1,int(duration_ms or 1)*1000)
    try:
        while True:
            if p.stdout:
                ready,_,_=select.select([p.stdout],[],[],1.0)
                if ready:
                    line=p.stdout.readline()
                    if line:
                        k,_,v=line.strip().partition('=')
                        if k in ('out_time_us','out_time_ms'):
                            try:
                                pct=p0+min(p1-p0,max(0,int(v)/duration_us*(p1-p0)))
                                if time.time()-last_db>1.0:job_update(job['id'],progress=round(pct));heartbeat('busy',job['id']);last_db=time.time()
                            except Exception:pass
            if job_status(job['id'])=='cancelled':
                p.terminate()
                try:p.wait(timeout=8)
                except subprocess.TimeoutExpired:p.kill()
                raise RuntimeError('JOB_CANCELLED')
            code=p.poll()
            if code is not None:
                if code!=0:raise RuntimeError('FFMPEG_FAILED: '+((p.stderr.read() if p.stderr else '')[-5000:]))
                break
    finally:
        if p.poll() is None:p.kill()

def process_checksum(job,m):
    with tempfile.TemporaryDirectory() as td:
        src=str(Path(td)/'source.bin');job_update(job['id'],progress=10);download(m['storage_path'],src,job['id']);job_update(job['id'],progress=60);digest=sha256_file(src,job['id'])
        if job_status(job['id'])=='cancelled':raise RuntimeError('JOB_CANCELLED')
        table_patch('media_files',{'id':m['id']},{'sha256':digest,'checksum_verified':True,'updated_at':now()});job_update(job['id'],progress=100,status='completed',completed_at=now(),output={'sha256':digest})

def process_proxy(job,m):
    with tempfile.TemporaryDirectory() as td:
        src=str(Path(td)/('source'+Path(m['original_name']).suffix));out=str(Path(td)/'proxy-720p.mp4');job_update(job['id'],progress=8);download(m['storage_path'],src,job['id']);meta=ffprobe(src);table_patch('media_files',{'id':m['id']},{**{k:v for k,v in meta.items() if v is not None},'updated_at':now()});job_update(job['id'],progress=25)
        vf="scale='if(gt(ih,720),-2,iw)':'if(gt(ih,720),720,ih)'";cmd=['ffmpeg','-y','-i',src,'-vf',vf,'-c:v','libx264','-preset','veryfast','-crf','24','-c:a','aac','-b:a','128k','-movflags','+faststart',out];run_ffmpeg(cmd,job,meta.get('duration_ms'),25,78)
        if job_status(job['id'])=='cancelled':raise RuntimeError('JOB_CANCELLED')
        path=f"{m['owner_id']}/proxy/{m['id']}/proxy-720p.mp4";job_update(job['id'],progress=82);upload(path,out,'video/mp4');job_update(job['id'],progress=95)
        table_upsert('mms_media_variants',{'media_file_id':m['id'],'variant_type':'proxy','storage_path':path,'mime_type':'video/mp4','size_bytes':os.path.getsize(out),'height':min(720,int(meta.get('height') or 720)),'duration_ms':meta.get('duration_ms'),'status':'ready','metadata':{'profile':'max-720p-h264-aac','worker':WORKER_ID}},'media_file_id,variant_type')
        job_update(job['id'],progress=100,status='completed',completed_at=now(),output={'storage_path':path,'proxy_path':path,'profile':'max-720p'})

def materialize_export_source(job,m,td):
    inp=job.get('input') or {};sid=inp.get('media_set_id')
    if not sid:
        if not m:raise RuntimeError('MEDIA_FILE_NOT_FOUND')
        src=str(Path(td)/('source'+(Path(m['original_name']).suffix or '.mp4')));job_update(job['id'],progress=5);download(m['storage_path'],src,job['id']);return src,m.get('owner_id'),m.get('original_name') or 'video.mp4',None
    s=media_set(sid)
    if not s:raise RuntimeError('MEDIA_SET_NOT_FOUND')
    parts=media_set_parts(sid);expected=int(s.get('total_parts') or 0)
    if not parts or (expected and len(parts)!=expected):raise RuntimeError(f'MEDIA_SET_INCOMPLETE:{len(parts)}/{expected}')
    files=[];total=len(parts)
    for i,p in enumerate(parts,1):
        ext=Path(p.get('original_name') or '').suffix or '.mp4';dst=str(Path(td)/f'part-{i:03d}{ext}');job_update(job['id'],progress=5+round((i-1)/max(1,total)*8));download(p['storage_path'],dst,job['id']);files.append(dst)
    concat_file=Path(td)/'concat.txt';concat_file.write_text(''.join("file '"+x.replace("'","'\\''")+"'\n" for x in files),encoding='utf-8');merged=str(Path(td)/'source-merged.mp4');job_update(job['id'],progress=14)
    p=subprocess.run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(concat_file),'-c','copy','-movflags','+faststart',merged],capture_output=True,text=True)
    if p.returncode!=0:
        p=subprocess.run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(concat_file),'-c:v','libx264','-preset','veryfast','-crf','18','-c:a','aac','-b:a','192k','-movflags','+faststart',merged],capture_output=True,text=True)
        if p.returncode!=0:raise RuntimeError('MEDIA_SET_CONCAT_FAILED: '+p.stderr[-4000:])
    job_update(job['id'],progress=18);return merged,s.get('owner_id'),s.get('original_name') or 'video.mp4',sid

def build_video_filters(inp,zoom,cx,cy,w,h):
    filters=[];mode=str(inp.get('zoom_mode') or 'original')
    if mode!='original' and zoom>1.001:
        filters.append(f"crop=w='trunc(iw/{zoom:.5f}/2)*2':h='trunc(ih/{zoom:.5f}/2)*2':x='(iw-ow)*{cx:.6f}':y='(ih-oh)*{cy:.6f}'");filters.append(f'scale={w}:{h}')
    enhance=inp.get('enhance') or {};brightness=max(-50.0,min(50.0,float(enhance.get('brightness') or 0)));contrast=max(-50.0,min(50.0,float(enhance.get('contrast') or 0)));saturation=max(-50.0,min(50.0,float(enhance.get('saturation') or 0)));sharpness=max(0.0,min(100.0,float(enhance.get('sharpness') or 0)));preset=str(enhance.get('preset') or 'custom')
    if preset=='cctv':filters.append('hqdn3d=1.5:1.5:6:6')
    if brightness or contrast or saturation:filters.append(f'eq=brightness={brightness/200.0:.4f}:contrast={1.0+contrast/100.0:.4f}:saturation={1.0+saturation/100.0:.4f}')
    if sharpness>0:filters.append(f'unsharp=5:5:{sharpness/100.0*1.5:.4f}:5:5:0')
    profile=str(inp.get('output_profile') or 'source_quality')
    if profile=='full_hd':filters.append("scale=1920:1080:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'")
    elif profile=='hd':filters.append("scale=1280:720:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'")
    elif profile=='compact':filters.append("scale=854:480:force_original_aspect_ratio=decrease,scale='trunc(iw/2)*2':'trunc(ih/2)*2'")
    return filters,{'brightness':brightness,'contrast':contrast,'saturation':saturation,'sharpness':sharpness,'preset':preset},profile

def process_video_export(job,m):
    inp=job.get('input') or {};mode=str(inp.get('zoom_mode') or 'original');zoom=max(1.0,min(4.0,float(inp.get('zoom_level') or 1)));center=inp.get('center') or {};cx=max(0,min(1,float(center.get('x',.5))));cy=max(0,min(1,float(center.get('y',.5))))
    with tempfile.TemporaryDirectory() as td:
        src,owner_id,source_name,set_id=materialize_export_source(job,m,td);meta=ffprobe(src);start=max(0,int(inp.get('trim_start_ms') or 0));source_dur=int(meta.get('duration_ms') or 0);end=int(inp.get('trim_end_ms') or source_dur);end=min(end,source_dur) if source_dur else end
        if end<=start:raise RuntimeError('INVALID_TRIM_RANGE')
        clip=max(1,end-start);w=int(meta.get('width') or (m or {}).get('width') or 1280);h=int(meta.get('height') or (m or {}).get('height') or 720);w-=w%2;h-=h%2;filters,enhance,profile=build_video_filters(inp,zoom,cx,cy,w,h);out=str(Path(td)/'final.mp4');job_update(job['id'],progress=20)
        cmd=['ffmpeg','-y','-ss',f'{start/1000:.3f}','-i',src,'-t',f'{clip/1000:.3f}'];
        if filters:cmd+=['-vf',','.join(filters)]
        crf='22' if profile=='compact' else '20';audio_rate='128k' if profile=='compact' else '192k';cmd+=['-c:v','libx264','-preset','veryfast','-crf',crf,'-c:a','aac','-b:a',audio_rate,'-movflags','+faststart',out];run_ffmpeg(cmd,job,clip,20,84)
        if job_status(job['id'])=='cancelled':raise RuntimeError('JOB_CANCELLED')
        final_meta=ffprobe(out);source_key=f'set-{set_id}' if set_id else str(m['id']);path=f"{owner_id}/output/{source_key}/{job['id']}/final.mp4";job_update(job['id'],progress=88);upload(path,out,'video/mp4');digest=sha256_file(out,job['id']);job_update(job['id'],progress=96)
        common_meta={'worker':WORKER_ID,'job_id':job['id'],'zoom_mode':mode,'zoom_level':zoom,'center':{'x':cx,'y':cy},'enhance':enhance,'output_profile':profile,'media_set_id':set_id,'tracking_note':'fixed-center export; AI tracking modes remain disabled in UI'}
        if m and not set_id:table_upsert('mms_media_variants',{'media_file_id':m['id'],'variant_type':'output','storage_path':path,'mime_type':'video/mp4','size_bytes':os.path.getsize(out),'width':final_meta.get('width'),'height':final_meta.get('height'),'duration_ms':clip,'checksum':digest,'status':'ready','metadata':common_meta},'media_file_id,variant_type')
        if set_id:table_patch('mms_media_sets',{'id':set_id},{'selected_clip_status':'ready','updated_at':now()})
        job_update(job['id'],progress=100,status='completed',completed_at=now(),output={'storage_path':path,'name':f"MMs_{Path(source_name).stem}_final.mp4",'sha256':digest,'duration_ms':clip,'zoom_mode':mode,'enhance':enhance,'output_profile':profile,'media_set_id':set_id,'width':final_meta.get('width'),'height':final_meta.get('height')})

def process_cctv(job,m):
    import cv2
    from ultralytics import YOLO
    inp=job.get('input') or {};sample_fps=max(.25,min(10,float(inp.get('sample_fps') or 2)));conf=max(.1,min(.95,float(inp.get('confidence') or .35)));wanted=set(inp.get('classes') or ['person','bicycle','car','motorcycle','bus','truck']);gap=max(300,int(inp.get('merge_gap_ms') or 1800));camera_id=inp.get('camera_id');model_name=str(inp.get('model') or os.getenv('YOLO_MODEL','yolo11n.pt'))
    with tempfile.TemporaryDirectory() as td:
        src=str(Path(td)/('cctv'+Path(m['original_name']).suffix));job_update(job['id'],progress=5);download(m['storage_path'],src,job['id']);job_update(job['id'],progress=12);model=YOLO(model_name);cap=cv2.VideoCapture(src)
        if not cap.isOpened():raise RuntimeError('CCTV_VIDEO_OPEN_FAILED')
        fps=float(cap.get(cv2.CAP_PROP_FPS) or 25);frames=int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0);step=max(1,int(round(fps/sample_fps)));names=model.names;ids=[int(k) for k,v in names.items() if str(v) in wanted];active={};events=[];idx=0;last_db=0.0
        def finish(kind):
            e=active.pop(kind,None)
            if e:events.append(e)
        while True:
            ok,frame=cap.read()
            if not ok:break
            if idx%step:idx+=1;continue
            ms=int(idx/fps*1000);idx+=1
            if job_status(job['id'])=='cancelled':cap.release();raise RuntimeError('JOB_CANCELLED')
            result=model.predict(frame,conf=conf,classes=ids,verbose=False,imgsz=640)[0];seen={'person':[],'vehicle':[]};sub={}
            if result.boxes is not None:
                for cls_v,cf_v in zip(result.boxes.cls.tolist(),result.boxes.conf.tolist()):
                    name=str(names[int(cls_v)]);kind='person' if name=='person' else 'vehicle';seen[kind].append(float(cf_v));sub[name]=sub.get(name,0)+1
            for kind in ('person','vehicle'):
                vals=seen[kind]
                if vals:
                    if kind not in active:active[kind]={'event_type':kind,'start_ms':ms,'end_ms':ms,'last_ms':ms,'confidence':max(vals),'max_count':len(vals),'subtypes':dict(sub)}
                    else:
                        e=active[kind];e['end_ms']=ms;e['last_ms']=ms;e['confidence']=max(e['confidence'],max(vals));e['max_count']=max(e['max_count'],len(vals));
                        for k,v in sub.items():e['subtypes'][k]=max(e['subtypes'].get(k,0),v)
                elif kind in active and ms-active[kind]['last_ms']>gap:finish(kind)
            if frames and time.time()-last_db>1.3:
                pct=15+min(72,(idx/max(1,frames))*72);job_update(job['id'],progress=round(pct));heartbeat('busy',job['id']);last_db=time.time()
        cap.release();finish('person');finish('vehicle');job_update(job['id'],progress=90);inserted=0
        for e in events:
            title='พบบุคคล' if e['event_type']=='person' else 'พบยานพาหนะ';detail=(f"พบสูงสุด {e['max_count']} คน" if e['event_type']=='person' else ' • '.join(f"{k} {v}" for k,v in sorted(e['subtypes'].items()) if k!='person'));row={'project_id':job.get('project_id'),'media_file_id':m['id'],'camera_id':camera_id,'event_type':e['event_type'],'title':title,'detail':detail,'start_ms':e['start_ms'],'end_ms':e['end_ms'],'pre_roll_ms':3000,'post_roll_ms':5000,'confidence':round(float(e['confidence']),4),'model_name':'Ultralytics YOLO','model_version':model_name,'review_status':'pending','metadata':{'job_id':job['id'],'max_count':e['max_count'],'subtypes':e['subtypes'],'sample_fps':sample_fps}}
            er=table_insert('mms_cctv_events',row);event_id=er[0]['id'] if er else None;table_insert('mms_ai_findings',{'project_id':job.get('project_id'),'media_file_id':m['id'],'module':'cctv','finding_type':e['event_type'],'title':title,'detail':detail,'position_text':f"{e['start_ms']/1000:.1f}s–{e['end_ms']/1000:.1f}s",'start_ms':e['start_ms'],'end_ms':e['end_ms'],'confidence':round(float(e['confidence']),4),'model_name':'Ultralytics YOLO','model_version':model_name,'review_status':'pending','payload':{'cctv_event_id':event_id,'job_id':job['id'],'subtypes':e['subtypes']}});inserted+=1
        job_update(job['id'],progress=100,status='completed',completed_at=now(),output={'event_count':inserted,'model':model_name,'sample_fps':sample_fps,'confidence':conf})

def fail(job,e):
    msg=str(e)[-1800:]
    if msg=='JOB_CANCELLED' or job_status(job['id'])=='cancelled':return
    attempts=int(job.get('attempts') or 1);max_attempts=int(job.get('max_attempts') or 3)
    if attempts<max_attempts:job_update(job['id'],status='queued',progress=0,error_message=msg,worker_id=None,locked_at=None,next_retry_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(time.time()+30)))
    else:job_update(job['id'],status='failed',error_message=msg,completed_at=now())

def main():
    print(f'{WORKER_ID} ({WORKER_LABEL}) v{VERSION} starting on {HOSTNAME}');heartbeat('online');last=time.time();job=None
    while True:
        try:
            if time.time()-last>HEARTBEAT_SECONDS:heartbeat('online');last=time.time()
            job=claim()
            if not job:time.sleep(POLL);continue
            heartbeat('busy',job['id']);m=media(job.get('media_file_id'));has_set=bool((job.get('input') or {}).get('media_set_id'))
            if job['job_type']!='video_export' and not m:raise RuntimeError('MEDIA_FILE_NOT_FOUND')
            if job['job_type']=='video_export' and not m and not has_set:raise RuntimeError('MEDIA_SOURCE_NOT_FOUND')
            if job['job_type']=='checksum_compute':process_checksum(job,m)
            elif job['job_type']=='proxy_generate':process_proxy(job,m)
            elif job['job_type']=='video_export':process_video_export(job,m)
            elif job['job_type']=='cctv_analyze':process_cctv(job,m)
            else:raise RuntimeError('UNSUPPORTED_JOB_TYPE:'+job['job_type'])
            heartbeat('online');last=time.time();job=None
        except KeyboardInterrupt:heartbeat('offline');break
        except Exception as e:
            print('worker error',repr(e))
            try:
                if job:fail(job,e)
                heartbeat('error',None,str(e)[-500:])
            except Exception as inner:print('error reporting failure',repr(inner))
            job=None;time.sleep(POLL)

if __name__=='__main__':main()
