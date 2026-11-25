"use client";

import { useState } from "react";
import type { Category, Topic } from "@/lib/types";
import type { PointActivity, PointCandidate } from "@/lib/point-recommendations";
import { preferredPoints } from "@/lib/recommendation-preferences";

export function FavoritesPanel({ points, activities, topics, categories, status, categoryName, onOpen, onRemove, onBrowse }: {
  points: PointCandidate[];
  activities: Record<string, PointActivity>;
  topics: Topic[];
  categories: Category[];
  status: "loading" | "loaded" | "error";
  categoryName: (id: string | null) => string;
  onOpen: (topicId: string, pointId: string) => void;
  onRemove: (pointId: string) => Promise<boolean>;
  onBrowse: () => void;
}) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const favoritePoints = points.filter(point => activities[point.id]?.is_favorite);
  const favoriteTopicIds = new Set(favoritePoints.map(point => point.topic_id));
  const favoriteTopics = topics.filter(topic => favoriteTopicIds.has(topic.id));
  const categoryOptions = categories.filter(category => preferredPoints(favoritePoints, favoriteTopics, categories, [category.id]).length > 0);
  const activeCategoryId = categoryOptions.some(category => category.id === categoryId) ? categoryId : "all";
  const scoped = activeCategoryId === "all" ? favoritePoints : preferredPoints(favoritePoints, favoriteTopics, categories, [activeCategoryId]);
  const search = query.trim().toLocaleLowerCase();
  const visible = scoped.filter(point => {
    const topic = topics.find(item => item.id === point.topic_id);
    return !search || point.title.toLocaleLowerCase().includes(search) || !!topic?.title.toLocaleLowerCase().includes(search) || categoryName(topic?.category_id || null).toLocaleLowerCase().includes(search);
  });
  const grouped = favoriteTopics.map(topic => ({ topic, points: visible.filter(point => point.topic_id === topic.id).sort((a, b) => a.title.localeCompare(b.title, "zh-CN")) })).filter(group => group.points.length);

  return <section className="page-wrap favorites-page">
    <div className="favorites-intro"><div><span className="favorites-kicker">随时回到重要知识</span><h1>我的收藏</h1><p>把值得反复看的知识点放在一起，打开后从原文继续读。</p></div><div className="favorites-bookmark" aria-label={status === "loaded" ? `已收藏 ${favoritePoints.length} 个知识点` : "正在加载收藏数量"}><span aria-hidden="true">★</span><strong>{status === "loaded" ? favoritePoints.length : "—"}</strong><small>个知识点</small></div></div>
    {status === "loaded" && favoritePoints.length > 0 && <div className="favorites-tools"><div className="favorites-filter"><label htmlFor="favorites-search">查找收藏</label><input id="favorites-search" type="search" placeholder="搜索知识点或专题" value={query} onChange={event => setQuery(event.target.value)} /></div><label className="favorites-category-filter">分类<select value={activeCategoryId} onChange={event => setCategoryId(event.target.value)}><option value="all">全部分类</option>{categoryOptions.map(category => <option key={category.id} value={category.id}>{categoryName(category.id)}</option>)}</select></label><span className="favorites-result-count">显示 {visible.length} / {favoritePoints.length}</span></div>}
    {status !== "loaded" ? <div className="favorites-empty" role="status">{status === "error" ? "收藏暂时无法加载，请刷新页面重试。" : "正在整理你的收藏…"}</div> : !favoritePoints.length ? <div className="favorites-empty"><span aria-hidden="true">☆</span><h2>还没有收藏的知识点</h2><p>阅读时点一下“收藏”，这里就会成为你的常用知识清单。</p><button onClick={onBrowse}>去知识库看看</button></div> : !visible.length ? <div className="favorites-empty"><h2>没有找到匹配的收藏</h2><p>换个关键词，或查看全部分类。</p><button onClick={() => { setQuery(""); setCategoryId("all"); }}>清除筛选</button></div> : <div className="favorites-groups">{grouped.map(({ topic, points: groupPoints }) => <section className="favorites-group" key={topic.id}><header><div><span>{categoryName(topic.category_id)}</span><h2>{topic.title}</h2></div><small>{groupPoints.length} 个知识点</small></header><div className="favorites-items">{groupPoints.map(point => <article key={point.id} className="favorites-item"><span className="favorites-item-mark" aria-hidden="true">★</span><div><h3>{point.title}</h3><p>{activities[point.id]?.view_count ? "已读过，可继续回顾" : "尚未阅读，从这里开始"}</p></div><button className="favorites-read" onClick={() => onOpen(point.topic_id, point.id)}>打开原文 <span aria-hidden="true">↗</span></button><button className="favorites-remove" onClick={() => void onRemove(point.id)} aria-label={`取消收藏${point.title}`}>取消收藏</button></article>)}</div></section>)}</div>}
  </section>;
}
