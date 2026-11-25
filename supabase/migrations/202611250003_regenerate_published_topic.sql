-- Replace a published topic only after every new section has been generated.
-- A failed insert rolls back the snapshot, deletion, and replacement together.
create or replace function public.replace_published_topic_content(
  p_topic_id uuid,
  p_summary text,
  p_category_id uuid,
  p_sections jsonb
) returns void
language plpgsql
set search_path = ''
as $$
declare
  current_topic public.topics%rowtype;
  section_row record;
  point_row record;
  parent_id uuid;
begin
  select * into current_topic from public.topics where id = p_topic_id for update;
  if not found or current_topic.user_id <> (select auth.uid()) or not public.is_admin() or current_topic.status <> 'published' then
    raise exception '无法重新生成此专题';
  end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) = 0 then
    raise exception '新专题内容不能为空';
  end if;

  insert into public.topic_content_versions (user_id, topic_id, version, snapshot)
  select current_topic.user_id, p_topic_id, current_topic.content_version,
    jsonb_build_object(
      'topic', to_jsonb(current_topic),
      'points', coalesce(jsonb_agg(to_jsonb(point) order by point.sort_order, point.created_at) filter (where point.id is not null), '[]'::jsonb)
    )
  from public.knowledge_points point where point.topic_id = p_topic_id;

  delete from public.knowledge_points where topic_id = p_topic_id;
  for section_row in select value, ordinality from jsonb_array_elements(p_sections) with ordinality loop
    insert into public.knowledge_points (topic_id, title, sort_order, point_type, content_md, verification_status)
    values (p_topic_id, section_row.value->>'title', section_row.ordinality - 1, 'section', section_row.value->>'content_md', 'ai_draft')
    returning id into parent_id;
    for point_row in select value, ordinality from jsonb_array_elements(section_row.value->'points') with ordinality loop
      insert into public.knowledge_points (
        topic_id, parent_id, title, sort_order, point_type, content_md, example_md,
        key_takeaways, common_mistakes, interview_questions, verification_status
      ) values (
        p_topic_id, parent_id, point_row.value->>'title', point_row.ordinality - 1, 'point',
        point_row.value->>'content_md', point_row.value->>'example_md',
        coalesce(point_row.value->'key_takeaways', '[]'::jsonb),
        coalesce(point_row.value->'common_mistakes', '[]'::jsonb),
        coalesce(point_row.value->'interview_questions', '[]'::jsonb), 'ai_draft'
      );
    end loop;
  end loop;

  update public.topics set summary = p_summary, category_id = p_category_id,
    generation_status = 'completed', content_version = content_version + 1, updated_at = now()
  where id = p_topic_id;
end;
$$;

revoke all on function public.replace_published_topic_content(uuid, text, uuid, jsonb) from public;
grant execute on function public.replace_published_topic_content(uuid, text, uuid, jsonb) to authenticated;
