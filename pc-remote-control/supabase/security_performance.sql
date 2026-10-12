-- Security/performance hardening applied to production project on 2026-09-01

create index if not exists idx_devices_owner_id on public.devices(owner_id);
create index if not exists idx_device_commands_created_by on public.device_commands(created_by);
create index if not exists idx_device_events_user_id on public.device_events(user_id);
create index if not exists idx_paired_devices_device_id on public.paired_devices(device_id);
create index if not exists idx_pairing_requests_created_by on public.pairing_requests(created_by);

create or replace function public.can_control_device(target uuid)
returns boolean
language sql
stable
security invoker
set search_path=public
as $$
  select exists (
    select 1
    from public.devices d
    left join public.profiles p on p.id=(select auth.uid())
    where d.id=target
      and d.owner_id=(select auth.uid())
      and coalesce(p.role,'VIEW_ONLY') in ('ADMIN','CONTROL')
  );
$$;
revoke all on function public.can_control_device(uuid) from public;
grant execute on function public.can_control_device(uuid) to authenticated;

drop policy if exists "profiles read own" on public.profiles;
create policy "profiles read own" on public.profiles for select to authenticated using (id=(select auth.uid()));

drop policy if exists "devices read own" on public.devices;
create policy "devices read own" on public.devices for select to authenticated using (owner_id=(select auth.uid()));

drop policy if exists "status read own" on public.device_status;
create policy "status read own" on public.device_status for select to authenticated using (exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));

drop policy if exists "commands read own" on public.device_commands;
create policy "commands read own" on public.device_commands for select to authenticated using (exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));

drop policy if exists "commands insert control" on public.device_commands;
create policy "commands insert control" on public.device_commands for insert to authenticated with check (created_by=(select auth.uid()) and public.can_control_device(device_id) and expires_at<=now()+interval '2 minutes');

drop policy if exists "events read own" on public.device_events;
create policy "events read own" on public.device_events for select to authenticated using (exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));

drop policy if exists "events insert own" on public.device_events;
create policy "events insert own" on public.device_events for insert to authenticated with check (user_id=(select auth.uid()) and exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));

drop policy if exists "pair requests own read" on public.pairing_requests;
create policy "pair requests own read" on public.pairing_requests for select to authenticated using (created_by=(select auth.uid()) and exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));

drop policy if exists "pair requests own insert" on public.pairing_requests;
create policy "pair requests own insert" on public.pairing_requests for insert to authenticated with check (created_by=(select auth.uid()) and expires_at<=now()+interval '15 minutes' and exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));

drop policy if exists "pair requests own update" on public.pairing_requests;
create policy "pair requests own update" on public.pairing_requests for update to authenticated using (created_by=(select auth.uid())) with check (created_by=(select auth.uid()));

drop policy if exists "paired devices own read" on public.paired_devices;
create policy "paired devices own read" on public.paired_devices for select to authenticated using (user_id=(select auth.uid()));

drop policy if exists "paired devices own insert" on public.paired_devices;
create policy "paired devices own insert" on public.paired_devices for insert to authenticated with check (user_id=(select auth.uid()) and exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));

drop policy if exists "paired devices own update" on public.paired_devices;
create policy "paired devices own update" on public.paired_devices for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

drop policy if exists "app allowlist read own" on public.application_allowlist;
create policy "app allowlist read own" on public.application_allowlist for select to authenticated using (exists(select 1 from public.devices d where d.id=device_id and d.owner_id=(select auth.uid())));

drop policy if exists "app allowlist admin write" on public.application_allowlist;
drop policy if exists "app allowlist admin insert" on public.application_allowlist;
drop policy if exists "app allowlist admin update" on public.application_allowlist;
drop policy if exists "app allowlist admin delete" on public.application_allowlist;
create policy "app allowlist admin insert" on public.application_allowlist for insert to authenticated with check (exists(select 1 from public.devices d join public.profiles p on p.id=(select auth.uid()) where d.id=device_id and d.owner_id=(select auth.uid()) and p.role='ADMIN'));
create policy "app allowlist admin update" on public.application_allowlist for update to authenticated using (exists(select 1 from public.devices d join public.profiles p on p.id=(select auth.uid()) where d.id=device_id and d.owner_id=(select auth.uid()) and p.role='ADMIN')) with check (exists(select 1 from public.devices d join public.profiles p on p.id=(select auth.uid()) where d.id=device_id and d.owner_id=(select auth.uid()) and p.role='ADMIN'));
create policy "app allowlist admin delete" on public.application_allowlist for delete to authenticated using (exists(select 1 from public.devices d join public.profiles p on p.id=(select auth.uid()) where d.id=device_id and d.owner_id=(select auth.uid()) and p.role='ADMIN'));
