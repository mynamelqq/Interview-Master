"use client";

import type { PointRecommendation } from "@/lib/point-recommendations";
import type { Topic } from "@/lib/types";

export function MobileHome({ recommendation, recommendations, topics, continueTopic, continuePoint, topicCount, favoriteCount, savedCount, draftCount, activeJobCount, canManage, offline, loading, recommendationStatus, canMore, categoryName, onRead, onPointRead, onCards, onContinue, onRandomTopic, onMore, onLibrary, onFavorites, onNotes, onDrafts, onTasks, onCreate }: {
  recommendation: Topic | null;
  recommendations: PointRecommendation[];
  topics: Topic[];
  continueTopic: Topic | null;
  continuePoint: string | null;
  topicCount: number;
  favoriteCount: number;
  savedCount: number;
  draftCount: number;
  activeJobCount: number;
  canManage: boolean;
  offline: boolean;
  loading: boolean;
  recommendationStatus: "loading" | "loaded" | "error";
  canMore: boolean;
  categoryName: (id: string | null) => string;
  onRead: (id: string) => void;
  onPointRead: (topicId: string, pointId: string) => void;
  onCards: () => void;
  onContinue: () => void;
  onRandomTopic: () => void;
  onMore: () => void;
  onLibrary: () => void;
  onFavorites: () => void;
  onNotes: () => void;
  onDrafts: () => void;
  onTasks: () => void;
  onCreate: () => void;
}) {
  const recentTopics = topics.slice(0, 3);
  return <section className="mobile-home" aria-label="手机学习首页">
    <div className="mobile-home-intro"><span className="mobile-home-kicker">学习首页</span><h1>今天想看点什么？</h1><p>从上次停下的地方继续，或挑一个新专题。</p></div>
    {offline && <p className="mobile-offline-banner" role="status">当前离线。已保存的 {savedCount} 个专题可以继续阅读。</p>}
    <dl className="mobile-home-overview"><div><dt>知识专题</dt><dd>{topicCount}</dd></div><div><dt>已收藏</dt><dd>{favoriteCount}</dd></div><div><dt>离线保存</dt><dd>{savedCount}</dd></div></dl>

    {continueTopic && <section className="mobile-home-section"><div className="mobile-section-title"><h2>继续阅读</h2></div><button className="mobile-continue-entry" onClick={onContinue}><span><strong>{continueTopic.title}</strong><small>{continuePoint ? `上次看到：${continuePoint}` : "从专题开头继续"}</small></span><span aria-hidden="true">→</span></button></section>}

    <nav className="mobile-home-shortcuts" aria-label="学习快捷入口">
      <button onClick={onLibrary}><span aria-hidden="true">▤</span><strong>知识库</strong><small>浏览全部专题</small></button>
      <button onClick={onFavorites}><span aria-hidden="true">☆</span><strong>我的收藏</strong><small>{favoriteCount ? `${favoriteCount} 个知识点` : "回看重点"}</small></button>
      <button onClick={onNotes}><span aria-hidden="true">✎</span><strong>我的笔记</strong><small>整理自己的理解</small></button>
      <button onClick={onRandomTopic} disabled={!topicCount}><span aria-hidden="true">◈</span><strong>随机专题</strong><small>换个方向阅读</small></button>
    </nav>

    <section className="mobile-home-section"><div className="mobile-section-title"><h2>推荐阅读</h2><span>完整读一篇</span></div>
      {recommendation ? <article className="mobile-feature-topic"><span className="mobile-feature-mark" aria-hidden="true">✳</span><h3>{recommendation.title}</h3><p>{recommendation.summary || "从一个知识专题开始，按自己的节奏阅读。"}</p><div className="mobile-feature-footer"><span>{categoryName(recommendation.category_id)}</span><button onClick={() => onRead(recommendation.id)}>开始阅读 <span aria-hidden="true">→</span></button></div></article> : <div className="mobile-empty">{loading ? "正在准备推荐专题…" : "还没有可阅读的专题。"}</div>}
    </section>

    <button className="mobile-card-entry" onClick={onCards}><span className="mobile-card-entry-icon" aria-hidden="true">▧</span><span><strong>随便看看</strong><small>随机翻几张知识卡片，无需评分</small></span><span aria-hidden="true">→</span></button>

    {topicCount > 0 && <section className="mobile-home-section"><div className="mobile-section-title"><h2>为你推荐</h2><button className="mobile-section-link" onClick={onMore} disabled={!canMore}>换一批</button></div>
      {recommendationStatus === "loaded" ? recommendations.length ? <div className="mobile-recommendation-list">{recommendations.map(point => <button key={point.id} onClick={() => onPointRead(point.topic_id, point.id)}><span><strong>{point.title}</strong><small>{topics.find(topic => topic.id === point.topic_id)?.title || "知识专题"} · {point.reason === "unread" ? "尚未阅读" : point.reason === "revisit" ? "值得回顾" : "随机探索"}</small></span><span aria-hidden="true">→</span></button>)}</div> : <p className="mobile-empty">暂无可推荐的知识点，去知识库看看吧。</p> : <p className="mobile-empty" role="status">{recommendationStatus === "error" ? "推荐暂时无法加载。" : "正在挑选知识点…"}</p>}
    </section>}

    {topicCount > 0 && <section className="mobile-home-section"><div className="mobile-section-title"><h2>最近专题</h2><button className="mobile-section-link" onClick={onLibrary}>查看全部</button></div>
      {recentTopics.length ? <div className="mobile-recent-list">{recentTopics.map(topic => <button key={topic.id} onClick={() => onRead(topic.id)}><span><strong>{topic.title}</strong><small>{categoryName(topic.category_id)}</small></span><span aria-hidden="true">→</span></button>)}</div> : <p className="mobile-empty">已发布的专题会出现在这里。</p>}
    </section>}

    {canManage && <section className="mobile-home-section mobile-admin-section"><div className="mobile-section-title"><h2>待处理</h2></div><div className="mobile-admin-links"><button onClick={onDrafts}><span>草稿箱</span><strong>{draftCount}</strong></button><button onClick={onTasks}><span>生成任务</span><strong>{activeJobCount}</strong></button></div><button className="mobile-admin-create" onClick={onCreate}>＋ 创建知识专题</button></section>}
  </section>;
}
