/** TV-only QR pairing server. A public ticket never grants playback/control access. */
function musicTVPairRecord_(ticket) {
  if(!/^[a-f0-9]{32}$/.test(String(ticket||'')))throw Error('ลิงก์จับคู่ไม่ถูกต้อง');
  var raw=CacheService.getScriptCache().get('music_tv_qr_'+ticket);
  if(!raw)throw Error('QR หมดอายุแล้ว ให้เปิด QR ใหม่ที่ทีวี');
  var pair=JSON.parse(raw);if(pair.expiresAt<=Date.now())throw Error('QR หมดอายุแล้ว ให้เปิด QR ใหม่ที่ทีวี');return pair;
}
function musicTVPairSave_(ticket,pair) {
  CacheService.getScriptCache().put('music_tv_qr_'+ticket,JSON.stringify(pair),Math.max(1,Math.min(300,Math.ceil((pair.expiresAt-Date.now())/1000))));
}
function beginMusicTVPair() {
  musicConfig_();var ticket=Utilities.getUuid().replace(/-/g,''),proof=musicRandom_(),expiresAt=Date.now()+300000;
  musicTVPairSave_(ticket,{proofHash:_sha256(proof),expiresAt:expiresAt,approved:false,claimed:false});
  return {ticket:ticket,proof:proof,expiresAt:expiresAt,expiresIn:300,url:'https://checkfile2568-ops.github.io/rta-tuning/court-tv.html?musicPair='+ticket};
}
function inspectMusicTVPair(token,ticket) {
  _requireAuth(token,'admin');musicConfig_();var pair=musicTVPairRecord_(ticket);
  return {expiresAt:pair.expiresAt,expiresIn:Math.max(0,Math.ceil((pair.expiresAt-Date.now())/1000)),approved:pair.approved,claimed:pair.claimed,room:pair.room||'',label:pair.room?musicRoom_(pair.room).label:'',rooms:getMusicRooms(token).rooms.map(function(r){return {id:r.id,label:r.label,paired:!!musicProps_().getProperty('music_room_device_'+r.id)};})};
}
function approveMusicTVPair(token,ticket,room,label) {
  _requireAuth(token,'admin');musicConfig_();var lock=LockService.getScriptLock();lock.waitLock(5000);
  try {
    var pair=musicTVPairRecord_(ticket);if(pair.approved)throw Error('QR นี้ได้รับการยืนยันแล้ว');
    if(room){room=musicId_(room);musicRoom_(room);}else{label=String(label||'').trim();if(!label||label.length>80)throw Error('ระบุชื่อทีวีใหม่ไม่เกิน 80 ตัวอักษร');room=createMusicRoom(token,label).room.id;}
    pair.room=room;pair.secret=musicRandom_();pair.approved=true;musicTVPairSave_(ticket,pair);
    return {approved:true,room:room,label:musicRoom_(room).label};
  } finally {lock.releaseLock();}
}
function getMusicTVPairResult(ticket,proof) {
  musicConfig_();if(!/^[a-f0-9]{64}$/.test(String(proof||'')))throw Error('ยืนยันเครื่องเล่นไม่ได้');
  var lock=LockService.getScriptLock();lock.waitLock(5000);
  try {
    var pair=musicTVPairRecord_(ticket);if(_sha256(proof)!==pair.proofHash)throw Error('ยืนยันเครื่องเล่นไม่ได้');
    if(!pair.approved)return {pending:true,expiresAt:pair.expiresAt};
    if(!pair.claimed){
      var p=musicProps_(),room=pair.room,old=p.getProperty('music_room_device_'+room),hash=_sha256(pair.secret);musicRoom_(room);
      if(old)p.deleteProperty('music_device_'+old);
      p.setProperty('music_device_'+hash,JSON.stringify({room:room}));p.setProperty('music_room_device_'+room,hash);
      pair.claimed=true;musicTVPairSave_(ticket,pair);
    }
    return {pending:false,secret:pair.secret,room:pair.room,label:musicRoom_(pair.room).label};
  } finally {lock.releaseLock();}
}
function cancelMusicTVPair(ticket,proof) {
  musicConfig_();if(!/^[a-f0-9]{32}$/.test(String(ticket||''))||!/^[a-f0-9]{64}$/.test(String(proof||'')))throw Error('ยืนยันเครื่องเล่นไม่ได้');
  var lock=LockService.getScriptLock();lock.waitLock(5000);
  try {var cache=CacheService.getScriptCache(),raw=cache.get('music_tv_qr_'+ticket);if(raw&&JSON.parse(raw).proofHash!==_sha256(proof))throw Error('ยืนยันเครื่องเล่นไม่ได้');cache.remove('music_tv_qr_'+ticket);return {cancelled:true};}finally{lock.releaseLock();}
}

function musicTVPairPage_(ticket) {
  musicConfig_();var t=HtmlService.createTemplateFromFile('MusicTVPair');t.pairTicket=/^[a-f0-9]{32}$/.test(String(ticket||''))?String(ticket):'';
  return t.evaluate().setTitle('จับคู่ทีวีด้วย QR').addMetaTag('viewport','width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
