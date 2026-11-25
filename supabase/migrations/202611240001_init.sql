create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (user_id, name), unique (id, user_id)
);
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid,
  title text not null check (length(trim(title)) between 1 and 120),
  summary text,
  difficulty smallint not null default 2 check (difficulty between 1 and 5),
  importance smallint not null default 3 check (importance between 1 and 5),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  generation_status text not null default 'pending' check (generation_status in ('pending','running','completed','failed')),
  content_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (category_id, user_id) references public.categories(id, user_id) on delete set null (category_id),
  unique (id, user_id)
);
create table public.knowledge_points (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  parent_id uuid,
  title text not null check (length(trim(title)) between 1 and 255),
  sort_order integer not null default 0,
  point_type text not null default 'point' check (point_type in ('section','point')),
  content_md text,
  key_takeaways jsonb not null default '[]'::jsonb,
  example_md text,
  common_mistakes jsonb not null default '[]'::jsonb,
  interview_questions jsonb not null default '[]'::jsonb,
  estimated_minutes integer not null default 5,
  verification_status text not null default 'ai_draft' check (verification_status in ('ai_draft','checked','verified')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, topic_id),
  foreign key (parent_id, topic_id) references public.knowledge_points(id, topic_id) on delete cascade
);
create table public.topic_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid,
  input_title text not null,
  model_name text,
  prompt_version text,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  raw_output jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (topic_id, user_id) references public.topics(id, user_id) on delete cascade
);
create table public.user_point_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  knowledge_point_id uuid not null references public.knowledge_points(id) on delete cascade,
  mastery_level smallint not null default 0 check (mastery_level between 0 and 4),
  repetition_count integer not null default 0,
  interval_days integer not null default 0,
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, knowledge_point_id)
);
create table public.review_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  knowledge_point_id uuid not null references public.knowledge_points(id) on delete cascade,
  mastery_before smallint check (mastery_before between 0 and 4),
  mastery_after smallint check (mastery_after between 0 and 4),
  answer_duration integer,
  viewed_answer boolean not null default false,
  reviewed_at timestamptz not null default now(),
  next_review_at timestamptz
);
create table public.user_point_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  knowledge_point_id uuid not null references public.knowledge_points(id) on delete cascade,
  content_md text not null default '',
  updated_at timestamptz not null default now(),
  unique (user_id, knowledge_point_id)
);
create table public.topic_content_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null,
  version integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (topic_id, user_id) references public.topics(id, user_id) on delete cascade,
  unique (topic_id, version)
);

create index topics_user_created_idx on public.topics(user_id, created_at desc);
create index knowledge_points_topic_order_idx on public.knowledge_points(topic_id, sort_order);
create index progress_due_idx on public.user_point_progress(user_id, next_review_at);

create function public.owns_topic(p_topic_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.topics where id = p_topic_id and user_id = (select auth.uid()));
$$;
create function public.owns_point(p_point_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.knowledge_points p join public.topics t on t.id = p.topic_id where p.id = p_point_id and t.user_id = (select auth.uid()));
$$;
revoke all on function public.owns_topic(uuid) from public;
revoke all on function public.owns_point(uuid) from public;
grant execute on function public.owns_topic(uuid) to authenticated;
grant execute on function public.owns_point(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.topics enable row level security;
alter table public.knowledge_points enable row level security;
alter table public.topic_generation_jobs enable row level security;
alter table public.user_point_progress enable row level security;
alter table public.review_records enable row level security;
alter table public.user_point_notes enable row level security;
alter table public.topic_content_versions enable row level security;

create policy profiles_owner on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy categories_owner on public.categories for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy topics_owner on public.topics for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy points_owner on public.knowledge_points for all to authenticated using (public.owns_topic(topic_id)) with check (public.owns_topic(topic_id));
create policy jobs_owner on public.topic_generation_jobs for all to authenticated using (user_id = (select auth.uid()) and (topic_id is null or public.owns_topic(topic_id))) with check (user_id = (select auth.uid()) and (topic_id is null or public.owns_topic(topic_id)));
create policy progress_owner on public.user_point_progress for all to authenticated using (user_id = (select auth.uid()) and public.owns_point(knowledge_point_id)) with check (user_id = (select auth.uid()) and public.owns_point(knowledge_point_id));
create policy reviews_owner on public.review_records for all to authenticated using (user_id = (select auth.uid()) and public.owns_point(knowledge_point_id)) with check (user_id = (select auth.uid()) and public.owns_point(knowledge_point_id));
create policy notes_owner on public.user_point_notes for all to authenticated using (user_id = (select auth.uid()) and public.owns_point(knowledge_point_id)) with check (user_id = (select auth.uid()) and public.owns_point(knowledge_point_id));
create policy versions_owner on public.topic_content_versions for all to authenticated using (user_id = (select auth.uid()) and public.owns_topic(topic_id)) with check (user_id = (select auth.uid()) and public.owns_topic(topic_id));
