-- MMs core schema deployed to Supabase project media-system
create extension if not exists pgcrypto;

create table if not exists public.mms_users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  role text not null default 'user' check (role in ('admin','user')),
  pin_salt text not null,
  pin_hash text not null,
  active boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mms_menus (
  id text primary key,
  title_th text not null,
  title_en text,
  subtitle text,
  icon text,
  accent text not null default '#4f8cff',
  route_type text not null default 'legacy' check (route_type in ('legacy','external','internal')),
  route_url text,
  sort_order integer not null default 100,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mms_user_menu_permissions (
  user_id uuid not null references public.mms_users(id) on delete cascade,
  menu_id text not null references public.mms_menus(id) on delete cascade,
  can_view boolean not null default false,
  can_use boolean not null default false,
  primary key (user_id, menu_id)
);

create table if not exists public.mms_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.mms_users(id) on delete cascade,
  token_hash text not null unique,
  device_label text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.mms_login_logs (
  id bigserial primary key,
  user_id uuid references public.mms_users(id) on delete set null,
  display_name text,
  success boolean not null,
  reason text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.media_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid null,
  original_name text not null,
  media_type text not null check (media_type in ('video','audio','document','image','other')),
  mime_type text,
  storage_path text,
  size_bytes bigint,
  sha256 text,
  created_at timestamptz not null default now()
);

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(), owner_id uuid null,
  media_file_id uuid null references public.media_files(id) on delete set null,
  legacy_source text, legacy_row_group text, mode text, model text,
  status text not null default 'completed' check (status in ('queued','processing','completed','failed','cancelled')),
  summary text, error_message text, started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.analysis_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.analysis_jobs(id) on delete cascade,
  position integer not null default 0, page_or_time text, title text, detail text, item_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.migration_import_log (
  id uuid primary key default gen_random_uuid(), source_name text not null, source_row text,
  imported_job_id uuid null references public.analysis_jobs(id) on delete set null,
  checksum text, status text not null check (status in ('imported','skipped','failed')),
  message text, imported_at timestamptz not null default now()
);

alter table public.mms_users enable row level security;
alter table public.mms_menus enable row level security;
alter table public.mms_user_menu_permissions enable row level security;
alter table public.mms_sessions enable row level security;
alter table public.mms_login_logs enable row level security;
alter table public.media_files enable row level security;
alter table public.analysis_jobs enable row level security;
alter table public.analysis_items enable row level security;
alter table public.migration_import_log enable row level security;

insert into public.mms_menus (id,title_th,title_en,subtitle,icon,accent,route_type,route_url,sort_order,enabled) values
('video','วิเคราะห์วิดีโอ','VIDEO ANALYSIS','วิเคราะห์ภาพ เหตุการณ์ และกิจกรรมในวิดีโอ','▶','#ff934f','legacy','https://script.google.com/macros/s/AKfycbwqyIrR6JXm9OKpUF8IBeJh7bVciZv0M8Oq8Lj0aIE3CE_l7kJdNp1JUrKb_tEwPNuE/exec',10,true),
('audio','วิเคราะห์เสียง','AUDIO ANALYSIS','วิเคราะห์เสียง คำพูด และรูปแบบเสียง','♫','#9a62ff','legacy','https://script.google.com/macros/s/AKfycbwqyIrR6JXm9OKpUF8IBeJh7bVciZv0M8Oq8Lj0aIE3CE_l7kJdNp1JUrKb_tEwPNuE/exec',20,true),
('document','วิเคราะห์เอกสาร','DOCUMENT AI','สรุป จำแนก และวิเคราะห์ข้อมูลเอกสาร','▤','#35bf87','legacy','https://script.google.com/macros/s/AKfycbwqyIrR6JXm9OKpUF8IBeJh7bVciZv0M8Oq8Lj0aIE3CE_l7kJdNp1JUrKb_tEwPNuE/exec',30,true),
('history','ประวัติการวิเคราะห์','HISTORY','ติดตามและตรวจสอบประวัติการทำงาน','◷','#59bdf6','legacy','https://script.google.com/macros/s/AKfycbwqyIrR6JXm9OKpUF8IBeJh7bVciZv0M8Oq8Lj0aIE3CE_l7kJdNp1JUrKb_tEwPNuE/exec',40,true),
('reports','รายงาน','REPORTS','จัดทำและส่งออกรายงาน','▥','#ff6e9f','legacy','https://script.google.com/macros/s/AKfycbwqyIrR6JXm9OKpUF8IBeJh7bVciZv0M8Oq8Lj0aIE3CE_l7kJdNp1JUrKb_tEwPNuE/exec',50,false),
('admin','ตั้งค่าแอดมิน','ADMIN SETTINGS','ผู้ใช้ สิทธิ์ เมนู และการตั้งค่าระบบ','⚙','#4f8cff','internal',null,90,true)
on conflict (id) do nothing;
