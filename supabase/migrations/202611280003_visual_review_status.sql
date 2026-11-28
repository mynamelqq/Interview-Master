alter table public.knowledge_point_visuals
  drop constraint knowledge_point_visuals_status_check;
alter table public.knowledge_point_visuals
  add constraint knowledge_point_visuals_status_check
  check (status in ('pending', 'approved', 'rejected'));
