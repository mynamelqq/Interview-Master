"use client";

import { useEffect, useState } from "react";

let configured = false;
let diagramNumber = 0;

export function MermaidDiagram({ source }: { source: string }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!source || source.length > 12000) return;
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        if (!configured) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "base",
            themeVariables: {
              primaryColor: "#edf4ff",
              primaryBorderColor: "#8eb5ec",
              primaryTextColor: "#202938",
              lineColor: "#667b99",
              secondaryColor: "#f6f8fc",
              tertiaryColor: "#ffffff",
              fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
            },
          });
          configured = true;
        }
        const valid = await mermaid.parse(source, { suppressErrors: true });
        if (!valid) throw new Error("Invalid Mermaid diagram");
        const result = await mermaid.render(`knowledge-mermaid-${++diagramNumber}`, source);
        if (active) setSvg(result.svg);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => { active = false; };
  }, [source]);

  if (!source || failed || source.length > 12000) return <div className="mermaid-fallback"><p>图表暂时无法显示，以下是原始内容：</p><pre><code>{source}</code></pre></div>;
  return <figure className="mermaid-diagram" aria-label="知识图表">
    {svg ? <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="mermaid-loading" role="status">正在绘制图表…</div>}
    {svg && <details><summary>查看图表源码</summary><pre><code>{source}</code></pre></details>}
  </figure>;
}
