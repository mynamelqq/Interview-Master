-- The original visual jobs migration may have been applied before image jobs
-- gained a visual reference. Bring existing databases in line with the schema.
alter table public.visual_enhancement_jobs
  add column if not exists visual_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.visual_enhancement_jobs'::regclass
      and conname = 'visual_enhancement_jobs_visual_id_fkey'
  ) then
    alter table public.visual_enhancement_jobs
      add constraint visual_enhancement_jobs_visual_id_fkey
      foreign key (visual_id) references public.knowledge_point_visuals(id) on delete set null;
  end if;
end $$;

alter table public.visual_enhancement_jobs
  drop constraint if exists visual_enhancement_jobs_scan_mode_check;
alter table public.visual_enhancement_jobs
  add constraint visual_enhancement_jobs_scan_mode_check
  check (scan_mode in ('topic', 'library', 'mermaid', 'image'));

notify pgrst, 'reload schema';
