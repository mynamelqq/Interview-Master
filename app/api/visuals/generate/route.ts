import { visualAdmin } from "@/lib/visual-auth";
import { imageBase64, imageGenerationBody, imageGenerationEndpoint, imageResultUrl, isDashscopeImageEndpoint, isPng } from "@/lib/visual-enhancement";
import { after } from "next/server";

export const maxDuration = 300;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export async function POST(request: Request) {
  const access = await visualAdmin(request);
  if (access.error) return access.error;
  const { db } = access;
  let body: { visualId?: string; prompt?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "请求格式错误" }, { status: 400 }); }
  if (!body?.visualId || !uuid.test(body.visualId) || body.prompt !== undefined && (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 3000)) {
    return Response.json({ error: "图片参数无效" }, { status: 400 });
  }
  const { data: visual, error: visualError } = await db.from("knowledge_point_visuals").select("id,topic_id,knowledge_point_id,visual_type,title,source_content,storage_path,generation_status").eq("id", body.visualId).single();
  if (visualError || !visual) return Response.json({ error: "找不到视觉建议" }, { status: 404 });
  if (visual.visual_type !== "image") return Response.json({ error: "这条建议不是图片" }, { status: 400 });
  if (!visual.knowledge_point_id) return Response.json({ error: "请先把图示重新关联到知识点" }, { status: 409 });
  if (visual.generation_status === "running") return Response.json({ error: "图片正在生成" }, { status: 409 });
  const key = process.env.AI_IMAGE_API_KEY;
  const base = process.env.AI_IMAGE_BASE_URL;
  const endpointUrl = process.env.AI_IMAGE_URL;
  const model = process.env.AI_IMAGE_MODEL || "gpt-image-2.5";
  if (!key || !base && !endpointUrl) return Response.json({ error: "请先配置 AI_IMAGE_API_KEY，以及 AI_IMAGE_URL 或 AI_IMAGE_BASE_URL" }, { status: 503 });
  const prompt = (body.prompt || visual.source_content).trim();
  if (!prompt) return Response.json({ error: "请先填写图片描述" }, { status: 400 });
  const { data: imageJob, error: jobError } = await db.from("visual_enhancement_jobs").insert({ user_id: access.userId, topic_id: visual.topic_id, visual_id: visual.id, scan_mode: "image", status: "running" }).select("id").single();
  if (jobError || !imageJob) return Response.json({ error: jobError?.message || "创建图片任务失败" }, { status: 503 });
  const { data: started, error: startError } = await db.from("knowledge_point_visuals").update({ generation_status: "running", generation_error: null, source_content: prompt, updated_at: new Date().toISOString() }).eq("id", visual.id).neq("generation_status", "running").select("id").maybeSingle();
  if (startError || !started) {
    await db.from("visual_enhancement_jobs").delete().eq("id", imageJob.id);
    return Response.json({ error: startError?.message || "图片正在生成" }, { status: startError ? 503 : 409 });
  }
  after(async () => {
    try {
      const endpoint = imageGenerationEndpoint(base || "", endpointUrl);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(imageGenerationBody(model, `${prompt}\n画面风格：手绘讲解风，浅色纸张底色，清晰技术关系与箭头，适量中文标签，易读且准确。`, isDashscopeImageEndpoint(endpoint))),
        signal: AbortSignal.timeout(240000),
      });
      const responseText = await response.text();
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(responseText) as Record<string, unknown>; } catch { /* 上游可能返回纯文本或 HTML。 */ }
      if (!response.ok) {
        const upstreamError = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : null;
        const detail = typeof upstreamError?.message === "string" ? upstreamError.message : typeof payload.message === "string" ? payload.message : typeof payload.code === "string" ? payload.code : responseText.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        throw new Error(`图片生成失败（${response.status}）：${detail.slice(0, 250) || "上游未返回错误详情"}`);
      }
      const encoded = imageBase64(payload);
      let data: Uint8Array;
      if (encoded) {
        if (encoded.length > 14 * 1024 * 1024) throw new Error("生成图片超过 10 MB");
        data = new Uint8Array(Buffer.from(encoded, "base64"));
      } else {
        const imageUrl = imageResultUrl(payload);
        const download = await fetch(imageUrl, { signal: AbortSignal.timeout(30000), redirect: "error" });
        if (!download.ok) throw new Error(`下载生成图片失败（${download.status}）`);
        data = new Uint8Array(await download.arrayBuffer());
      }
      if (!data.length || data.length > 10 * 1024 * 1024) throw new Error("生成图片为空或超过 10 MB");
      if (!isPng(data)) throw new Error("生成服务返回的文件不是 PNG 图片");
      const path = `${visual.knowledge_point_id}/${visual.id}-${crypto.randomUUID()}.png`;
      const { error: uploadError } = await db.storage.from("knowledge-visuals").upload(path, data, { contentType: "image/png", upsert: false });
      if (uploadError) throw new Error(`保存图片失败：${uploadError.message}`);
      const { error: saveError } = await db.from("knowledge_point_visuals").update({ storage_path: path, generation_status: "completed", generation_error: null, status: "approved", updated_at: new Date().toISOString() }).eq("id", visual.id);
      if (saveError) {
        await db.storage.from("knowledge-visuals").remove([path]);
        throw new Error(`保存图片记录失败：${saveError.message}`);
      }
      if (visual.storage_path) await db.storage.from("knowledge-visuals").remove([visual.storage_path]);
      await db.from("visual_enhancement_jobs").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", imageJob.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成图片失败";
      await db.from("knowledge_point_visuals").update({ generation_status: "failed", generation_error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", visual.id);
      await db.from("visual_enhancement_jobs").update({ status: "failed", error_message: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", imageJob.id);
    }
  });
  return Response.json({ jobId: imageJob.id, status: "running" }, { status: 202 });
}
