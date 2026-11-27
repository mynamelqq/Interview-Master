import { after } from "next/server";
import { dispatchGenerationJobs } from "@/lib/generation-queue";
import { getRequestClient } from "@/lib/supabase";
import { resolveModelConfig } from "@/lib/ai-model-groups";

export const maxDuration = 300;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "请先登录" }, { status: 401 });
  let body: { title?: string; titles?: string[]; difficulty?: number; groupId?: string };
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
  if (body.groupId !== undefined && typeof body.groupId !== "string") return Response.json({ error: "模型分组无效" }, { status: 400 });
  let config;
  try { config = await resolveModelConfig(db, auth.user.id, body.groupId); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "模型分组不可用" }, { status: 400 }); }
  const { error: queueError } = await db.rpc("claim_generation_jobs", { p_limit: 0 });
  if (queueError) return Response.json({ error: `生成队列不可用（${queueError.code}）：${queueError.message}` }, { status: 503 });
  const normalizedTitles = titles.map(title => title.trim());
  const { data: existingTopics, error: duplicateCheckError } = await db.from("topics")
    .select("title").neq("status", "archived").neq("generation_status", "failed").in("title", [...new Set(normalizedTitles)]);
  if (duplicateCheckError) return Response.json({ error: "检查同名专题失败，请稍后重试" }, { status: 503 });
  const existingTitles = new Set((existingTopics || []).map(topic => topic.title));
  const queuedTitles = new Set<string>();
  const created: { title: string; topicId: string; jobId: string }[] = [];
  const skipped: { title: string; reason: string }[] = [];
  const failed: { title: string; error: string; jobId?: string }[] = [];
  for (const title of normalizedTitles) {
    if (existingTitles.has(title) || queuedTitles.has(title)) {
      skipped.push({ title, reason: existingTitles.has(title) ? "已有同名专题" : "本次提交已有同名专题" });
      continue;
    }
    const { data: topic, error: topicError } = await db.from("topics").insert({ user_id: auth.user.id, title, difficulty: body.difficulty || 2, status: "draft", generation_status: "pending" }).select("id").single();
    if (topicError || !topic) { failed.push({ title, error: topicError?.message || "创建专题失败" }); continue; }
    const { data: job, error: jobError } = await db.from("topic_generation_jobs").insert({ user_id: auth.user.id, topic_id: topic.id, input_title: title, model_name: config.model, model_group_id: body.groupId && body.groupId !== "env" ? body.groupId : null, prompt_version: "v6", status: "pending" }).select("id").single();
    if (jobError || !job) {
      await db.from("topics").delete().eq("id", topic.id);
      failed.push({ title, error: jobError?.message || "创建任务失败" });
      continue;
    }
    queuedTitles.add(title);
    created.push({ title, topicId: topic.id, jobId: job.id });
  }
  if (created.length) after(() => dispatchGenerationJobs(token));
  return Response.json({ created, skipped, failed, status: created.length ? "pending" : skipped.length && !failed.length ? "skipped" : "failed", ...(titles.length === 1 && created[0] ? { topicId: created[0].topicId, jobId: created[0].jobId } : {}) }, { status: created.length ? 202 : skipped.length && !failed.length ? 200 : 500 });
}
