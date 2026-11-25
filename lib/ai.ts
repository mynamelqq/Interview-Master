import { normalizeMarkdown } from "./markdown.ts";

export type Outline = { summary: string; answer_focus: string; category?: string; sections: { title: string; points: string[] }[] };
type PointContent = { title: string; recall_prompt: string; content_md: string; example_md: string; key_takeaways: string[]; common_mistakes: string[]; interview_questions: string[] };
type JsonObject = Record<string, unknown>;

export class AiOutputError extends Error {
  readonly stage: string;
  readonly rawOutput: unknown;
  constructor(message: string, stage: string, rawOutput: unknown) {
    super(message);
    this.name = "AiOutputError";
    this.stage = stage;
    this.rawOutput = rawOutput;
  }
}

export class AiRequestError extends Error {
  readonly stage: string;
  readonly status: number;
  readonly requestId: string | null;
  constructor(message: string, stage: string, status: number, requestId: string | null) {
    super(message);
    this.name = "AiRequestError";
    this.stage = stage;
    this.status = status;
    this.requestId = requestId;
  }
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function first(value: JsonObject, keys: string[]): unknown {
  for (const key of keys) if (value[key] !== undefined && value[key] !== null) return value[key];
  return undefined;
}

function nonemptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function named(value: unknown): string | null {
  if (typeof value === "string") return nonemptyString(value);
  const entry = object(value);
  return entry ? nonemptyString(first(entry, ["title", "name", "section_title", "sectionTitle", "chapter_title", "point_title", "标题", "名称"])) : null;
}

async function completion(system: string, user: string, stage: string): Promise<{ data: unknown; raw: string }> {
  const key = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  const base = process.env.AI_BASE_URL || "https://api.openai.com/v1";
  if (!key || !model) throw new Error("AI_API_KEY 或 AI_MODEL 尚未配置");
  const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(2000000),
  });
  if (!response.ok) {
    const body = await response.text();
    let detail = "";
    try {
      const parsed = object(JSON.parse(body));
      const error = parsed && object(parsed.error);
      detail = nonemptyString(error && first(error, ["message", "detail"]))
        || nonemptyString(parsed && first(parsed, ["message", "detail"])) || "";
    } catch {
      // Some gateways return a plain-text error instead of JSON.
      if (body && !/<[a-z][\s\S]*>/i.test(body)) detail = body;
    }
    if (response.status === 403 && (/cloudflare/i.test(body) || response.headers.has("cf-ray"))) {
      detail = "上游网关的 Cloudflare 防护拦截了服务器请求；请检查网关访问策略或更换可供服务器调用的 AI_BASE_URL";
    }
    detail = detail.replace(/\s+/g, " ").slice(0, 500);
    const requestId = response.headers.get("x-request-id") || response.headers.get("x-trace-id");
    const phase = stage === "outline_validation_failed" ? "目录" : "章节";
    const message = `AI ${phase}请求失败（${response.status}）${detail ? `：${detail}` : ""}${requestId ? `；请求 ID：${requestId}` : ""}`;
    throw new AiRequestError(message, stage.replace(/_validation_failed$/, "_request_failed"), response.status, requestId);
  }
  const result = await response.json();
  const raw = result.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new AiOutputError("AI 未返回内容", stage, result);
  try {
    return { data: JSON.parse(raw), raw };
  } catch {
    try { return { data: JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")), raw }; }
    catch { throw new AiOutputError("AI 返回的内容不是有效 JSON", stage, raw); }
  }
}

export function normalizeOutline(data: unknown): Outline {
  const root = object(data);
  if (!root) throw new AiOutputError("目录根节点必须是 JSON 对象", "outline_validation_failed", data);
  const topic = object(root.topic);
  const summary = nonemptyString(first(root, ["summary", "description", "overview", "摘要", "简介"]))
    || (topic && nonemptyString(first(topic, ["summary", "description", "overview", "摘要", "简介"]))) || "";
  const answerFocus = nonemptyString(first(root, ["answer_focus", "answerFocus", "回答重点"]))
    || (topic && nonemptyString(first(topic, ["answer_focus", "answerFocus", "回答重点"])));
  if (!answerFocus) throw new AiOutputError("专题缺少整体回答重点 answer_focus", "outline_validation_failed", data);
  const category = nonemptyString(first(root, ["category", "category_path", "分类"]))
    || (topic && nonemptyString(first(topic, ["category", "category_path", "分类"]))) || undefined;
  const wrapper = object(root.outline);
  const rawSections = first(root, ["sections", "chapters", "目录", "章节"])
    ?? (Array.isArray(root.outline) ? root.outline : undefined)
    ?? (wrapper && first(wrapper, ["sections", "chapters", "目录", "章节"]))
    ?? (topic && first(topic, ["sections", "chapters", "目录", "章节"]));
  if (!Array.isArray(rawSections) || rawSections.length === 0) {
    throw new AiOutputError("目录缺少非空的 sections/chapters 章节数组", "outline_validation_failed", data);
  }
  const sections = rawSections.map((rawSection, sectionIndex) => {
    const section = object(rawSection);
    const title = named(rawSection);
    if (!title) throw new AiOutputError(`目录第 ${sectionIndex + 1} 章缺少标题`, "outline_validation_failed", data);
    const rawPoints = section ? first(section, ["points", "knowledge_points", "knowledgePoints", "topics", "items", "知识点"]) : undefined;
    const pointList = rawPoints === undefined ? [title] : rawPoints;
    if (!Array.isArray(pointList) || pointList.length === 0) {
      throw new AiOutputError(`目录第 ${sectionIndex + 1} 章「${title}」缺少知识点数组`, "outline_validation_failed", data);
    }
    const points = pointList.map((point, pointIndex) => {
      const pointTitle = named(point);
      if (!pointTitle) throw new AiOutputError(`目录第 ${sectionIndex + 1} 章第 ${pointIndex + 1} 个知识点缺少标题`, "outline_validation_failed", data);
      return pointTitle;
    });
    return { title, points };
  });
  return { summary, answer_focus: answerFocus, ...(category ? { category } : {}), sections };
}

export async function generateOutline(title: string, categories: string[] = []): Promise<Outline> {
  const categoryInstruction = categories.length
    ? `请从以下已有分类中选择最合适的一项，category 必须逐字返回完整分类路径：${categories.map(category => `「${category}」`).join("、")}。没有合适分类时返回空字符串。`
    : "当前没有可用分类，category 返回空字符串。";
  const { data, raw } = await completion(
    "你是严谨的技术面试知识编辑。只输出一个 JSON 对象，不要输出 Markdown 代码块，不要编造来源。",
    `为「${title}」设计技术面试知识专题。请严格返回此结构：{"category":"已有分类完整路径或空字符串","summary":"专题摘要","answer_focus":"针对整个专题面试问题的直接回答","sections":[{"title":"章节标题","points":["知识点标题"]}]}。answer_focus 必须非空，只针对专题「${title}」生成一份，不针对章节或知识点分别生成。模拟求职者面对面试官的口头回答：先给核心结论，再用一两句点出最关键的机制、适用条件或取舍，简洁、准确、一语中的；不要写回答建议、提纲或罗列章节。${categoryInstruction}sections 和 points 必须是非空数组；points 的元素必须是字符串。建议 3–4 章、每章 1–3 个知识点，但应以完整覆盖主题为准。覆盖核心原理、实践和常见追问。`,
    "outline_validation_failed",
  );
  try { return normalizeOutline(data); }
  catch (error) {
    if (error instanceof AiOutputError) throw new AiOutputError(error.message, error.stage, raw);
    throw error;
  }
}

export async function generateSection(topic: string, section: { title: string; points: string[] }): Promise<PointContent[]> {
  const { data, raw } = await completion(
    "你是严谨的技术面试知识编辑。只输出一个 JSON 对象。准确说明版本限制和不确定之处，不要编造来源。",
    `专题：${topic}。章节：${section.title}。请逐一讲解这些知识点：${section.points.join("、")}。严格返回 {"points":[{"title":"知识点标题","recall_prompt":"查看答案前的核心问题或回忆提示，要求学习者解释关键机制、原因或取舍","content_md":"完整参考内容，使用适合此知识点的 Markdown 小标题和短段落；必要时先写核心结论，再展开原理","example_md":"代码或配置示例，确有帮助时填写，否则为空字符串","key_takeaways":["适合此知识点时提供补充结论，否则为空数组"],"common_mistakes":["适合此知识点时提供易错点，否则为空数组"],"interview_questions":["适合此知识点时提供面试追问，否则为空数组"]}]}。每个知识点必须有 title、非空 recall_prompt 和非空 content_md；其余模块按知识点特点选用，不要机械套用同一结构。整体面试回答重点已经在专题级生成，这里不要再生成 answer_focus。JSON 字符串中的换行只转义一次；正文里的真实代码请使用正确的语言标识。`,
    "section_validation_failed",
  );
  const root = object(data);
  const rawPoints = root && first(root, ["points", "knowledge_points", "items", "知识点"]);
  if (!Array.isArray(rawPoints) || rawPoints.length === 0) throw new AiOutputError(`章节「${section.title}」没有返回知识点数组`, "section_validation_failed", raw);
  const points = rawPoints.map((entry, index) => {
    const point = object(entry);
    const title = (point && named(point)) || section.points[index] || `知识点 ${index + 1}`;
    const recallPrompt = point && nonemptyString(first(point, ["recall_prompt", "recallPrompt", "回忆提示", "核心问题"]));
    const content = point && nonemptyString(first(point, ["content_md", "content", "explanation", "answer", "正文"]));
    if (!recallPrompt) throw new AiOutputError(`章节「${section.title}」知识点「${title}」缺少回忆提示 recall_prompt`, "section_validation_failed", raw);
    if (!content) throw new AiOutputError(`章节「${section.title}」知识点「${title}」缺少正文 content_md`, "section_validation_failed", raw);
    return {
      title,
      recall_prompt: recallPrompt,
      content_md: normalizeMarkdown(content, true),
      example_md: normalizeMarkdown(nonemptyString(first(point, ["example_md", "example", "示例"]))),
      key_takeaways: Array.isArray(first(point, ["key_takeaways", "key_points", "要点"])) ? (first(point, ["key_takeaways", "key_points", "要点"]) as unknown[]).filter((item): item is string => typeof item === "string") : [],
      common_mistakes: Array.isArray(first(point, ["common_mistakes", "mistakes", "易错点"])) ? (first(point, ["common_mistakes", "mistakes", "易错点"]) as unknown[]).filter((item): item is string => typeof item === "string") : [],
      interview_questions: Array.isArray(first(point, ["interview_questions", "questions", "面试追问"])) ? (first(point, ["interview_questions", "questions", "面试追问"]) as unknown[]).filter((item): item is string => typeof item === "string") : [],
    };
  });
  return points;
}
