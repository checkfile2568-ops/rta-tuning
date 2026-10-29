import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../mms-clip.js',import.meta.url),'utf8').replace(/export /g,'').replace(/import\.meta\.url/g,"'https://example.test/mms-clip.js'");
function setup(fetch){
  const files=new Map();
  const ffmpeg={writeFile:async(name,data)=>files.set(name,data),deleteFile:async name=>files.delete(name)};
  const context={fetch,AbortController,DOMException,Uint8Array,Response,URL,console};vm.createContext(context);vm.runInContext(source,context);
  return {context,ffmpeg,files};
}
test('repeat exports reuse one input and changing source frees the previous cached bytes',async()=>{
  let calls=0;const {context,ffmpeg,files}=setup(async()=>{calls++;return new Response(new Uint8Array([1,2,3]))});
  for(const url of ['first','first','second'])await context.cachedSource(ffmpeg,{url},()=>{});
  assert.equal(calls,2);assert.equal(files.size,1);assert.equal([...files.values()][0].length,3);
});
test('stop aborts a source download and permits a clean retry',async()=>{
  let started;const ready=new Promise(resolve=>started=resolve);
  const {context,ffmpeg,files}=setup((url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')));started();
  }));
  const downloading=context.cachedSource(ffmpeg,{url:'slow'},()=>{});await ready;context.cancelProcessing();
  await assert.rejects(downloading,{name:'AbortError'});assert.equal(files.size,0);
  context.fetch=async()=>new Response(new Uint8Array([4]));await context.cachedSource(ffmpeg,{url:'retry'},()=>{});assert.equal(files.size,1);
});
