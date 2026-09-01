import json
import logging
import os
import platform
import subprocess
import socket
import sys
import time
from pathlib import Path
import requests
from commands import execute, CommandError
from system_monitor import collect_metrics

BASE=Path(__file__).resolve().parent; LOG_DIR=BASE/'logs'; LOG_DIR.mkdir(exist_ok=True)
logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s',handlers=[logging.FileHandler(LOG_DIR/'agent.log',encoding='utf-8'),logging.StreamHandler()]); log=logging.getLogger('pc-remote')

def load_config():
    path=BASE/'config.json'
    if not path.exists(): raise RuntimeError('config.json not found; copy config.example.json and configure it')
    cfg=json.loads(path.read_text(encoding='utf-8')); token=os.getenv('PC_REMOTE_DEVICE_TOKEN')
    if not token: raise RuntimeError('Environment variable PC_REMOTE_DEVICE_TOKEN is required')
    for k in ('device_id','backend_url'):
        if not cfg.get(k): raise RuntimeError(f'Missing config key: {k}')
    cfg['token']=token; return cfg

class Agent:
    def __init__(self,cfg):
        self.cfg=cfg; self.session=requests.Session(); self.session.headers.update({'x-device-id':cfg['device_id'],'x-device-token':cfg['token'],'content-type':'application/json'}); self.last_heartbeat=0; self.shutdown_due_at=None; self.shutdown_action=None
    def call(self,method,action,**kwargs):
        r=self.session.request(method,f"{self.cfg['backend_url']}?action={action}",timeout=12,verify=self.cfg.get('verify_tls',True),**kwargs); r.raise_for_status(); return r.json() if r.content else {}
    def heartbeat(self):
        metrics=collect_metrics(); body={'device_name':socket.gethostname(),'agent_version':'1.1.0','windows_version':metrics.pop('windows_version',platform.platform()),'metrics':metrics,'shutdown_due_at':self.shutdown_due_at,'shutdown_action':self.shutdown_action}; self.call('POST','heartbeat',json=body); self.last_heartbeat=time.time(); log.info('heartbeat ok')
    def get_commands(self): return self.call('GET','commands').get('commands',[])
    def send_result(self,cid,status,result=None,error_message=None): self.call('POST','result',json={'command_id':cid,'status':status,'result':result or {},'error_message':error_message})
    def run_command(self,item):
        cid=item['id']; command=item['command']; params=item.get('parameters') or {}; log.info('command %s %s',cid,command)
        try:
            result=execute(command,params)
            if 'shutdown_due_at' in result:self.shutdown_due_at=result.get('shutdown_due_at')
            if 'shutdown_action' in result:self.shutdown_action=result.get('shutdown_action')
            self.send_result(cid,'SUCCESS',result=result)
        except (CommandError,subprocess.SubprocessError) as exc: log.exception('command failed'); self.send_result(cid,'FAILED',error_message=str(exc))
        except Exception as exc: log.exception('unexpected command failure'); self.send_result(cid,'FAILED',error_message=str(exc))
    def run(self):
        log.info('agent started on %s',socket.gethostname()); hb=int(self.cfg.get('heartbeat_seconds',15)); poll=float(self.cfg.get('poll_seconds',2))
        while True:
            try:
                if time.time()-self.last_heartbeat>=hb:self.heartbeat()
                for item in self.get_commands():self.run_command(item)
            except requests.RequestException as exc: log.warning('network/backend error: %s',exc)
            except Exception: log.exception('agent loop error')
            time.sleep(poll)

if __name__=='__main__':
    try: Agent(load_config()).run()
    except KeyboardInterrupt: pass
    except Exception as exc: log.critical('agent stopped: %s',exc); sys.exit(1)
