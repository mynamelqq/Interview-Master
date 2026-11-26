import { MarkdownContent } from "@/components/markdown-content";
import { readCardContent } from "@/lib/card-content";

export function PointContent({ content }: { content: string }) {
  const { prompt, reference } = readCardContent(content);

  return <>
    {prompt && <div className="point-recall-prompt"><span>回忆提示</span><p>{prompt}</p></div>}
    <MarkdownContent content={reference} prose />
  </>;
}
