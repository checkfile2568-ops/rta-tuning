create index if not exists idx_analysis_jobs_media_file_id on public.analysis_jobs(media_file_id);
create index if not exists idx_migration_import_log_job_id on public.migration_import_log(imported_job_id);
create index if not exists idx_mms_permissions_menu_id on public.mms_user_menu_permissions(menu_id);
