import { visualAdmin } from "@/lib/visual-auth";
import { extractMermaid, isWorthVisualizing, normalizeVisualSuggestions, shouldSkipVisualScan, visualPriority } from "@/lib/visual-enhancement";

export const maxDuration = 300;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

type ScanPoint = { id: string; title: string; content_md: string | null; parent_id: string | null };
type ExistingVisual = { knowledge_point_id: string | null; visual_type: string; title: string; caption: string; source_content: string; replaces_mermaid: boolean };

async function analyze(topic: string, chapter: string, points: ScanPoint[], existing: ExistingVisual[], mermaidOnly: boolean) {
  const key = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  const base = process.env.AI_BASE_URL;
  if (!key || !model || !base) throw new Error("请先配置 AI_BASE_URL、AI_MODEL 和 AI_API_KEY");
  const endpoint = `${base.replace(/\/$/, "")}/chat/completions`;
  const requestBody = JSON.stringify({ model, response_format: { type: "json_object" }, messages: [
    { role: "system", content: "你是技术面试知识图解编辑。按章节理解整体结构和知识点之间的关系，只提出能明显降低理解难度的图示。重点检查结构、执行流程、时序、状态变化和关键对比；已有图示只在缺少不同且必要的视角时补充。一个知识点本轮最多一条建议，纯定义或现有解释足够清楚时不建议。严格返回 JSON。" },
    { role: "user", content: `专题：${topic}；章节：${chapter}。模式：${mermaidOnly ? "只优化已有 Mermaid，只有原图存在明显理解障碍时提出替换建议，replaces_mermaid=true" : "分析章节总览、知识点机制和跨知识点关系；流程优先 mermaid，复杂结构可用 image，对比优先 table"}。已有图示仅提供描述，请勿假设看到了图片。不要重复已有图示的主题和信息，不要为增加数量而补图。分数 complexity、relationships、benefit 均为 0-5；仅当 benefit 至少 4 且优先级至少 3.5 时建议。没有合适内容返回 {"suggestions":[]}。返回 {"suggestions":[{"point_id":"原始 ID","visual_type":"mermaid|image|table","title":"标题","caption":"一行图注","rationale":"解决的具体理解困难及与已有图示的区别","prompt":"详细中文图像描述或 Mermaid 源码或 Markdown 表格","complexity":4,"relationships":4,"benefit":5,"replaces_mermaid":false}]}。章节总览图关联到最能代表该机制的知识点。图片描述应写清组件、层级、数据流、箭头含义、关键标签及边界条件；手绘讲解风、浅色纸张、字迹清晰，不添加正文没有的机制。知识点：${JSON.stringify(points.map(point => ({ id: point.id, title: point.title, content: (point.content_md || "").slice(0, 3000), mermaid: extractMermaid(point.content_md || "").slice(0, 2), existing_visuals: existing.filter(visual => visual.knowledge_point_id === point.id).map(visual => ({ type: visual.visual_type, title: visual.title, caption: visual.caption, description: visual.visual_type === "image" ? visual.source_content.slice(0, 700) : visual.source_content.slice(0, 300) })) })))}` },
  ] });
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: requestBody,
        signal: AbortSignal.timeout(180000),
      });
      break;
    } catch (error) {
      const cause = error instanceof Error ? error.cause as { code?: string; errors?: { code?: string }[] } | undefined : undefined;
      const host = new URL(endpoint).host;
      const code = cause?.code || cause?.errors?.[0]?.code;
      const detail = code ? `，错误代码 ${code}` : error instanceof Error && error.name === "TimeoutError" ? "，请求超时" : "";
      if (attempt === 1 || error instanceof Error && error.name === "TimeoutError") throw new Error(`视觉分析无法连接 AI 网关 ${host}${detail}，请检查网关连通性后重试`);
      await new Promise(resolve => setTimeout(resolve, 800));
    }
  }
  if (!response) throw new Error("视觉分析请求未能启动");
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
  const { data: points, error: pointsError } = await db.from("knowledge_points").select("id,title,content_md,parent_id").eq("topic_id", topic.id).order("sort_order");
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
    const { data: existing, error: existingError } = await db.from("knowledge_point_visuals").select("knowledge_point_id,visual_type,title,caption,source_content,replaces_mermaid").eq("topic_id", topic.id);
    if (existingError) throw new Error(`读取已有图示失败：${existingError.message}`);
    const visuals = (existing || []) as ExistingVisual[];
    const sections = (points || []).filter(point => !point.parent_id);
    const eligible = (points || []).filter(point => point.parent_id && (body.mode === "mermaid"
      ? extractMermaid(point.content_md || "").length > 0 && !visuals.some(visual => visual.knowledge_point_id === point.id && visual.replaces_mermaid)
      : visuals.filter(visual => visual.knowledge_point_id === point.id).length < 2));
    const groups = sections.map(section => ({ title: section.title, points: eligible.filter(point => point.parent_id === section.id) }));
    const ungrouped = eligible.filter(point => !sections.some(section => section.id === point.parent_id));
    if (ungrouped.length) groups.push({ title: "其他知识点", points: ungrouped });
    let inserted = 0;
    for (const group of groups) for (let start = 0; start < group.points.length; start += 8) {
      if (await cancelled()) return Response.json({ jobId, cancelled: true });
      const chunk = group.points.slice(start, start + 8);
      const suggestions = await analyze(topic.title, group.title, chunk, visuals, body.mode === "mermaid");
      if (await cancelled()) return Response.json({ jobId, cancelled: true });
      const proposed = new Set<string>();
      const rows = suggestions.filter(item => {
        if (!isWorthVisualizing(item) || proposed.has(item.point_id)) return false;
        proposed.add(item.point_id);
        return !visuals.some(visual => visual.knowledge_point_id === item.point_id && visual.visual_type === item.visual_type && visual.title.trim().toLowerCase() === item.title.trim().toLowerCase());
      }).map(item => ({
        topic_id: topic.id, knowledge_point_id: item.point_id, point_title: chunk.find(point => point.id === item.point_id)?.title || "知识点", visual_type: item.visual_type, title: item.title, caption: item.caption,
        rationale: item.rationale, source_content: item.prompt, priority_score: visualPriority(item.complexity, item.relationships, item.benefit),
        replaces_mermaid: body.mode === "mermaid" || item.replaces_mermaid, status: "pending",
      }));
      if (rows.length) {
        const { error } = await db.from("knowledge_point_visuals").insert(rows);
        if (error) throw new Error(`保存视觉建议失败：${error.message}`);
        inserted += rows.length;
        visuals.push(...rows.map(row => ({ knowledge_point_id: row.knowledge_point_id, visual_type: row.visual_type, title: row.title, caption: row.caption, source_content: row.source_content, replaces_mermaid: row.replaces_mermaid })));
      }
    }
    if (await cancelled()) return Response.json({ jobId, cancelled: true });
    const pointCount = (points || []).filter(point => point.parent_id).length;
    const { error: recordError } = await db.from("visual_topic_scans").upsert({ topic_id: topic.id, scan_mode: scanKind, scanned_at: new Date().toISOString(), point_count: pointCount, suggestion_count: inserted }, { onConflict: "topic_id,scan_mode" });
    if (recordError) throw new Error(`记录专题扫描状态失败：${recordError.message}`);
    if (!body.jobId) await db.from("visual_enhancement_jobs").update({ status: "completed", scanned_topics: 1, suggested_count: inserted, updated_at: new Date().toISOString() }).eq("id", jobId);
    else {
      const { data: job } = await db.from("visual_enhancement_jobs").select("scanned_topics,suggested_count").eq("id", jobId).single();
      await db.from("visual_enhancement_jobs").update({ scanned_topics: (job?.scanned_topics || 0) + 1, suggested_count: (job?.suggested_count || 0) + inserted, updated_at: new Date().toISOString() }).eq("id", jobId);
    }
    return Response.json({ jobId, scanned: pointCount, suggested: inserted });
  } catch (error) {
    if (await cancelled()) return Response.json({ jobId, cancelled: true });
    await db.from("visual_enhancement_jobs").update({ status: "failed", error_message: error instanceof Error ? error.message.slice(0, 500) : "扫描失败", updated_at: new Date().toISOString() }).eq("id", jobId);
    return Response.json({ error: error instanceof Error ? error.message : "扫描失败", jobId }, { status: 502 });
  }
}
