"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Topic } from "@/lib/types";

const PAGE_SIZE = 10;

type Props = {
  topics: Topic[];
  value: string;
  disabled?: boolean;
  onChange: (topicId: string) => void;
};

export function TopicPagePicker({ topics, value, disabled = false, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageInput, setPageInput] = useState("1");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = topics.find(topic => topic.id === value);
  const matches = useMemo(() => topics.filter(topic => topic.title.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.title.localeCompare(b.title, "zh-CN")), [topics, query]);
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = matches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  function goToPage() {
    const requested = Number(pageInput);
    if (!Number.isInteger(requested)) { setPageInput(String(currentPage + 1)); return; }
    const next = Math.max(1, Math.min(pageCount, requested));
    setPage(next - 1);
    setPageInput(String(next));
  }

  function changePage(next: number) {
    setPage(next);
    setPageInput(String(next + 1));
  }

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    function closeOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return <div className="topic-page-picker" ref={rootRef}>
    <button type="button" className="topic-page-trigger" aria-label="选择当前专题" aria-expanded={open} aria-controls="topic-page-options" disabled={disabled || !topics.length} onClick={() => {
      if (!open) {
        setQuery("");
        const selectedIndex = matches.findIndex(topic => topic.id === value);
        changePage(selectedIndex >= 0 ? Math.floor(selectedIndex / PAGE_SIZE) : 0);
      }
      setOpen(current => !current);
    }}><span>{selected?.title || "选择专题"}</span><span aria-hidden="true">⌄</span></button>
    {open && <div className="topic-page-popover" id="topic-page-options">
      <input ref={searchRef} type="search" aria-label="搜索当前专题" placeholder="搜索专题名称" value={query} onChange={event => { setQuery(event.target.value); changePage(0); }} />
      <div className="topic-page-options">{visible.map(topic => <button key={topic.id} type="button" className={topic.id === value ? "selected" : ""} aria-current={topic.id === value ? "true" : undefined} onClick={() => { onChange(topic.id); setOpen(false); }}>{topic.title}</button>)}{!visible.length && <p>没有匹配的专题</p>}</div>
      <div className="topic-page-footer"><span>共 {matches.length} 个 · 较早创建的在前</span><div><button type="button" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>上一页</button><label>第 <input type="number" min={1} max={pageCount} aria-label="跳转到第几页" value={pageInput} onChange={event => setPageInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") goToPage(); }} /> / {pageCount} 页</label><button type="button" onClick={goToPage}>跳转</button><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => changePage(currentPage + 1)}>下一页</button></div></div>
    </div>}
  </div>;
}
