-- Record completed scans even when the model finds no useful visual.
create table public.visual_topic_scans (
  topic_id uuid not null references public.topics(id) on delete cascade,
  scan_mode text not null check (scan_mode in ('general', 'mermaid')),
  scanned_at timestamptz not null default now(),
  point_count integer not null default 0,
  suggestion_count integer not null default 0,
  primary key (topic_id, scan_mode)
);

alter table public.visual_topic_scans enable row level security;
create policy visual_topic_scans_admin on public.visual_topic_scans for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Older single-topic jobs identify their topic. Older batch jobs do not.
insert into public.visual_topic_scans (topic_id, scan_mode, scanned_at, suggestion_count)
select distinct on (topic_id) topic_id, 'general', updated_at, suggested_count
from public.visual_enhancement_jobs
where topic_id is not null and scan_mode = 'topic' and status = 'completed'
order by topic_id, updated_at desc
on conflict (topic_id, scan_mode) do nothing;

notify pgrst, 'reload schema';
