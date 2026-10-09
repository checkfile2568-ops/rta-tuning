/** Isolated music module. No case sheets, legacy TV registry, LINE, or refresh writers. */
var MUSIC_MAX_BYTES_ = 8 * 1024 * 1024;
function musicEnabled_() { try { return PropertiesService.getScriptProperties().getProperty('MUSIC_ENABLED') === 'true'; } catch(e) { return false; } }
function musicInclude_(name) { var html=HtmlService.createHtmlOutputFromFile(name).getContent(); return name==='MusicTV' ? html+HtmlService.createHtmlOutputFromFile('MusicRemote').getContent() : html; }
function musicProps_() { return PropertiesService.getScriptProperties(); }
function musicRandom_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function musicConfig_() {
  if (!musicEnabled_()) throw new Error('ระบบเพลงยังไม่ได้เปิดใช้งาน');
  var p = musicProps_(), c;
  try { c = JSON.parse(p.getProperty('MUSIC_FIREBASE_CONFIG') || '{}'); } catch(e) { throw new Error('ตั้งค่า Firebase ไม่ถูกต้อง'); }
  if (!c.apiKey || !c.projectId || !/^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/.test(c.databaseURL || '') || !p.getProperty('MUSIC_SERVICE_EMAIL') || !p.getProperty('MUSIC_SERVICE_PRIVATE_KEY') || !p.getProperty('MUSIC_FOLDER_ID')) throw new Error('ยังไม่ได้ตั้งค่าระบบเพลงครบ');
  // Return only public Firebase fields. Private key and folder ID never leave the server.
  return {apiKey:c.apiKey, projectId:c.projectId, databaseURL:c.databaseURL, authDomain:c.authDomain || c.projectId + '.firebaseapp.com'};
}
function musicId_(id) {
  id = String(id || '');
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('รหัสระบบเพลงไม่ถูกต้อง');
  return id;
}
function musicRoom_(room) {
  room = musicId_(room);
  var raw = musicProps_().getProperty('music_room_' + room);
  if (!raw) throw new Error('ไม่พบทีวีนี้');
  return JSON.parse(raw);
}
function musicDevice_(secret) {
  if (!/^[a-f0-9]{64}$/.test(String(secret || ''))) throw new Error('ทีวีนี้ยังไม่ได้จับคู่');
  var raw = musicProps_().getProperty('music_device_' + _sha256(secret));
  if (!raw) throw new Error('รหัสทีวีถูกยกเลิก กรุณาจับคู่ใหม่');
  var d = JSON.parse(raw);
  musicRoom_(d.room);
  return d;
}
function musicToken_(uid, room, role, until) {
  var p = musicProps_(), email = p.getProperty('MUSIC_SERVICE_EMAIL'), now = Math.floor(Date.now()/1000);
  var enc = function(v) { return Utilities.base64EncodeWebSafe(JSON.stringify(v)).replace(/=+$/, ''); };
  var claims={musicRoom:room,musicRole:role}; if(role==='controller') claims.musicUntil=until;
  var body = enc({alg:'RS256',typ:'JWT'}) + '.' + enc({iss:email,sub:email,aud:'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',iat:now,exp:now+3600,uid:uid,claims:claims});
  var sig = Utilities.computeRsaSha256Signature(body, p.getProperty('MUSIC_SERVICE_PRIVATE_KEY').replace(/\\n/g,'\n'));
  return body + '.' + Utilities.base64EncodeWebSafe(sig).replace(/=+$/,'');
}
function getMusicRooms(token) {
  _requireAuth(token, 'admin');
  var p = musicProps_().getProperties(), rooms = [];
  Object.keys(p).forEach(function(k) { if(/^music_room_[a-f0-9]{32}$/.test(k)) rooms.push(JSON.parse(p[k])); });
  return {enabled:musicEnabled_(),rooms:rooms};
}
function createMusicRoom(token, label) {
  _requireAuth(token, 'admin'); musicConfig_();
  if(getMusicRooms(token).rooms.length >= 10) throw new Error('เพิ่มทีวีได้สูงสุด 10 ห้อง');
  label = String(label || 'ทีวี').trim().slice(0,80);
  var id = Utilities.getUuid().replace(/-/g,''), code = musicRandom_().slice(0,12).toUpperCase();
  var room = {id:id,label:label};
  musicProps_().setProperty('music_room_' + id, JSON.stringify(room));
  CacheService.getScriptCache().put('music_pair_' + code, JSON.stringify({room:id}), 600);
  CacheService.getScriptCache().put('music_pending_' + id, code, 600);
  return {room:room,code:code,expiresIn:600};
}
function renewMusicPairCode(token, room) {
  _requireAuth(token, 'admin'); musicConfig_(); musicRoom_(room);
  var code = musicRandom_().slice(0,12).toUpperCase();
  CacheService.getScriptCache().put('music_pair_' + code, JSON.stringify({room:room}), 600);
  CacheService.getScriptCache().put('music_pending_' + room, code, 600);
  return {code:code,expiresIn:600};
}
function claimMusicDevice(code) {
  musicConfig_(); code = String(code || '').replace(/[\s-]/g,'').toUpperCase();
  if (!/^[A-F0-9]{12}$/.test(code)) throw new Error('กรอกรหัสจับคู่ 12 ตัว');
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    var cache = CacheService.getScriptCache(), raw = cache.get('music_pair_' + code);
    if (!raw) throw new Error('รหัสจับคู่ไม่ถูกต้องหรือหมดอายุ');
    var room = JSON.parse(raw).room; musicRoom_(room);
    if(cache.get('music_pending_' + room)!==code) throw new Error('มีรหัสใหม่แล้ว กรุณาใช้รหัสล่าสุด');
    var p = musicProps_(), old = p.getProperty('music_room_device_' + room);
    // One paired browser per room. Re-pairing revokes future RPC/token issuance for the old secret.
    if(old) p.deleteProperty('music_device_' + old);
    var secret = musicRandom_(), hash = _sha256(secret);
    p.setProperty('music_device_' + hash, JSON.stringify({room:room}));
    p.setProperty('music_room_device_' + room, hash);
    cache.remove('music_pair_' + code);
    cache.remove('music_pending_' + room);
    return {secret:secret};
  } finally { lock.releaseLock(); }
}
function getMusicTVBoot(secret) {
  var config = musicConfig_(), d = musicDevice_(secret);
  return {config:config,room:d.room,label:musicRoom_(d.room).label,token:musicToken_('tv_' + d.room, d.room, 'tv')};
}
function getMusicControlBoot(token, room) {
  var session=_requireAuth(token,'admin'); var config = musicConfig_(); musicRoom_(room);
  return {config:config,room:room,token:musicToken_('ctl_' + musicRandom_().slice(0,32),room,'controller',session.expiresAt),tracks:musicTracks_(room)};
}
function musicTracks_(room) {
  var p = musicProps_().getProperties(), prefix = 'music_track_' + room + '_', tracks = [];
  Object.keys(p).forEach(function(k) { if(k.indexOf(prefix) === 0) { var t = JSON.parse(p[k]); delete t.fileId; delete t.modifiedAt; tracks.push(t); } });
  return tracks;
}
function musicSaveTrack_(room, t) {
  var lock=LockService.getScriptLock(); lock.waitLock(5000);
  try {
    if(musicTracks_(room).length >= 30) throw new Error('ห้องนี้มีเพลงครบ 30 เพลงแล้ว');
    t.id = Utilities.getUuid().replace(/-/g,'');
    musicProps_().setProperty('music_track_' + room + '_' + t.id, JSON.stringify(t));
    var publicTrack = JSON.parse(JSON.stringify(t)); delete publicTrack.fileId;
    return publicTrack;
  } finally {lock.releaseLock();}
}
function uploadMusicTrack(token, room, name, base64) {
  _requireAuth(token,'admin'); musicConfig_(); musicRoom_(room);
  name = String(name || '').trim().slice(0,120);
  if(!/\.mp3$/i.test(name)) throw new Error('เลือกไฟล์ MP3 เท่านั้น');
  if(typeof base64 !== 'string' || base64.length > Math.ceil(MUSIC_MAX_BYTES_/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('ไฟล์เพลงใหญ่เกิน 8 MB หรือข้อมูลไม่ถูกต้อง');
  var bytes = Utilities.base64Decode(base64);
  if(!bytes.length || bytes.length > MUSIC_MAX_BYTES_) throw new Error('ไฟล์เพลงต้องมีขนาด 1 ไบต์ถึง 8 MB');
  if(musicTracks_(room).length >= 30) throw new Error('ห้องนี้มีเพลงครบ 30 เพลงแล้ว');
  var file = DriveApp.getFolderById(musicProps_().getProperty('MUSIC_FOLDER_ID')).createFile(Utilities.newBlob(bytes,'audio/mpeg',name));
  try { return musicSaveTrack_(room,{name:name,kind:'drive',fileId:file.getId(),bytes:bytes.length}); }
  catch(e) { file.setTrashed(true); throw e; }
}
function addMusicLink(token, room, name, url) {
  _requireAuth(token,'admin'); musicConfig_(); musicRoom_(room);
  name = String(name || 'เพลงจากลิงก์').trim().slice(0,120); url = String(url || '').trim();
  if(url.length > 2000 || !/^https:\/\/[^\s@]+$/i.test(url)) throw new Error('ใช้ลิงก์ HTTPS ของไฟล์เสียงโดยตรง');
  // TV fetches the URL directly with CORS and a size limit; server never fetches arbitrary URLs.
  return musicSaveTrack_(room,{name:name,kind:'url',url:url});
}
function getMusicAudio(secret, trackId) {
  musicConfig_(); var d = musicDevice_(secret); trackId = musicId_(trackId);
  var raw = musicProps_().getProperty('music_track_' + d.room + '_' + trackId);
  if(!raw) throw new Error('ไม่พบเพลงในห้องของทีวีนี้');
  var t = JSON.parse(raw);
  if(t.kind === 'url') return {url:t.url,id:t.id};
  var file = DriveApp.getFileById(t.fileId);
  if(file.getSize() > MUSIC_MAX_BYTES_) throw new Error('เพลงใหญ่เกิน 8 MB');
  return {id:t.id,mime:'audio/mpeg',base64:Utilities.base64Encode(file.getBlob().getBytes())};
}
