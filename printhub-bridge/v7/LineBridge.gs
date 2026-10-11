/**
 * PrintHub v7 · LineBridge.gs
 * Secure server-to-server adapter for the Lopburi LINE bot.
 * Requires Script Property PRINT_HUB_BRIDGE_TOKEN.
 */
const LINE_BRIDGE_ALLOWED_MIME_ = ['application/pdf','image/jpeg','image/png'];
const LINE_OWNER_PREFIX_ = 'LINE:';

function lineBridgeDispatch_(b) {
  switch (String(b.action || '')) {
    case 'line_status':       return lineBridgeStatus_();
    case 'line_upload_start': return lineBridgeUploadStart_(b);
    case 'line_upload_chunk': return lineBridgeUploadChunk_(b);
    case 'line_submit':       return lineBridgeSubmit_(b);
    case 'line_job':          return lineBridgeJob_(b);
    case 'line_latest':       return lineBridgeLatest_(b);
    case 'line_confirm':      return lineBridgeConfirm_(b);
    case 'line_cancel':       return lineBridgeCancel_(b);
    case 'line_receive':      return lineBridgeReceive_(b);
    case 'line_search':       return lineBridgeSearch_(b);
    case 'line_reprint':      return lineBridgeReprint_(b);
    default: return {ok:false,msg:'UNKNOWN_LINE_ACTION'};
  }
}

function lineBridgeOwner_(lineUserId) {
  const id=String(lineUserId||'').trim();
  if (!/^U[0-9A-Za-z_-]{10,}$/.test(id)) throw new Error('BAD_LINE_USER_ID');
  return LINE_OWNER_PREFIX_+id;
}

function lineBridgeAgent_() {
  const a=agentStatus_();
  return {online:!!a.online,host:String(a.name||''),printer:String(a.printer||''),lastSeen:String(a.last||'')};
}

function lineBridgeStatus_() {
  return {ok:true,agent:lineBridgeAgent_(),serverTime:new Date().toISOString()};
}

function lineBridgeUploadStart_(b) {
  lineBridgeOwner_(b.ownerId);
  return {ok:true,uploadId:'LUP'+Utilities.getUuid().replace(/-/g,'').slice(0,16)};
}

function lineBridgeUploadChunk_(b) {
  const uploadId=String(b.uploadId||'');
  if (!/^LUP[0-9a-f]{16}$/i.test(uploadId)) return {ok:false,msg:'BAD_UPLOAD_ID'};
  const index=Math.max(0,parseInt(b.index,10)||0);
  const data=String(b.data||'');
  if (!data) return {ok:false,msg:'EMPTY_CHUNK'};
  if (data.length > 900000) return {ok:false,msg:'CHUNK_TOO_LARGE'};
  spoolFolder_().createFile(
    Utilities.newBlob(Utilities.base64Decode(data),'application/octet-stream',
      uploadId+'.part'+('000'+index).slice(-3))
  );
  return {ok:true,index:index};
}

function lineBridgeSubmit_(b) {
  const owner=lineBridgeOwner_(b.ownerId);
  const ownerName=String(b.ownerName||'LINE').trim().slice(0,120)||'LINE';
  const name=String(b.fileName||'document.pdf').replace(/[\u0000-\u001f]/g,'').slice(0,120);
  const mime=String(b.mime||'');
  if (LINE_BRIDGE_ALLOWED_MIME_.indexOf(mime)<0) return {ok:false,msg:'UNSUPPORTED_FILE'};

  const uploadId=String(b.uploadId||'');
  if (!/^LUP[0-9a-f]{16}$/i.test(uploadId)) return {ok:false,msg:'BAD_UPLOAD_ID'};
  const bytes=mergeParts_(uploadId,mime);
  if (bytes.error) return {ok:false,msg:bytes.error};

  const maxMb=setting_('MAX_FILE_MB',CFG.MAX_FILE_MB);
  if (bytes.data.length>maxMb*1024*1024) return {ok:false,msg:'ไฟล์ใหญ่เกิน '+maxMb+' MB'};

  const jobId=nextJobId_();
  const saved=spoolFolder_().createFile(Utilities.newBlob(bytes.data,mime,jobId+'_'+name));
  const agent=lineBridgeAgent_();
  const status=agent.online?ST.WAIT_CONFIRM:ST.WAIT_AGENT;

  getDb_().getSheetByName('PRINT_QUEUE').appendRow([
    jobId,new Date(),owner,ownerName,name,mime,Math.round(bytes.data.length/1024),saved.getId(),'',
    '',1,false,'',0,status,'','','','',0,false
  ]);
  audit_(owner,'LINE_SUBMIT','สำเร็จ',jobId+' · '+name+' · '+status);
  return {ok:true,jobId:jobId,status:status,position:queuePosition_(jobId),agent:agent};
}

function lineBridgeReadJob_(jobId) {
  const sh=getDb_().getSheetByName('PRINT_QUEUE');
  const row=findJobRow_(sh,String(jobId||''));
  if (row<0) return null;
  return {sh:sh,row:row,r:sh.getRange(row,1,1,QCOLS).getValues()[0]};
}

function lineBridgeOwns_(r,ownerId) {
  return String(r[Q.USER])===lineBridgeOwner_(ownerId);
}

function lineBridgeJobObject_(r) {
  let available=false;
  try { if (r[Q.FID]) available=!DriveApp.getFileById(r[Q.FID]).isTrashed(); } catch(e){}
  return {
    id:String(r[Q.ID]||''),file:String(r[Q.FILE]||''),mime:String(r[Q.MIME]||''),
    kb:Number(r[Q.KB]||0),pages:Number(r[Q.PAGES]||0),copies:Number(r[Q.COPIES]||1),
    duplex:r[Q.DUPLEX]===true,range:String(r[Q.RANGE]||''),status:String(r[Q.STATUS]||''),
    err:String(r[Q.ERR]||''),at:r[Q.AT]?fmtThai_(r[Q.AT]):'',available:available
  };
}

function lineBridgeJob_(b) {
  const hit=lineBridgeReadJob_(b.jobId);
  if (!hit) return {ok:false,msg:'JOB_NOT_FOUND'};
  if (!lineBridgeOwns_(hit.r,b.ownerId)) return {ok:false,msg:'NOT_OWNER'};
  return {ok:true,job:lineBridgeJobObject_(hit.r),agent:lineBridgeAgent_()};
}

function lineBridgeLatest_(b) {
  const owner=lineBridgeOwner_(b.ownerId);
  const sh=getDb_().getSheetByName('PRINT_QUEUE');
  const n=sh.getLastRow()-1;
  if (n<1) return {ok:true,job:null,agent:lineBridgeAgent_()};
  const rows=sh.getRange(2,1,n,QCOLS).getValues();
  for (let i=rows.length-1;i>=0;i--) {
    if (String(rows[i][Q.USER])===owner) return {ok:true,job:lineBridgeJobObject_(rows[i]),agent:lineBridgeAgent_()};
  }
  return {ok:true,job:null,agent:lineBridgeAgent_()};
}

function lineBridgeConfirm_(b) {
  const hit=lineBridgeReadJob_(b.jobId);
  if (!hit) return {ok:false,msg:'JOB_NOT_FOUND'};
  if (!lineBridgeOwns_(hit.r,b.ownerId)) return {ok:false,msg:'NOT_OWNER'};
  const st=String(hit.r[Q.STATUS]||'');
  if ([ST.WAIT_AGENT,ST.WAIT_CONFIRM].indexOf(st)<0) return {ok:false,msg:'งานนี้ไม่ได้อยู่ระหว่างรอยืนยัน',status:st};

  const agent=lineBridgeAgent_();
  if (!agent.online) {
    hit.sh.getRange(hit.row,Q.STATUS+1).setValue(ST.WAIT_AGENT);
    return {ok:false,msg:'ขณะนี้คอม Print Hub ยังออฟไลน์',code:'AGENT_OFFLINE',agent:agent};
  }
  hit.sh.getRange(hit.row,Q.STATUS+1).setValue(ST.QUEUED);
  hit.sh.getRange(hit.row,Q.ERR+1).setValue('');
  hit.sh.getRange(hit.row,Q.TRY+1).setValue(0);
  audit_(hit.r[Q.USER],'LINE_CONFIRM','สำเร็จ',hit.r[Q.ID]);
  return {ok:true,status:ST.QUEUED,agent:agent};
}

function lineBridgeCancel_(b) {
  const hit=lineBridgeReadJob_(b.jobId);
  if (!hit) return {ok:false,msg:'JOB_NOT_FOUND'};
  if (!lineBridgeOwns_(hit.r,b.ownerId)) return {ok:false,msg:'NOT_OWNER'};
  const st=String(hit.r[Q.STATUS]||'');
  if ([ST.PRINTING,ST.SENT,ST.DONE].indexOf(st)>=0)
    return {ok:false,msg:'งานนี้ส่งเข้าเครื่องพิมพ์ไปแล้ว ยกเลิกไม่ได้',status:st};
  hit.sh.getRange(hit.row,Q.STATUS+1).setValue(ST.CANCEL);
  hit.sh.getRange(hit.row,Q.END+1).setValue(new Date());
  trashFile_(hit.r[Q.FID]); trashFile_(hit.r[Q.PDF]);
  hit.r[Q.STATUS]=ST.CANCEL;
  archive_(hit.r,'ผู้ใช้ยกเลิกผ่าน LINE');
  audit_(hit.r[Q.USER],'LINE_CANCEL','สำเร็จ',hit.r[Q.ID]);
  return {ok:true,status:ST.CANCEL};
}

function lineBridgeReceive_(b) {
  const hit=lineBridgeReadJob_(b.jobId);
  if (!hit) return {ok:false,msg:'JOB_NOT_FOUND'};
  if (!lineBridgeOwns_(hit.r,b.ownerId)) return {ok:false,msg:'NOT_OWNER'};
  if (String(hit.r[Q.STATUS])!==ST.SENT)
    return {ok:false,msg:'งานนี้ไม่ได้อยู่ระหว่างรอยืนยันรับเอกสาร',status:String(hit.r[Q.STATUS]||'')};

  if (b.ok===true) {
    hit.sh.getRange(hit.row,Q.STATUS+1).setValue(ST.DONE);
    hit.sh.getRange(hit.row,Q.END+1).setValue(new Date());
    hit.r[Q.STATUS]=ST.DONE;
    archive_(hit.r,'ผู้ฝากยืนยันรับเอกสารผ่าน LINE');
    audit_(hit.r[Q.USER],'LINE_RECEIVE','สำเร็จ',hit.r[Q.ID]);
    return {ok:true,status:ST.DONE};
  }
  const note=String(b.note||'ผู้ใช้แจ้งผ่าน LINE ว่าเอกสารมีปัญหา').slice(0,200);
  hit.sh.getRange(hit.row,Q.STATUS+1).setValue(ST.ERROR);
  hit.sh.getRange(hit.row,Q.ERR+1).setValue(note);
  audit_(hit.r[Q.USER],'LINE_RECEIVE','มีปัญหา',hit.r[Q.ID]+' · '+note);
  return {ok:true,status:ST.ERROR};
}

function lineBridgeSearchTerms_(q) {
  return String(q||'').toLowerCase()
    .replace(/(ช่วย|บอท|หา|ค้น|ไฟล์|เอกสาร|ที่|เคย|ส่ง|พิมพ์|ปริ้น|ย้อนหลัง|เมื่อวาน|วันนี้|หน่อย|ขอ)/g,' ')
    .replace(/\s+/g,' ').trim();
}

function lineBridgeSearchWindow_(q) {
  const raw=String(q||'');
  let d=null;
  const now=new Date();
  if (/เมื่อวาน/.test(raw)) d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1);
  else if (/วันนี้/.test(raw)) d=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if (!d) return null;
  return {from:d.getTime(),to:d.getTime()+86400000};
}

function lineBridgeDateInWindow_(value,win) {
  if (!win) return true;
  const t=value?new Date(value).getTime():NaN;
  return isFinite(t) && t>=win.from && t<win.to;
}

function lineBridgeSearch_(b) {
  const owner=lineBridgeOwner_(b.ownerId);
  const limit=Math.max(1,Math.min(20,parseInt(b.limit,10)||8));
  const term=lineBridgeSearchTerms_(b.query);
  const win=lineBridgeSearchWindow_(b.query);
  const jobs=[];
  const sh=getDb_().getSheetByName('PRINT_QUEUE');
  const n=sh.getLastRow()-1;
  if (n>0) {
    const rows=sh.getRange(2,1,n,QCOLS).getValues();
    for (let i=rows.length-1;i>=0 && jobs.length<limit;i--) {
      const r=rows[i];
      if (String(r[Q.USER])!==owner) continue;
      if (!lineBridgeDateInWindow_(r[Q.AT],win)) continue;
      if (term && String(r[Q.FILE]||'').toLowerCase().indexOf(term)<0) continue;
      jobs.push(lineBridgeJobObject_(r));
    }
  }
  if (jobs.length<limit) {
    const log=getDb_().getSheetByName('PRINT_LOG');
    const ln=log.getLastRow()-1;
    if (ln>0) {
      const rows=log.getRange(2,1,ln,11).getValues();
      const seen={}; jobs.forEach(function(j){seen[j.id]=true;});
      for (let i=rows.length-1;i>=0 && jobs.length<limit;i--) {
        const r=rows[i],id=String(r[0]||'');
        if (String(r[2])!==owner || seen[id]) continue;
        if (!lineBridgeDateInWindow_(r[1],win)) continue;
        if (term && String(r[5]||'').toLowerCase().indexOf(term)<0) continue;
        jobs.push({id:id,file:String(r[5]||''),pages:Number(r[6]||0),copies:Number(r[7]||1),
          status:String(r[9]||''),at:r[1]?fmtThai_(r[1]):'',available:false});
      }
    }
  }
  return {ok:true,jobs:jobs};
}

function lineBridgeReprint_(b) {
  const hit=lineBridgeReadJob_(b.jobId);
  if (!hit) return {ok:false,msg:'ไม่พบงานเดิม อาจเหลือเฉพาะประวัติแล้ว'};
  if (!lineBridgeOwns_(hit.r,b.ownerId)) return {ok:false,msg:'NOT_OWNER'};

  let src,fresh;
  try {
    src=DriveApp.getFileById(hit.r[Q.FID]);
    if (src.isTrashed()) throw new Error('trashed');
    fresh=src.makeCopy();
  } catch(e) {
    return {ok:false,msg:'ไฟล์ต้นฉบับถูกลบตามระยะเวลาเก็บแล้ว กรุณาส่งไฟล์ใหม่'};
  }
  const jobId=nextJobId_();
  fresh.setName(jobId+'_'+hit.r[Q.FILE]);
  spoolFolder_().addFile(fresh);
  DriveApp.getRootFolder().removeFile(fresh);

  const agent=lineBridgeAgent_();
  const status=agent.online?ST.WAIT_CONFIRM:ST.WAIT_AGENT;
  hit.sh.appendRow([
    jobId,new Date(),hit.r[Q.USER],hit.r[Q.NAME],hit.r[Q.FILE],hit.r[Q.MIME],hit.r[Q.KB],
    fresh.getId(),'','',hit.r[Q.COPIES]||1,hit.r[Q.DUPLEX]===true,hit.r[Q.RANGE]||'',0,
    status,'','','','',0,false
  ]);
  audit_(hit.r[Q.USER],'LINE_REPRINT','สำเร็จ',hit.r[Q.ID]+' → '+jobId+' · '+status);
  return {ok:true,jobId:jobId,fileName:String(hit.r[Q.FILE]||''),mime:String(hit.r[Q.MIME]||''),status:status,agent:agent};
}
