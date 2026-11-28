import { visualAdmin } from "@/lib/visual-auth";
import { extractMermaid, isWorthVisualizing, normalizeVisualSuggestions, shouldSkipVisualScan, visualPriority } from "@/lib/visual-enhancement";

export const maxDuration = 300;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

type ScanPoint = { id: string; title: string; content_md: string | null; parent_id: string | null };

async function analyze(topic: string, points: ScanPoint[], mermaidOnly: boolean) {
  const key = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  const base = process.env.AI_BASE_URL;
  if (!key || !model || !base) throw new Error("请先配置 AI_BASE_URL、AI_MODEL 和 AI_API_KEY");
  const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, messages: [
      { role: "system", content: "你是技术面试知识图解编辑。不要刻意增加视觉内容，也不要按知识点平均分配图。只有图示比现有文字或已有图表更能帮助用户理解机制、流程、结构、关系或关键对比时才提出建议。纯定义、简单结论、已有清晰解释的内容保持纯文字；没有合适建议时返回空 suggestions 数组。严格返回 JSON，不要输出 Markdown。" },
      { role: "user", content: `专题：${topic}。模式：${mermaidOnly ? "只检查已有 Mermaid。仅当重新绘制能明显提升理解时给出建议，replaces_mermaid=true；原图已经清楚时不建议替换" : "分析视觉需求。流程和时序优先 mermaid；抽象结构可用 image；对比优先 table"}。逐条比较现有内容和补图后的理解收益，不要为视觉丰富或装饰而提建议。分数 complexity、relationships、benefit 均为 0-5，优先级按 0.4C+0.3R+0.3E；仅当 benefit 至少 4 且优先级至少 3.5 时建议。可以对整个专题返回 {"suggestions":[]}。返回 {"suggestions":[{"point_id":"原始 ID","visual_type":"mermaid|image|table","title":"标题","caption":"一行图注","rationale":"图示具体解决的理解困难","prompt":"生成图像的中文提示词或 Mermaid 源码或 Markdown 表格","complexity":4,"relationships":4,"benefit":5,"replaces_mermaid":false}]}。图片提示词要准确描述技术关系，手绘讲解风、浅色纸张、清晰箭头、少量中文标签、无装饰性人物。不要编造正文没有的细节,字迹清晰易读。知识点：${JSON.stringify(points.map(point => ({ id: point.id, title: point.title, content: (point.content_md || "").slice(0, 1700), mermaid: extractMermaid(point.content_md || "").slice(0, 2) })))}` },
    ] }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`视觉分析请求失败（${response.status}）：${(await response.text()).slice(0, 300)}`);
  const payload = await response.json();
  const raw = payload.choices?.[0]?.message?.content;
  if (typeof raw !== "string") throw new Error("视觉分析模型未返回 JSON");
  return normalizeVisualSuggestions(JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")), new Set(points.map(point => point.id)));
}

export async function POST(request: Request) {
  const access = await visualAdmin(request);
  if (access.error) return access.error;
  const { db, userId } = access;
  let body: { topicId?: string; mode?: "topic" | "library" | "mermaid"; jobId?: string; force?: boolean };
  try { body = await request.json(); } catch { return Response.json({ error: "请求格式错误" }, { status: 400 }); }
  if (!body?.topicId || !uuid.test(body.topicId) || !["topic", "library", "mermaid"].includes(body.mode || "")) return Response.json({ error: "扫描参数无效" }, { status: 400 });
  const { data: topic, error: topicError } = await db.from("topics").select("id,title").eq("id", body.topicId).single();
  if (topicError || !topic) return Response.json({ error: "找不到专题" }, { status: 404 });
  const scanKind = body.mode === "mermaid" ? "mermaid" : "general";
  if (body.mode !== "topic") {
    const { data: previous, error: historyError } = await db.from("visual_topic_scans").select("topic_id").eq("topic_id", topic.id).eq("scan_mode", scanKind).maybeSingle();
    if (historyError) return Response.json({ error: historyError.message }, { status: 503 });
    if (shouldSkipVisualScan(body.mode || "topic", !!previous, body.force === true)) return Response.json({ skipped: true, reason: "这个专题已扫描，未重复调用模型" });
  }
  const { data: points, error: pointsError } = await db.from("knowledge_points").select("id,title,content_md,parent_id").eq("topic_id", topic.id).not("parent_id", "is", null).order("sort_order");
  if (pointsError) return Response.json({ error: pointsError.message }, { status: 503 });
  let jobId = body.jobId;
  if (jobId) {
    if (!uuid.test(jobId)) return Response.json({ error: "任务 ID 无效" }, { status: 400 });
    const { data: job } = await db.from("visual_enhancement_jobs").select("id,scan_mode,status").eq("id", jobId).eq("user_id", userId).maybeSingle();
    if (!job || job.scan_mode !== body.mode || job.status !== "running") return Response.json({ error: "扫描任务不可用" }, { status: 409 });
  } else {
    const { data: job, error: jobError } = await db.from("visual_enhancement_jobs").insert({ user_id: userId, topic_id: topic.id, scan_mode: body.mode, status: "running" }).select("id").single();
    if (jobError || !job) return Response.json({ error: jobError?.message || "创建扫描任务失败" }, { status: 503 });
    jobId = job.id;
  }
  async function cancelled() {
    if (!body.jobId) return false;
    const { data: job } = await db.from("visual_enhancement_jobs").select("status").eq("id", jobId).maybeSingle();
    return job?.status === "cancelled";
  }
  try {
    const { data: existing, error: existingError } = await db.from("knowledge_point_visuals").select("knowledge_point_id").in("knowledge_point_id", (points || []).map(point => point.id).length ? (points || []).map(point => point.id) : ["00000000-0000-0000-0000-000000000000"]);
    if (existingError) throw existingError;
    const occupied = new Set((existing || []).map(item => item.knowledge_point_id));
    const eligible = (points || []).filter(point => !occupied.has(point.id) && (body.mode !== "mermaid" || extractMermaid(point.content_md || "").length > 0));
    let inserted = 0;
    for (let start = 0; start < eligible.length; start += 15) {
      if (await cancelled()) return Response.json({ jobId, cancelled: true });
      const chunk = eligible.slice(start, start + 15);
      const suggestions = await analyze(topic.title, chunk, body.mode === "mermaid");
      if (await cancelled()) return Response.json({ jobId, cancelled: true });
      const rows = suggestions.filter(isWorthVisualizing).map(item => ({
        topic_id: topic.id, knowledge_point_id: item.point_id, point_title: chunk.find(point => point.id === item.point_id)?.title || "知识点", visual_type: item.visual_type, title: item.title, caption: item.caption,
        rationale: item.rationale, source_content: item.prompt, priority_score: visualPriority(item.complexity, item.relationships, item.benefit),
        replaces_mermaid: body.mode === "mermaid" || item.replaces_mermaid, status: "pending",
      }));
      if (rows.length) {
        const { error } = await db.from("knowledge_point_visuals").insert(rows);
        if (error) throw error;
        inserted += rows.length;
      }
    }
    if (await cancelled()) return Response.json({ jobId, cancelled: true });
    const { error: recordError } = await db.from("visual_topic_scans").upsert({ topic_id: topic.id, scan_mode: scanKind, scanned_at: new Date().toISOString(), point_count: points?.length || 0, suggestion_count: inserted }, { onConflict: "topic_id,scan_mode" });
    if (recordError) throw recordError;
    if (!body.jobId) await db.from("visual_enhancement_jobs").update({ status: "completed", scanned_topics: 1, suggested_count: inserted, updated_at: new Date().toISOString() }).eq("id", jobId);
    else {
      const { data: job } = await db.from("visual_enhancement_jobs").select("scanned_topics,suggested_count").eq("id", jobId).single();
      await db.from("visual_enhancement_jobs").update({ scanned_topics: (job?.scanned_topics || 0) + 1, suggested_count: (job?.suggested_count || 0) + inserted, updated_at: new Date().toISOString() }).eq("id", jobId);
    }
    return Response.json({ jobId, scanned: points?.length || 0, suggested: inserted });
  } catch (error) {
    if (await cancelled()) return Response.json({ jobId, cancelled: true });
    await db.from("visual_enhancement_jobs").update({ status: "failed", error_message: error instanceof Error ? error.message.slice(0, 500) : "扫描失败", updated_at: new Date().toISOString() }).eq("id", jobId);
    return Response.json({ error: error instanceof Error ? error.message : "扫描失败", jobId }, { status: 502 });
  }
}
