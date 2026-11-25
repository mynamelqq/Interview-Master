import { after } from "next/server";
import { runGenerationJob } from "@/lib/generation-job";
import { getRequestClient } from "@/lib/supabase";

export const maxDuration = 300;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "请先登录" }, { status: 401 });
  let body: { topicId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求格式错误" }, { status: 400 }); }
  if (!body.topicId) return Response.json({ error: "缺少专题 ID" }, { status: 400 });

  const db = getRequestClient(token);
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return Response.json({ error: "登录已过期，请重新登录" }, { status: 401 });
  const { data: profile, error: profileError } = await db.from("profiles").select("is_admin").eq("id", auth.user.id).single();
  if (profileError) return Response.json({ error: "无法验证管理员权限" }, { status: 503 });
  if (!profile.is_admin) return Response.json({ error: "只有管理员可以重新生成专题" }, { status: 403 });
  if (!process.env.AI_API_KEY || !process.env.AI_MODEL) return Response.json({ error: "AI 服务尚未配置" }, { status: 503 });

  const { data: topic, error: topicError } = await db.from("topics")
    .select("id,title,status").eq("id", body.topicId).eq("user_id", auth.user.id).single();
  if (topicError || !topic || topic.status !== "published") return Response.json({ error: "找不到已发布的专题" }, { status: 404 });
  const { data: activeJobs, error: activeError } = await db.from("topic_generation_jobs")
    .select("id").eq("topic_id", topic.id).in("status", ["pending", "running"]).limit(1);
  if (activeError) return Response.json({ error: activeError.message }, { status: 500 });
  if (activeJobs?.length) return Response.json({ error: "这个专题正在生成中" }, { status: 409 });

  const { data: job, error: jobError } = await db.from("topic_generation_jobs").insert({
    user_id: auth.user.id, topic_id: topic.id, input_title: topic.title,
    model_name: process.env.AI_MODEL, prompt_version: "v6", status: "pending",
    raw_output: { regeneration: true },
  }).select("id").single();
  if (jobError || !job) return Response.json({ error: jobError?.message || "创建生成任务失败" }, { status: 500 });
  after(() => runGenerationJob({ token, topicId: topic.id, jobId: job.id, title: topic.title, replaceExisting: true }));
  return Response.json({ topicId: topic.id, jobId: job.id, status: "pending" }, { status: 202 });
}
