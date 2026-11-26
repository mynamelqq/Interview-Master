"use client";

import type { Topic } from "@/lib/types";

export function MobileHome({ recommendation, continueTopic, continuePoint, savedCount, offline, loading, onRead, onCards, onContinue }: {
  recommendation: Topic | null;
  continueTopic: Topic | null;
  continuePoint: string | null;
  savedCount: number;
  offline: boolean;
  loading: boolean;
  onRead: (id: string) => void;
  onCards: () => void;
  onContinue: () => void;
}) {
  return <section className="mobile-home" aria-label="手机学习首页">
    <div className="mobile-home-intro"><span className="mobile-home-kicker">Interview Master</span><h1>随时学一点。</h1><p>今天也来看看技术知识吧。</p></div>
    {offline && <p className="mobile-offline-banner" role="status">当前离线。已保存的 {savedCount} 个专题可以继续阅读。</p>}
    <div className="mobile-section-title"><h2>推荐阅读</h2><span>一篇就好</span></div>
    {recommendation ? <article className="mobile-feature-topic"><span className="mobile-feature-mark" aria-hidden="true">✳</span><h3>{recommendation.title}</h3><p>{recommendation.summary || "从一个知识专题开始，按自己的节奏阅读。"}</p><div className="mobile-feature-footer"><span>约 5 分钟</span><button onClick={() => onRead(recommendation.id)}>开始阅读 <span aria-hidden="true">→</span></button></div></article> : <div className="mobile-empty">{loading ? "正在准备推荐专题…" : "还没有可阅读的专题。连接网络后再来看看。"}</div>}
    <button className="mobile-card-entry" onClick={onCards}><span className="mobile-card-entry-icon" aria-hidden="true">▧</span><span><strong>随机卡片</strong><small>随手翻一翻，不用打分</small></span><span aria-hidden="true">→</span></button>
    <div className="mobile-section-title mobile-continue-title"><h2>继续阅读</h2></div>
    {continueTopic ? <button className="mobile-continue-entry" onClick={onContinue}><span><strong>{continueTopic.title}</strong><small>{continuePoint ? "回到上次阅读位置" : "从专题开头继续"}</small></span><span aria-hidden="true">→</span></button> : <p className="mobile-empty">读过的专题会出现在这里。</p>}
  </section>;
}
