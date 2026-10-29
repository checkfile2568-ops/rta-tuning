/*  MMs — mms-clip.js  (v1.0)
 *  ตัด/ซูม/ปรับแสงสี แล้วส่งออกเป็นไฟล์ในเบราว์เซอร์ด้วย FFmpeg-WASM
 *  รวมความสามารถ "ตัดคลิปในเบราว์เซอร์ + ปรับแสง" จากระบบวิเคราะห์วิดีโอเดิม (Google Apps Script)
 *  เข้ากับคลังไฟล์ของ MMs ใหม่ — ไม่ต้องพึ่ง Worker
 *
 *  ── จุดต่อยอด (extension points) ──
 *  [EXT-1] PRESETS          : เพิ่มชุดค่าปรับภาพใหม่ได้ที่นี่
 *  [EXT-2] buildVideoFilter : เพิ่มฟิลเตอร์ FFmpeg เพิ่มเติม (watermark, deinterlace ฯลฯ)
 *  [EXT-3] PROFILES         : เพิ่มโปรไฟล์ความละเอียด/คุณภาพ
 */

const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
const FFMPEG_ESM = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
const UTIL_ESM  = 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js';

let ffmpegPromise = null, activeFFmpeg = null, sourceCache = null, sourceController = null, processingGeneration = 0;
export function cancelProcessing(){
  processingGeneration++;
  sourceController?.abort();sourceController=null;
  activeFFmpeg?.terminate();activeFFmpeg=null;ffmpegPromise=null;sourceCache=null;
}
async function cachedSource(ffmpeg,part,onStage){
  if(sourceCache?.url===part.url)return sourceCache.name;
  if(sourceCache){try{await ffmpeg.deleteFile(sourceCache.name)}catch{}sourceCache=null}
  const controller=new AbortController();sourceController=controller;
  try{
    const response=await fetch(part.url,{signal:controller.signal});
    if(!response.ok)throw new Error('ดาวน์โหลดต้นทางไม่สำเร็จ HTTP '+response.status);
    const total=Number(response.headers.get('content-length'))||part.size_bytes||0;
    const chunks=[];let received=0;
    if(response.body){
      const reader=response.body.getReader();
      for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);received+=value.length;
        onStage?.(`กำลังอ่านต้นทาง ${(received/1048576).toFixed(1)}${total?' / '+(total/1048576).toFixed(1):''} MB`)}
    }else{const value=new Uint8Array(await response.arrayBuffer());chunks.push(value);received=value.length}
    controller.signal.throwIfAborted();
    const data=new Uint8Array(received);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length}
    const name='cached-source.mp4';await ffmpeg.writeFile(name,data);sourceCache={url:part.url,name};return name;
  }finally{if(sourceController===controller)sourceController=null}
}


/* โหลด FFmpeg-WASM ครั้งเดียวแล้วใช้ซ้ำ
   หมายเหตุสำคัญ: worker ของ FFmpeg ต้องเป็น same-origin ไม่งั้น Chromium/Android จะสร้าง Worker ข้ามโดเมนไม่ได้
   จึงต้องชี้ classWorkerURL ไปที่ ./vendor/ffmpeg-0.12.10/worker.js ที่อยู่ในโดเมนเดียวกัน */
export async function loadFFmpeg(onLoadProgress){
  if(ffmpegPromise) return ffmpegPromise;
  const generation=processingGeneration;
  ffmpegPromise = (async () => {
    const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
      import(FFMPEG_ESM),
      import(UTIL_ESM)
    ]);
    if(generation!==processingGeneration)throw new DOMException('Cancelled','AbortError');
    const ffmpeg = new FFmpeg();activeFFmpeg=ffmpeg;
    const classWorkerURL = new URL('./vendor/ffmpeg-0.12.10/worker.js', import.meta.url).href;
    onLoadProgress?.(0.2);
    const controller=new AbortController();sourceController=controller;
    let coreURL,wasmURL;
    try{
      const core=await fetch(CORE_BASE+'/ffmpeg-core.js',{signal:controller.signal});
      if(!core.ok)throw new Error('โหลดตัวตัดวิดีโอไม่สำเร็จ');coreURL=URL.createObjectURL(await core.blob());
      onLoadProgress?.(.6);
      const wasm=await fetch(CORE_BASE+'/ffmpeg-core.wasm',{signal:controller.signal});
      if(!wasm.ok)throw new Error('โหลดตัวตัดวิดีโอไม่สำเร็จ');wasmURL=URL.createObjectURL(await wasm.blob());
      if(generation!==processingGeneration)throw new DOMException('Cancelled','AbortError');
      onLoadProgress?.(.9);await ffmpeg.load({coreURL,wasmURL,classWorkerURL});onLoadProgress?.(1);
    }finally{
      if(coreURL)URL.revokeObjectURL(coreURL);if(wasmURL)URL.revokeObjectURL(wasmURL);
      if(sourceController===controller)sourceController=null;
    }
    return { ffmpeg, fetchFile };
  })();
  try { return await ffmpegPromise; }
  catch(e){ ffmpegPromise = null; throw e; }
}

/* [EXT-1] ชุดค่าปรับภาพสำเร็จรูป — คีย์ต้องตรงกับฝั่งเซิร์ฟเวอร์ (mms-workflow-api) */
export const PRESETS = {
  natural: { label:'ธรรมชาติ',      brightness:0,   contrast:0,  saturation:0,  sharpness:0  },
  bright:  { label:'สว่างขึ้น',      brightness:14,  contrast:8,  saturation:6,  sharpness:15 },
  cctv:    { label:'กล้องวงจรปิด',   brightness:20,  contrast:22, saturation:-8, sharpness:45 },
  sport:   { label:'กีฬา/ฟุตบอล',    brightness:6,   contrast:14, saturation:16, sharpness:32 },
  custom:  { label:'กำหนดเอง',      brightness:0,   contrast:0,  saturation:0,  sharpness:0  }
};

/* [EXT-3] โปรไฟล์ส่งออก */
export const PROFILES = {
  quick:          { label:'เร็ว ไม่เกิน 720p', height:720, cap:true, crf:24, preset:'ultrafast' },
  source_quality: { label:'เท่าต้นฉบับ', height:0,    crf:20 },
  full_hd:        { label:'Full HD 1080p', height:1080, crf:21 },
  hd:             { label:'HD 720p',       height:720,  crf:23 },
  compact:        { label:'ประหยัด 480p',  height:480,  crf:26 }
};

const clamp = (n,a,b)=>Math.max(a,Math.min(b,Number(n)||0));

/* อ่านความยาวจริงของแต่ละ Part จาก URL โดยโหลดเฉพาะ metadata (ไม่ดาวน์โหลดทั้งไฟล์) */
export function probeDuration(url, timeoutMs = 25000){
  return new Promise((resolve,reject)=>{
    const v = document.createElement('video');
    let done = false;
    const finish = (fn,arg)=>{ if(done) return; done = true; clearTimeout(timer); v.removeAttribute('src'); v.load?.(); fn(arg); };
    const timer = setTimeout(()=>finish(reject,new Error('อ่านความยาวไฟล์ไม่ทันเวลา')), timeoutMs);
    v.preload = 'metadata';
    v.crossOrigin = 'anonymous';
    v.onloadedmetadata = ()=> finish(resolve, Number.isFinite(v.duration) ? v.duration : 0);
    v.onerror = ()=> finish(reject, new Error('อ่านความยาวไฟล์ไม่สำเร็จ'));
    v.src = url;
  });
}

/* สร้างไทม์ไลน์รวมจากหลาย Part → [{index,url,name,start,end,duration}] */
export async function buildTimeline(parts, onProgress){
  const list = [];
  let cursor = 0;
  for(let i=0;i<parts.length;i++){
    const p = parts[i];
    let d = Number(p.duration_ms) > 0 ? Number(p.duration_ms)/1000 : 0;
    if(!d){ d = await probeDuration(p.url); }
    list.push({ id:p.id, index:i, url:p.url, name:p.original_name || p.name || ('part-'+(i+1)), start:cursor, end:cursor+d, duration:d, size_bytes:Number(p.size_bytes)||0 });
    cursor += d;
    onProgress?.((i+1)/parts.length);
  }
  return { parts:list, duration:cursor };
}

/* [EXT-2] สร้างสาย filter ของ FFmpeg */
export function buildVideoFilter({ zoom, center, enhance, profile }){
  const chain = [];
  const z = clamp(zoom,1,4);
  if(z > 1.001){
    const cx = clamp(center?.x ?? .5, 0, 1).toFixed(4);
    const cy = clamp(center?.y ?? .5, 0, 1).toFixed(4);
    const zz = z.toFixed(4);
    // ใช้นิพจน์เพื่อไม่ต้องรู้ขนาดจริงของวิดีโอล่วงหน้า — ต้อง escape comma ใน min/max
    chain.push(
      `crop=iw/${zz}:ih/${zz}:` +
      `max(0\\,min(iw-iw/${zz}\\,iw*${cx}-iw/(2*${zz}))):` +
      `max(0\\,min(ih-ih/${zz}\\,ih*${cy}-ih/(2*${zz})))`
    );
  }
  const prof = PROFILES[profile] || PROFILES.source_quality;
  if(prof.height) chain.push(prof.cap?`scale=-2:min(${prof.height}\\,ih):flags=fast_bilinear`:`scale=-2:${prof.height}:flags=bicubic`);

  const e = enhance || {};
  const b = clamp(e.brightness,-50,50), c = clamp(e.contrast,-50,50), s = clamp(e.saturation,-50,50), sh = clamp(e.sharpness,0,100);
  if(b||c||s){
    chain.push(`eq=brightness=${(b/50*0.30).toFixed(3)}:contrast=${(1+c/100).toFixed(3)}:saturation=${(1+s/100).toFixed(3)}`);
  }
  if(sh > 0){
    chain.push(`unsharp=5:5:${(sh/100*1.5).toFixed(3)}:5:5:0.0`);
  }
  chain.push('format=yuv420p');
  return chain.join(',');
}

/* คำนวณว่าช่วงเวลาที่เลือกกินกี่ Part — ดาวน์โหลดเฉพาะที่จำเป็นเพื่อไม่ให้มือถือหน่วยความจำเต็ม */
export function partsForRange(timelineParts, startSec, endSec){
  return timelineParts.filter(p => p.end > startSec + 0.001 && p.start < endSec - 0.001);
}

/* Rates shared by playback, export, and duration labels. */
export const PLAYBACK_RATES = [1, 0.5, 0.25];
export function playbackRate(value = 1){
  const rate=Number(value);
  if(!PLAYBACK_RATES.includes(rate))throw new Error('ความเร็วต้องเป็น 1, 0.5 หรือ 0.25 เท่า');
  return rate;
}
export function buildClipArgs({offset=0,inputArgs,duration,rate=1,zoom=1,center={x:.5,y:.5},enhance=PRESETS.natural,profile='source_quality',mute=false,output='output.mp4'}){
  rate=playbackRate(rate);
  if(!Number.isFinite(duration)||duration<=.2)throw new Error('ช่วงเวลาไม่ถูกต้อง');
  const video=[buildVideoFilter({zoom,center,enhance,profile})];
  const audio=[];
  if(rate!==1){
    video.push(`setpts=(PTS-STARTPTS)/${rate}`,`fps=fps=source_fps*${rate}`,'tpad=stop_mode=clone:stop_duration=3');
    audio.push('asetpts=PTS-STARTPTS','atempo=0.5');
    if(rate===.25)audio.push('atempo=0.5');
    audio.push('apad');
  }
  const prof=PROFILES[profile]||PROFILES.source_quality;
  return ['-ss',offset.toFixed(3),'-t',duration.toFixed(3),...inputArgs,
    '-t',(duration/rate).toFixed(3),'-vf',video.join(','),
    '-c:v','libx264','-preset',prof.preset||'veryfast','-crf',String(prof.crf),
    ...(rate!==1?['-vsync','vfr']:[]),
    ...(mute?['-an']:[...(audio.length?['-af',audio.join(',')]:[]),'-c:a','aac','-b:a','128k']),
    '-movflags','+faststart','-threads','1',output];
}

/**
 * ตัด + ส่งออกไฟล์ในเบราว์เซอร์
 * @returns {Promise<{blob:Blob,name:string,bytes:number,seconds:number}>}
 */
export async function exportClip({
  timelineParts, startSec, endSec,
  zoom = 1, center = { x:.5, y:.5 },
  enhance = PRESETS.natural, profile = 'source_quality',
  mute = false, rate = 1, baseName = 'MMs-clip',
  onStage, onProgress
} = {}){
  rate=playbackRate(rate);
  const start = Math.max(0, Number(startSec) || 0);
  const end   = Number(endSec) || 0;
  const dur   = end - start;
  if(!(dur > 0.2)) throw new Error('ช่วงเวลาที่เลือกสั้นเกินไป');

  const needed = partsForRange(timelineParts, start, end);
  if(!needed.length) throw new Error('ไม่พบไฟล์ต้นทางในช่วงเวลาที่เลือก');

  onStage?.('กำลังเตรียมระบบตัดวิดีโอ');
  const { ffmpeg, fetchFile } = await loadFFmpeg(p => onProgress?.(p * 0.08));

  const written = [];
  const cleanup = async () => { for(const f of written){ try{ await ffmpeg.deleteFile(f); }catch{} } };

  try{
    // 1) ดึงเฉพาะ Part ที่เกี่ยวข้องเข้าหน่วยความจำของ FFmpeg
    let inputArgs;
    if(needed.length===1){
      const name=await cachedSource(ffmpeg,needed[0],onStage);inputArgs=['-i',name];onProgress?.(.38);
    }else{
      for(let i=0;i<needed.length;i++){
        onStage?.(`กำลังดึงไฟล์ต้นทาง ${i+1}/${needed.length}`);
        const fname=`src-${String(i+1).padStart(3,'0')}.mp4`;
        // The one-Part cache is copied before moving on to the next Part.
        const cached=await cachedSource(ffmpeg,needed[i],onStage);
        await ffmpeg.writeFile(fname,await ffmpeg.readFile(cached));written.push(fname);
        onProgress?.(.08+(i+1)/needed.length*.30);
      }
      await ffmpeg.writeFile('concat.txt',new TextEncoder().encode(written.map(n=>`file '${n}'`).join('\n')+'\n'));
      if(sourceCache){try{await ffmpeg.deleteFile(sourceCache.name)}catch{}sourceCache=null}
      written.push('concat.txt');inputArgs=['-f','concat','-safe','0','-i','concat.txt'];
    }

    // เวลาเริ่มต้นต้องเทียบกับจุดเริ่มของ Part แรกที่ดึงมา ไม่ใช่จุดเริ่มของทั้งคลิป
    const offset = Math.max(0, start - needed[0].start);
    const args=buildClipArgs({offset,inputArgs,duration:dur,rate,zoom,center,enhance,profile,mute});
    written.push('output.mp4');

    onStage?.('กำลังเรนเดอร์คลิป');
    const handler = ({ progress }) => {
      const p = Math.max(0, Math.min(1, Number(progress) || 0));
      onProgress?.(0.38 + p * 0.58);
    };
    ffmpeg.on('progress', handler);
    let code;
    try{ code = await ffmpeg.exec(args); }
    finally{ ffmpeg.off?.('progress', handler); }
    if(code !== 0) throw new Error('FFmpeg ทำงานไม่สำเร็จ (code ' + code + ')');

    onStage?.('กำลังสร้างไฟล์ดาวน์โหลด');
    const data = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([data], { type:'video/mp4' });
    onProgress?.(1);

    const stamp = new Date();
    const pad = n => String(n).padStart(2,'0');
    const name = `${baseName}${rate===1?'':'_'+rate+'x'}_${stamp.getFullYear()+543}${pad(stamp.getMonth()+1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.mp4`;
    return { blob, name, bytes: blob.size, seconds: dur/rate, sourceSeconds: dur, rate };
  } finally {
    await cleanup();
  }
}

/* บันทึกไฟล์ลงเครื่อง — รองรับทั้ง Android/iOS/เดสก์ท็อป */
export function saveBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 4000);
}

/* Still image uses exactly the same FFmpeg crop and enhancement as video export. */
export async function exportFrame({timelineParts, timeSec, zoom=1, center={x:.5,y:.5}, enhance=PRESETS.natural, profile='source_quality', onStage}={}) {
  const part=timelineParts.find(p=>timeSec>=p.start && timeSec<p.end);
  if(!part)throw new Error('ไม่พบภาพในช่วงเวลานี้');
  onStage?.('กำลังเตรียมภาพนิ่งตามค่าซูมเดิม');
  const {ffmpeg,fetchFile}=await loadFFmpeg();
  try {
    const input=await cachedSource(ffmpeg,part,onStage);
    const code=await ffmpeg.exec(['-ss',Math.max(0,timeSec-part.start).toFixed(3),'-i',input,'-frames:v','1','-vf',buildVideoFilter({zoom,center,enhance,profile}),'-threads','1','frame.png']);
    if(code!==0)throw new Error('ส่งออกภาพไม่สำเร็จ');
    const data=await ffmpeg.readFile('frame.png');
    return {blob:new Blob([data],{type:'image/png'}),name:`MMs-frame-${timeSec.toFixed(3)}.png`};
  } finally {for(const name of ['frame.png'])try{await ffmpeg.deleteFile(name)}catch{}}
}
