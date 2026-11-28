import { visualAdmin } from "@/lib/visual-auth";

export const maxDuration = 60;

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export async function POST(request: Request) {
  const access = await visualAdmin(request);
  if (access.error) return access.error;
  const { db } = access;
  let body: { topicId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求格式错误" }, { status: 400 }); }
  if (!body?.topicId || !uuid.test(body.topicId)) return Response.json({ error: "专题 ID 无效" }, { status: 400 });

  const { data: topic, error: topicError } = await db.from("topics").select("id,status").eq("id", body.topicId).maybeSingle();
  if (topicError) return Response.json({ error: topicError.message }, { status: 503 });
  if (!topic || topic.status !== "published") return Response.json({ error: "找不到已发布专题" }, { status: 404 });

  const [generationJobs, visualJobs] = await Promise.all([
    db.from("topic_generation_jobs").select("id").eq("topic_id", topic.id).in("status", ["pending", "running"]).limit(1),
    db.from("visual_enhancement_jobs").select("id").eq("topic_id", topic.id).eq("status", "running").limit(1),
  ]);
  if (generationJobs.error || visualJobs.error) return Response.json({ error: generationJobs.error?.message || visualJobs.error?.message }, { status: 503 });
  if (generationJobs.data?.length || visualJobs.data?.length) return Response.json({ error: "专题仍有生成任务进行中，请等待完成后再删除" }, { status: 409 });

  const storagePaths = new Set<string>();
  for (let start = 0; ; start += 500) {
    const { data, error } = await db.from("knowledge_point_visuals").select("id,storage_path").eq("topic_id", topic.id).order("id").range(start, start + 499);
    if (error) return Response.json({ error: error.message }, { status: 503 });
    for (const visual of data || []) if (visual.storage_path) storagePaths.add(visual.storage_path);
    if (!data || data.length < 500) break;
  }

  const { data: deleted, error: deleteError } = await db.from("topics").delete().eq("id", topic.id).eq("status", "published").select("id").maybeSingle();
  if (deleteError) return Response.json({ error: deleteError.message }, { status: 503 });
  if (!deleted) return Response.json({ error: "专题未能删除，请刷新后重试；确认已执行管理员删除策略迁移" }, { status: 403 });

  let cleanupWarning: string | undefined;
  const paths = [...storagePaths];
  for (let start = 0; start < paths.length; start += 100) {
    const { error } = await db.storage.from("knowledge-visuals").remove(paths.slice(start, start + 100));
    if (error) cleanupWarning = `专题已删除，但部分图片文件清理失败：${error.message}`;
  }
  return Response.json({ deleted: true, cleanupWarning });
}
