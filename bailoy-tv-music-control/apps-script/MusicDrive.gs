/** Drive album access stays within MUSIC_FOLDER_ID and its immediate child folders. */
function musicAlbumFolder_(album) {
  var root=DriveApp.getFolderById(musicProps_().getProperty('MUSIC_FOLDER_ID'));
  if(!album || album==='root') return root;
  var folders=root.getFolders(), checked=0;
  while(folders.hasNext() && checked++<100) {var folder=folders.next();if(folder.getId()===album)return folder;}
  throw new Error('เลือกอัลบั้มภายในโฟลเดอร์เพลงที่กำหนดเท่านั้น');
}
function musicDriveFiles_(folder) {
  var files=folder.getFiles(), tracks=[], skipped=0, checked=0;
  while(files.hasNext() && checked++<500) {
    var f=files.next(), name=f.getName(), bytes=f.getSize();
    if(f.isTrashed() || !/\.mp3$/i.test(name)) continue;
    if(!bytes || bytes>MUSIC_MAX_BYTES_ || tracks.length>=30){skipped++;continue;}
    tracks.push({fileId:f.getId(),name:String(name).slice(0,120),bytes:bytes,modifiedAt:f.getLastUpdated().getTime()});
  }
  tracks.sort(function(a,b){return a.name.localeCompare(b.name,'th');});
  return {tracks:tracks,skipped:skipped,truncated:files.hasNext()};
}
function getMusicDriveLibrary(token,room,album) {
  _requireAuth(token,'admin');musicConfig_();musicRoom_(room);
  var root=musicAlbumFolder_('root'), folders=root.getFolders();
  var albums=[{id:'root',name:'เพลงในโฟลเดอร์หลัก'}], checked=0;
  while(folders.hasNext() && checked++<100){var f=folders.next();if(!f.isTrashed())albums.push({id:f.getId(),name:String(f.getName()).slice(0,120)});}
  var selected=musicAlbumFolder_(album), listing=musicDriveFiles_(selected);
  return {albums:albums,album:album||'root',albumName:album&&album!=='root'?String(selected.getName()).slice(0,120):'เพลงทั่วไป',tracks:listing.tracks,skipped:listing.skipped,truncated:listing.truncated};
}
function importMusicDriveTracks(token,room,album,fileIds) {
  _requireAuth(token,'admin');musicConfig_();musicRoom_(room);
  if(!Array.isArray(fileIds) || !fileIds.length || fileIds.length>30 || fileIds.some(function(id){return typeof id!=='string'||!/^[A-Za-z0-9_-]{10,100}$/.test(id);}))throw new Error('เลือกเพลง 1–30 ไฟล์');
  if(new Set(fileIds).size!==fileIds.length)throw new Error('รายการเพลงซ้ำ');
  var folder=musicAlbumFolder_(album), listing=musicDriveFiles_(folder), selected=[];
  fileIds.forEach(function(id){var item=listing.tracks.filter(function(t){return t.fileId===id;})[0];if(!item)throw new Error('เพลงไม่ได้อยู่ในอัลบั้มนี้ หรือเกินขนาด 8 MB');selected.push(item);});
  var lock=LockService.getScriptLock();lock.waitLock(5000);
  try {
    var props=musicProps_().getProperties(), prefix='music_track_'+room+'_', existing=[];
    Object.keys(props).forEach(function(k){if(k.indexOf(prefix)===0)existing.push(JSON.parse(props[k]));});
    var albumName=album&&album!=='root'?String(folder.getName()).slice(0,120):'เพลงทั่วไป';
    var planned=[],changes={};
    selected.forEach(function(item){
      var found=existing.filter(function(t){return t.fileId===item.fileId&&t.modifiedAt===item.modifiedAt&&t.album===albumName;})[0];
      if(!found){found={id:Utilities.getUuid().replace(/-/g,''),name:item.name,kind:'drive',fileId:item.fileId,bytes:item.bytes,modifiedAt:item.modifiedAt,album:albumName};changes[prefix+found.id]=JSON.stringify(found);}
      var publicTrack=JSON.parse(JSON.stringify(found));delete publicTrack.fileId;delete publicTrack.modifiedAt;planned.push(publicTrack);
    });
    if(existing.length+Object.keys(changes).length>30)throw new Error('คลังของทีวีนี้เก็บได้สูงสุด 30 เพลง กรุณาเลือกจำนวนเพลงให้อยู่ในขอบเขต');
    if(Object.keys(changes).length)musicProps_().setProperties(changes,false);
    return {tracks:planned,album:albumName};
  } finally {lock.releaseLock();}
}
