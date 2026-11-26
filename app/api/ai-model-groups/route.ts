import { getRequestClient } from "@/lib/supabase";
import { encryptApiKey, environmentModelConfig, validateBaseUrl, type AiModelGroup } from "@/lib/ai-model-groups";

async function adminClient(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: Response.json({ error: "请先登录" }, { status: 401 }) };
  const db = getRequestClient(token);
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return { error: Response.json({ error: "登录已过期，请重新登录" }, { status: 401 }) };
  const { data: profile, error: profileError } = await db.from("profiles").select("is_admin").eq("id", auth.user.id).single();
  if (profileError) return { error: Response.json({ error: "无法验证管理员权限" }, { status: 503 }) };
  if (!profile.is_admin) return { error: Response.json({ error: "只有管理员可以管理模型分组" }, { status: 403 }) };
  return { db, userId: auth.user.id };
}

export async function GET(request: Request) {
  const auth = await adminClient(request);
  if (auth.error) return auth.error;
  const { data, error } = await auth.db!.from("ai_model_groups").select("id,name,base_url,model").eq("user_id", auth.userId!).order("created_at");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const groups: AiModelGroup[] = (data || []).map(row => ({ id: row.id, name: row.name, baseUrl: row.base_url, model: row.model, source: "custom" }));
  const environment = environmentModelConfig();
  if (environment) groups.unshift({ id: "env", name: "默认环境配置", baseUrl: environment.baseUrl, model: environment.model, source: "environment" });
  return Response.json({ groups }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) { return saveGroup(request, false); }
export async function PATCH(request: Request) { return saveGroup(request, true); }

async function saveGroup(request: Request, editing: boolean) {
  const auth = await adminClient(request);
  if (auth.error) return auth.error;
  let body: { id?: string; name?: string; baseUrl?: string; model?: string; apiKey?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求格式错误" }, { status: 400 }); }
  if (!body || typeof body !== "object" || typeof body.name !== "string" || typeof body.baseUrl !== "string" || typeof body.model !== "string" || (editing && (!body.id || body.id === "env"))) return Response.json({ error: "模型分组信息不完整" }, { status: 400 });
  const name = body.name.trim();
  const model = body.model.trim();
  if (!name || name.length > 80 || !model || model.length > 120 || body.baseUrl.length > 2048) return Response.json({ error: "分组名、URL 或模型名长度无效" }, { status: 400 });
  let baseUrl: string;
  try { baseUrl = validateBaseUrl(body.baseUrl); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "模型 URL 无效" }, { status: 400 }); }
  const apiKey = body.apiKey?.trim() || "";
  if ((!editing && !apiKey) || apiKey.length > 500 || /[\r\n]/.test(apiKey)) return Response.json({ error: "请输入有效的 API Key" }, { status: 400 });
  let encryptedApiKey: string | undefined;
  try { if (apiKey) encryptedApiKey = encryptApiKey(apiKey); else if (!process.env.AI_CONFIG_ENCRYPTION_KEY) throw new Error("AI_CONFIG_ENCRYPTION_KEY 尚未配置"); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "密钥加密失败" }, { status: 503 }); }
  const values = { name, base_url: baseUrl, model, updated_at: new Date().toISOString(), ...(encryptedApiKey ? { encrypted_api_key: encryptedApiKey } : {}) };
  const result = editing
    ? await auth.db!.from("ai_model_groups").update(values).eq("id", body.id!).eq("user_id", auth.userId!).select("id,name,base_url,model").single()
    : await auth.db!.from("ai_model_groups").insert({ ...values, user_id: auth.userId! }).select("id,name,base_url,model").single();
  if (result.error) return Response.json({ error: result.error.code === "23505" ? "分组名称已存在" : result.error.message }, { status: result.error.code === "23505" ? 409 : 500 });
  return Response.json({ group: { id: result.data.id, name: result.data.name, baseUrl: result.data.base_url, model: result.data.model, source: "custom" } satisfies AiModelGroup }, { status: editing ? 200 : 201, headers: { "Cache-Control": "no-store" } });
}
