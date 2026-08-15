import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-mms-session,apikey,authorization',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
};
const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'mms-media';
// Signed resumable uploads must use the signed TUS endpoint.
const TUS_ENDPOINT = 'https://hwzadnpaxiacucvjxmor.storage.supabase.co/storage/v1/upload/resumable/sign';
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const out = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: cors });
const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
async function sha256(s: string) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))); }

async function ctx(req: Request, body: any) {
  const raw = req.headers.get('x-mms-session') || body?.session || '';
  if (!raw) return null;
  const h = await sha256(raw);
  const { data: s } = await db.from('mms_sessions').select('id,user_id,expires_at').eq('token_hash', h).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!s) return null;
  const { data: u } = await db.from('mms_users').select('id,display_name,role,active').eq('id', s.user_id).maybeSingle();
  if (!u?.active) return null;
  await db.from('mms_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', s.id);
  return { user: u };
}
function mediaType(mime: string, name: string) {
  const m = (mime || '').toLowerCase(), n = (name || '').toLowerCase();
  if (m.startsWith('video/') || /\.(mp4|mov|mkv|avi|mts|m2ts|ts|webm)$/i.test(n)) return 'video';
  if (m.startsWith('audio/') || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(n)) return 'audio';
  if (m.startsWith('image/')) return 'image';
  if (m.includes('pdf') || m.includes('document') || /\.(pdf|docx?|xlsx?|pptx?|txt)$/i.test(n)) return 'document';
  return 'other';
}
function originalName(v: unknown) {
  return String(v || 'file').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 240) || 'file';
}
function safeExt(name: string, mime: string) {
  const hit = name.match(/\.([A-Za-z0-9]{1,10})$/);
  if (hit) return hit[1].toLowerCase();
  const map: Record<string,string> = {
    'video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm',
    'audio/mpeg':'mp3','audio/wav':'wav','audio/mp4':'m4a',
    'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'
  };
  return map[(mime || '').toLowerCase()] || 'bin';
}
async function audit(userId: string, action: string, entityId: string, detail: any = {}, projectId: string | null = null, mediaId: string | null = null) {
  await db.from('mms_audit_events').insert({ actor_id: userId, action, entity_type: 'media_file', entity_id: entityId, detail, project_id: projectId, media_file_id: mediaId });
}
async function ownedFile(id: string, c: any) {
  let q = db.from('media_files').select('*').eq('id', id);
  if (c.user.role !== 'admin') q = q.eq('owner_id', c.user.id);
  const { data } = await q.maybeSingle();
  return data;
}
async function sign(path: string) {
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (error || !data?.token) throw error || new Error('SIGNED_UPLOAD_FAILED');
  return data.token;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const c = await ctx(req, body);
    if (!c) return out({ ok: false, error: 'กรุณาเข้าสู่ระบบใหม่' }, 401);
    const action = String(body.action || '');

    if (action === 'request-upload') {
      const name = originalName(body.name);
      const mime = String(body.mime_type || 'application/octet-stream').slice(0, 200);
      const size = Math.max(0, Number(body.size_bytes) || 0);
      const projectId = body.project_id ? String(body.project_id) : null;
      const sourceKind = ['upload','cctv','import','nvr'].includes(String(body.source_kind)) ? String(body.source_kind) : 'upload';
      if (projectId) {
        let pq = db.from('mms_projects').select('id,owner_id').eq('id', projectId);
        if (c.user.role !== 'admin') pq = pq.eq('owner_id', c.user.id);
        const { data: p } = await pq.maybeSingle();
        if (!p) return out({ ok: false, error: 'ไม่พบ Project หรือไม่มีสิทธิ์' }, 403);
      }
      const id = crypto.randomUUID();
      const ext = safeExt(name, mime);
      const path = `${c.user.id}/${new Date().toISOString().slice(0,7)}/${id}/source.${ext}`;
      const token = await sign(path);
      const now = new Date().toISOString();
      const { data: file, error } = await db.from('media_files').insert({
        id, owner_id: c.user.id, project_id: projectId, original_name: name,
        media_type: mediaType(mime, name), mime_type: mime, storage_path: path,
        size_bytes: size, upload_status: 'uploading', source_kind: sourceKind,
        upload_bytes: 0, upload_progress: 0, upload_started_at: now, last_upload_activity_at: now
      }).select().single();
      if (error) throw error;
      await audit(c.user.id, 'upload_requested_v3', id, { original_name: name, storage_key: path, size, sourceKind }, projectId, id);
      return out({ ok: true, file, bucket: BUCKET, path, token, tus_endpoint: TUS_ENDPOINT });
    }

    if (action === 'refresh-upload') {
      const id = String(body.id || '');
      const file = await ownedFile(id, c);
      if (!file) return out({ ok: false, error: 'ไม่พบรายการเดิมหรือไม่มีสิทธิ์' }, 404);
      if (file.upload_status === 'ready') return out({ ok: false, error: 'ไฟล์นี้อัปโหลดสำเร็จแล้ว' }, 409);
      if (!file.storage_path || !/^[A-Za-z0-9_./-]+$/.test(file.storage_path)) return out({ ok: false, error: 'รายการเดิมใช้ Storage key รุ่นเก่า กรุณาลบรายการแล้วอัปโหลดใหม่' }, 409);
      const token = await sign(file.storage_path);
      const now = new Date().toISOString();
      await db.from('media_files').update({ upload_status:'uploading', upload_error:null, last_upload_activity_at:now }).eq('id', id);
      return out({ ok:true, file, bucket:BUCKET, path:file.storage_path, token, tus_endpoint:TUS_ENDPOINT });
    }

    if (action === 'delete-media') {
      const id = String(body.id || '');
      if (!id) return out({ ok: false, error: 'ไม่พบรหัสรายการ' }, 400);
      const file = await ownedFile(id, c);
      if (!file) return out({ ok: false, error: 'ไม่พบรายการหรือไม่มีสิทธิ์' }, 404);
      if (file.legal_hold) return out({ ok: false, error: 'รายการนี้ติด Legal Hold จึงลบไม่ได้' }, 409);
      if (file.upload_status === 'ready') {
        if (file.project_id) return out({ ok: false, error: 'ไฟล์นี้อยู่ใน Project กรุณานำออกจาก Project ก่อน' }, 409);
        const { count: jobs } = await db.from('mms_processing_jobs').select('*', { count: 'exact', head: true }).eq('media_file_id', id);
        if ((jobs || 0) > 0) return out({ ok: false, error: 'ไฟล์นี้มีประวัติงานประมวลผล จึงยังถือว่ามีการใช้งาน' }, 409);
      }
      await audit(c.user.id, 'media_deleted', id, { original_name: file.original_name, upload_status: file.upload_status, storage_path: file.storage_path }, file.project_id, id);
      if (file.upload_status === 'ready' && file.storage_path) {
        const { data: variants } = await db.from('mms_media_variants').select('storage_path').eq('media_file_id', id);
        const paths = [...new Set([file.storage_path, ...(variants || []).map((v:any) => v.storage_path).filter(Boolean)])];
        if (paths.length) {
          const { error: removeError } = await db.storage.from(BUCKET).remove(paths);
          if (removeError) return out({ ok: false, error: 'ลบไฟล์ใน Storage ไม่สำเร็จ', detail: removeError.message }, 500);
        }
      }
      const { error: deleteError } = await db.from('media_files').delete().eq('id', id);
      if (deleteError) throw deleteError;
      return out({ ok: true, deleted_id: id });
    }

    return out({ ok: false, error: 'UNKNOWN_ACTION' }, 400);
  } catch (e) {
    console.error(e);
    return out({ ok: false, error: 'เกิดข้อผิดพลาดของระบบ', detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});