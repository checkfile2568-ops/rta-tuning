-- Fast, access-controlled search for spoken transcript segments and video AI events.
-- pg_trgm is available in the current project; this keeps the migration safe for a
-- fresh environment without granting any client-side database permissions.
create extension if not exists pg_trgm;

create index if not exists idx_mms_ai_findings_transcript_detail_trgm
  on public.mms_ai_findings using gin (detail gin_trgm_ops)
  where module = 'audio' and finding_type = 'transcript_segment';

create index if not exists idx_mms_ai_findings_video_event_lookup
  on public.mms_ai_findings (media_file_id, finding_type, start_ms)
  where module = 'video'
    and finding_type in ('highlight_candidate', 'goal_candidate');

-- Administrators see enabled menus automatically.  Existing non-admin users keep
-- their current access: grant this menu from Admin Settings when appropriate.
insert into public.mms_menus(
  id,title_th,title_en,subtitle,icon,accent,route_type,route_url,sort_order,enabled
) values (
  'video-search','ค้นหาในวิดีโอ','VIDEO SEARCH',
  'ค้นหาคำพูด ช่วงสำคัญ และ Goal candidate จากวิดีโอ','⌕','#4f8cff','external',
  'https://checkfile2568-ops.github.io/rta-tuning/video-search.html',18,true
)
on conflict (id) do update set
  title_th=excluded.title_th,
  title_en=excluded.title_en,
  subtitle=excluded.subtitle,
  icon=excluded.icon,
  accent=excluded.accent,
  route_type=excluded.route_type,
  route_url=excluded.route_url,
  sort_order=excluded.sort_order,
  enabled=excluded.enabled,
  updated_at=now();
