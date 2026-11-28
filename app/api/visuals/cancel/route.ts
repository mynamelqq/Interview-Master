import { visualAdmin } from "@/lib/visual-auth";

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export async function POST(request: Request) {
  const access = await visualAdmin(request);
  if (access.error) return access.error;
  let body: { jobId?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求格式错误" }, { status: 400 }); }
  if (!body?.jobId || !uuid.test(body.jobId)) return Response.json({ error: "任务 ID 无效" }, { status: 400 });
  const { data, error } = await access.db.from("visual_enhancement_jobs")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", body.jobId).eq("user_id", access.userId).eq("status", "running")
    .in("scan_mode", ["library", "mermaid"]).select("id");
  if (error) return Response.json({ error: error.message }, { status: 503 });
  if (!data?.length) return Response.json({ error: "任务已结束或不可停止" }, { status: 409 });
  return Response.json({ cancelled: true });
}
