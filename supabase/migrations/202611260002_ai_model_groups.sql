create table public.ai_model_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  base_url text not null,
  model text not null,
  encrypted_api_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create index ai_model_groups_user_idx on public.ai_model_groups(user_id, created_at);
alter table public.ai_model_groups enable row level security;
create policy ai_model_groups_admin on public.ai_model_groups for all to authenticated
  using (user_id = (select auth.uid()) and public.is_admin())
  with check (user_id = (select auth.uid()) and public.is_admin());

alter table public.topic_generation_jobs
  add column model_group_id uuid references public.ai_model_groups(id) on delete set null;
