import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-mms-session, apikey, authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};
const url = Deno.env.get('SUPABASE_URL')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();

function out(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: cors }); }
function hex(bytes: Uint8Array) { return [...bytes].map(b => b.toString(16).padStart(2, '0')).join(''); }
function randomHex(n = 24) { const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a); }
async function sha256(s: string) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))); }
async function pinHash(pin: string, salt: string) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 140000, hash: 'SHA-256' }, base, 256);
  return hex(new Uint8Array(bits));
}
function validPin(pin: unknown) { return /^\d{4}$/.test(String(pin || '')); }
function num(v: unknown, fallback: number | null = null) {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function int(v: unknown, fallback: number | null = null) {
  const n = num(v, fallback);
  return n === null ? null : Math.round(n);
}
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

async function activeUsers() {
  const { data, error } = await db.from('mms_users').select('id,display_name').eq('active', true).order('display_name');
  if (error) throw error;
  return data || [];
}
async function userMenus(user: any) {
  const { data: menus, error } = await db.from('mms_menus').select('*').eq('enabled', true).order('sort_order');
  if (error) throw error;
  if (user.role === 'admin') return menus || [];
  const { data: perms, error: pe } = await db.from('mms_user_menu_permissions').select('menu_id,can_view,can_use').eq('user_id', user.id).eq('can_view', true).eq('can_use', true);
  if (pe) throw pe;
  const allowed = new Set((perms || []).map((p: any) => p.menu_id));
  return (menus || []).filter((m: any) => allowed.has(m.id) && m.id !== 'admin');
}
async function sessionFrom(req: Request, body: any) {
  const raw = req.headers.get('x-mms-session') || body?.session || '';
  if (!raw) return null;
  const tokenHash = await sha256(raw);
  const { data: s } = await db.from('mms_sessions').select('id,user_id,expires_at').eq('token_hash', tokenHash).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!s) return null;
  const { data: user } = await db.from('mms_users').select('id,display_name,role,active').eq('id', s.user_id).maybeSingle();
  if (!user?.active) return null;
  await db.from('mms_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', s.id);
  return { raw, session: s, user };
}
async function requireSession(req: Request, body: any) {
  const ctx = await sessionFrom(req, body);
  if (!ctx) throw new Error('UNAUTHORIZED');
  return ctx;
}
async function requireAdmin(req: Request, body: any) {
  const ctx = await requireSession(req, body);
  if (ctx.user.role !== 'admin') throw new Error('FORBIDDEN');
  return ctx;
}
async function getOwnedVideoJob(ctx: any, id: string) {
  const { data, error } = await db.from('video_edit_jobs').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('JOB_NOT_FOUND');
  if (ctx.user.role !== 'admin' && data.user_id !== ctx.user.id) throw new Error('FORBIDDEN');
  return data;
}
function videoJobPatch(src: any, current?: any) {
  const allowedZoom = ['original','fixed','manual_keyframes','follow_ball','follow_subject','auto_action'];
  const pre = clamp(int(src.pre_roll_ms, current?.pre_roll_ms ?? 3000) ?? 3000, 0, 30000);
  const post = clamp(int(src.post_roll_ms, current?.post_roll_ms ?? 2000) ?? 2000, 0, 30000);
  const duration = int(src.source_duration_ms, current?.source_duration_ms ?? null);
  const event = int(src.event_time_ms, current?.event_time_ms ?? null);
  let start = int(src.trim_start_ms, current?.trim_start_ms ?? null);
  let end = int(src.trim_end_ms, current?.trim_end_ms ?? null);
  if (start === null && event !== null) start = Math.max(0, event - pre);
  if (end === null && event !== null && duration !== null) end = Math.min(duration, event + post);
  if (start !== null) start = Math.max(0, start);
  if (end !== null && duration !== null) end = Math.min(duration, end);
  if (start !== null && end !== null && start >= end) throw new Error('INVALID_TRIM_RANGE');
  return {
    source_name: src.source_name !== undefined ? String(src.source_name || '').slice(0,500) : current?.source_name,
    source_object_path: src.source_object_path !== undefined ? (src.source_object_path ? String(src.source_object_path).slice(0,1200) : null) : current?.source_object_path,
    source_duration_ms: duration,
    source_fps: num(src.source_fps, current?.source_fps ?? null),
    source_width: int(src.source_width, current?.source_width ?? null),
    source_height: int(src.source_height, current?.source_height ?? null),
    event_time_ms: event,
    pre_roll_ms: pre,
    post_roll_ms: post,
    trim_start_ms: start,
    trim_end_ms: end,
    zoom_mode: allowedZoom.includes(String(src.zoom_mode || current?.zoom_mode || 'original')) ? String(src.zoom_mode || current?.zoom_mode || 'original') : 'original',
    tracking_target: src.tracking_target !== undefined ? (src.tracking_target ? String(src.tracking_target).slice(0,300) : null) : current?.tracking_target,
    zoom_level: clamp(num(src.zoom_level, current?.zoom_level ?? 1) ?? 1, 1, 4),
    output_profile: String(src.output_profile || current?.output_profile || 'source_quality').slice(0,80),
    updated_at: new Date().toISOString()
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'status');

    if (action === 'status') {
      const { count, error } = await db.from('mms_users').select('*', { count: 'exact', head: true });
      if (error) throw error;
      return out({ ok: true, setupRequired: (count || 0) === 0, users: await activeUsers(), system: 'MMs', version: '2.1.0' });
    }

    if (action === 'bootstrap') {
      const { count } = await db.from('mms_users').select('*', { count: 'exact', head: true });
      if ((count || 0) > 0) return out({ ok: false, error: 'ระบบถูกตั้งค่าแล้ว' }, 409);
      const name = String(body.display_name || '').trim();
      const pin = String(body.pin || '');
      if (!name || !validPin(pin)) return out({ ok: false, error: 'กรุณากรอกชื่อและ PIN 4 หลัก' }, 400);
      const salt = randomHex(18);
      const hash = await pinHash(pin, salt);
      const { data: user, error } = await db.from('mms_users').insert({ display_name: name, role: 'admin', pin_salt: salt, pin_hash: hash, active: true }).select('id,display_name,role').single();
      if (error) throw error;
      return out({ ok: true, user });
    }

    if (action === 'login') {
      const userId = String(body.user_id || '');
      const pin = String(body.pin || '');
      if (!userId || !validPin(pin)) return out({ ok: false, error: 'PIN ต้องเป็นตัวเลข 4 หลัก' }, 400);
      const { data: user } = await db.from('mms_users').select('*').eq('id', userId).maybeSingle();
      if (!user?.active) return out({ ok: false, error: 'ไม่พบบัญชีหรือบัญชีถูกปิด' }, 403);
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) return out({ ok: false, error: 'บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง' }, 423);
      const good = (await pinHash(pin, user.pin_salt)) === user.pin_hash;
      if (!good) {
        const attempts = (user.failed_attempts || 0) + 1;
        const patch: any = { failed_attempts: attempts };
        if (attempts >= 5) {
          patch.failed_attempts = 0;
          patch.locked_until = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        }
        await db.from('mms_users').update(patch).eq('id', user.id);
        await db.from('mms_login_logs').insert({ user_id: user.id, display_name: user.display_name, success: false, reason: 'bad_pin', user_agent: req.headers.get('user-agent') });
        return out({ ok: false, error: attempts >= 5 ? 'PIN ไม่ถูกต้อง บัญชีถูกล็อก 10 นาที' : 'PIN ไม่ถูกต้อง' }, 401);
      }
      await db.from('mms_users').update({ failed_attempts: 0, locked_until: null }).eq('id', user.id);
      const token = randomHex(32);
      const token_hash = await sha256(token);
      const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      await db.from('mms_sessions').insert({ user_id: user.id, token_hash, expires_at: expires, device_label: String(body.device_label || '').slice(0,120) });
      await db.from('mms_login_logs').insert({ user_id: user.id, display_name: user.display_name, success: true, reason: 'login', user_agent: req.headers.get('user-agent') });
      return out({ ok: true, session: token, expires_at: expires, user: { id: user.id, display_name: user.display_name, role: user.role }, menus: await userMenus(user) });
    }

    if (action === 'session') {
      const ctx = await requireSession(req, body);
      return out({ ok: true, user: ctx.user, menus: await userMenus(ctx.user) });
    }

    if (action === 'logout') {
      const ctx = await sessionFrom(req, body);
      if (ctx) await db.from('mms_sessions').delete().eq('id', ctx.session.id);
      return out({ ok: true });
    }

    if (action === 'admin-data') {
      await requireAdmin(req, body);
      const { data: menus, error: me } = await db.from('mms_menus').select('*').order('sort_order');
      if (me) throw me;
      const { data: users, error: ue } = await db.from('mms_users').select('id,display_name,role,active,created_at,updated_at').order('display_name');
      if (ue) throw ue;
      const { data: perms, error: pe } = await db.from('mms_user_menu_permissions').select('*');
      if (pe) throw pe;
      return out({ ok: true, menus: menus || [], users: users || [], permissions: perms || [] });
    }

    if (action === 'admin-save-user') {
      await requireAdmin(req, body);
      const u = body.user || {};
      const name = String(u.display_name || '').trim();
      const role = u.role === 'admin' ? 'admin' : 'user';
      if (!name) return out({ ok: false, error: 'กรุณากรอกชื่อผู้ใช้' }, 400);
      let userId = String(u.id || '');
      if (userId) {
        const patch: any = { display_name: name, role, active: u.active !== false, updated_at: new Date().toISOString() };
        if (u.pin) {
          if (!validPin(u.pin)) return out({ ok:false,error:'PIN ต้องเป็น 4 หลัก' },400);
          const salt=randomHex(18);
          patch.pin_salt=salt;
          patch.pin_hash=await pinHash(String(u.pin),salt);
        }
        const { error } = await db.from('mms_users').update(patch).eq('id', userId);
        if (error) throw error;
      } else {
        if (!validPin(u.pin)) return out({ ok:false,error:'ผู้ใช้ใหม่ต้องมี PIN 4 หลัก' },400);
        const salt=randomHex(18);
        const hash=await pinHash(String(u.pin),salt);
        const { data, error } = await db.from('mms_users').insert({ display_name:name, role, active:u.active!==false, pin_salt:salt, pin_hash:hash }).select('id').single();
        if (error) throw error;
        userId=data.id;
      }
      if (role !== 'admin' && Array.isArray(u.permissions)) {
        await db.from('mms_user_menu_permissions').delete().eq('user_id', userId);
        const rows = u.permissions.filter((x:any)=>x && x.menu_id && x.menu_id !== 'admin').map((x:any)=>({user_id:userId,menu_id:String(x.menu_id),can_view:!!x.can_view,can_use:!!x.can_use}));
        if (rows.length) {
          const { error } = await db.from('mms_user_menu_permissions').insert(rows);
          if (error) throw error;
        }
      }
      return out({ ok:true, id:userId });
    }

    if (action === 'admin-save-menu') {
      await requireAdmin(req, body);
      const m = body.menu || {};
      const id = String(m.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-');
      if (!id || !String(m.title_th || '').trim()) return out({ok:false,error:'กรุณากรอกรหัสและชื่อเมนู'},400);
      const row = {
        id,
        title_th:String(m.title_th).trim(),
        title_en:String(m.title_en||'').trim(),
        subtitle:String(m.subtitle||'').trim(),
        icon:String(m.icon||'◈').slice(0,8),
        accent:String(m.accent||'#4f8cff'),
        route_type:['legacy','external','internal'].includes(m.route_type)?m.route_type:'external',
        route_url:m.route_url?String(m.route_url):null,
        sort_order:Number(m.sort_order||100),
        enabled:!!m.enabled,
        updated_at:new Date().toISOString()
      };
      const { error } = await db.from('mms_menus').upsert(row);
      if (error) throw error;
      return out({ok:true,id});
    }

    if (action === 'video-job-list') {
      const ctx = await requireSession(req, body);
      let q = db.from('video_edit_jobs').select('*').order('created_at', { ascending: false }).limit(clamp(int(body.limit, 50) || 50, 1, 200));
      if (ctx.user.role !== 'admin') q = q.eq('user_id', ctx.user.id);
      const { data, error } = await q;
      if (error) throw error;
      return out({ ok:true, jobs:data || [] });
    }

    if (action === 'video-job-create') {
      const ctx = await requireSession(req, body);
      const patch = videoJobPatch(body.job || {});
      const row = { ...patch, user_id:ctx.user.id, status:'draft', progress:0, created_at:new Date().toISOString() };
      const { data, error } = await db.from('video_edit_jobs').insert(row).select('*').single();
      if (error) throw error;
      await db.from('video_job_events').insert({ job_id:data.id, event_type:'created', progress:0, message:'สร้างแผนงานตัดวิดีโอ' });
      return out({ ok:true, job:data });
    }

    if (action === 'video-job-update') {
      const ctx = await requireSession(req, body);
      const id = String(body.id || '');
      const current = await getOwnedVideoJob(ctx, id);
      if (!['draft','uploading','failed'].includes(current.status)) return out({ok:false,error:'งานกำลังประมวลผล ไม่สามารถแก้ค่าตัดได้'},409);
      const patch = videoJobPatch(body.job || {}, current);
      const { data, error } = await db.from('video_edit_jobs').update(patch).eq('id', id).select('*').single();
      if (error) throw error;
      await db.from('video_job_events').insert({ job_id:id, event_type:'updated', progress:data.progress, message:'แก้ไขจุดตัด/ซูม' });
      return out({ok:true,job:data});
    }

    if (action === 'video-keyframes-save') {
      const ctx = await requireSession(req, body);
      const id = String(body.id || '');
      const current = await getOwnedVideoJob(ctx, id);
      if (!['draft','uploading','failed'].includes(current.status)) return out({ok:false,error:'งานกำลังประมวลผล ไม่สามารถแก้ keyframe ได้'},409);
      const frames = Array.isArray(body.keyframes) ? body.keyframes.slice(0,500) : [];
      const rows = frames.map((f:any)=>({
        job_id:id,
        time_ms:Math.max(0,int(f.time_ms,0)||0),
        center_x:clamp(num(f.center_x,.5)||.5,0,1),
        center_y:clamp(num(f.center_y,.5)||.5,0,1),
        zoom:clamp(num(f.zoom,1)||1,1,4),
        easing:String(f.easing||'smooth').slice(0,30),
        tracking_source:f.tracking_source?String(f.tracking_source).slice(0,100):null
      }));
      await db.from('video_edit_keyframes').delete().eq('job_id',id);
      if (rows.length) {
        const { error } = await db.from('video_edit_keyframes').insert(rows);
        if (error) throw error;
      }
      return out({ok:true,count:rows.length});
    }

    if (action === 'video-job-queue') {
      const ctx = await requireSession(req, body);
      const id = String(body.id || '');
      const current = await getOwnedVideoJob(ctx, id);
      if (!current.source_object_path) return out({ok:false,error:'ยังไม่มีไฟล์ต้นฉบับใน Storage'},400);
      if (current.trim_start_ms === null || current.trim_end_ms === null || current.trim_start_ms >= current.trim_end_ms) return out({ok:false,error:'กรุณากำหนดจุดเริ่มและสิ้นสุดให้ถูกต้อง'},400);
      const { data, error } = await db.from('video_edit_jobs').update({ status:'queued', progress:0, error_message:null, updated_at:new Date().toISOString() }).eq('id',id).select('*').single();
      if (error) throw error;
      await db.from('video_job_events').insert({ job_id:id, event_type:'queued', progress:0, message:'รอ Media Worker ประมวลผล' });
      return out({ok:true,job:data,workerReady:false});
    }

    if (action === 'video-job-cancel') {
      const ctx = await requireSession(req, body);
      const id = String(body.id || '');
      const current = await getOwnedVideoJob(ctx, id);
      if (current.status === 'completed') return out({ok:false,error:'งานเสร็จแล้ว ไม่สามารถยกเลิกได้'},409);
      const { data, error } = await db.from('video_edit_jobs').update({ status:'cancelled', updated_at:new Date().toISOString() }).eq('id',id).select('*').single();
      if (error) throw error;
      await db.from('video_job_events').insert({ job_id:id, event_type:'cancelled', progress:data.progress, message:'ผู้ใช้ยกเลิกงาน' });
      return out({ok:true,job:data});
    }

    return out({ ok:false, error:'Unknown action' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'UNAUTHORIZED') return out({ok:false,error:'กรุณาเข้าสู่ระบบใหม่'},401);
    if (msg === 'FORBIDDEN') return out({ok:false,error:'ไม่มีสิทธิ์ดำเนินการ'},403);
    if (msg === 'JOB_NOT_FOUND') return out({ok:false,error:'ไม่พบงานวิดีโอ'},404);
    if (msg === 'INVALID_TRIM_RANGE') return out({ok:false,error:'จุดเริ่มต้องน้อยกว่าจุดสิ้นสุด'},400);
    console.error(e);
    return out({ ok:false, error:'เกิดข้อผิดพลาดของระบบ', detail: msg }, 500);
  }
});