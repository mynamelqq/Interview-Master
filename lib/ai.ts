import { normalizeMarkdown } from "./markdown.ts";
import type { AiModelConfig } from "./ai-model-groups.ts";

export type Outline = { summary: string; answer_focus: string; category?: string; sections: { title: string; points: string[] }[] };
type PointContent = { title: string; recall_prompt: string; content_md: string; example_md: string; key_takeaways: string[]; common_mistakes: string[]; interview_questions: string[] };
const INTERVIEW_SYSTEM = "你在帮求职者准备技术面试。用通俗、自然的中文解释技术问题，让没有深入研究过源码的人也能听懂。只保留面试常问且有用的内容，先说结论，再解释原因；少用术语和英文缩写。必要的产品名、接口名、代码和通用缩写可以保留，首次出现时用中文说明。不要为了显得专业堆砌英文关键词、冷门细节或空话。只输出一个 JSON 对象，不要输出 Markdown 代码块，不要编造来源。";
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

export function normalizeInterviewQuestionAnswer(data: unknown): string {
  const answer = object(data)?.answer;
  if (typeof answer !== "string" || !answer.trim() || Array.from(answer.trim()).length > 300) {
    throw new AiOutputError("追问答案须为 1 至 300 字", "question_answer_validation_failed", data);
  }
  return answer.trim();
}

export async function generateInterviewQuestionAnswer(topic: string, point: string, question: string, context: string, config?: AiModelConfig): Promise<string> {
  const { data } = await completion(
    INTERVIEW_SYSTEM,
    `专题：${topic}。知识点：${point}。相关正文：${context.slice(0, 4000)}。面试追问：${question}。请直接回答这道追问，简短、准确、适合面试口头表达，不超过 300 个汉字或字符。只返回 {"answer":"答案"}。`,
    "question_answer_validation_failed",
    config,
  );
  return normalizeInterviewQuestionAnswer(data);
}

function named(value: unknown): string | null {
  if (typeof value === "string") return nonemptyString(value);
  const entry = object(value);
  return entry ? nonemptyString(first(entry, ["title", "name", "section_title", "sectionTitle", "chapter_title", "point_title", "标题", "名称"])) : null;
}

async function completion(system: string, user: string, stage: string, config?: AiModelConfig): Promise<{ data: unknown; raw: string }> {
  const key = config?.apiKey || process.env.AI_API_KEY;
  const model = config?.model || process.env.AI_MODEL;
  const base = config?.baseUrl || process.env.AI_BASE_URL || "https://api.openai.com/v1";
  if (!key || !model) throw new Error("AI_API_KEY 或 AI_MODEL 尚未配置");
  const response = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(stage === "question_answer_validation_failed" ? 60000 : 2000000),
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
    const phase = stage === "outline_validation_failed" ? "目录" : stage === "question_answer_validation_failed" ? "追问答案" : "章节";
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

export async function generateOutline(title: string, categories: string[] = [], config?: AiModelConfig): Promise<Outline> {
  const categoryInstruction = categories.length
    ? `请从以下已有分类中选择最合适的一项，category 必须逐字返回完整分类路径：${categories.map(category => `「${category}」`).join("、")}。没有合适分类时返回空字符串。`
    : "当前没有可用分类，category 返回空字符串。";
  const { data, raw } = await completion(
    INTERVIEW_SYSTEM,
    `为「${title}」设计一份够用的技术面试专题，不要写成百科或系统课程。请严格返回此结构：{"category":"已有分类完整路径或空字符串","summary":"一两句通俗的专题摘要","answer_focus":"针对整个专题面试问题的直接回答","sections":[{"title":"章节标题","points":["知识点标题"]}]}。answer_focus 必须非空，只针对专题「${title}」生成一份，不针对章节或知识点分别生成。把它写成求职者能直接说出口的回答：先给结论，再用两三句解释面试官最可能追问的原理、适用场景或取舍；不用开场白、回答建议、提纲和章节罗列。${categoryInstruction}sections 和 points 必须是非空数组；points 的元素必须是字符串。通常安排 2–4 章、每章 1–3 个知识点，优先选择高频问题；不为凑数量加入冷门源码细节、冗长配置或与面试无关的扩展。章节和知识点标题尽量使用中文，保留必要的标准技术名称。`,
    "outline_validation_failed",
    config,
  );
  try { return normalizeOutline(data); }
  catch (error) {
    if (error instanceof AiOutputError) throw new AiOutputError(error.message, error.stage, raw);
    throw error;
  }
}

export async function generateSection(topic: string, section: { title: string; points: string[] }, config?: AiModelConfig): Promise<PointContent[]> {
  const { data, raw } = await completion(
    INTERVIEW_SYSTEM,
    `专题：${topic}。章节：${section.title}。请逐一讲解这些知识点：${section.points.join("、")}。严格返回 {"points":[{"title":"知识点标题","recall_prompt":"一句能引出面试常问问题的回忆提示","content_md":"通俗、简短的中文参考答案，可使用少量 Markdown 小标题和短段落","example_md":"确有助于理解时才给简短代码或配置，否则为空字符串","key_takeaways":["必要的补充结论，否则为空数组"],"common_mistakes":["常见误解，否则为空数组"],"interview_questions":["常见面试追问，否则为空数组"]}]}。每个知识点必须有 title、非空 recall_prompt 和非空 content_md。正文先直接回答是什么，再解释为什么、怎么做或什么时候用，只写面试中能讲清楚的关键内容；优先使用短句和具体例子，避免长篇背景、低频源码细节和重复定义。能用中文说清楚的概念不要反复附英文；必须保留的英文术语首次出现时用中文解释，不要把多个英文关键词堆在同一句。版本差异或不确定之处仅在影响回答准确性时简要说明。其余模块按需选用，不要机械填满，也不要重复正文。面试追问只有在能深入考察正文尚未回答的关键问题时才写；正文里已经有答案的问题不要重复列出，没有有意义的追问就返回空数组。仅当知识点涉及流程、组件关系、状态变化或时序，且图比文字更容易理解时，可在 content_md 正文解释之后加入一段 \`\`\`mermaid 围栏图表；最多一张，不用生成也可以，不要为装饰而画图。优先使用 flowchart 或 sequenceDiagram，节点文字保持简短中文，避免 HTML、交互链接、复杂样式和难以验证的细节；图表不能代替文字解释。整体面试回答重点已经在专题级生成，这里不要再生成 answer_focus。JSON 字符串中的换行只转义一次；真实代码请使用正确的语言标识。`,
    "section_validation_failed",
    config,
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
