(()=>{'use strict';
const base=window.MY_MUSIC_SEARCH_CONFIG?.apiUrl?.replace(/\/api\/search$/,'');
if(!base)return;
let registered=null;
const kind=/\/car\.html$/.test(location.pathname)?'car':'mobile';
function deviceToken(){let token=localStorage.getItem('music-device-token-v1');if(!/^[a-f0-9]{64}$/.test(token||'')){token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem('music-device-token-v1',token);if(localStorage.getItem('music-device-token-v1')!==token)throw Error('เบราว์เซอร์นี้ไม่ยอมจำเครื่อง กรุณาอนุญาตพื้นที่เก็บข้อมูล')}return token}
async function request(path,{method='GET',data,token,signal}={}){
 const headers={'X-Music-Device':deviceToken()};if(data!==undefined)headers['Content-Type']='application/json';if(token)headers.Authorization='Bearer '+token;
 const response=await fetch(base+path,{method,headers,...(data!==undefined?{body:JSON.stringify(data)}:{}),signal});let json;try{json=await response.json()}catch{throw Error('บริการไม่ตอบสนอง กรุณาลองใหม่')}
 if(!response.ok){const e=new Error(json.error?.message||'บริการไม่พร้อม');e.status=response.status;throw e}return json;
}
function ensure(label){if(!registered)registered=request('/api/device/register',{method:'POST',data:{kind,label:label||(kind==='car'?'จอรถ':'มือถือ')}}).catch(e=>{registered=null;throw e});return registered}
async function release(){await request('/api/device',{method:'DELETE'});registered=null;window.dispatchEvent(new Event('music-device-released'))}
window.MusicDevice=Object.freeze({base,request,ensure,release,token:deviceToken,forgetRegistration:()=>{registered=null}});
window.musicSearchFetch=async(target,options={})=>{if(String(target).startsWith(base+'/api/search')){await ensure();return fetch(target,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),'X-Music-Device':deviceToken()}})}return fetch(target,options)};
})();
