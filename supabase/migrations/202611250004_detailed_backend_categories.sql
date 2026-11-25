-- Add a third level for backend languages and message queue products.
create function public.seed_detailed_backend_categories(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  backend_id uuid;
  languages_id uuid;
  queues_id uuid;
  java_id uuid;
  python_id uuid;
  kafka_id uuid;
  rabbitmq_id uuid;
begin
  select id into backend_id from public.categories where user_id = p_user_id and name = '后端';
  if backend_id is null then return; end if;

  insert into public.categories (user_id, name, parent_id, sort_order)
  values (p_user_id, '编程语言', backend_id, 5) on conflict (user_id, name) do nothing;
  select id into languages_id from public.categories where user_id = p_user_id and name = '编程语言';
  update public.categories set parent_id = backend_id, sort_order = 5 where id = languages_id;

  insert into public.categories (user_id, name, parent_id, sort_order)
  values (p_user_id, 'Java', languages_id, 10),
         (p_user_id, 'Python', languages_id, 20),
         (p_user_id, 'Go', languages_id, 30)
  on conflict (user_id, name) do nothing;
  update public.categories set parent_id = languages_id,
    sort_order = case name when 'Java' then 10 when 'Python' then 20 else 30 end
  where user_id = p_user_id and name in ('Java', 'Python', 'Go');
  select id into java_id from public.categories where user_id = p_user_id and name = 'Java';
  select id into python_id from public.categories where user_id = p_user_id and name = 'Python';

  update public.topics set category_id = java_id
  where user_id = p_user_id and category_id in (
    select id from public.categories where user_id = p_user_id and parent_id = backend_id and name = 'Java 与 JVM'
  );
  update public.topics set category_id = python_id
  where user_id = p_user_id and category_id in (
    select id from public.categories where user_id = p_user_id and parent_id = backend_id and name = 'Python 后端'
  );
  update public.categories set parent_id = java_id
  where user_id = p_user_id and parent_id in (
    select id from public.categories where user_id = p_user_id and parent_id = backend_id and name = 'Java 与 JVM'
  );
  update public.categories set parent_id = python_id
  where user_id = p_user_id and parent_id in (
    select id from public.categories where user_id = p_user_id and parent_id = backend_id and name = 'Python 后端'
  );
  delete from public.categories
  where user_id = p_user_id and parent_id = backend_id and name in ('Java 与 JVM', 'Python 后端');

  select id into queues_id from public.categories
  where user_id = p_user_id and parent_id = backend_id and name = '消息队列';
  if queues_id is null then
    insert into public.categories (user_id, name, parent_id, sort_order)
    values (p_user_id, '消息队列', backend_id, 70)
    on conflict (user_id, name) do nothing;
    select id into queues_id from public.categories where user_id = p_user_id and name = '消息队列';
  end if;
  insert into public.categories (user_id, name, parent_id, sort_order)
  values (p_user_id, 'RabbitMQ', queues_id, 10),
         (p_user_id, 'Kafka', queues_id, 20)
  on conflict (user_id, name) do nothing;
  update public.categories set parent_id = queues_id,
    sort_order = case name when 'RabbitMQ' then 10 else 20 end
  where user_id = p_user_id and name in ('RabbitMQ', 'Kafka');
  select id into rabbitmq_id from public.categories where user_id = p_user_id and name = 'RabbitMQ';
  select id into kafka_id from public.categories where user_id = p_user_id and name = 'Kafka';

  -- Keep comparison topics under the shared message queue category.
  update public.topics set category_id = rabbitmq_id
  where user_id = p_user_id and category_id = queues_id
    and title ~* 'rabbitmq' and title !~* 'kafka';
  update public.topics set category_id = kafka_id
  where user_id = p_user_id and category_id = queues_id
    and title ~* 'kafka' and title !~* 'rabbitmq';
end;
$$;

revoke all on function public.seed_detailed_backend_categories(uuid) from public;

create or replace function public.seed_categories_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_default_categories(new.id);
  perform public.seed_detailed_backend_categories(new.id);
  return new;
end;
$$;

select public.seed_detailed_backend_categories(id) from auth.users;
