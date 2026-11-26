"use client";

import { useEffect, useRef, useState } from "react";
import { MarkdownContent } from "@/components/markdown-content";
import { PointContent } from "@/components/point-content";
import { TopicAnswerFocus } from "@/components/topic-answer-focus";
import { readTopicAnswer } from "@/lib/topic-answer";
import type { KnowledgePoint, Topic } from "@/lib/types";
import { getBrowserClient } from "@/lib/supabase";

export type ReaderPreferences = {
  size: "small" | "standard" | "large" | "xlarge";
  leading: "compact" | "standard" | "loose" | "comfortable";
  background: "white" | "warm" | "gray" | "dark";
  width: "narrow" | "standard" | "wide";
};

export const defaultReaderPreferences: ReaderPreferences = {
  size: "standard", leading: "standard", background: "white", width: "standard",
};
type ReadingBookmark = { progress: number; pointId: string | null; savedAt?: string };

const options = [
  { key: "size", label: "正文大小", values: [["small", "小"], ["standard", "标准"], ["large", "大"], ["xlarge", "特大"]] },
  { key: "leading", label: "行间距", values: [["compact", "紧凑"], ["standard", "标准"], ["loose", "宽松"], ["comfortable", "舒适"]] },
  { key: "background", label: "阅读背景", values: [["white", "纯白"], ["warm", "暖白"], ["gray", "浅灰"], ["dark", "深色"]] },
  { key: "width", label: "正文宽度", values: [["narrow", "窄"], ["standard", "标准"], ["wide", "宽"]] },
] as const;

export function FocusReader({ topic, category, sections, points, notes, userId, initialPointId, preferences, onPreferencesChange, savedOffline, onToggleOffline, onOpenMenu, onBack, backLabel = "知识库", onExit }: {
  topic: Topic;
  category: string;
  sections: KnowledgePoint[];
  points: KnowledgePoint[];
  notes: Record<string, string>;
  userId: string;
  initialPointId: string | null;
  preferences: ReaderPreferences;
  onPreferencesChange: (next: ReaderPreferences) => void;
  savedOffline: boolean;
  onToggleOffline: () => void;
  onOpenMenu: () => void;
  onBack: () => void;
  backLabel?: string;
  onExit: (pointId: string | null) => void;
}) {
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [bookmark, setBookmark] = useState<ReadingBookmark | null>(null);
  const [readSeconds, setReadSeconds] = useState(0);
  const movedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ordered = points.filter(point => point.parent_id);
  const activeIndex = Math.max(0, ordered.findIndex(point => point.id === activeId));

  useEffect(() => {
    if (!points.length) return;
    window.scrollTo(0, 0);
    movedRef.current = false;
    let readyToSave = false;
    const readyTimer = window.setTimeout(() => { readyToSave = true; }, 250);
    const positionKey = `im:reading-position:${userId}:${topic.id}`;
    const db = getBrowserClient();
    let localBookmark: ReadingBookmark | null = null;
    let latestPosition: Pick<ReadingBookmark, "progress" | "pointId"> | null = null;
    let cancelled = false;
    function restore(saved: ReadingBookmark) {
      if (initialPointId || saved.progress <= 3 || saved.progress >= 97) return;
      queueMicrotask(() => setBookmark(saved));
      if (!window.matchMedia("(max-width: 760px)").matches) return;
      requestAnimationFrame(() => {
        if (movedRef.current) return;
        readyToSave = false;
        const point = saved.pointId && document.getElementById(`focus-point-${saved.pointId}`);
        if (point) point.scrollIntoView({ behavior: "instant", block: "start" });
        else window.scrollTo({ top: Math.max(0, (document.documentElement.scrollHeight - window.innerHeight) * saved.progress / 100), behavior: "instant" });
        setBookmark(null);
        window.setTimeout(() => { readyToSave = true; }, 250);
      });
    }
    try {
      localBookmark = JSON.parse(window.localStorage.getItem(positionKey) || "null") as ReadingBookmark | null;
      if (localBookmark && Number.isFinite(localBookmark.progress)) restore(localBookmark);
    } catch { queueMicrotask(() => setBookmark(null)); }
    if (navigator.onLine && db) {
      void db.from("user_reading_positions").select("point_id,progress,updated_at").eq("user_id", userId).eq("topic_id", topic.id).maybeSingle().then(({ data }) => {
        if (cancelled || !data) return;
        if (localBookmark?.savedAt && localBookmark.savedAt > data.updated_at) {
          void db.from("user_reading_positions").upsert({ user_id: userId, topic_id: topic.id, point_id: localBookmark.pointId, progress: localBookmark.progress, updated_at: localBookmark.savedAt }, { onConflict: "user_id,topic_id" });
          return;
        }
        const remote = { pointId: data.point_id, progress: data.progress, savedAt: data.updated_at };
        window.localStorage.setItem(positionKey, JSON.stringify(remote));
        if (!movedRef.current) restore(remote);
      });
    }
    function savePosition() {
      if (!movedRef.current || !latestPosition) return;
      const { progress: current, pointId } = latestPosition;
      const savedAt = new Date().toISOString();
      window.localStorage.setItem(positionKey, JSON.stringify({ progress: current, pointId, savedAt }));
      if (pointId) window.localStorage.setItem(`im:last-point:${userId}:${topic.id}`, pointId);
      window.localStorage.setItem(`im:last-topic:${userId}`, topic.id);
      window.localStorage.setItem(`im:last-topic-at:${userId}`, savedAt);
      if (navigator.onLine && db) void db.from("user_reading_positions").upsert({ user_id: userId, topic_id: topic.id, point_id: pointId, progress: current, updated_at: savedAt }, { onConflict: "user_id,topic_id" });
    }
    function readPosition(): Pick<ReadingBookmark, "progress" | "pointId"> {
      const distance = document.documentElement.scrollHeight - window.innerHeight;
      const current = distance > 0 ? Math.min(100, Math.round(window.scrollY / distance * 100)) : 100;
      const visible = ordered.filter(point => {
        const element = document.getElementById(`focus-point-${point.id}`);
        return element && element.getBoundingClientRect().top < window.innerHeight * .48;
      });
      return { progress: current, pointId: visible.at(-1)?.id || null };
    }
    function update() {
      const distance = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(distance > 0 ? Math.min(100, Math.round(window.scrollY / distance * 100)) : 100);
      const visible = ordered.filter(point => {
        const element = document.getElementById(`focus-point-${point.id}`);
        return element && element.getBoundingClientRect().top < window.innerHeight * .48;
      });
      setActiveId(visible.at(-1)?.id || ordered[0]?.id || null);
    }
    function onScroll() {
      update();
      if (!readyToSave) return;
      movedRef.current = true;
      latestPosition = readPosition();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(savePosition, 2000);
    }
    if (initialPointId) document.getElementById(`focus-point-${initialPointId}`)?.scrollIntoView({ behavior: "auto", block: "start" });
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelled = true;
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      window.clearTimeout(readyTimer);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      savePosition();
    };
  // Entering another topic mounts a new reader; the scroll handler reads the current DOM.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic.id, points.length, userId, initialPointId]);

  useEffect(() => {
    const key = `im:reading-time:${userId}:${topic.id}`;
    const saved = Number(window.localStorage.getItem(key) || 0);
    let seconds = Number.isFinite(saved) && saved > 0 ? saved : 0;
    queueMicrotask(() => setReadSeconds(seconds));
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      seconds += 1;
      setReadSeconds(seconds);
      if (seconds % 10 === 0) window.localStorage.setItem(key, String(seconds));
    }, 1000);
    return () => { window.clearInterval(timer); window.localStorage.setItem(key, String(seconds)); };
  }, [topic.id, userId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { setTocOpen(false); setSettingsOpen(false); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTocOpen(false);
  }
  function resume() {
    if (!bookmark) return;
    const point = bookmark.pointId && document.getElementById(`focus-point-${bookmark.pointId}`);
    if (point) point.scrollIntoView({ behavior: "smooth", block: "start" });
    else {
      const distance = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: Math.max(0, distance * bookmark.progress / 100), behavior: "smooth" });
    }
    setBookmark(null);
  }

  return <div className={`focus-reader focus-size-${preferences.size} focus-leading-${preferences.leading} focus-bg-${preferences.background} focus-width-${preferences.width}`}>
    <header className="focus-header">
      <div className="focus-header-inner"><button className="focus-menu" onClick={onOpenMenu} aria-label="打开侧栏">☰</button><button className="focus-back" onClick={onBack}>← <span>返回{backLabel}</span></button><span className="focus-breadcrumb">{category} / {topic.title}</span><div className="focus-tools">{topic.status === "published" && <button onClick={onToggleOffline} aria-pressed={savedOffline}>{savedOffline ? "已离线" : "存离线"}</button>}<button onClick={() => { setTocOpen(value => !value); setSettingsOpen(false); }} aria-expanded={tocOpen}>目录</button><button onClick={() => { setSettingsOpen(value => !value); setTocOpen(false); }} aria-expanded={settingsOpen}>阅读设置</button><button className="focus-exit" onClick={() => onExit(activeId)}>退出专注</button></div></div>
      <div className="focus-progress-track" role="progressbar" aria-label="阅读进度" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
    </header>

    {settingsOpen && <div className="focus-settings" role="dialog" aria-label="阅读偏好设置"><div className="focus-panel-head"><strong>阅读偏好</strong><button onClick={() => setSettingsOpen(false)} aria-label="关闭阅读设置">×</button></div>{options.map(group => <fieldset key={group.key}><legend>{group.label}</legend><div className="focus-options">{group.values.map(([value, label]) => <button key={value} className={preferences[group.key] === value ? "selected" : ""} onClick={() => onPreferencesChange({ ...preferences, [group.key]: value })}>{label}</button>)}</div></fieldset>)}</div>}
    {tocOpen && <><button className="focus-drawer-backdrop" aria-label="关闭目录" onClick={() => setTocOpen(false)} /><aside className="focus-toc" aria-label="专题目录"><div className="focus-panel-head"><strong>本章目录</strong><button onClick={() => setTocOpen(false)} aria-label="关闭目录">×</button></div>{sections.map(section => <div className="focus-toc-section" key={section.id}><button className="focus-toc-chapter" onClick={() => jump(`focus-section-${section.id}`)}>{section.title}</button>{points.filter(point => point.parent_id === section.id).map(point => <button className={activeId === point.id ? "active" : ""} key={point.id} onClick={() => jump(`focus-point-${point.id}`)}>{point.title}</button>)}</div>)}</aside></>}
    {!tocOpen && <button className="focus-back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}>↑</button>}

    <article className="focus-article"><div className="focus-title"><div className="focus-category">{category} · 专题阅读</div><h1>{topic.title}</h1><TopicAnswerFocus answer={readTopicAnswer(sections[0]?.content_md)} />{topic.summary && <p>{topic.summary}</p>}<div className="focus-progress-caption"><span>阅读进度 <strong>{progress}%</strong></span><span>专注用时 <strong>{String(Math.floor(readSeconds / 60)).padStart(2, "0")}:{String(readSeconds % 60).padStart(2, "0")}</strong></span></div>{bookmark && <button className="focus-resume" onClick={resume}>继续上次阅读（{bookmark.progress}%） →</button>}</div>
      {sections.length ? sections.map(section => <section className="focus-chapter" id={`focus-section-${section.id}`} key={section.id}><h2>{section.title}</h2>{points.filter(point => point.parent_id === section.id).map(point => <section className="focus-point" id={`focus-point-${point.id}`} key={point.id}><h3>{point.title}</h3><PointContent content={point.content_md || "暂无正文"} />{point.example_md && <div className="focus-example"><div className="focus-example-label">配置或代码示例</div><MarkdownContent content={point.example_md} /></div>}{point.key_takeaways?.length > 0 && <div className="focus-takeaways"><strong>补充要点</strong><ul>{point.key_takeaways.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}{point.common_mistakes?.length > 0 && <div className="focus-mistakes"><strong>易错点</strong><ul>{point.common_mistakes.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}{point.interview_questions?.length > 0 && <details className="focus-questions"><summary>面试追问 · {point.interview_questions.length} 题</summary><ul>{point.interview_questions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}</section>)}{notes[section.id] && <details className="focus-note"><summary>本章笔记</summary><MarkdownContent content={notes[section.id]} prose /></details>}</section>) : <p className="focus-empty">专题还没有知识点，生成完成后可以在这里连续阅读。</p>}
    </article>
    {ordered.length > 0 && <nav className="focus-point-nav" aria-label="知识点导航"><button disabled={activeIndex <= 0} onClick={() => jump(`focus-point-${ordered[activeIndex - 1]?.id}`)}>← 上一个</button><span>{activeIndex + 1} / {ordered.length}</span><button disabled={activeIndex >= ordered.length - 1} onClick={() => jump(`focus-point-${ordered[activeIndex + 1]?.id}`)}>下一个 →</button></nav>}
  </div>;
}

