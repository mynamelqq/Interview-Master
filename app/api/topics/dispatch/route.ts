import { after } from "next/server";
import { dispatchGenerationJobs } from "@/lib/generation-queue";
import { getRequestClient } from "@/lib/supabase";

export const maxDuration = 300;

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ error: "请先登录" }, { status: 401 });
  const db = getRequestClient(token);
  const { data: auth, error } = await db.auth.getUser(token);
  if (error || !auth.user) return Response.json({ error: "登录已过期，请重新登录" }, { status: 401 });
  const { data: profile } = await db.from("profiles").select("is_admin").eq("id", auth.user.id).single();
  if (!profile?.is_admin) return Response.json({ error: "只有管理员可以启动生成任务" }, { status: 403 });
  after(() => dispatchGenerationJobs(token));
  return Response.json({ status: "dispatching" }, { status: 202 });
}
