"use client";

import Image from "next/image";
import { MarkdownContent } from "@/components/markdown-content";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { getBrowserClient } from "@/lib/supabase";
import type { Visual } from "@/lib/visual-enhancement";

export function PointVisuals({ visuals }: { visuals: Visual[] }) {
  const db = getBrowserClient();
  const approved = visuals.filter(visual => visual.status === "approved");
  if (!approved.length) return null;
  return <div className="point-visuals">{approved.map(visual => {
    const src = visual.storage_path ? db?.storage.from("knowledge-visuals").getPublicUrl(visual.storage_path).data.publicUrl : null;
    return <figure className={`point-visual point-visual--${visual.visual_type}`} key={visual.id}><figcaption><strong>{visual.title}</strong>{visual.caption && <span>{visual.caption}</span>}</figcaption>
      {visual.visual_type === "image" && src && <Image src={src} alt={visual.caption || visual.title} width={1536} height={1024} unoptimized />}
      {visual.visual_type === "mermaid" && <MermaidDiagram source={visual.source_content} />}
      {visual.visual_type === "table" && <MarkdownContent content={visual.source_content} />}
    </figure>;
  })}</div>;
}
