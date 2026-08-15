update public.mms_menus
set route_type='external',route_url='https://checkfile2568-ops.github.io/rta-tuning/admin-settings-v4.html',updated_at=now()
where id='admin';

revoke all on function public.mms_admin_users(text) from public,anon,authenticated;
revoke all on function public.mms_admin_save_identity(text,uuid,text,boolean,text) from public,anon,authenticated;
