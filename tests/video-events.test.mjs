import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvents,mergeEvents} from '../mms-video-events.js';
import {buildVideoFilter,partsForRange} from '../mms-clip.js';
const part={start:60,end:120,duration:60};
test('Part-local event time becomes global time with bounded pre/post roll',()=>{
  assert.deepEqual(normalizeEvents([{start_seconds:2,end_seconds:4}],part,8,4).map(r=>[r.start,r.end,r.at]),[[54,68,63]]);
});
test('invalid and out-of-range AI times never become clips',()=>{
  assert.equal(normalizeEvents([{start_seconds:'2',end_seconds:4},{start_seconds:-1,end_seconds:2},{start_seconds:70,end_seconds:71},{start_seconds:4,end_seconds:2}],part).length,0);
  assert.throws(()=>normalizeEvents(null,part));
});
test('overlap detections merge but separate incidents and different types remain',()=>{
  const r={at:10,start:2,end:16,type:'goal',confidence:.5};
  assert.equal(mergeEvents([r,{...r,at:11},{...r,at:20},{...r,type:'injury',at:21}]).length,3);
});
test('range crossing Part boundary selects both inputs',()=>{
  assert.equal(partsForRange([{start:0,end:60},{start:60,end:120}],58,64).length,2);
});
test('still and clip share fixed zoom filter, including edge center coordinates',()=>{
  const vf=buildVideoFilter({zoom:2,center:{x:0,y:1},enhance:{brightness:10,sharpness:30},profile:'hd'});
  assert.match(vf,/crop=iw\/2.0000:ih\/2.0000/);assert.match(vf,/iw\*0.0000/);assert.match(vf,/ih\*1.0000/);
  assert.match(vf,/scale=-2:720/);assert.match(vf,/eq=/);assert.match(vf,/unsharp=/);
});
