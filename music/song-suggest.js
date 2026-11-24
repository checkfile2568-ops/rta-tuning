(()=>{'use strict';
/* (1) YouTube-style search bar behaviour and (2) "เพลงที่คล้ายกัน" — 2026-11-24.
   YouTube removed related-video search from the Data API (Aug 2023), so suggestions come from:
     a) the owner's library: same channel / artist / category as the playing song (free, instant)
     b) one search on the shared gateway for the playing song's artist (or cleaned title)
   Quota guards for (b): only after 10 s of real playback, 24 h cache per query, max DAILY_LIMIT lookups per device per day.
   ต่อยอด: tune MAX_ITEMS / PLAY_DELAY_MS / DAILY_LIMIT / CACHE_MS below. */
const MAX_ITEMS=8,PLAY_DELAY_MS=10000,DAILY_LIMIT=40,CACHE_MS=24*60*60*1000;
const CACHE_KEY='music-suggest-cache-v1',BUDGET_KEY='music-suggest-budget-v1';
const $=id=>document.getElementById(id);
const view=()=>window.MusicLibraryView;

/* ---------- 1) Search bar ---------- */
function setupSearchBar(){
 const input=$('youtubeQuery'),clear=$('youtubeClear'),go=$('youtubeSearch'),panel=$('topMusicSearch'),results=$('youtubeSearchResults'),statusEl=$('youtubeSearchStatus');
 if(!input||!panel)return;
 const syncClear=()=>{clear.hidden=!input.value&&panel.hidden};
 const open=()=>{if(input.value.trim()){panel.hidden=false;syncClear()}};
 input.addEventListener('input',syncClear);
 // The page's own handlers run the search; we only reveal the results panel first.
 go.addEventListener('click',open,true);
 input.addEventListener('keydown',e=>{if(e.key==='Enter'){open();input.blur()}if(e.key==='Escape'){e.preventDefault();clear.click()}},true);
 const reset=()=>{input.value='';results.replaceChildren();results.hidden=true;if(statusEl)statusEl.textContent='';panel.hidden=true;syncClear()};
 clear.addEventListener('click',()=>{reset();input.focus()});
 window.addEventListener('music-profile-changed',reset);
}

/* ---------- helpers ---------- */
const NOISE=/\b(official|audio|video|mv|m\/v|lyrics?|lyric video|karaoke|cover|live|full|hd|4k|remaster(ed)?|version|visualizer|topic|music|records?|channel|vevo)\b/gi;
function clean(t){return String(t||'').replace(/[\[(【「].*?[\])】」]/g,' ').replace(/[“”"']/g,' ').replace(NOISE,' ').replace(/\s+/g,' ').trim()}
function parts(title){return clean(title).split(/\s+[-–—|:]\s+|\s*[|｜]\s*/).map(x=>x.trim()).filter(x=>x.length>1)}
// \p{M} keeps Thai vowels/tone marks inside words (ก่อนตาย stays one token).
function norm(t){return clean(t).toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim()}
function tokens(t){return new Set(norm(t).split(' ').filter(x=>x.length>1))}
function similar(a,b){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let n=0;for(const x of A)if(B.has(x))n++;return n/Math.min(A.size,B.size)}
function cleanChannel(c){return clean(String(c||'').replace(/\s*-\s*topic$/i,''))}
/** Best guess of the artist:
    1) a title part that matches the channel name, 2) the channel if it appears in the title,
    3) a title part that also appears in other library titles (the artist repeats, song names don't). */
function artistOf(song,lib){
 const ps=parts(song.title),ch=cleanChannel(song.channel),chn=norm(ch);
 if(chn)for(const p of ps){const pn=norm(p);if(pn&&(chn.includes(pn)||pn.includes(chn)))return p}
 if(chn&&chn.length>2&&norm(song.title).includes(chn))return ch;
 if(ps.length>1&&lib?.length){let best='',hits=0;for(const p of ps){const pn=norm(p);if(pn.length<3)continue;let n=0;for(const s of lib)if(s.id!==song.id&&norm(s.title).includes(pn))n++;if(n>hits){hits=n;best=p}}if(best)return best}
 return '';
}
/** The song-name part (title minus the artist), used to drop other uploads of the same song. */
function songPartOf(song,artist){const a=norm(artist),ps=parts(song.title).filter(p=>norm(p)!==a);return ps.length===1&&a?norm(ps[0]):''}
function thumb(id){return 'https://i.ytimg.com/vi/'+id+'/mqdefault.jpg'}

/* ---------- a) library suggestions ---------- */
function fromLibrary(cur){
 const lib=view()?.songs()||[],artist=norm(artistOf(cur,lib)),ch=norm(cleanChannel(cur.channel)),curParts=parts(cur.title).map(norm);
 const scored=[];
 for(const s of lib){
  if(s.id===cur.id)continue;let score=0;const t=norm(s.title);
  if(ch&&norm(cleanChannel(s.channel))===ch)score+=3;
  if(artist&&t.includes(artist))score+=4;
  else for(const p of curParts)if(p.length>2&&t.includes(p)){score+=2;break}
  if(cur.category&&s.category===cur.category)score+=1;
  if(score>0)scored.push({score,item:{id:s.id,title:s.title,channel:s.channel||s.category||'',lib:true,strong:score>=2}});
 }
 return scored.sort((a,b)=>b.score-a.score).slice(0,MAX_ITEMS).map(x=>x.item);
}

/* ---------- b) online suggestions (shared search gateway) ---------- */
function readJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
function writeJSON(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
function today(){const d=new Date();return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()}
function budgetLeft(){const b=readJSON(BUDGET_KEY,{});return b.day===today()?DAILY_LIMIT-(b.used||0):DAILY_LIMIT}
function spend(){const b=readJSON(BUDGET_KEY,{});writeJSON(BUDGET_KEY,b.day===today()?{day:today(),used:(b.used||0)+1}:{day:today(),used:1})}
function cacheGet(q){const c=readJSON(CACHE_KEY,{}),hit=c[q];return hit&&Date.now()-hit.t<CACHE_MS?hit.items:null}
function cachePut(q,items){const c=readJSON(CACHE_KEY,{});c[q]={t:Date.now(),items};const keys=Object.keys(c).sort((a,b)=>c[b].t-c[a].t);for(const k of keys.slice(60))delete c[k];writeJSON(CACHE_KEY,c)}
function queryFor(cur){const a=artistOf(cur,view()?.songs()||[]);return (a||parts(cur.title).join(' ')||clean(cur.title)).slice(0,80)}
async function fetchOnline(q){
 const api=window.MY_MUSIC_SEARCH_CONFIG?.apiUrl;if(!api)throw Error('no-api');
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),12000);
 try{
  const r=await (window.musicSearchFetch||fetch)(api+'?'+new URLSearchParams({q}),{signal:c.signal});
  const j=await r.json().catch(()=>({}));if(!r.ok){const e=Error(j.error?.message||'ค้นหาไม่สำเร็จ');e.status=r.status;throw e}
  return (j.items||[]).map(v=>({id:v?.id?.videoId,title:String(v?.snippet?.title||''),channel:String(v?.snippet?.channelTitle||'')})).filter(v=>/^[\w-]{11}$/.test(v.id)&&v.title);
 }finally{clearTimeout(timer)}
}
function decode(t){const el=document.createElement('textarea');el.innerHTML=t;return el.value}

/* ---------- render ---------- */
let box,row,note,current=null,localItems=[],onlineItems=[],timer=null,generation=0,songPart='';
function render(loading){
 if(!current){box.hidden=true;return}
 const seen=new Set([current.id]),items=[];
 // Order: strong library matches (same artist/channel) → online results → weaker library matches (same category).
 const ordered=[...localItems.filter(x=>x.strong),...onlineItems,...localItems.filter(x=>!x.strong)];
 for(const it of ordered){if(seen.has(it.id))continue;if(!it.lib&&(similar(it.title,current.title)>=0.75||(songPart&&norm(it.title).includes(songPart))))continue;seen.add(it.id);items.push(it);if(items.length>=MAX_ITEMS)break}
 row.replaceChildren();
 if(!items.length&&!loading){box.hidden=true;return}
 box.hidden=false;
 for(const it of items){
  const b=document.createElement('button');b.type='button';b.className='song-suggest-card';b.setAttribute('role','listitem');b.setAttribute('aria-label','เล่น '+it.title);
  const th=document.createElement('span');th.className='song-suggest-thumb';const img=document.createElement('img');img.src=thumb(it.id);img.alt='';img.loading='lazy';img.decoding='async';
  const badge=document.createElement('span');badge.className='song-suggest-badge'+(it.lib?' lib':'');badge.textContent=it.lib?'ในคลัง':'YouTube';th.append(img,badge);
  const t=document.createElement('span');t.className='song-suggest-title';t.textContent=it.title;
  const c=document.createElement('span');c.className='song-suggest-ch';c.textContent=it.channel||'';
  b.append(th,t,c);b.onclick=()=>{if(document.documentElement.classList.contains('pin-locked'))return;view()?.play(it.id,it.lib?null:{title:it.title,channel:it.channel})};
  row.append(b);
 }
 if(loading)for(let i=items.length;i<3;i++){const sk=document.createElement('div');sk.className='song-suggest-card song-suggest-skel';sk.setAttribute('aria-hidden','true');sk.innerHTML='<span class="song-suggest-thumb"></span>';row.append(sk)}
 row.scrollLeft=0;
}
function onSongStart(){
 const cur=view()?.current();clearTimeout(timer);generation++;
 if(!cur){current=null;render();return}
 current=cur;localItems=fromLibrary(cur);onlineItems=[];note.textContent='';songPart=songPartOf(cur,artistOf(cur,view()?.songs()||[]));
 const q=queryFor(cur),cached=q?cacheGet(q):null;
 if(cached){onlineItems=cached;render();return}
 render();
}
async function lookup(gen){
 if(!current||gen!==generation)return;
 const q=queryFor(current);if(!q)return;
 const cached=cacheGet(q);if(cached){onlineItems=cached;render();return}
 if(budgetLeft()<=0){note.textContent=localItems.length?'วันนี้ใช้การค้นหาเพลงแนะนำครบแล้ว · แสดงเพลงจากคลัง':'';render();return}
 render(true);spend();
 try{
  const items=(await fetchOnline(q)).map(v=>({...v,title:decode(v.title),channel:decode(v.channel),lib:false}));
  cachePut(q,items);if(gen!==generation)return;onlineItems=items;note.textContent='';render();
 }catch(e){if(gen!==generation)return;note.textContent=localItems.length?'ค้นหาเพลงแนะนำออนไลน์ไม่สำเร็จ · แสดงเพลงจากคลัง':'';render()}
}
function onState(e){
 const st=e.detail?.state;clearTimeout(timer);
 if(st==='playing'&&current&&!cacheGet(queryFor(current))){const gen=generation;timer=setTimeout(()=>lookup(gen),PLAY_DELAY_MS)}
 if(st==='idle'&&!e.detail?.selected){current=null;render()}
}
function setupSuggest(){
 box=$('songSuggest');row=$('songSuggestRow');note=$('songSuggestNote');if(!box||!row)return;
 const step=()=>Math.max(120,row.clientWidth*0.9);
 $('songSuggestPrev').onclick=()=>row.scrollBy({left:-step(),behavior:'smooth'});
 $('songSuggestNext').onclick=()=>row.scrollBy({left:step(),behavior:'smooth'});
 window.addEventListener('music-song-start',()=>setTimeout(onSongStart,0));
 window.addEventListener('music-player-state',onState);
 window.addEventListener('music-profile-changed',()=>{current=null;clearTimeout(timer);generation++;render()});
}
function init(){setupSearchBar();setupSuggest()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
