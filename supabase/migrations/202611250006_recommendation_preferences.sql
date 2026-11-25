create table public.user_recommendation_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  category_ids uuid[] not null default '{}',
  random_percent integer not null default 20 check (random_percent between 0 and 100),
  updated_at timestamptz not null default now()
);
alter table public.user_recommendation_preferences enable row level security;
create policy recommendation_preferences_owner on public.user_recommendation_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Update only recommendation controls, preserving concurrently recorded reading counts.
create function public.set_point_recommendation_control(p_point_id uuid, p_action text) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_action not in ('favorite', 'unfavorite', 'exclude', 'restore') or not public.owns_point(p_point_id) then
    raise exception 'Invalid recommendation control';
  end if;
  insert into public.user_point_activity (user_id, knowledge_point_id, is_favorite, excluded_until)
  values ((select auth.uid()), p_point_id, p_action = 'favorite',
    case when p_action = 'exclude' then now() + interval '7 days' else null end)
  on conflict (user_id, knowledge_point_id) do update set
    is_favorite = case when p_action in ('favorite', 'unfavorite') then p_action = 'favorite' else public.user_point_activity.is_favorite end,
    excluded_until = case when p_action = 'exclude' then now() + interval '7 days'
      when p_action = 'restore' then null else public.user_point_activity.excluded_until end,
    updated_at = now();
end;
$$;
revoke all on function public.set_point_recommendation_control(uuid, text) from public;
grant execute on function public.set_point_recommendation_control(uuid, text) to authenticated;
