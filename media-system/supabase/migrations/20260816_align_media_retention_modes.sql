-- Align Media Library UI retention contract with database constraints.
-- Canonical values are exactly: auto_24h, immediate.

alter table public.mms_media_sets
  drop constraint if exists mms_media_sets_retention_mode_check;
alter table public.mms_media_sets
  add constraint mms_media_sets_retention_mode_check
  check (retention_mode in ('auto_24h','immediate'));

alter table public.media_files
  drop constraint if exists media_files_retention_mode_check;
alter table public.media_files
  add constraint media_files_retention_mode_check
  check (retention_mode is null or retention_mode in ('auto_24h','immediate'));
