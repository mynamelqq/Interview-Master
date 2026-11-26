import { MarkdownContent } from "@/components/markdown-content";
import { readCardContent } from "@/lib/card-content";

export function PointContent({ content }: { content: string }) {
  const { reference } = readCardContent(content);
  return <MarkdownContent content={reference} prose />;
}
