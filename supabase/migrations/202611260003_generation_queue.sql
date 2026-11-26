-- Claim at most seven generation jobs across all administrators in one transaction.
create or replace function public.claim_generation_jobs(p_limit integer default 7)
returns table (id uuid, topic_id uuid, input_title text, model_group_id uuid, raw_output jsonb)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.is_admin) then
    raise exception 'Only administrators can start generation jobs';
  end if;
  perform pg_advisory_xact_lock(7291, 7);
  return query
  with available as (
    select j.id from public.topic_generation_jobs j
    where j.status = 'pending' and j.topic_id is not null
    order by j.created_at, j.id
    limit greatest(0, least(coalesce(p_limit, 7), 7 - (select count(*)::integer from public.topic_generation_jobs where status = 'running')))
    for update skip locked
  ), claimed as (
    update public.topic_generation_jobs j set status = 'running'
    from available where j.id = available.id
    returning j.id, j.topic_id, j.input_title, j.model_group_id, j.raw_output
  )
  select claimed.id, claimed.topic_id, claimed.input_title, claimed.model_group_id, claimed.raw_output from claimed;
end;
$$;

revoke all on function public.claim_generation_jobs(integer) from public;
grant execute on function public.claim_generation_jobs(integer) to authenticated;
