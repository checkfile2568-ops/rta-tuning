-- Enforce strict sequential multipart uploads at the database layer.
-- Part N+1 cannot be registered until Part N is upload_status='ready'.

create or replace function public.mms_enforce_media_part_sequence()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  expected_part integer;
begin
  if new.media_set_id is null or new.segment_index is null then
    return new;
  end if;

  select coalesce(max(segment_index), 0) + 1
    into expected_part
  from public.media_files
  where media_set_id = new.media_set_id
    and upload_status = 'ready'
    and purged_at is null;

  if new.segment_index <> expected_part then
    raise exception using
      errcode = 'P0001',
      message = format('PART_OUT_OF_ORDER: ต้องให้ Part %s อัปโหลดสำเร็จก่อน', expected_part);
  end if;

  if exists (
    select 1
    from public.media_files f
    where f.media_set_id = new.media_set_id
      and f.segment_index = new.segment_index
      and f.purged_at is null
      and f.upload_status in ('pending','uploading','ready')
  ) then
    raise exception using
      errcode = 'P0001',
      message = format('PART_ALREADY_ACTIVE: Part %s มีรายการที่กำลังอัปโหลดหรือพร้อมใช้แล้ว', new.segment_index);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mms_enforce_media_part_sequence on public.media_files;
create trigger trg_mms_enforce_media_part_sequence
before insert on public.media_files
for each row
when (new.media_set_id is not null)
execute function public.mms_enforce_media_part_sequence();

revoke all on function public.mms_enforce_media_part_sequence() from public, anon, authenticated;
