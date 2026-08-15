-- MMs asynchronous video edit job queue
create table if not exists public.video_edit_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.mms_users(id) on delete set null,
  source_name text,
  source_object_path text,
  source_duration_ms bigint,
  source_fps numeric,
  source_width integer,
  source_height integer,
  event_time_ms bigint,
  pre_roll_ms integer not null default 3000 check (pre_roll_ms between 0 and 30000),
  post_roll_ms integer not null default 2000 check (post_roll_ms between 0 and 30000),
  trim_start_ms bigint,
  trim_end_ms bigint,
  zoom_mode text not null default 'original' check (zoom_mode in ('original','fixed','manual_keyframes','follow_ball','follow_subject','auto_action')),
  tracking_target text,
  zoom_level numeric not null default 1.0 check (zoom_level >= 1.0 and zoom_level <= 4.0),
  output_profile text not null default 'source_quality',
  status text not null default 'draft' check (status in ('draft','uploading','queued','processing','completed','failed','cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  result_object_path text,
  error_message text,
  worker_job_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.video_edit_keyframes (
  id bigserial primary key,
  job_id uuid not null references public.video_edit_jobs(id) on delete cascade,
  time_ms bigint not null,
  center_x numeric not null default 0.5 check (center_x between 0 and 1),
  center_y numeric not null default 0.5 check (center_y between 0 and 1),
  zoom numeric not null default 1.0 check (zoom >= 1.0 and zoom <= 4.0),
  easing text not null default 'smooth',
  tracking_source text,
  unique(job_id,time_ms)
);

create table if not exists public.video_job_events (
  id bigserial primary key,
  job_id uuid not null references public.video_edit_jobs(id) on delete cascade,
  event_type text not null,
  progress integer,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_video_edit_jobs_user_created on public.video_edit_jobs(user_id, created_at desc);
create index if not exists idx_video_edit_jobs_status on public.video_edit_jobs(status, created_at);
create index if not exists idx_video_keyframes_job_time on public.video_edit_keyframes(job_id,time_ms);
create index if not exists idx_video_job_events_job on public.video_job_events(job_id,created_at);

alter table public.video_edit_jobs enable row level security;
alter table public.video_edit_keyframes enable row level security;
alter table public.video_job_events enable row level security;

create or replace function public.mms_touch_video_job_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_video_edit_jobs_touch on public.video_edit_jobs;
create trigger trg_video_edit_jobs_touch before update on public.video_edit_jobs for each row execute function public.mms_touch_video_job_updated_at();

comment on table public.video_edit_jobs is 'MMs asynchronous video edit/trim/zoom job queue. Media worker will process queued jobs.';
comment on column public.video_edit_jobs.pre_roll_ms is 'Default 3000ms before AI/user event marker.';
comment on column public.video_edit_jobs.zoom_mode is 'original, fixed, manual_keyframes, follow_ball, follow_subject, auto_action';