/* Prompt-based event search. Samples full-frame images; never changes editor zoom. */
export function normalizeEvents(rows, part, pre = 8, post = 4, totalDuration = part.end) {
  if (!Array.isArray(rows)) throw new Error('ผล AI ไม่มีรายการ events ที่อ่านได้');
  return rows.flatMap(r => {
    const a = r.start_seconds, b = r.end_seconds;
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < a || a >= part.duration) return [];
    return [{ title: String(r.title || 'เหตุการณ์ที่ควรตรวจ').slice(0,160),
      detail: String(r.detail || '').slice(0,800),
      start: Math.max(0, part.start + a - pre),
      end: Math.min(totalDuration, part.start + b + post),
      at: part.start + Math.min(part.duration - .05, (a+b)/2),
      type: String(r.type || 'highlight'), confidence: Math.max(0,Math.min(1,Number(r.confidence)||0)) }];
  }).filter(r => r.end - r.start > .2);
}
export function mergeEvents(rows) {
  const out = [];
  for (const r of [...rows].sort((a,b)=>a.at-b.at)) {
    const prev = out[out.length-1];
    // Merge repeated detections in overlapping batches, not separate nearby incidents.
    if (prev && prev.type === r.type && Math.abs(prev.at-r.at) <= 3) {
      prev.start = Math.min(prev.start,r.start); prev.end = Math.max(prev.end,r.end);
      if (r.confidence > prev.confidence) { prev.title=r.title; prev.detail=r.detail; prev.confidence=r.confidence; }
    } else out.push({...r});
  }
  return out;
}
function waitMedia(v, event, action) {
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);v.removeEventListener(event,ok);v.removeEventListener('error',fail)};
    const ok=()=>{cleanup();resolve()};
    const fail=()=>{cleanup();reject(new Error('อ่านภาพวิดีโอไม่สำเร็จ ลองโหลดวิดีโอใหม่'))};
    const timer=setTimeout(fail,25000);
    v.addEventListener(event,ok,{once:true});v.addEventListener('error',fail,{once:true});action();
  });
}
export async function scanVideoEvents({parts, question, range=null, interval=1, pre=8, post=4, api, cancelled=()=>false, onProgress, onEvents}) {
  const v=document.createElement('video');v.crossOrigin='anonymous';v.preload='auto';v.muted=true;v.playsInline=true;
  const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d');
  let rows=[];
  try {
    for (let i=0;i<parts.length;i++) {
      const part=parts[i];
      if(cancelled()) break;
      if(range && (part.end<=range.start || part.start>=range.end))continue;
      if(!part.id) throw new Error('ไม่พบรหัสไฟล์สำหรับวิเคราะห์ กรุณาโหลดวิดีโอใหม่');
      await waitMedia(v,'loadeddata',()=>{v.src=part.url;v.load()});
      canvas.width=Math.min(768,v.videoWidth);canvas.height=Math.round(canvas.width*v.videoHeight/v.videoWidth);
      if(!canvas.width||!canvas.height)throw new Error('ไม่พบขนาดภาพวิดีโอ');
      // Two-frame overlap gives the model context at batch boundaries.
      const begin=range?Math.max(0,range.start-part.start):0;
      const finish=range?Math.min(part.duration,range.end-part.start):part.duration;
      for(let from=begin;from<finish;from+=22*interval) {
        if(cancelled()) break;
        const frames=[];
        for(let n=0;n<24;n++) {
          const t=from+n*interval;if(t>=finish)break;
          if(cancelled())break;
          const target=Math.min(t,part.duration-.05);
          if(v.readyState<2||Math.abs(v.currentTime-target)>.001)await waitMedia(v,'seeked',()=>{v.currentTime=target});
          ctx.drawImage(v,0,0,canvas.width,canvas.height);
          frames.push({seconds:t,data:canvas.toDataURL('image/jpeg',.65).split(',')[1]});
        }
        if(cancelled())break;
        onProgress?.(`กำลังวิเคราะห์ Part ${i+1}/${parts.length} · ${Math.floor(part.start+from)} / ${Math.ceil(parts.at(-1).end)} วินาที`);
        const d=await api('video-events',{media_file_id:part.id,question,frames});
        if(!d.ok)throw new Error([d.error,d.detail].filter(Boolean).join(' · '));
        if(cancelled())break;
        rows=mergeEvents([...rows,...normalizeEvents(d.events,part,pre,post,parts.at(-1).end)]);
        onEvents?.(rows);
      }
    }
    return rows;
  } finally {v.removeAttribute('src');v.load();canvas.width=0;canvas.height=0;}
}
