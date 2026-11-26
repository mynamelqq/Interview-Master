"use client";

import { useEffect, useState } from "react";

let configured = false;
let diagramNumber = 0;

export function MermaidDiagram({ source }: { source: string }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

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
            look: "classic",
            flowchart: {
              useMaxWidth: false,
              nodeSpacing: 28,
              rankSpacing: 32,
              padding: 14,
              wrappingWidth: 260,
              curve: "monotoneX",
            },
            themeVariables: {
              background: "#ffffff",
              primaryColor: "#ffffff",
              primaryBorderColor: "#d1d5db",
              primaryTextColor: "#292d33",
              lineColor: "#858b94",
              secondaryColor: "#f7f7f8",
              tertiaryColor: "#ffffff",
              clusterBkg: "#fafafa",
              clusterBorder: "#e4e4e7",
              actorBkg: "#ffffff",
              actorBorder: "#d1d5db",
              actorTextColor: "#292d33",
              signalColor: "#858b94",
              signalTextColor: "#454951",
              edgeLabelBackground: "#ffffff",
              fontSize: "17px",
              fontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif',
            },
            themeCSS: `
              .nodeLabel { font-weight: 500; }
              .nodeLabel p { line-height: 1.65; }
              .edgeLabel { font-size: 14px; font-weight: 400; }
              .edgeLabel p { line-height: 1.5; }
              .cluster-label { font-weight: 600; }
            `,
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
  return <figure className={`mermaid-diagram${expanded ? " is-expanded" : ""}`} aria-label="知识图表">
    <figcaption className="mermaid-heading">
      <span className="mermaid-heading-label">图解</span>
      {svg && <button type="button" className="mermaid-expand" onClick={() => setExpanded(!expanded)} aria-pressed={expanded}>{expanded ? "适应宽度" : "放大查看"}<span aria-hidden="true">↗</span></button>}
    </figcaption>
    {svg ? <div className="mermaid-viewport"><div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} /></div> : <div className="mermaid-loading" role="status">正在绘制图表…</div>}
    {svg && <details><summary>查看图表源码</summary><pre><code>{source}</code></pre></details>}
  </figure>;
}
