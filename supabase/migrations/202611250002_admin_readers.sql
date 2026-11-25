-- Existing accounts are the initial administrators. New signups are readers.
alter table public.profiles add column is_admin boolean not null default false;
insert into public.profiles (id, is_admin)
select id, true from auth.users
on conflict (id) do update set is_admin = true;

create function public.create_reader_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, is_admin) values (new.id, false);
  return new;
end;
$$;
create trigger create_reader_profile_after_signup
after insert on auth.users for each row execute function public.create_reader_profile();

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select is_admin from public.profiles where id = (select auth.uid())), false);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create function public.can_read_topic(p_topic_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.topics
    where id = p_topic_id and (status = 'published' or user_id = (select auth.uid()))
  );
$$;
revoke all on function public.can_read_topic(uuid) from public;
grant execute on function public.can_read_topic(uuid) to authenticated;

-- Reading progress and notes belong to the reader even for a shared topic.
create or replace function public.owns_point(p_point_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.knowledge_points p
    join public.topics t on t.id = p.topic_id
    where p.id = p_point_id and (t.status = 'published' or t.user_id = (select auth.uid()))
  );
$$;

-- The previous all-operation policies would let users grant themselves admin
-- or create drafts directly, so replace them with operation-specific policies.
drop policy profiles_owner on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy topics_owner on public.topics;
create policy topics_read on public.topics for select to authenticated
  using (status = 'published' or user_id = (select auth.uid()));
create policy topics_admin_insert on public.topics for insert to authenticated
  with check (public.is_admin() and user_id = (select auth.uid()));
create policy topics_admin_update on public.topics for update to authenticated
  using (public.is_admin() and user_id = (select auth.uid()))
  with check (public.is_admin() and user_id = (select auth.uid()));
create policy topics_admin_delete on public.topics for delete to authenticated
  using (public.is_admin() and user_id = (select auth.uid()));

drop policy categories_owner on public.categories;
create policy categories_read on public.categories for select to authenticated
  using (user_id = (select auth.uid()) or exists (
    select 1 from public.topics where status = 'published' and category_id = categories.id
  ));
create policy categories_admin_insert on public.categories for insert to authenticated
  with check (public.is_admin() and user_id = (select auth.uid()));
create policy categories_admin_update on public.categories for update to authenticated
  using (public.is_admin() and user_id = (select auth.uid()))
  with check (public.is_admin() and user_id = (select auth.uid()));
create policy categories_admin_delete on public.categories for delete to authenticated
  using (public.is_admin() and user_id = (select auth.uid()));

drop policy points_owner on public.knowledge_points;
create policy points_read on public.knowledge_points for select to authenticated
  using (public.can_read_topic(topic_id));
create policy points_admin_insert on public.knowledge_points for insert to authenticated
  with check (public.is_admin() and public.owns_topic(topic_id));
create policy points_admin_update on public.knowledge_points for update to authenticated
  using (public.is_admin() and public.owns_topic(topic_id))
  with check (public.is_admin() and public.owns_topic(topic_id));
create policy points_admin_delete on public.knowledge_points for delete to authenticated
  using (public.is_admin() and public.owns_topic(topic_id));

drop policy jobs_owner on public.topic_generation_jobs;
create policy jobs_admin on public.topic_generation_jobs for all to authenticated
  using (public.is_admin() and user_id = (select auth.uid()) and (topic_id is null or public.owns_topic(topic_id)))
  with check (public.is_admin() and user_id = (select auth.uid()) and (topic_id is null or public.owns_topic(topic_id)));

drop policy versions_owner on public.topic_content_versions;
create policy versions_admin on public.topic_content_versions for all to authenticated
  using (public.is_admin() and user_id = (select auth.uid()) and public.owns_topic(topic_id))
  with check (public.is_admin() and user_id = (select auth.uid()) and public.owns_topic(topic_id));
