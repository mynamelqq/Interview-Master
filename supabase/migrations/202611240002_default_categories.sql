-- Default categories belong to each user, so the existing owner-only RLS applies.
alter table public.categories
  add column parent_id uuid,
  add column sort_order integer not null default 0;

alter table public.categories
  add constraint categories_parent_same_user
  foreign key (parent_id, user_id)
  references public.categories(id, user_id)
  on delete set null (parent_id);

create index categories_user_parent_order_idx
  on public.categories(user_id, parent_id, sort_order);

create or replace function public.seed_default_categories(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (user_id, name, parent_id, sort_order)
  values
    (p_user_id, '后端', null, 10),
    (p_user_id, '前端', null, 20),
    (p_user_id, 'AI', null, 30)
  on conflict (user_id, name) do nothing;

  insert into public.categories (user_id, name, parent_id, sort_order)
  select p_user_id, defaults.name, parent.id, defaults.sort_order
  from (values
    ('后端', 'Java 与 JVM', 10),
    ('后端', 'Spring 生态', 20),
    ('后端', 'Node.js', 30),
    ('后端', 'Python 后端', 40),
    ('后端', '数据库与 SQL', 50),
    ('后端', 'Redis 与缓存', 60),
    ('后端', '消息队列', 70),
    ('后端', '分布式系统', 80),
    ('后端', '系统设计', 90),
    ('后端', '操作系统与网络', 100),
    ('前端', 'HTML 与 CSS', 10),
    ('前端', 'JavaScript', 20),
    ('前端', 'TypeScript', 30),
    ('前端', 'React', 40),
    ('前端', 'Next.js', 50),
    ('前端', '浏览器原理', 60),
    ('前端', '前端工程化', 70),
    ('前端', '性能与可访问性', 80),
    ('AI', '机器学习基础', 10),
    ('AI', '深度学习', 20),
    ('AI', '大语言模型', 30),
    ('AI', '提示词工程', 40),
    ('AI', 'RAG 与知识库', 50),
    ('AI', 'Agent 与工具调用', 60),
    ('AI', '模型评测与安全', 70),
    ('AI', '推理与部署', 80)
  ) as defaults(parent_name, name, sort_order)
  join public.categories parent
    on parent.user_id = p_user_id
   and parent.name = defaults.parent_name
  on conflict (user_id, name) do nothing;
end;
$$;

revoke all on function public.seed_default_categories(uuid) from public;

create function public.seed_categories_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

create trigger seed_categories_after_signup
after insert on auth.users
for each row execute function public.seed_categories_for_new_user();

-- Backfill users created before this migration. The unique constraint makes reruns safe.
select public.seed_default_categories(id) from auth.users;
