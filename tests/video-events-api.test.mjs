import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync(new URL('../media-system/supabase/functions/mms-gemini-api/index.ts',import.meta.url),'utf8').replace(/^import .*?;\n/,'');
const js=stripTypeScriptTypes(source);
async function request(body,{session=true,owned=true,ready=true,aiEvents=[]}={}){
 let handler,calls=0;
 const db={from(table){const q={select(){return q},eq(){return q},gt(){return q},async maybeSingle(){
  return {data:table==='mms_sessions'?session?{user_id:'u'}:null:table==='mms_users'?{id:'u',role:'user',active:true}:owned?{id:'v',media_type:'video',upload_status:ready?'ready':'pending'}:null};
 }};return q}};
 const context={createClient:()=>db,Deno:{env:{get:k=>k==='GEMINI_API_KEY'?'test-key':'test'},serve:h=>handler=h},TextEncoder,Response,Request,crypto,AbortSignal,console,
 fetch:async()=>{calls++;return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({events:aiEvents})}]}}]})}};
 vm.runInNewContext(js,context);
 const response=await handler(new Request('https://example.test',{method:'POST',headers:{'x-mms-session':'test'},body:JSON.stringify({action:'video-events',...body})}));
 return {status:response.status,data:await response.json(),calls};
}
const frames=[{seconds:0,data:'/9j/AAAA'},{seconds:5,data:'/9j/AAAA'}],body={media_file_id:'v',question:'ผู้เล่นเจ็บ',frames};
test('unauthenticated and other owner requests denied before model call',async()=>{
 for(const opts of [{session:false},{owned:false},{ready:false}]){const r=await request(body,opts);assert.ok(r.status>=400);assert.equal(r.calls,0)}
});
test('bad timestamps, image sizes and empty prompt denied',async()=>{
 for(const b of [{...body,question:''},{...body,frames:[...frames,frames[0]]},{...body,frames:[{seconds:0,data:'not-jpeg'}]}]){const r=await request(b);assert.equal(r.status,400);assert.equal(r.calls,0)}
});
test('model timestamps outside submitted frames discarded and text safely bounded',async()=>{
 const r=await request(body,{aiEvents:[{start_seconds:1,end_seconds:3,title:'candidate',confidence:.8},{start_seconds:7,end_seconds:8},{start_seconds:'1',end_seconds:2}]});
 assert.equal(r.status,200);assert.equal(r.data.events.length,1);assert.equal(r.data.events[0].title,'candidate');assert.equal(r.calls,1);
});
