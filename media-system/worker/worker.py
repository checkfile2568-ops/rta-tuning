import os,time,json,hashlib,tempfile,subprocess,uuid
from pathlib import Path
from urllib.parse import quote
import requests

SUPABASE_URL=os.environ['SUPABASE_URL'].rstrip('/')
SERVICE_KEY=os.environ['SUPABASE_SERVICE_ROLE_KEY']
WORKER_ID=os.getenv('WORKER_ID',f'mms-worker-{uuid.uuid4().hex[:8]}')
POLL=float(os.getenv('POLL_SECONDS','3'))
BUCKET=os.getenv('MEDIA_BUCKET','mms-media')
VERSION='0.1.0'
HEAD={'apikey':SERVICE_KEY,'Authorization':f'Bearer {SERVICE_KEY}'}
REST=f'{SUPABASE_URL}/rest/v1'


def req(method,url,**kw):
    h=dict(HEAD);h.update(kw.pop('headers',{}));r=requests.request(method,url,headers=h,timeout=kw.pop('timeout',120),**kw);r.raise_for_status();return r

def table_get(table,params):return req('GET',f'{REST}/{table}',params=params).json()
def table_patch(table,filters,payload):
    params={k:f'eq.{v}' for k,v in filters.items()};return req('PATCH',f'{REST}/{table}',params=params,json=payload,headers={'Content-Type':'application/json','Prefer':'return=representation'}).json()
def table_upsert(table,payload,on_conflict=None):
    params={'on_conflict':on_conflict} if on_conflict else None
    return req('POST',f'{REST}/{table}',params=params,json=payload,headers={'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=representation'}).json()
def rpc(name,payload):
    r=req('POST',f'{REST}/rpc/{name}',json=payload,headers={'Content-Type':'application/json'});return r.json() if r.text else None

def heartbeat(status='online',job_id=None,error=None):
    payload={'worker_id':WORKER_ID,'worker_type':'media','status':status,'current_job_id':job_id,'version':VERSION,'last_seen_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'capabilities':{'job_types':['proxy_generate','checksum_compute'],'ffmpeg':True},'metadata':{'error':error} if error else {}}
    table_upsert('mms_worker_nodes',payload,'worker_id')

def claim():return rpc('mms_claim_processing_job',{'p_worker_id':WORKER_ID,'p_job_types':['proxy_generate','checksum_compute']})
def job_update(jid,**patch):
    patch['updated_at']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());return table_patch('mms_processing_jobs',{'id':jid},patch)

def media(mid):
    rows=table_get('media_files',{'id':f'eq.{mid}','select':'*','limit':'1'});return rows[0] if rows else None

def download(path,dst):
    url=f"{SUPABASE_URL}/storage/v1/object/authenticated/{BUCKET}/{quote(path,safe='/')}"
    with req('GET',url,stream=True,timeout=3600) as r,open(dst,'wb') as f:
        for chunk in r.iter_content(8*1024*1024):
            if chunk:f.write(chunk)

def upload(path,src,mime='application/octet-stream'):
    url=f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{quote(path,safe='/')}"
    size=os.path.getsize(src)
    with open(src,'rb') as f:req('POST',url,data=f,headers={'Content-Type':mime,'x-upsert':'true','Content-Length':str(size)},timeout=3600)

def sha256_file(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda:f.read(8*1024*1024),b''):h.update(chunk)
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

def process_checksum(job,m):
    with tempfile.TemporaryDirectory() as td:
        src=str(Path(td)/'source.bin');job_update(job['id'],progress=10);download(m['storage_path'],src);job_update(job['id'],progress=65);digest=sha256_file(src);table_patch('media_files',{'id':m['id']},{'sha256':digest,'checksum_verified':True,'updated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())});job_update(job['id'],progress=100,status='completed',completed_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),output={'sha256':digest})

def process_proxy(job,m):
    with tempfile.TemporaryDirectory() as td:
        src=str(Path(td)/('source'+Path(m['original_name']).suffix));out=str(Path(td)/'proxy-720p.mp4');job_update(job['id'],progress=8);download(m['storage_path'],src);meta=ffprobe(src);table_patch('media_files',{'id':m['id']},{**{k:v for k,v in meta.items() if v is not None},'updated_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())});job_update(job['id'],progress=30)
        cmd=['ffmpeg','-y','-i',src,'-vf','scale=-2:720:force_original_aspect_ratio=decrease','-c:v','libx264','-preset','veryfast','-crf','24','-c:a','aac','-b:a','128k','-movflags','+faststart',out]
        subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);job_update(job['id'],progress=78)
        path=f"{m['owner_id']}/proxy/{m['id']}/proxy-720p.mp4";upload(path,out,'video/mp4');job_update(job['id'],progress=93)
        table_upsert('mms_media_variants',{'media_file_id':m['id'],'variant_type':'proxy','storage_path':path,'mime_type':'video/mp4','size_bytes':os.path.getsize(out),'width':None,'height':720,'duration_ms':meta.get('duration_ms'),'status':'ready','metadata':{'profile':'720p-h264-aac','worker':WORKER_ID}},'media_file_id,variant_type')
        job_update(job['id'],progress=100,status='completed',completed_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),output={'proxy_path':path,'profile':'720p'})

def fail(job,e):
    attempts=int(job.get('attempts') or 1);max_attempts=int(job.get('max_attempts') or 3);msg=str(e)[-1800:]
    if attempts<max_attempts:job_update(job['id'],status='queued',progress=0,error_message=msg,worker_id=None,locked_at=None,next_retry_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(time.time()+30)))
    else:job_update(job['id'],status='failed',error_message=msg,completed_at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))

def main():
    print(f'{WORKER_ID} v{VERSION} starting');heartbeat('online')
    last=time.time()
    while True:
        try:
            if time.time()-last>30:heartbeat('online');last=time.time()
            job=claim()
            if not job:time.sleep(POLL);continue
            heartbeat('busy',job['id']);m=media(job.get('media_file_id'))
            if not m:raise RuntimeError('MEDIA_FILE_NOT_FOUND')
            if job['job_type']=='checksum_compute':process_checksum(job,m)
            elif job['job_type']=='proxy_generate':process_proxy(job,m)
            else:raise RuntimeError('UNSUPPORTED_JOB_TYPE:'+job['job_type'])
            heartbeat('online');last=time.time()
        except KeyboardInterrupt:heartbeat('offline');break
        except Exception as e:
            print('worker error',repr(e));
            try:
                if 'job' in locals() and job:fail(job,e)
                heartbeat('error',None,str(e)[-500:])
            except Exception as inner:print('error reporting failure',repr(inner))
            time.sleep(POLL)

if __name__=='__main__':main()
