"use client";

import { useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase";
import { readCardContent } from "@/lib/card-content";
import { MarkdownContent } from "@/components/markdown-content";
import { recommendPoints, type PointActivity, type PointCandidate } from "@/lib/point-recommendations";
import { readRecommendationHistory, recentRecommendationIds, rememberRecommendations, saveRecommendationHistory } from "@/lib/recommendation-history";
import type { Category, KnowledgePoint, Topic } from "@/lib/types";
import { preferredPoints } from "@/lib/recommendation-preferences";
import { getOfflineTopic } from "@/lib/offline-topics";

export function CasualCards({ userId, points, activities, topics, categories, offline, onSeen, onControl, onExit, onOpenTopic }: {
  userId: string;
  points: PointCandidate[];
  activities: Record<string, PointActivity>;
  topics: Topic[];
  categories: Category[];
  offline: boolean;
  onSeen: (id: string) => void;
  onControl: (id: string, action: "favorite" | "unfavorite" | "exclude" | "restore") => Promise<boolean>;
  onExit: () => void;
  onOpenTopic: (id: string) => void;
}) {
  const [categoryId, setCategoryId] = useState("all");
  const [queue, setQueue] = useState(() => makeQueue(points, activities, userId));
  const [index, setIndex] = useState(0);
  const [card, setCard] = useState<KnowledgePoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [shown, setShown] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const current = queue[index];
  const topic = topics.find(item => item.id === current?.topic_id);
  const content = readCardContent(card?.content_md);

  useEffect(() => {
    const key = `im:card-recommendations:${userId}`;
    const history = readRecommendationHistory(key);
    saveRecommendationHistory(key, rememberRecommendations(history, queue.map(point => point.id)));
  }, [queue, userId]);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    async function loadCard() {
      let loaded: KnowledgePoint | null = null;
      if (!offline) {
        const db = getBrowserClient();
        const { data, error } = await db!.from("knowledge_points").select("*").eq("id", current.id).single();
        if (!error) loaded = data as KnowledgePoint;
      }
      if (!loaded) {
        const saved = await getOfflineTopic(userId, current.topic_id).catch(() => undefined);
        loaded = saved?.points.find(point => point.id === current.id) || null;
      }
      if (cancelled) return;
      setCard(loaded);
      setLoading(false);
      setLoadError(!loaded);
      if (loaded) onSeen(current.id);
    }
    void loadCard();
    return () => { cancelled = true; };
  }, [current, onSeen, offline, userId]);

  function changeCategory(id: string) {
    setCategoryId(id);
    const allowed = id === "all" ? points : preferredPoints(points, topics, categories, [id]);
    setQueue(makeQueue(allowed, activities, userId));
    setIndex(0);
    setCard(null);
    setLoading(true);
    setShown(false);
  }
  function next() {
    if (!current) return;
    setCard(null);
    setLoading(true);
    setShown(false);
    if (index + 1 < queue.length) { setIndex(index + 1); return; }
    const allowed = categoryId === "all" ? points : preferredPoints(points, topics, categories, [categoryId]);
    setQueue(makeQueue(allowed, activities, userId));
    setIndex(0);
  }
  function previous() {
    if (index === 0) return;
    setIndex(index - 1);
    setCard(null);
    setLoading(true);
    setShown(false);
  }
  async function excludeCurrent() {
    if (!current || !await onControl(current.id, "exclude")) return;
    const remaining = queue.filter(point => point.id !== current.id);
    setQueue(remaining.length ? remaining : makeQueue(points.filter(point => point.id !== current.id), activities, userId));
    setIndex(Math.min(index, Math.max(0, remaining.length - 1)));
    setCard(null);
    setLoading(true);
    setShown(false);
  }

  return <section className="page-wrap casual-page"><div className="casual-heading"><div><span className="eyebrow">随便看看 · 无需评分</span><h1 className="page-title">翻几张知识卡片</h1><p>想一想，再看参考内容。随时可以离开。</p></div><button className="text-btn" onClick={onExit}>返回首页</button></div>
    <label className="casual-filter">技术分类 <select value={categoryId} onChange={event => changeCategory(event.target.value)}><option value="all">全部分类</option>{categories.filter(category => preferredPoints(points, topics, categories, [category.id]).length > 0).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
    {!current ? <div className="empty">这个分类下还没有知识卡片。换一个分类看看。</div> : <article className="flashcard casual-card" onTouchStart={event => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }} onTouchEnd={event => { const start = touchStart.current; touchStart.current = null; if (!start) return; const touch = event.changedTouches[0]; const dx = touch.clientX - start.x; const dy = touch.clientY - start.y; if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.5) return; if (dx < 0) next(); else previous(); }}><div className="card-top"><span>{topic?.title || "知识卡片"}</span><span>{index + 1} / {queue.length}</span></div><div className="card-question"><p className="card-prompt">{current.reason === "unread" ? "还没看过" : current.reason === "revisit" ? "重新接触" : "随机探索"}</p><h2>{current.title}</h2><p>在心里想一想，再看参考内容。</p></div>{loading ? <p role="status">正在加载卡片…</p> : loadError ? <p role="alert">卡片加载失败，请换一张重试。</p> : <>{!shown ? <button className="primary-btn" onClick={() => setShown(true)}>显示参考内容</button> : <div className="casual-answer"><MarkdownContent content={content.reference} /></div>}</>}
      <div className="casual-actions"><button onClick={previous} disabled={index === 0}>上一张</button><button onClick={next}>下一张 →</button><button onClick={() => current && onOpenTopic(current.topic_id)}>阅读完整专题</button>{!offline && <button onClick={() => current && void onControl(current.id, activities[current.id]?.is_favorite ? "unfavorite" : "favorite")} aria-pressed={activities[current.id]?.is_favorite || false}>{activities[current.id]?.is_favorite ? "★ 已收藏" : "☆ 收藏"}</button>}{!offline && <button onClick={() => void excludeCurrent()}>暂不推荐 7 天</button>}</div></article>}
  </section>;
}

function makeQueue(points: PointCandidate[], activities: Record<string, PointActivity>, userId: string) {
  const key = `im:card-recommendations:${userId}`;
  const history = readRecommendationHistory(key);
  const batchSize = Math.min(10, Math.max(1, Math.ceil(points.length / 2)));
  const avoid = recentRecommendationIds(history, points.map(point => point.id), batchSize);
  const queue = recommendPoints(points, activities, batchSize, avoid);
  return queue;
}
