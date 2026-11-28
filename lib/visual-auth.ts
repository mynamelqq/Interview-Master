import { getRequestClient } from "@/lib/supabase";

export async function visualAdmin(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: Response.json({ error: "请先登录" }, { status: 401 }) };
  const db = getRequestClient(token);
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return { error: Response.json({ error: "登录已过期，请重新登录" }, { status: 401 }) };
  const { data: profile, error: profileError } = await db.from("profiles").select("is_admin").eq("id", auth.user.id).single();
  if (profileError) return { error: Response.json({ error: "无法验证管理员权限" }, { status: 503 }) };
  if (!profile?.is_admin) return { error: Response.json({ error: "只有管理员可以管理视觉内容" }, { status: 403 }) };
  return { db, userId: auth.user.id };
}
