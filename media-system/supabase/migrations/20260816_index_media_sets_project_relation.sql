-- Cover the project relationship used by media-set queries and cleanup.
create index if not exists idx_mms_media_sets_project_id
  on public.mms_media_sets(project_id)
  where project_id is not null;
