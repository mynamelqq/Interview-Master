const HEADING = "## 回答重点";

export function formatTopicAnswer(answer: string): string {
  return `${HEADING}\n\n${answer.trim()}`;
}

export function readTopicAnswer(content: string | null | undefined): string | null {
  if (!content?.startsWith(`${HEADING}\n`)) return null;
  return content.slice(HEADING.length).trim() || null;
}
