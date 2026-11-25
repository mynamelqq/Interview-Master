"use client";

import { useEffect, useState } from "react";
import { MarkdownContent } from "@/components/markdown-content";
import { getBrowserClient } from "@/lib/supabase";
import type { Topic } from "@/lib/types";

type StoredNote = { knowledge_point_id: string; content_md: string; updated_at: string };
type NoteItem = StoredNote & { chapterTitle: string; topicId: string };

export function NotesPanel({ userId, topics, categoryName, onOpen }: {
  userId: string;
  topics: Topic[];
  categoryName: (id: string | null) => string;
  onOpen: (topicId: string, chapterId: string) => void;
}) {
  const [items, setItems] = useState<NoteItem[]>([]);
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const db = getBrowserClient();
    if (!db) return;
    let cancelled = false;
    async function loadNotes() {
      const notes: StoredNote[] = [];
      for (let start = 0; ; start += 100) {
        const { data, error } = await db!.from("user_point_notes")
          .select("knowledge_point_id,content_md,updated_at")
          .eq("user_id", userId).order("updated_at", { ascending: false }).range(start, start + 99);
        if (error) { if (!cancelled) setStatus("error"); return; }
        notes.push(...(data || []));
        if (!data || data.length < 100) break;
      }
      const pointRows: { id: string; title: string; topic_id: string; parent_id: string | null }[] = [];
      for (let start = 0; start < notes.length; start += 100) {
        const ids = notes.slice(start, start + 100).map(note => note.knowledge_point_id);
        const { data, error } = await db!.from("knowledge_points")
          .select("id,title,topic_id,parent_id").in("id", ids);
        if (error) { if (!cancelled) setStatus("error"); return; }
        pointRows.push(...(data || []));
      }
      if (cancelled) return;
      const pointsById = new Map(pointRows.map(point => [point.id, point]));
      setItems(notes.filter(note => note.content_md.trim() && pointsById.get(note.knowledge_point_id)?.parent_id === null).map(note => ({
        ...note,
        chapterTitle: pointsById.get(note.knowledge_point_id)!.title,
        topicId: pointsById.get(note.knowledge_point_id)!.topic_id,
      })));
      setStatus("loaded");
    }
    void loadNotes();
    return () => { cancelled = true; };
  }, [userId]);

  const topicById = new Map(topics.map(topic => [topic.id, topic]));
  const term = search.trim().toLocaleLowerCase();
  const visible = items.filter(note => {
    const topic = topicById.get(note.topicId);
    return !term || [note.chapterTitle, note.content_md, topic?.title || "", categoryName(topic?.category_id || null)]
      .some(value => value.toLocaleLowerCase().includes(term));
  });

  return <section className="page-wrap management-page notes-page">
    <div className="management-heading"><div><span className="eyebrow">个人整理</span><h1 className="page-title">我的笔记</h1><p>笔记按章节整理，方便回看整章的理解和疑问。</p></div><span className="management-count">{status === "loaded" ? `${items.length} 条笔记` : ""}</span></div>
    {status === "loaded" && items.length > 0 && <label className="notes-search">搜索笔记<input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索专题、章节或笔记内容" /></label>}
    {status === "loading" ? <div className="management-empty" role="status">正在加载笔记…</div>
      : status === "error" ? <div className="management-empty" role="alert">笔记暂时无法加载，请刷新页面重试。</div>
      : visible.length ? <div className="notes-list">{visible.map(note => {
          const topic = topicById.get(note.topicId);
          return <article className="notes-item" key={note.knowledge_point_id}>
            <div className="notes-item-head"><div><span className="category-tag">{categoryName(topic?.category_id || null)}</span><h2>{note.chapterTitle}</h2><p>{topic?.title || "专题"} · {new Date(note.updated_at).toLocaleDateString("zh-CN")}</p></div><button type="button" onClick={() => onOpen(note.topicId, note.knowledge_point_id)}>查看本章 →</button></div>
            <MarkdownContent content={note.content_md} prose />
          </article>;
        })}</div>
      : <div className="management-empty">{items.length ? "没有找到符合条件的笔记。" : "还没有笔记。阅读专题时，可以在章节末尾添加笔记。"}</div>}
  </section>;
}
