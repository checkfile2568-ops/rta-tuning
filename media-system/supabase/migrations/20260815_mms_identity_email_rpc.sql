-- MMs identity/profile enhancement
-- Adds email identity metadata without exposing tables directly to the browser.

alter table public.mms_users add column if not exists email text;
alter table public.mms_users add column if not exists email_verified boolean not null default false;
alter table public.mms_users add column if not exists identity_provider text not null default 'local_pin';
alter table public.mms_users add column if not exists external_subject text;
alter table public.mms_users add column if not exists last_login_at timestamptz;

create unique index if not exists idx_mms_users_email_unique on public.mms_users (lower(email)) where email is not null and btrim(email) <> '';
create index if not exists idx_mms_users_external_subject on public.mms_users(identity_provider, external_subject) where external_subject is not null;

create or replace function public.mms_profile(p_session_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user public.mms_users%rowtype;
begin
  select u.* into v_user from public.mms_sessions s join public.mms_users u on u.id=s.user_id
  where s.token_hash=encode(digest(convert_to(coalesce(p_session_token,''),'UTF8'),'sha256'),'hex') and s.expires_at>now() and u.active=true limit 1;
  if v_user.id is null then return jsonb_build_object('ok',false,'error','SESSION_EXPIRED'); end if;
  return jsonb_build_object('ok',true,'user',jsonb_build_object('id',v_user.id,'display_name',v_user.display_name,'role',v_user.role,'email',v_user.email,'email_verified',v_user.email_verified,'identity_provider',v_user.identity_provider));
end;$$;

create or replace function public.mms_profile_save_email(p_session_token text,p_email text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_uid uuid; v_email text;
begin
  select u.id into v_uid from public.mms_sessions s join public.mms_users u on u.id=s.user_id
  where s.token_hash=encode(digest(convert_to(coalesce(p_session_token,''),'UTF8'),'sha256'),'hex') and s.expires_at>now() and u.active=true limit 1;
  if v_uid is null then return jsonb_build_object('ok',false,'error','SESSION_EXPIRED'); end if;
  v_email=nullif(lower(btrim(coalesce(p_email,''))), '');
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then return jsonb_build_object('ok',false,'error','INVALID_EMAIL'); end if;
  update public.mms_users set email=v_email,email_verified=false,identity_provider=case when v_email is null then 'local_pin' else 'email_pin' end,external_subject=null,updated_at=now() where id=v_uid;
  return jsonb_build_object('ok',true,'email',v_email,'email_verified',false);
exception when unique_violation then return jsonb_build_object('ok',false,'error','EMAIL_EXISTS');
end;$$;

create or replace function public.mms_admin_users(p_session_token text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text; v_rows jsonb;
begin
  select u.role into v_role from public.mms_sessions s join public.mms_users u on u.id=s.user_id
  where s.token_hash=encode(digest(convert_to(coalesce(p_session_token,''),'UTF8'),'sha256'),'hex') and s.expires_at>now() and u.active=true limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'error','SESSION_EXPIRED'); end if;
  if v_role<>'admin' then return jsonb_build_object('ok',false,'error','FORBIDDEN'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'display_name',display_name,'role',role,'active',active,'email',email,'email_verified',email_verified,'identity_provider',identity_provider,'created_at',created_at,'updated_at',updated_at,'last_login_at',last_login_at) order by display_name),'[]'::jsonb) into v_rows from public.mms_users;
  return jsonb_build_object('ok',true,'users',v_rows);
end;$$;

create or replace function public.mms_admin_save_identity(p_session_token text,p_user_id uuid,p_email text,p_email_verified boolean default false,p_identity_provider text default 'email_pin')
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_role text; v_email text; v_provider text;
begin
  select u.role into v_role from public.mms_sessions s join public.mms_users u on u.id=s.user_id
  where s.token_hash=encode(digest(convert_to(coalesce(p_session_token,''),'UTF8'),'sha256'),'hex') and s.expires_at>now() and u.active=true limit 1;
  if v_role is null then return jsonb_build_object('ok',false,'error','SESSION_EXPIRED'); end if;
  if v_role<>'admin' then return jsonb_build_object('ok',false,'error','FORBIDDEN'); end if;
  v_email=nullif(lower(btrim(coalesce(p_email,''))), '');
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then return jsonb_build_object('ok',false,'error','INVALID_EMAIL'); end if;
  v_provider=case when p_identity_provider in ('local_pin','email_pin','google') then p_identity_provider else case when v_email is null then 'local_pin' else 'email_pin' end end;
  update public.mms_users set email=v_email,email_verified=case when v_email is null then false else coalesce(p_email_verified,false) end,identity_provider=v_provider,external_subject=case when v_provider='google' then external_subject else null end,updated_at=now() where id=p_user_id;
  if not found then return jsonb_build_object('ok',false,'error','USER_NOT_FOUND'); end if;
  return jsonb_build_object('ok',true,'id',p_user_id);
exception when unique_violation then return jsonb_build_object('ok',false,'error','EMAIL_EXISTS');
end;$$;

grant execute on function public.mms_profile(text) to anon,authenticated;
grant execute on function public.mms_profile_save_email(text,text) to anon,authenticated;
grant execute on function public.mms_admin_users(text) to anon,authenticated;
grant execute on function public.mms_admin_save_identity(text,uuid,text,boolean,text) to anon,authenticated;

create or replace function public.mms_sync_last_login_from_log() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.success=true and new.user_id is not null then
    update public.mms_users set last_login_at=new.created_at,updated_at=greatest(updated_at,new.created_at) where id=new.user_id;
  end if;
  return new;
end;$$;

drop trigger if exists trg_mms_sync_last_login on public.mms_login_logs;
create trigger trg_mms_sync_last_login after insert on public.mms_login_logs for each row execute function public.mms_sync_last_login_from_log();