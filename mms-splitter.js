const TARGET_BYTES=45*1024*1024;
let ffmpegPromise=null;

async function loadFFmpeg(onProgress){
  if(ffmpegPromise)return ffmpegPromise;
  ffmpegPromise=(async()=>{
    const [{FFmpeg},{fetchFile,toBlobURL}]=await Promise.all([
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js'),
      import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js')
    ]);
    const ffmpeg=new FFmpeg();
    ffmpeg.on('progress',({progress})=>onProgress?.(Math.max(0,Math.min(1,Number(progress)||0))));
    const coreBase='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';
    // The FFmpeg class worker must be same-origin. Loading the class itself from a CDN
    // without classWorkerURL makes Chromium/Android try to construct a cross-origin Worker.
    const classWorkerURL=new URL('./vendor/ffmpeg-0.12.10/worker.js',import.meta.url).href;
    await ffmpeg.load({
      coreURL:await toBlobURL(coreBase+'/ffmpeg-core.js','text/javascript'),
      wasmURL:await toBlobURL(coreBase+'/ffmpeg-core.wasm','application/wasm'),
      classWorkerURL
    });
    return {ffmpeg,fetchFile};
  })();
  try{return await ffmpegPromise}catch(e){ffmpegPromise=null;throw e}
}
function extOf(file){
  const hit=(file.name||'').match(/\.([A-Za-z0-9]{1,10})$/);
  return hit?hit[1].toLowerCase():'mp4';
}
export function plan(file,targetBytes=TARGET_BYTES){
  const count=Math.max(2,Math.ceil(file.size/targetBytes*1.12));
  const base=Math.floor(file.size/count), remainder=file.size-base*count;
  const items=Array.from({length:count},(_,i)=>({
    index:i+1,
    estimatedBytes:base+(i<remainder?1:0)
  }));
  return {targetBytes,count,items};
}
export async function splitVideo(file,{targetBytes=TARGET_BYTES,maxPartBytes=TARGET_BYTES,onProgress}={}){
  if(!file?.size)throw new Error('ไม่พบไฟล์ต้นฉบับ');
  const p=plan(file,targetBytes);
  let runtime;
  try{
    runtime=await loadFFmpeg(progress=>onProgress?.({phase:'ตัดไฟล์',progress:progress*.85}));
  }catch(e){
    throw new Error('ไม่สามารถเริ่มระบบตัดไฟล์ FFmpeg ได้ • '+String(e?.message||e));
  }
  const {ffmpeg,fetchFile}=runtime;
  const input='input.'+extOf(file), extension=extOf(file);
  const objectUrl=URL.createObjectURL(file);
  try{
    const duration=await new Promise((resolve,reject)=>{
      const v=document.createElement('video');v.preload='metadata';v.src=objectUrl;
      v.onloadedmetadata=()=>resolve(Number.isFinite(v.duration)?v.duration:0);
      v.onerror=()=>reject(new Error('ไม่สามารถอ่านระยะเวลาวิดีโอได้'));
    });
    if(!duration)throw new Error('ไฟล์วิดีโอไม่มีข้อมูลระยะเวลา');
    onProgress?.({phase:'กำลังเตรียมไฟล์',progress:.02});
    await ffmpeg.writeFile(input,await fetchFile(file));
    const segmentSeconds=Math.max(1,Math.ceil(duration/p.count));
    const pattern='part-%03d.'+extension;
    const exitCode=await ffmpeg.exec(['-i',input,'-map','0','-c','copy','-f','segment','-segment_time',String(segmentSeconds),'-reset_timestamps','1',pattern]);
    if(exitCode!==0)throw new Error('FFmpeg ตัดไฟล์ไม่สำเร็จ (code '+exitCode+')');
    const names=(await ffmpeg.listDir('/')).map(x=>x.name).filter(x=>/^part-\d+\./.test(x)).sort();
    if(!names.length)throw new Error('ระบบตัดวิดีโอไม่สำเร็จ');
    const parts=[];
    for(let i=0;i<names.length;i++){
      const data=await ffmpeg.readFile(names[i]);
      const blob=new Blob([data],{type:file.type||'video/mp4'});
      if(blob.size>maxPartBytes)throw new Error('Part '+(i+1)+' มีขนาดเกิน 45 MB กรุณาลองใหม่บนคอมพิวเตอร์');
      parts.push(new File([blob], file.name.replace(/(\.[^.]*)?$/, '-part-'+String(i+1).padStart(3,'0')+'.'+extension), {type:file.type||'video/mp4'}));
      onProgress?.({phase:'ตรวจสอบ Part',progress:.85+((i+1)/names.length)*.15});
      await ffmpeg.deleteFile(names[i]);
    }
    return {parts,durationMs:Math.round(duration*1000),plan:{...p,count:names.length}};
  }finally{
    URL.revokeObjectURL(objectUrl);
    try{await ffmpeg?.deleteFile(input)}catch{}
  }
}
export {TARGET_BYTES};
