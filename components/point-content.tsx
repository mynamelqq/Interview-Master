import { MarkdownContent } from "@/components/markdown-content";
import { readCardContent } from "@/lib/card-content";
import { withoutMermaid } from "@/lib/visual-enhancement";

export function PointContent({ content, hideMermaid = false }: { content: string; hideMermaid?: boolean }) {
  const { reference } = readCardContent(content);
  return <MarkdownContent content={hideMermaid ? withoutMermaid(reference) : reference} prose />;
}
