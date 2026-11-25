-- Combine existing knowledge-point notes into one note per chapter.
-- Keep each original knowledge-point title as a heading in the combined note.
begin;

with chapter_notes as (
  select note.user_id, point.parent_id as chapter_id,
    string_agg('### ' || point.title || E'\n\n' || note.content_md, E'\n\n' order by point.sort_order, note.updated_at) as content_md,
    max(note.updated_at) as updated_at
  from public.user_point_notes note
  join public.knowledge_points point on point.id = note.knowledge_point_id
  where point.parent_id is not null and btrim(note.content_md) <> ''
  group by note.user_id, point.parent_id
)
insert into public.user_point_notes (user_id, knowledge_point_id, content_md, updated_at)
select user_id, chapter_id, content_md, updated_at from chapter_notes
on conflict (user_id, knowledge_point_id) do update
set content_md = case
      when btrim(public.user_point_notes.content_md) = '' then excluded.content_md
      else public.user_point_notes.content_md || E'\n\n' || excluded.content_md
    end,
    updated_at = greatest(public.user_point_notes.updated_at, excluded.updated_at);

delete from public.user_point_notes note
using public.knowledge_points point
where point.id = note.knowledge_point_id and point.parent_id is not null;

commit;
