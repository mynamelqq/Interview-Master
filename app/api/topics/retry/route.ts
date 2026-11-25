import { after } from "next/server";
import { runGenerationJob } from "@/lib/generation-job";
import { getRequestClient } from "@/lib/supabase";

export const maxDuration = 300;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "请先登录" }, { status: 401 });
  let body: { jobId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求格式错误" }, { status: 400 }); }
  if (!body.jobId) return Response.json({ error: "缺少任务 ID" }, { status: 400 });
  if (!process.env.AI_API_KEY || !process.env.AI_MODEL) return Response.json({ error: "AI 服务尚未配置" }, { status: 503 });

  const db = getRequestClient(token);
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return Response.json({ error: "登录已过期，请重新登录" }, { status: 401 });
  const { data: job, error: jobError } = await db.from("topic_generation_jobs")
    .select("id,topic_id,input_title,status").eq("id", body.jobId).eq("user_id", auth.user.id).single();
  if (jobError || !job || !job.topic_id) return Response.json({ error: "找不到这项生成任务" }, { status: 404 });
  if (job.status !== "failed") return Response.json({ error: "只有失败的任务可以重试" }, { status: 409 });
  const { data: topic, error: topicError } = await db.from("topics")
    .select("id,title,status,generation_status").eq("id", job.topic_id).eq("user_id", auth.user.id).single();
  if (topicError || !topic) return Response.json({ error: "找不到对应的专题" }, { status: 404 });
  if (topic.status !== "draft" || topic.generation_status !== "failed") {
    return Response.json({ error: "这个专题当前不能重新生成" }, { status: 409 });
  }

  const { data: restarted, error: restartError } = await db.from("topic_generation_jobs").update({
    status: "pending", error_message: null, raw_output: null, finished_at: null,
    created_at: new Date().toISOString(), model_name: process.env.AI_MODEL, prompt_version: "v5",
  }).eq("id", job.id).eq("status", "failed").select("id").maybeSingle();
  if (restartError) return Response.json({ error: restartError.message }, { status: 500 });
  if (!restarted) return Response.json({ error: "任务已经开始重试" }, { status: 409 });

  const { error: clearError } = await db.from("knowledge_points").delete().eq("topic_id", topic.id);
  const { error: resetError } = clearError ? { error: clearError } : await db.from("topics").update({
    generation_status: "pending", summary: null,
  }).eq("id", topic.id);
  if (resetError) {
    await db.from("topic_generation_jobs").update({ status: "failed", error_message: resetError.message, finished_at: new Date().toISOString() }).eq("id", job.id);
    return Response.json({ error: "重试准备失败，请稍后再试" }, { status: 500 });
  }

  after(() => runGenerationJob({ token, topicId: topic.id, jobId: job.id, title: topic.title }));
  return Response.json({ topicId: topic.id, jobId: job.id, status: "pending" }, { status: 202 });
}
