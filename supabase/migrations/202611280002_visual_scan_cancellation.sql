alter table public.visual_enhancement_jobs
  drop constraint visual_enhancement_jobs_status_check;
alter table public.visual_enhancement_jobs
  add constraint visual_enhancement_jobs_status_check
  check (status in ('running', 'completed', 'failed', 'approved', 'cancelled'));
