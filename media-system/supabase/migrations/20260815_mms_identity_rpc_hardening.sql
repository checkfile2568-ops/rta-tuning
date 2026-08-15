-- Security hardening for MMs identity RPCs
revoke execute on function public.mms_sync_last_login_from_log() from public, anon, authenticated;
revoke execute on function public.mms_profile(text) from public, anon, authenticated;
revoke execute on function public.mms_profile_save_email(text,text) from public, anon, authenticated;
revoke execute on function public.mms_admin_users(text) from public, authenticated;
revoke execute on function public.mms_admin_save_identity(text,uuid,text,boolean,text) from public, authenticated;
grant execute on function public.mms_admin_users(text) to anon;
grant execute on function public.mms_admin_save_identity(text,uuid,text,boolean,text) to anon;
alter function public.mms_touch_video_job_updated_at() set search_path = public;