"use client";

import { isValidElement, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { normalizeMarkdown } from "@/lib/markdown";
import { MermaidDiagram } from "@/components/mermaid-diagram";

function extractText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: React.ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const codeRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const language = isValidElement<{ className?: string }>(children) ? children.props.className?.match(/language-([\w+#-]+)/)?.[1] : undefined;
  if (language?.toLowerCase() === "mermaid") {
    const source = extractText(children).trim();
    return <MermaidDiagram key={source} source={source} />;
  }
  const foldable = extractText(children).split("\n").length > 12;
  async function copy() {
    const code = codeRef.current?.textContent || "";
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { setCopied(false); }
  }
  return <div className={`code-block ${foldable && !expanded ? "code-collapsed" : ""}`}>{language && <span className="code-language">{language}</span>}<button type="button" onClick={copy} aria-label="复制代码">{copied ? "已复制" : "复制"}</button><div ref={codeRef}><pre>{children}</pre></div>{foldable && <button className="code-expand" type="button" onClick={() => setExpanded(value => !value)}>{expanded ? "收起代码" : "展开代码"}</button>}</div>;
}

export function MarkdownContent({ content, className = "", prose = false }: { content: string | null | undefined; className?: string; prose?: boolean }) {
  return <div className={`markdown ${className}`}><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false }]]} components={{ pre: CodeBlock }}>{normalizeMarkdown(content, prose)}</ReactMarkdown></div>;
}
