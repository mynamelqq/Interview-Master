-- Visuals are independent of Markdown and remain reviewable before publication.
create table public.knowledge_point_visuals (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  knowledge_point_id uuid,
  point_title text not null,
  visual_type text not null check (visual_type in ('mermaid', 'svg', 'image', 'interactive', 'table')),
  title text not null,
  source_content text not null default '',
  storage_path text,
  caption text not null default '',
  rationale text not null default '',
  priority_score numeric(3, 1) check (priority_score between 0 and 5),
  replaces_mermaid boolean not null default false,
  sort_order integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  generation_status text not null default 'idle' check (generation_status in ('idle', 'running', 'failed', 'completed')),
  generation_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (knowledge_point_id, topic_id) references public.knowledge_points(id, topic_id) on delete set null (knowledge_point_id)
);
create index knowledge_point_visuals_point_idx on public.knowledge_point_visuals(knowledge_point_id, status, sort_order);
create index knowledge_point_visuals_topic_idx on public.knowledge_point_visuals(topic_id, status);

create table public.visual_enhancement_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete set null,
  visual_id uuid references public.knowledge_point_visuals(id) on delete set null,
  scan_mode text not null check (scan_mode in ('topic', 'library', 'mermaid', 'image')),
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'approved')),
  scanned_topics integer not null default 0,
  suggested_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visual_enhancement_jobs_user_idx on public.visual_enhancement_jobs(user_id, created_at desc);

alter table public.knowledge_point_visuals enable row level security;
alter table public.visual_enhancement_jobs enable row level security;
create policy visuals_read on public.knowledge_point_visuals for select to authenticated
  using (exists (select 1 from public.topics t where t.id = knowledge_point_visuals.topic_id
    and (t.status = 'published' and knowledge_point_visuals.status = 'approved' or public.is_admin())));
create policy visuals_admin_write on public.knowledge_point_visuals for all to authenticated
  using (public.is_admin() and exists (select 1 from public.topics t where t.id = knowledge_point_visuals.topic_id
    and (t.status = 'published' or t.user_id = (select auth.uid()))))
  with check (public.is_admin() and exists (select 1 from public.topics t where t.id = knowledge_point_visuals.topic_id
    and (t.status = 'published' or t.user_id = (select auth.uid()))));
create policy visual_jobs_admin on public.visual_enhancement_jobs for all to authenticated
  using (public.is_admin() and user_id = (select auth.uid()))
  with check (public.is_admin() and user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge-visuals', 'knowledge-visuals', true, 10485760, array['image/png'])
on conflict (id) do nothing;
create policy knowledge_visuals_public_read on storage.objects for select to public
  using (bucket_id = 'knowledge-visuals');
create policy knowledge_visuals_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'knowledge-visuals' and public.is_admin());
create policy knowledge_visuals_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'knowledge-visuals' and public.is_admin());
