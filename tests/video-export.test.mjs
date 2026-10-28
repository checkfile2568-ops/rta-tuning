import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {playbackRate,buildVideoFilter,buildClipArgs} from '../mms-clip.js';

test('only normal, slow and very slow rates are accepted',()=>{
  for(const n of [1,.5,.25])assert.equal(playbackRate(n),n);
  for(const n of [0,-1,2,NaN,.75])assert.throws(()=>playbackRate(n));
});
const available=spawnSync('ffmpeg',['-version']).status===0;
test('real exports preserve crop, sharpening, duration and audio at all three speeds',{skip:!available},()=>{
  const dir=mkdtempSync(join(tmpdir(),'mms-export-'));
  const run=(args)=>execFileSync('ffmpeg',['-y','-hide_banner','-loglevel','error',...args],{stdio:'pipe'});
  try{
    const source=join(dir,'source.mp4');
    run(['-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000','-t','6','-vf','boxblur=1','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','aac',source]);
    const probes=[];
    for(const rate of [1,.5,.25]){
      const output=join(dir,`rate-${rate}.mp4`);
      run(buildClipArgs({offset:2,inputArgs:['-i',source],duration:2,rate,zoom:2,center:{x:.25,y:.75},enhance:{sharpness:60},output}));
      const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',output],{encoding:'utf8'}));
      const v=info.streams.find(s=>s.codec_type==='video'),a=info.streams.find(s=>s.codec_type==='audio');
      assert.equal(v.width,160);assert.equal(v.height,90);
      assert.ok(Math.abs(Number(info.format.duration)-2/rate)<.10,`duration at ${rate}: ${info.format.duration}`);
      assert.ok(a);assert.ok(Math.abs(Number(a.duration)-Number(v.duration))<.10);
      probes.push({rate,seconds:info.format.duration,width:v.width,height:v.height,audio:a.duration});
    }
    // Pixel comparison proves sharpness changes the rendered result, beyond presence of an option.
    const images=[];
    for(const sharpness of [0,100]){
      const file=join(dir,`sharp-${sharpness}.gray`);
      run(['-ss','2','-i',source,'-vf',buildVideoFilter({zoom:2,center:{x:.25,y:.75},enhance:{sharpness},profile:'source_quality'}),'-frames:v','1','-pix_fmt','gray','-f','rawvideo',file]);
      images.push(readFileSync(file));
    }
    const [base,sharp]=images;
    const diff=base.reduce((sum,v,i)=>sum+Math.abs(v-sharp[i]),0)/base.length;
    const edge=b=>{let sum=0;for(let y=1;y<89;y++)for(let x=1;x<159;x++){const i=y*160+x;sum+=Math.abs(4*b[i]-b[i-1]-b[i+1]-b[i-160]-b[i+160]);}return sum};
    assert.ok(diff>.5,`pixel delta ${diff}`);assert.ok(edge(sharp)>edge(base),'sharpen increases edge contrast');
    // Crop centre at the edge is respected: .25/.75 at 2x means x=0,y=90.
    const expected=join(dir,'expected.gray');
    run(['-ss','2','-i',source,'-vf','crop=160:90:0:90,format=yuv420p','-frames:v','1','-pix_fmt','gray','-f','rawvideo',expected]);
    assert.deepEqual(base,readFileSync(expected));
    // Silent and muted clips must also export successfully.
    const silent=join(dir,'silent.mp4');run(['-i',source,'-an','-c:v','copy',silent]);
    for(const mute of [false,true])run(buildClipArgs({inputArgs:['-i',silent],duration:1,rate:.25,mute,output:join(dir,`silent-${mute}.mp4`)}));
    console.log('Measured exports:',JSON.stringify(probes),'sharpness mean pixel delta:',diff.toFixed(3));
  }finally{rmSync(dir,{recursive:true,force:true})}
});
