-- Administrators may remove published topics, including topics created by another admin.
-- Draft deletion remains limited to its owner by the existing policy.
create policy topics_admin_delete_published on public.topics for delete to authenticated
  using (public.is_admin() and status = 'published');

-- The delete route must see active jobs belonging to any administrator.
create policy topic_jobs_admin_read_all on public.topic_generation_jobs for select to authenticated
  using (public.is_admin());
create policy visual_jobs_admin_read_all on public.visual_enhancement_jobs for select to authenticated
  using (public.is_admin());

notify pgrst, 'reload schema';
