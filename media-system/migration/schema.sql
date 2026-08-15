-- Draft schema for Supabase/PostgreSQL
-- No production data or secrets are stored here.

create extension if not exists pgcrypto;

create table if not exists public.media_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid null references auth.users(id) on delete set null,
  original_name text not null,
  media_type text not null check (media_type in ('video','audio','document','image','other')),
  mime_type text,
  storage_path text,
  size_bytes bigint,
  sha256 text,
  created_at timestamptz not null default now()
);

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid null references auth.users(id) on delete set null,
  media_file_id uuid null references public.media_files(id) on delete set null,
  legacy_source text,
  legacy_row_group text,
  mode text,
  model text,
  status text not null default 'completed' check (status in ('queued','processing','completed','failed','cancelled')),
  summary text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.analysis_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.analysis_jobs(id) on delete cascade,
  position integer not null default 0,
  page_or_time text,
  title text,
  detail text,
  item_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.migration_import_log (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_row text,
  imported_job_id uuid null references public.analysis_jobs(id) on delete set null,
  checksum text,
  status text not null check (status in ('imported','skipped','failed')),
  message text,
  imported_at timestamptz not null default now()
);

create index if not exists idx_media_files_owner on public.media_files(owner_id);
create index if not exists idx_analysis_jobs_owner_created on public.analysis_jobs(owner_id, created_at desc);
create index if not exists idx_analysis_jobs_file on public.analysis_jobs(media_file_id);
create index if not exists idx_analysis_items_job_position on public.analysis_items(job_id, position);

alter table public.media_files enable row level security;
alter table public.analysis_jobs enable row level security;
alter table public.analysis_items enable row level security;
alter table public.migration_import_log enable row level security;

-- Policies will be finalized after the authentication model is confirmed.
-- Service-role credentials must never be exposed in GitHub Pages/client JavaScript.
