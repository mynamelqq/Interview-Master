create table public.user_point_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  knowledge_point_id uuid not null references public.knowledge_points(id) on delete cascade,
  view_count integer not null default 0 check (view_count >= 0),
  reading_seconds integer not null default 0 check (reading_seconds >= 0),
  last_viewed_at timestamptz,
  card_seen_count integer not null default 0 check (card_seen_count >= 0),
  last_card_seen_at timestamptz,
  is_favorite boolean not null default false,
  excluded_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, knowledge_point_id)
);

create index activity_recent_idx on public.user_point_activity(user_id, last_viewed_at desc);
alter table public.user_point_activity enable row level security;
create policy activity_owner on public.user_point_activity for all to authenticated
  using (user_id = (select auth.uid()) and public.owns_point(knowledge_point_id))
  with check (user_id = (select auth.uid()) and public.owns_point(knowledge_point_id));

-- A batch is one network request; increments remain atomic across tabs and devices.
create function public.record_point_activity(events jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  event jsonb;
  point_id uuid;
  views integer;
  seconds integer;
  cards integer;
begin
  if jsonb_typeof(events) <> 'array' or jsonb_array_length(events) > 100 then
    raise exception 'Invalid activity batch';
  end if;
  for event in select value from jsonb_array_elements(events) as item(value) loop
    point_id := (event->>'knowledge_point_id')::uuid;
    views := coalesce((event->>'views')::integer, 0);
    seconds := coalesce((event->>'seconds')::integer, 0);
    cards := coalesce((event->>'cards')::integer, 0);
    if views not between 0 and 1 or seconds not between 0 and 3600 or cards not between 0 and 1
      or views + seconds + cards = 0 or not public.owns_point(point_id) then
      raise exception 'Invalid activity event';
    end if;
    insert into public.user_point_activity(user_id, knowledge_point_id, view_count, reading_seconds, last_viewed_at, card_seen_count, last_card_seen_at)
    values ((select auth.uid()), point_id, views, seconds,
      case when views > 0 then now() else null end, cards,
      case when cards > 0 then now() else null end)
    on conflict (user_id, knowledge_point_id) do update set
      view_count = public.user_point_activity.view_count + excluded.view_count,
      reading_seconds = public.user_point_activity.reading_seconds + excluded.reading_seconds,
      last_viewed_at = coalesce(excluded.last_viewed_at, public.user_point_activity.last_viewed_at),
      card_seen_count = public.user_point_activity.card_seen_count + excluded.card_seen_count,
      last_card_seen_at = coalesce(excluded.last_card_seen_at, public.user_point_activity.last_card_seen_at),
      updated_at = now();
  end loop;
end;
$$;
revoke all on function public.record_point_activity(jsonb) from public;
grant execute on function public.record_point_activity(jsonb) to authenticated;
