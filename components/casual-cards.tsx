"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase";
import { readCardContent } from "@/lib/card-content";
import { MarkdownContent } from "@/components/markdown-content";
import { recommendPoints, type PointActivity, type PointCandidate } from "@/lib/point-recommendations";
import type { Category, KnowledgePoint, Topic } from "@/lib/types";

export function CasualCards({ points, activities, topics, categories, onSeen, onExit, onOpenTopic }: {
  points: PointCandidate[];
  activities: Record<string, PointActivity>;
  topics: Topic[];
  categories: Category[];
  onSeen: (id: string) => void;
  onExit: () => void;
  onOpenTopic: (id: string) => void;
}) {
  const [categoryId, setCategoryId] = useState("all");
  const [queue, setQueue] = useState(() => recommendPoints(points, activities, 10));
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [card, setCard] = useState<KnowledgePoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const current = queue[index];
  const topic = topics.find(item => item.id === current?.topic_id);
  const content = readCardContent(card?.content_md);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    const db = getBrowserClient();
    void db?.from("knowledge_points").select("*").eq("id", current.id).single().then(({ data, error }) => {
      if (cancelled) return;
      setCard(error ? null : data as KnowledgePoint);
      setLoading(false);
      setLoadError(!!error);
      if (!error) onSeen(current.id);
    });
    return () => { cancelled = true; };
  }, [current, onSeen]);

  function changeCategory(id: string) {
    setCategoryId(id);
    const allowed = points.filter(point => id === "all" || topics.find(topic => topic.id === point.topic_id)?.category_id === id);
    setQueue(recommendPoints(allowed, activities, 10));
    setIndex(0);
    setHistory([]);
    setCard(null);
    setLoading(true);
    setShown(false);
  }
  function next() {
    if (!current) return;
    setHistory(previous => [...previous, current.id]);
    setCard(null);
    setLoading(true);
    setShown(false);
    if (index + 1 < queue.length) { setIndex(index + 1); return; }
    const allowed = points.filter(point => categoryId === "all" || topics.find(topic => topic.id === point.topic_id)?.category_id === categoryId);
    const avoid = [...history, current.id].slice(-Math.min(10, Math.max(0, allowed.length - 1)));
    setQueue(recommendPoints(allowed, activities, 10, avoid));
    setIndex(0);
  }
  function previous() {
    if (index === 0) return;
    setIndex(index - 1);
    setCard(null);
    setLoading(true);
    setShown(false);
  }

  return <section className="page-wrap casual-page"><div className="casual-heading"><div><span className="eyebrow">随便看看 · 无需评分</span><h1 className="page-title">翻几张知识卡片</h1><p>想一想，再看参考内容。随时可以离开。</p></div><button className="text-btn" onClick={onExit}>返回首页</button></div>
    <label className="casual-filter">技术分类 <select value={categoryId} onChange={event => changeCategory(event.target.value)}><option value="all">全部分类</option>{categories.filter(category => topics.some(topic => topic.category_id === category.id && points.some(point => point.topic_id === topic.id))).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    {!current ? <div className="empty">这个分类下还没有知识卡片。换一个分类看看。</div> : <article className="flashcard casual-card"><div className="card-top"><span>{topic?.title || "知识卡片"}</span><span>{index + 1} / {queue.length}</span></div><div className="card-question"><p className="card-prompt">{current.reason === "unread" ? "还没看过" : current.reason === "revisit" ? "重新接触" : "随机探索"}</p><h2>{current.title}</h2><p>在心里想一想，再看参考内容。</p></div>{loading ? <p role="status">正在加载卡片…</p> : loadError ? <p role="alert">卡片加载失败，请换一张重试。</p> : <>{!shown ? <button className="primary-btn" onClick={() => setShown(true)}>显示参考内容</button> : <div className="casual-answer"><MarkdownContent content={content.reference} /></div>}</>}
      <div className="casual-actions"><button onClick={previous} disabled={index === 0}>上一张</button><button onClick={next}>下一张 →</button><button onClick={() => current && onOpenTopic(current.topic_id)}>阅读完整专题</button></div></article>}
  </section>;
}
