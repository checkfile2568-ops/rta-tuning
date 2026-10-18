import { createClient } from 'npm:@supabase/supabase-js@2';

const APP_ORIGIN = 'https://checkfile2568-ops.github.io';
const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();

function headers(req: Request) {
  const origin = req.headers.get('origin');
  return {
    'Access-Control-Allow-Origin': origin === APP_ORIGIN ? origin : APP_ORIGIN,
    'Access-Control-Allow-Headers': 'content-type,x-mms-session,apikey,authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin'
  };
}
function out(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: headers(req) });
}
function fail(req: Request, error: string, status = 400) { return out(req, { ok: false, error }, status); }
function hex(bytes: Uint8Array) { return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function sha256(value: string) { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)))); }
function boundedText(value: unknown, max: number) { return String(value ?? '').trim().slice(0, max); }
function boundedInt(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

async function sessionFrom(req: Request) {
  const raw = req.headers.get('x-mms-session') || '';
  if (!raw || raw.length > 256) return null;
  const tokenHash = await sha256(raw);
  const { data: session } = await db.from('mms_sessions')
    .select('id,user_id,expires_at').eq('token_hash', tokenHash).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (!session) return null;
  const { data: user } = await db.from('mms_users')
    .select('id,display_name,role,active').eq('id', session.user_id).maybeSingle();
  if (!user?.active) return null;
  await db.from('mms_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id);
  return { session, user };
}
async function requireSession(req: Request) {
  const context = await sessionFrom(req);
  if (!context) throw new Error('UNAUTHORIZED');
  return context;
}
function owned(query: any, context: any, column = 'owner_id') {
  return context.user.role === 'admin' ? query : query.eq(column, context.user.id);
}
async function audit(context: any, action: string, entityId: string | null, file: any, detail: Record<string, unknown> = {}) {
  await db.from('mms_audit_events').insert({
    actor_id: context.user.id, action, entity_type: 'video_search', entity_id: entityId,
    project_id: file?.project_id || null, media_file_id: file?.id || null, detail
  });
}
async function videoFor(context: any, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  let query = db.from('media_files').select('*').eq('id', id).eq('media_type', 'video').eq('upload_status', 'ready').is('purged_at', null);
  query = owned(query, context);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}
async function videosFor(context: any, limit = 300) {
  let query = db.from('media_files')
    .select('id,original_name,media_type,mime_type,size_bytes,duration_ms,created_at,project_id,owner_id')
    .eq('media_type', 'video').eq('upload_status', 'ready').is('purged_at', null)
    .order('created_at', { ascending: false }).limit(limit);
  query = owned(query, context);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
async function activeAiWorkers() {
  const cutoff = new Date(Date.now() - 120000).toISOString();
  const { data, error } = await db.from('mms_worker_nodes')
    .select('worker_id,status,version,last_seen_at,capabilities')
    .eq('worker_type', 'ai').gte('last_seen_at', cutoff).in('status', ['online', 'busy'])
    .order('last_seen_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
function workerTypes(workers: any[]) {
  const types = new Set<string>();
  for (const worker of workers) for (const type of (worker?.capabilities?.job_types || [])) types.add(String(type));
  return [...types];
}
async function queueJob(context: any, file: any, module: string, jobType: string, input: any, key: string) {
  const { data: existing, error: lookupError } = await db.from('mms_processing_jobs').select('*').eq('idempotency_key', key).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) {
    if (['failed', 'cancelled'].includes(existing.status)) {
      const { data, error } = await db.from('mms_processing_jobs').update({
        status: 'queued', progress: 0, error_message: null, worker_id: null, locked_at: null,
        next_retry_at: null, input, updated_at: new Date().toISOString()
      }).eq('id', existing.id).select().single();
      if (error) throw error;
      return data;
    }
    return existing;
  }
  const { data, error } = await db.from('mms_processing_jobs').insert({
    owner_id: file.owner_id, project_id: file.project_id, media_file_id: file.id, module,
    job_type: jobType, status: 'queued', priority: 80, input, idempotency_key: key
  }).select().single();
  if (error) throw error;
  await audit(context, 'ai_job_queued', data.id, file, { job_type: jobType });
  return data;
}
async function findingScope(context: any) {
  const files = await videosFor(context, 300);
  return { files, ids: files.map((file: any) => file.id), byId: new Map(files.map((file: any) => [file.id, file])) };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: headers(req) });
  if (req.method !== 'POST') return fail(req, 'METHOD_NOT_ALLOWED', 405);
  try {
    const body = await req.json().catch(() => ({}));
    const action = boundedText(body.action || 'capabilities', 48);
    const context = await requireSession(req);

    if (action === 'capabilities') {
      const workers = await activeAiWorkers();
      const jobTypes = workerTypes(workers);
      return out(req, {
        ok: true, workers, job_types: jobTypes,
        audio_transcribe: jobTypes.includes('audio_transcribe'),
        football_highlight_scan: jobTypes.includes('football_highlight_scan')
      });
    }

    if (action === 'video-list') {
      const { files, ids } = await findingScope(context);
      if (!ids.length) return out(req, { ok: true, files: [] });
      const { data: findings, error } = await db.from('mms_ai_findings')
        .select('media_file_id,module,finding_type').in('media_file_id', ids)
        .in('finding_type', ['transcript_segment', 'highlight_candidate', 'goal_candidate']).limit(5000);
      if (error) throw error;
      const counts = new Map<string, { transcript: number; highlights: number; goals: number }>();
      for (const finding of findings || []) {
        const item = counts.get(finding.media_file_id) || { transcript: 0, highlights: 0, goals: 0 };
        if (finding.finding_type === 'transcript_segment') item.transcript += 1;
        if (finding.finding_type === 'highlight_candidate') item.highlights += 1;
        if (finding.finding_type === 'goal_candidate') item.goals += 1;
        counts.set(finding.media_file_id, item);
      }
      return out(req, { ok: true, files: files.map((file: any) => ({ ...file, search_index: counts.get(file.id) || { transcript: 0, highlights: 0, goals: 0 } })) });
    }

    if (action === 'preview-url') {
      const file = await videoFor(context, boundedText(body.media_file_id, 64));
      if (!file) return fail(req, 'ไม่พบวิดีโอหรือไม่มีสิทธิ์', 404);
      const expires = boundedInt(body.expires_in, 900, 60, 1800);
      const { data, error } = await db.storage.from('mms-media').createSignedUrl(file.storage_path, expires);
      if (error || !data?.signedUrl) throw error || new Error('SIGNED_URL_FAILED');
      return out(req, { ok: true, url: data.signedUrl, file: { id: file.id, original_name: file.original_name, duration_ms: file.duration_ms } });
    }

    if (action === 'request-audio-transcript') {
      const file = await videoFor(context, boundedText(body.media_file_id, 64));
      if (!file) return fail(req, 'ไม่พบวิดีโอหรือไม่มีสิทธิ์', 404);
      const language = /^[a-z-]{2,16}$/i.test(boundedText(body.language || 'th', 16)) ? boundedText(body.language || 'th', 16) : 'th';
      const model = ['tiny', 'base', 'small', 'medium'].includes(boundedText(body.model || 'small', 16)) ? boundedText(body.model || 'small', 16) : 'small';
      const job = await queueJob(context, file, 'audio', 'audio_transcribe', { language, model, source_path: file.storage_path }, `audio-transcribe:${file.id}:${language}:${model}:v1`);
      return out(req, { ok: true, job, notice: 'งานจะเริ่มเมื่อ AI Worker ที่รองรับการถอดเสียงออนไลน์' });
    }

    if (action === 'request-football-scan') {
      const file = await videoFor(context, boundedText(body.media_file_id, 64));
      if (!file) return fail(req, 'ไม่พบวิดีโอหรือไม่มีสิทธิ์', 404);
      const settings = {
        preset: 'football', sample_seconds: Number(Math.max(0.5, Math.min(5, Number(body.sample_seconds) || 1.5))),
        pre_roll_ms: boundedInt(body.pre_roll_ms, 8000, 0, 30000),
        post_roll_ms: boundedInt(body.post_roll_ms, 12000, 0, 45000),
        max_candidates: boundedInt(body.max_candidates, 24, 5, 60), goal_heuristic: Boolean(body.goal_heuristic)
      };
      const key = `football-scan:${file.id}:${settings.sample_seconds}:${settings.pre_roll_ms}:${settings.post_roll_ms}:v1`;
      const job = await queueJob(context, file, 'video', 'football_highlight_scan', { source_path: file.storage_path, ...settings }, key);
      return out(req, { ok: true, job, notice: 'Goal candidate เป็นเพียงข้อเสนอจาก AI และต้องยืนยันโดยผู้ใช้' });
    }

    if (action === 'video-search') {
      const mode = ['speech', 'highlights', 'goals', 'all'].includes(String(body.mode)) ? String(body.mode) : 'speech';
      const query = boundedText(body.query, 120);
      if ((mode === 'speech' || mode === 'all') && !query) return fail(req, 'กรอกคำหรือวลีที่ต้องการค้นหา');
      const { ids, byId } = await findingScope(context);
      if (!ids.length) return out(req, { ok: true, findings: [], total: 0 });
      const types = mode === 'speech' ? ['transcript_segment'] : mode === 'highlights' ? ['highlight_candidate'] : mode === 'goals' ? ['goal_candidate'] : ['transcript_segment', 'highlight_candidate', 'goal_candidate'];
      let findingQuery = db.from('mms_ai_findings')
        .select('id,project_id,media_file_id,module,finding_type,title,detail,position_text,start_ms,end_ms,confidence,review_status,payload,created_at')
        .in('media_file_id', ids).in('finding_type', types)
        .order('created_at', { ascending: false }).limit(boundedInt(body.limit, 100, 1, 150));
      if (query) findingQuery = findingQuery.ilike('detail', `%${query}%`);
      const { data, error } = await findingQuery;
      if (error) throw error;
      const findings = (data || []).map((finding: any) => ({ ...finding, file: byId.get(finding.media_file_id) || null }));
      await audit(context, 'video_search', null, null, { mode, query_length: query.length, returned: findings.length });
      return out(req, { ok: true, findings, total: findings.length });
    }

    if (action === 'job-status') {
      const id = boundedText(body.id, 64);
      let query = db.from('mms_processing_jobs').select('*').eq('id', id);
      query = owned(query, context);
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) return fail(req, 'ไม่พบงาน', 404);
      return out(req, { ok: true, job: data });
    }

    if (action === 'review-finding') {
      const id = boundedText(body.id, 64);
      const reviewStatus = ['confirmed', 'rejected', 'corrected'].includes(String(body.review_status)) ? String(body.review_status) : '';
      if (!reviewStatus) return fail(req, 'สถานะไม่ถูกต้อง');
      const { data: finding, error } = await db.from('mms_ai_findings').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!finding || !['highlight_candidate', 'goal_candidate'].includes(finding.finding_type)) return fail(req, 'ไม่พบเหตุการณ์ AI', 404);
      const file = await videoFor(context, String(finding.media_file_id || ''));
      if (!file) return fail(req, 'ไม่มีสิทธิ์', 403);
      const { data, error: updateError } = await db.from('mms_ai_findings').update({
        review_status: reviewStatus, reviewed_by: context.user.id, reviewed_at: new Date().toISOString(), correction: {}
      }).eq('id', id).select().single();
      if (updateError) throw updateError;
      await audit(context, 'ai_finding_reviewed', id, file, { status: reviewStatus });
      return out(req, { ok: true, finding: data });
    }

    return fail(req, 'UNKNOWN_ACTION');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('mms-video-search-api', message);
    if (message === 'UNAUTHORIZED') return fail(req, 'กรุณาเข้าสู่ระบบใหม่', 401);
    return fail(req, 'เกิดข้อผิดพลาดของระบบ', 500);
  }
});
