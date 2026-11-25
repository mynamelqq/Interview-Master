const PROMPT_HEADING = "## 回忆提示";

export function formatCardContent(prompt: string, content: string): string {
  return `${PROMPT_HEADING}\n\n${prompt.trim()}\n\n${content.trim()}`;
}

export function readCardContent(content: string | null | undefined) {
  const source = content || "";
  if (!source.startsWith(`${PROMPT_HEADING}\n`)) return { prompt: null, reference: source };
  const rest = source.slice(PROMPT_HEADING.length).trimStart();
  const boundary = rest.indexOf("\n\n");
  if (boundary < 0) return { prompt: null, reference: source };
  return { prompt: rest.slice(0, boundary).trim(), reference: rest.slice(boundary + 2).trim() };
}
