import { generateInterviewQuestionAnswer } from "@/lib/ai";
import { followupModelConfig } from "@/lib/ai-model-groups";
import { getRequestClient } from "@/lib/supabase";

export const maxDuration = 300;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "请先登录" }, { status: 401 });
  let body: { pointId?: string; question?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求格式错误" }, { status: 400 }); }
  if (!body || typeof body.pointId !== "string" || !/^[\da-f-]{36}$/i.test(body.pointId) || typeof body.question !== "string" || !body.question.trim() || body.question.length > 1000) {
    return Response.json({ error: "追问参数无效" }, { status: 400 });
  }
  const db = getRequestClient(token);
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return Response.json({ error: "登录已过期，请重新登录" }, { status: 401 });
  const { data: profile, error: profileError } = await db.from("profiles").select("is_admin").eq("id", auth.user.id).single();
  if (profileError) return Response.json({ error: "无法验证管理员权限" }, { status: 503 });
  if (!profile?.is_admin) return Response.json({ error: "只有管理员可以生成追问答案" }, { status: 403 });
  const { data: point, error: pointError } = await db.from("knowledge_points").select("id,topic_id,title,content_md,interview_questions,interview_question_answers").eq("id", body.pointId).single();
  if (pointError || !point || !Array.isArray(point.interview_questions) || !point.interview_questions.includes(body.question)) {
    return Response.json({ error: "找不到这条面试追问" }, { status: 404 });
  }
  const existing = point.interview_question_answers?.[body.question];
  if (typeof existing === "string" && existing.trim()) return Response.json({ answer: existing });
  const { data: topic, error: topicError } = await db.from("topics").select("title").eq("id", point.topic_id).single();
  if (topicError || !topic) return Response.json({ error: "找不到专题" }, { status: 404 });
  let config;
  try { config = followupModelConfig(); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "追问模型配置不可用" }, { status: 503 }); }
  try {
    const answer = await generateInterviewQuestionAnswer(topic.title, point.title, body.question, point.content_md || "", config);
    const { error: saveError } = await db.rpc("save_interview_question_answer", { p_point_id: point.id, p_question: body.question, p_answer: answer });
    if (saveError) return Response.json({ error: `答案保存失败：${saveError.message}` }, { status: 503 });
    return Response.json({ answer });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return Response.json({ error: "追问答案生成超时，请重试" }, { status: 504 });
    return Response.json({ error: error instanceof Error ? error.message : "生成追问答案失败" }, { status: 502 });
  }
}
