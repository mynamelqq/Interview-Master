"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

let configured = false;
let diagramNumber = 0;

export function MermaidDiagram({ source }: { source: string }) {
  const figureRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const expandButton = expandRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
      if (event.key === "Tab") {
        const buttons = document.querySelectorAll<HTMLButtonElement>(".mermaid-modal-toolbar button");
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1]?.focus(); }
        else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0]?.focus(); }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      expandButton?.focus();
    };
  }, [expanded]);

  useEffect(() => {
    const element = figureRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") { queueMicrotask(() => setVisible(true)); return; }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "400px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    if (!visible || !source || source.length > 12000) return;
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        if (!configured) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "base",
            look: "handDrawn",
            flowchart: {
              useMaxWidth: false,
              nodeSpacing: 28,
              rankSpacing: 32,
              padding: 14,
              wrappingWidth: 260,
              curve: "monotoneX",
            },
            themeVariables: {
              background: "#fffdf7",
              primaryColor: "#f4f8ff",
              primaryBorderColor: "#6183b8",
              primaryTextColor: "#243249",
              lineColor: "#55749e",
              secondaryColor: "#fff5e7",
              tertiaryColor: "#edf6f1",
              clusterBkg: "#f8f9f4",
              clusterBorder: "#adc2da",
              actorBkg: "#f4f8ff",
              actorBorder: "#6183b8",
              actorTextColor: "#243249",
              signalColor: "#55749e",
              signalTextColor: "#243249",
              edgeLabelBackground: "#fffdf7",
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
  }, [source, visible]);

  if (!source || failed || source.length > 12000) return <div className="mermaid-fallback"><p>图表暂时无法显示，以下是原始内容：</p><pre><code>{source}</code></pre></div>;
  return <figure ref={figureRef} className="mermaid-diagram" aria-label="知识图表">
    <figcaption className="mermaid-heading">
      <span className="mermaid-heading-label">图解</span>
      {svg && <button ref={expandRef} type="button" className="mermaid-expand" onClick={() => { setActualSize(false); setExpanded(true); }}>放大查看<span aria-hidden="true">↗</span></button>}
    </figcaption>
    {svg ? <div className="mermaid-viewport">{!expanded && <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />}</div> : <div className="mermaid-loading" role="status">正在绘制图表…</div>}
    {svg && <details><summary>查看图表源码</summary><pre><code>{source}</code></pre></details>}
    {expanded && createPortal(<div className="mermaid-modal" role="dialog" aria-modal="true" aria-label="放大查看知识图表">
      <div className="mermaid-modal-toolbar"><strong>图解</strong><span>拖动滚动区域查看完整图表</span><button type="button" onClick={() => setActualSize(value => !value)}>{actualSize ? "适应窗口" : "原始大小"}</button><button ref={closeRef} type="button" onClick={() => setExpanded(false)} aria-label="关闭图解">关闭 ×</button></div>
      <div className={`mermaid-modal-viewport${actualSize ? " is-actual-size" : ""}`}><div className="mermaid-modal-svg" dangerouslySetInnerHTML={{ __html: svg }} /></div>
    </div>, document.body)}
  </figure>;
}
