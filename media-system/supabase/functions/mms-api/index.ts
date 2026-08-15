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
async function activeUsers() {
  const { data, error } = await db.from('mms_users').select('id,display_name').eq('active', true).order('display_name');
  if (error) throw error; return data || [];
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
async function requireAdmin(req: Request, body: any) {
  const ctx = await sessionFrom(req, body);
  if (!ctx) throw new Error('UNAUTHORIZED');
  if (ctx.user.role !== 'admin') throw new Error('FORBIDDEN');
  return ctx;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'status');

    if (action === 'status') {
      const { count, error } = await db.from('mms_users').select('*', { count: 'exact', head: true });
      if (error) throw error;
      return out({ ok: true, setupRequired: (count || 0) === 0, users: await activeUsers(), system: 'MMs', version: '2.0.0' });
    }
    if (action === 'bootstrap') {
      const { count } = await db.from('mms_users').select('*', { count: 'exact', head: true });
      if ((count || 0) > 0) return out({ ok: false, error: 'ระบบถูกตั้งค่าแล้ว' }, 409);
      const name = String(body.display_name || '').trim(); const pin = String(body.pin || '');
      if (!name || !validPin(pin)) return out({ ok: false, error: 'กรุณากรอกชื่อและ PIN 4 หลัก' }, 400);
      const salt = randomHex(18); const hash = await pinHash(pin, salt);
      const { data: user, error } = await db.from('mms_users').insert({ display_name: name, role: 'admin', pin_salt: salt, pin_hash: hash, active: true }).select('id,display_name,role').single();
      if (error) throw error; return out({ ok: true, user });
    }
    if (action === 'login') {
      const userId = String(body.user_id || ''); const pin = String(body.pin || '');
      if (!userId || !validPin(pin)) return out({ ok: false, error: 'PIN ต้องเป็นตัวเลข 4 หลัก' }, 400);
      const { data: user } = await db.from('mms_users').select('*').eq('id', userId).maybeSingle();
      if (!user?.active) return out({ ok: false, error: 'ไม่พบบัญชีหรือบัญชีถูกปิด' }, 403);
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) return out({ ok: false, error: 'บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง' }, 423);
      const good = (await pinHash(pin, user.pin_salt)) === user.pin_hash;
      if (!good) {
        const attempts = (user.failed_attempts || 0) + 1; const patch: any = { failed_attempts: attempts };
        if (attempts >= 5) { patch.failed_attempts = 0; patch.locked_until = new Date(Date.now() + 10 * 60 * 1000).toISOString(); }
        await db.from('mms_users').update(patch).eq('id', user.id);
        await db.from('mms_login_logs').insert({ user_id: user.id, display_name: user.display_name, success: false, reason: 'bad_pin', user_agent: req.headers.get('user-agent') });
        return out({ ok: false, error: attempts >= 5 ? 'PIN ไม่ถูกต้อง บัญชีถูกล็อก 10 นาที' : 'PIN ไม่ถูกต้อง' }, 401);
      }
      await db.from('mms_users').update({ failed_attempts: 0, locked_until: null }).eq('id', user.id);
      const token = randomHex(32); const token_hash = await sha256(token); const expires = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      await db.from('mms_sessions').insert({ user_id: user.id, token_hash, expires_at: expires, device_label: String(body.device_label || '').slice(0,120) });
      await db.from('mms_login_logs').insert({ user_id: user.id, display_name: user.display_name, success: true, reason: 'login', user_agent: req.headers.get('user-agent') });
      return out({ ok: true, session: token, expires_at: expires, user: { id: user.id, display_name: user.display_name, role: user.role }, menus: await userMenus(user) });
    }
    if (action === 'session') {
      const ctx = await sessionFrom(req, body); if (!ctx) return out({ ok: false, error: 'SESSION_EXPIRED' }, 401);
      return out({ ok: true, user: ctx.user, menus: await userMenus(ctx.user) });
    }
    if (action === 'logout') { const ctx = await sessionFrom(req, body); if (ctx) await db.from('mms_sessions').delete().eq('id', ctx.session.id); return out({ ok: true }); }
    if (action === 'admin-data') {
      await requireAdmin(req, body);
      const { data: menus, error: me } = await db.from('mms_menus').select('*').order('sort_order'); if (me) throw me;
      const { data: users, error: ue } = await db.from('mms_users').select('id,display_name,role,active,created_at,updated_at').order('display_name'); if (ue) throw ue;
      const { data: perms, error: pe } = await db.from('mms_user_menu_permissions').select('*'); if (pe) throw pe;
      return out({ ok: true, menus: menus || [], users: users || [], permissions: perms || [] });
    }
    if (action === 'admin-save-user') {
      await requireAdmin(req, body); const u = body.user || {}; const name = String(u.display_name || '').trim(); const role = u.role === 'admin' ? 'admin' : 'user';
      if (!name) return out({ ok: false, error: 'กรุณากรอกชื่อผู้ใช้' }, 400); let userId = String(u.id || '');
      if (userId) {
        const patch: any = { display_name: name, role, active: u.active !== false, updated_at: new Date().toISOString() };
        if (u.pin) { if (!validPin(u.pin)) return out({ ok:false,error:'PIN ต้องเป็น 4 หลัก' },400); const salt=randomHex(18); patch.pin_salt=salt; patch.pin_hash=await pinHash(String(u.pin),salt); }
        const { error } = await db.from('mms_users').update(patch).eq('id', userId); if (error) throw error;
      } else {
        if (!validPin(u.pin)) return out({ ok:false,error:'ผู้ใช้ใหม่ต้องมี PIN 4 หลัก' },400);
        const salt=randomHex(18); const hash=await pinHash(String(u.pin),salt);
        const { data, error } = await db.from('mms_users').insert({ display_name:name, role, active:u.active!==false, pin_salt:salt, pin_hash:hash }).select('id').single(); if (error) throw error; userId=data.id;
      }
      if (role !== 'admin' && Array.isArray(u.permissions)) {
        await db.from('mms_user_menu_permissions').delete().eq('user_id', userId);
        const rows = u.permissions.filter((x:any)=>x && x.menu_id && x.menu_id !== 'admin').map((x:any)=>({user_id:userId,menu_id:String(x.menu_id),can_view:!!x.can_view,can_use:!!x.can_use}));
        if (rows.length) { const { error } = await db.from('mms_user_menu_permissions').insert(rows); if (error) throw error; }
      }
      return out({ ok:true, id:userId });
    }
    if (action === 'admin-save-menu') {
      await requireAdmin(req, body); const m = body.menu || {};
      const id = String(m.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'-');
      if (!id || !String(m.title_th || '').trim()) return out({ok:false,error:'กรุณากรอกรหัสและชื่อเมนู'},400);
      const row = { id, title_th:String(m.title_th).trim(), title_en:String(m.title_en||'').trim(), subtitle:String(m.subtitle||'').trim(), icon:String(m.icon||'◈').slice(0,8), accent:String(m.accent||'#4f8cff'), route_type:['legacy','external','internal'].includes(m.route_type)?m.route_type:'external', route_url:m.route_url?String(m.route_url):null, sort_order:Number(m.sort_order||100), enabled:!!m.enabled, updated_at:new Date().toISOString() };
      const { error } = await db.from('mms_menus').upsert(row); if (error) throw error; return out({ok:true,id});
    }
    return out({ ok:false, error:'Unknown action' }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'UNAUTHORIZED') return out({ok:false,error:'กรุณาเข้าสู่ระบบใหม่'},401);
    if (msg === 'FORBIDDEN') return out({ok:false,error:'ไม่มีสิทธิ์ดำเนินการ'},403);
    console.error(e); return out({ ok:false, error:'เกิดข้อผิดพลาดของระบบ', detail: msg }, 500);
  }
});
