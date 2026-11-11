-- Phase 6-8: mobile pairing, app allowlist, additional safe commands

create table if not exists public.pairing_requests (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.paired_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  mobile_name text not null default 'Mobile Browser',
  browser_fingerprint text,
  paired_at timestamptz not null default now(),
  last_seen timestamptz,
  revoked_at timestamptz,
  unique(user_id, device_id, browser_fingerprint)
);

create table if not exists public.application_allowlist (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  app_id text not null,
  label text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(device_id, app_id)
);

-- Expand the command check constraint safely.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.device_commands'::regclass
      and conname = 'device_commands_command_check'
  ) then
    alter table public.device_commands drop constraint device_commands_command_check;
  end if;
end $$;

alter table public.device_commands
  add constraint device_commands_command_check
  check (command in (
    'LOCK','SLEEP','HIBERNATE','RESTART','SHUTDOWN','CANCEL_SHUTDOWN',
    'OPEN_APP','CLOSE_APP','OPEN_URL'
  ));

alter table public.pairing_requests enable row level security;
alter table public.paired_devices enable row level security;
alter table public.application_allowlist enable row level security;

create policy "pair requests own read" on public.pairing_requests
for select using (
  created_by = auth.uid()
  and exists(select 1 from public.devices d where d.id=device_id and d.owner_id=auth.uid())
);

create policy "pair requests own insert" on public.pairing_requests
for insert with check (
  created_by = auth.uid()
  and expires_at <= now() + interval '15 minutes'
  and exists(select 1 from public.devices d where d.id=device_id and d.owner_id=auth.uid())
);

create policy "pair requests own update" on public.pairing_requests
for update using (created_by=auth.uid()) with check (created_by=auth.uid());

create policy "paired devices own read" on public.paired_devices
for select using (user_id=auth.uid());

create policy "paired devices own insert" on public.paired_devices
for insert with check (
  user_id=auth.uid()
  and exists(select 1 from public.devices d where d.id=device_id and d.owner_id=auth.uid())
);

create policy "paired devices own update" on public.paired_devices
for update using (user_id=auth.uid()) with check (user_id=auth.uid());

create policy "app allowlist read own" on public.application_allowlist
for select using (
  exists(select 1 from public.devices d where d.id=device_id and d.owner_id=auth.uid())
);

create policy "app allowlist admin write" on public.application_allowlist
for all using (
  exists(
    select 1 from public.devices d
    join public.profiles p on p.id=auth.uid()
    where d.id=device_id and d.owner_id=auth.uid() and p.role='ADMIN'
  )
) with check (
  exists(
    select 1 from public.devices d
    join public.profiles p on p.id=auth.uid()
    where d.id=device_id and d.owner_id=auth.uid() and p.role='ADMIN'
  )
);

create index if not exists idx_pairing_requests_device on public.pairing_requests(device_id, created_at desc);
create index if not exists idx_paired_devices_user on public.paired_devices(user_id, paired_at desc);
create index if not exists idx_application_allowlist_device on public.application_allowlist(device_id, enabled, label);

alter publication supabase_realtime add table public.paired_devices;
alter publication supabase_realtime add table public.application_allowlist;
