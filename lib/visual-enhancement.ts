export type VisualType = "mermaid" | "svg" | "image" | "interactive" | "table";
export type Visual = {
  id: string;
  topic_id: string;
  knowledge_point_id: string | null;
  point_title: string;
  visual_type: VisualType;
  title: string;
  source_content: string;
  storage_path: string | null;
  caption: string;
  rationale: string;
  priority_score: number | null;
  replaces_mermaid: boolean;
  sort_order: number;
  status: "pending" | "approved" | "rejected";
  generation_status: "idle" | "running" | "failed" | "completed";
  generation_error: string | null;
};

export type VisualSuggestion = {
  point_id: string;
  visual_type: "mermaid" | "image" | "table";
  title: string;
  caption: string;
  rationale: string;
  prompt: string;
  complexity: number;
  relationships: number;
  benefit: number;
  replaces_mermaid: boolean;
};

export function shouldSkipVisualScan(mode: "topic" | "library" | "mermaid", previouslyScanned: boolean, force: boolean): boolean {
  return mode !== "topic" && previouslyScanned && !force;
}

export function visualPriority(complexity: number, relationships: number, benefit: number): number {
  return Math.round((0.4 * complexity + 0.3 * relationships + 0.3 * benefit) * 10) / 10;
}

export function isWorthVisualizing(suggestion: VisualSuggestion): boolean {
  return suggestion.benefit >= 4 && visualPriority(suggestion.complexity, suggestion.relationships, suggestion.benefit) >= 3.5;
}

export function extractMermaid(content: string): string[] {
  return [...content.matchAll(/```mermaid\s*\r?\n([\s\S]*?)```/gi)].map(match => match[1].trim()).filter(Boolean);
}

export function withoutMermaid(content: string): string {
  return content.replace(/```mermaid\s*\r?\n[\s\S]*?```/gi, "").trim();
}

export function imageGenerationEndpoint(baseUrl: string, imageUrl?: string): string {
  const url = new URL(imageUrl || baseUrl);
  if (url.protocol !== "https:") throw new Error("图片生成接口必须使用 HTTPS");
  if (url.username || url.password) throw new Error("图片生成接口不能包含账号或密码");
  if (imageUrl) {
    if (url.pathname.replace(/\/$/, "").endsWith("/v1")) url.pathname = `${url.pathname.replace(/\/$/, "")}/images/generations`;
    return url.toString();
  }
  url.pathname = "/api/v1/services/aigc/multimodal-generation/generation";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function isDashscopeImageEndpoint(endpoint: string): boolean {
  return new URL(endpoint).pathname.endsWith("/api/v1/services/aigc/multimodal-generation/generation");
}

export function imageGenerationBody(model: string, prompt: string, dashscope: boolean): object {
  if (dashscope) return { model, input: { messages: [{ role: "user", content: [{ text: prompt }] }] }, parameters: { prompt_extend: true, size: "1536*1024" } };
  return { model, prompt, n: 1, size: "1536x1024" };
}

export function imageBase64(data: unknown): string | null {
  const root = data as { data?: { b64_json?: unknown }[] };
  const value = root?.data?.[0]?.b64_json;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function imageResultUrl(data: unknown): string {
  const result = data as { data?: { url?: string }[]; output?: { choices?: { message?: { content?: { image?: string }[] } }[] } };
  const image = result?.data?.[0]?.url || result?.output?.choices?.[0]?.message?.content?.find(item => typeof item.image === "string")?.image;
  if (!image) throw new Error("图片模型未返回图片地址");
  const url = new URL(image);
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".") || /^(localhost|\d+\.\d+\.\d+\.\d+)$/i.test(url.hostname) || /\.(local|localhost|internal)$/i.test(url.hostname)) {
    throw new Error("图片模型返回了非预期的下载地址");
  }
  return image;
}

export function isPng(data: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return data.length >= signature.length && signature.every((byte, index) => data[index] === byte);
}

export function normalizeVisualSuggestions(data: unknown, pointIds: Set<string>): VisualSuggestion[] {
  const root = data as { suggestions?: unknown };
  if (!Array.isArray(root?.suggestions)) throw new Error("视觉分析结果缺少 suggestions 数组");
  return root.suggestions.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.point_id !== "string" || !pointIds.has(item.point_id) || !["mermaid", "image", "table"].includes(String(item.visual_type))) return [];
    const score = [item.complexity, item.relationships, item.benefit].map(value => Number(value));
    if (score.some(value => !Number.isFinite(value) || value < 0 || value > 5)) return [];
    if (typeof item.title !== "string" || !item.title.trim() || typeof item.prompt !== "string" || !item.prompt.trim()) return [];
    return [{
      point_id: item.point_id,
      visual_type: item.visual_type as VisualSuggestion["visual_type"],
      title: item.title.trim().slice(0, 120),
      caption: typeof item.caption === "string" ? item.caption.trim().slice(0, 300) : "",
      rationale: typeof item.rationale === "string" ? item.rationale.trim().slice(0, 300) : "",
      prompt: item.prompt.trim().slice(0, 3000),
      complexity: score[0], relationships: score[1], benefit: score[2],
      replaces_mermaid: item.replaces_mermaid === true,
    }];
  });
}
