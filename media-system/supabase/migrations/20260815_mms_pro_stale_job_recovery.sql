create or replace function public.mms_recover_stale_processing_jobs()
returns integer
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare n integer;
begin
  update public.mms_processing_jobs j
  set status=case when attempts < max_attempts then 'queued' else 'failed' end,
      progress=case when attempts < max_attempts then 0 else progress end,
      worker_id=null,
      locked_at=null,
      next_retry_at=case when attempts < max_attempts then now()+interval '30 seconds' else null end,
      error_message=coalesce(error_message,'') || case when coalesce(error_message,'')='' then '' else E'\n' end || 'Recovered after stale/offline worker',
      completed_at=case when attempts < max_attempts then completed_at else coalesce(completed_at,now()) end,
      updated_at=now()
  where j.status='processing'
    and j.locked_at < now()-interval '10 minutes'
    and not exists (
      select 1 from public.mms_worker_nodes w
      where w.worker_id=j.worker_id
        and w.last_seen_at >= now()-interval '3 minutes'
        and w.status in ('online','busy')
    );
  get diagnostics n = row_count;
  return n;
end$$;
revoke all on function public.mms_recover_stale_processing_jobs() from public,anon,authenticated;
grant execute on function public.mms_recover_stale_processing_jobs() to service_role;

create or replace function public.mms_claim_processing_job(p_worker_id text,p_job_types text[])
returns jsonb
language plpgsql
security definer
set search_path=public,pg_catalog
as $$
declare r public.mms_processing_jobs;
begin
  perform public.mms_recover_stale_processing_jobs();
  with picked as (
    select id from public.mms_processing_jobs
    where status='queued'
      and job_type=any(p_job_types)
      and (next_retry_at is null or next_retry_at<=now())
    order by priority asc,created_at asc
    for update skip locked
    limit 1
  )
  update public.mms_processing_jobs j
  set status='processing',worker_id=p_worker_id,locked_at=now(),started_at=coalesce(started_at,now()),attempts=attempts+1,updated_at=now()
  from picked where j.id=picked.id returning j.* into r;
  if r.id is null then return null; end if;
  insert into public.mms_worker_nodes(worker_id,worker_type,status,current_job_id,last_seen_at)
  values(p_worker_id,'media','busy',r.id,now())
  on conflict(worker_id) do update set status='busy',current_job_id=excluded.current_job_id,last_seen_at=now();
  return to_jsonb(r);
end$$;
revoke all on function public.mms_claim_processing_job(text,text[]) from public,anon,authenticated;
grant execute on function public.mms_claim_processing_job(text,text[]) to service_role;
