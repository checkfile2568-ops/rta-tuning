import json,os,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import worker

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ('/','/health','/healthz'):
            self.send_response(404);self.end_headers();return
        body=json.dumps({'ok':True,'service':'mms-media-worker','worker_id':worker.WORKER_ID,'version':worker.VERSION,'job_types':worker.JOB_TYPES,'time':time.time()}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def log_message(self,fmt,*args):return

def serve():
    port=int(os.getenv('PORT','8080'))
    ThreadingHTTPServer(('0.0.0.0',port),Handler).serve_forever()

if __name__=='__main__':
    threading.Thread(target=serve,daemon=True).start()
    worker.main()
