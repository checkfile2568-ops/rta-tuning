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

let ffmpegPromise = null;

/* โหลด FFmpeg-WASM ครั้งเดียวแล้วใช้ซ้ำ
   หมายเหตุสำคัญ: worker ของ FFmpeg ต้องเป็น same-origin ไม่งั้น Chromium/Android จะสร้าง Worker ข้ามโดเมนไม่ได้
   จึงต้องชี้ classWorkerURL ไปที่ ./vendor/ffmpeg-0.12.10/worker.js ที่อยู่ในโดเมนเดียวกัน */
export async function loadFFmpeg(onLoadProgress){
  if(ffmpegPromise) return ffmpegPromise;
  ffmpegPromise = (async () => {
    const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
      import(FFMPEG_ESM),
      import(UTIL_ESM)
    ]);
    const ffmpeg = new FFmpeg();
    const classWorkerURL = new URL('./vendor/ffmpeg-0.12.10/worker.js', import.meta.url).href;
    onLoadProgress?.(0.2);
    const coreURL = await toBlobURL(CORE_BASE + '/ffmpeg-core.js', 'text/javascript');
    onLoadProgress?.(0.6);
    const wasmURL = await toBlobURL(CORE_BASE + '/ffmpeg-core.wasm', 'application/wasm');
    onLoadProgress?.(0.9);
    await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
    onLoadProgress?.(1);
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
    list.push({ index:i, url:p.url, name:p.original_name || p.name || ('part-'+(i+1)), start:cursor, end:cursor+d, duration:d, size_bytes:Number(p.size_bytes)||0 });
    cursor += d;
    onProgress?.((i+1)/parts.length);
  }
  return { parts:list, duration:cursor };
}

/* [EXT-2] สร้างสาย filter ของ FFmpeg */
function buildVideoFilter({ zoom, center, enhance, profile }){
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
  if(prof.height) chain.push(`scale=-2:${prof.height}:flags=bicubic`);

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

/**
 * ตัด + ส่งออกไฟล์ในเบราว์เซอร์
 * @returns {Promise<{blob:Blob,name:string,bytes:number,seconds:number}>}
 */
export async function exportClip({
  timelineParts, startSec, endSec,
  zoom = 1, center = { x:.5, y:.5 },
  enhance = PRESETS.natural, profile = 'source_quality',
  mute = false, baseName = 'MMs-clip',
  onStage, onProgress
} = {}){
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
    for(let i=0;i<needed.length;i++){
      onStage?.(`กำลังดึงไฟล์ต้นทาง ${i+1}/${needed.length}`);
      const fname = `src-${String(i+1).padStart(3,'0')}.mp4`;
      await ffmpeg.writeFile(fname, await fetchFile(needed[i].url));
      written.push(fname);
      onProgress?.(0.08 + ((i+1)/needed.length) * 0.30);
    }

    // 2) เตรียม input — ไฟล์เดียวใช้ตรง ๆ หลายไฟล์ใช้ concat demuxer
    let inputArgs;
    if(written.length === 1){
      inputArgs = ['-i', written[0]];
    }else{
      const list = written.map(n => `file '${n}'`).join('\n') + '\n';
      await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(list));
      written.push('concat.txt');
      inputArgs = ['-f','concat','-safe','0','-i','concat.txt'];
    }

    // เวลาเริ่มต้นต้องเทียบกับจุดเริ่มของ Part แรกที่ดึงมา ไม่ใช่จุดเริ่มของทั้งคลิป
    const offset = Math.max(0, start - needed[0].start);
    const vf = buildVideoFilter({ zoom, center, enhance, profile });
    const prof = PROFILES[profile] || PROFILES.source_quality;

    const args = [
      '-ss', offset.toFixed(3),
      ...inputArgs,
      '-t', dur.toFixed(3),
      '-vf', vf,
      '-c:v','libx264','-preset','veryfast','-crf', String(prof.crf),
      ...(mute ? ['-an'] : ['-c:a','aac','-b:a','128k']),
      '-movflags','+faststart',
      '-threads','1',
      'output.mp4'
    ];

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
    written.push('output.mp4');
    const blob = new Blob([data.buffer ? data.buffer : data], { type:'video/mp4' });
    onProgress?.(1);

    const stamp = new Date();
    const pad = n => String(n).padStart(2,'0');
    const name = `${baseName}_${stamp.getFullYear()+543}${pad(stamp.getMonth()+1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.mp4`;
    return { blob, name, bytes: blob.size, seconds: dur };
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
