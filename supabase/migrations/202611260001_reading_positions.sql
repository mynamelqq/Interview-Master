create table public.user_reading_positions (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  point_id uuid,
  progress integer not null default 0 check (progress between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create index user_reading_positions_recent_idx on public.user_reading_positions(user_id, updated_at desc);

alter table public.user_reading_positions enable row level security;
create policy reading_positions_owner on public.user_reading_positions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
