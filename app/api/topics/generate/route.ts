import { after } from "next/server";
import { runGenerationJob } from "@/lib/generation-job";
import { getRequestClient } from "@/lib/supabase";

export const maxDuration = 300;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "请先登录" }, { status: 401 });
  let body: { title?: string; titles?: string[]; difficulty?: number };
  try { body = await request.json(); } catch { return Response.json({ error: "请求格式错误" }, { status: 400 }); }
  if (!body || typeof body !== "object") return Response.json({ error: "请求格式错误" }, { status: 400 });
  const titles = body.titles ?? (body.title ? [body.title] : []);
  if (!Array.isArray(titles) || !titles.length || titles.length > 100 || titles.some(title => typeof title !== "string" || !title.trim() || title.trim().length > 120)) {
    return Response.json({ error: "每次可提交 1 至 100 个专题，标题长度须为 1 至 120 个字符" }, { status: 400 });
  }
  const db = getRequestClient(token);
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return Response.json({ error: "登录已过期，请重新登录" }, { status: 401 });
  const { data: profile, error: profileError } = await db.from("profiles").select("is_admin").eq("id", auth.user.id).single();
  if (profileError) return Response.json({ error: "无法验证管理员权限" }, { status: 503 });
  if (!profile.is_admin) return Response.json({ error: "只有管理员可以创建专题" }, { status: 403 });
  if (!process.env.AI_API_KEY || !process.env.AI_MODEL) return Response.json({ error: "AI 服务尚未配置" }, { status: 503 });
  const created: { title: string; topicId: string; jobId: string }[] = [];
  const failed: { title: string; error: string }[] = [];
  for (const input of titles) {
    const title = input.trim();
    const { data: topic, error: topicError } = await db.from("topics").insert({ user_id: auth.user.id, title, difficulty: body.difficulty || 2, status: "draft", generation_status: "pending" }).select("id").single();
    if (topicError || !topic) { failed.push({ title, error: topicError?.message || "创建专题失败" }); continue; }
    const { data: job, error: jobError } = await db.from("topic_generation_jobs").insert({ user_id: auth.user.id, topic_id: topic.id, input_title: title, model_name: process.env.AI_MODEL, prompt_version: "v6", status: "pending" }).select("id").single();
    if (jobError || !job) {
      await db.from("topics").delete().eq("id", topic.id);
      failed.push({ title, error: jobError?.message || "创建任务失败" });
      continue;
    }
    created.push({ title, topicId: topic.id, jobId: job.id });
    after(() => runGenerationJob({ token, topicId: topic.id, jobId: job.id, title }));
  }
  return Response.json({ created, failed, status: "pending", ...(titles.length === 1 && created[0] ? { topicId: created[0].topicId, jobId: created[0].jobId } : {}) }, { status: created.length ? 202 : 500 });
}
