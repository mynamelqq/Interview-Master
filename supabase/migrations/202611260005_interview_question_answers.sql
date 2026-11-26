alter table public.knowledge_points
  add column interview_question_answers jsonb not null default '{}'::jsonb
  check (jsonb_typeof(interview_question_answers) = 'object');

create function public.save_interview_question_answer(p_point_id uuid, p_question text, p_answer text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception '只有管理员可以保存追问答案';
  end if;
  if length(trim(p_answer)) < 1 or char_length(trim(p_answer)) > 300 then
    raise exception '追问答案须为 1 至 300 字';
  end if;
  update public.knowledge_points
  set interview_question_answers = interview_question_answers || jsonb_build_object(p_question, trim(p_answer)),
      updated_at = now()
  where id = p_point_id
    and point_type = 'point'
    and interview_questions ? p_question;
  if not found then
    raise exception '追问不存在或没有编辑权限';
  end if;
end;
$$;
revoke all on function public.save_interview_question_answer(uuid, text, text) from public;
grant execute on function public.save_interview_question_answer(uuid, text, text) to authenticated;
