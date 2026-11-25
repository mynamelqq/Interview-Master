"use client";

import { useEffect, useState } from "react";
import { MarkdownContent } from "@/components/markdown-content";
import { readCardContent } from "@/lib/card-content";
import type { KnowledgePoint, Topic } from "@/lib/types";
import { isReviewDue, type ReviewLevel, type ReviewProgress, type ReviewUndo } from "@/lib/review-schedule";
import type { ReaderPreferences } from "@/components/focus-reader";

const ratings = ["完全不会", "不熟悉", "基本掌握", "熟练掌握"] as const;
const preferenceGroups = [
  { key: "size", label: "字体大小", values: [["small", "小"], ["standard", "标准"], ["large", "大"], ["xlarge", "特大"]] },
  { key: "leading", label: "行距", values: [["compact", "紧凑"], ["standard", "标准"], ["loose", "宽松"], ["comfortable", "舒适"]] },
  { key: "background", label: "阅读主题", values: [["white", "纯白"], ["warm", "暖白"], ["gray", "浅灰"], ["dark", "深色"]] },
] as const;

type LastRating = { undo: ReviewUndo; order: string[]; position: number; later: string[] };

export function CardReview({ topic, category, sections, points, notes, progress, preferences, onPreferencesChange, onSaveNote, onRate, onUndo, onExit }: {
  topic: Topic;
  category: string;
  sections: KnowledgePoint[];
  points: KnowledgePoint[];
  notes: Record<string, string>;
  progress: Record<string, ReviewProgress>;
  preferences: ReaderPreferences;
  onPreferencesChange: (next: ReaderPreferences) => void;
  onSaveNote: (pointId: string, content: string) => Promise<boolean>;
  onRate: (pointId: string, level: ReviewLevel) => Promise<ReviewUndo | null>;
  onUndo: (undo: ReviewUndo) => Promise<boolean>;
  onExit: (pointId: string | null) => void;
}) {
  const [order, setOrder] = useState(() => points.filter(point => isReviewDue(progress[point.id]?.next_review_at)).map(point => point.id));
  const [position, setPosition] = useState(0);
  const [later, setLater] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [deferredReady, setDeferredReady] = useState(false);
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [lastRating, setLastRating] = useState<LastRating | null>(null);
  const current = points.find(point => point.id === order[position]);
  const currentId = current?.id;
  const content = readCardContent(current?.content_md);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setNoteDraft(currentId ? notes[currentId] || "" : "");
      setNoteOpen(false);
    });
    return () => { cancelled = true; };
  }, [currentId, notes]);

  function moveTo(next: number) {
    setPosition(next);
    setShown(false);
    setDone(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function advance() {
    if (position + 1 < order.length) moveTo(position + 1);
    else if (later.length) { setOrder(later); setLater([]); moveTo(0); }
    else { setDone(true); setDeferredReady(false); setShown(false); }
  }
  async function rate(level: ReviewLevel) {
    if (!current || !shown || saving) return;
    setSaving(true);
    try {
      const undo = await onRate(current.id, level);
      if (undo) { setLastRating({ undo, order, position, later }); advance(); }
    } finally { setSaving(false); }
  }
  async function undoRating() {
    if (!lastRating || saving) return;
    setSaving(true);
    try {
      if (await onUndo(lastRating.undo)) {
        setOrder(lastRating.order); setPosition(lastRating.position); setLater(lastRating.later);
        setDone(false); setShown(true); setLastRating(null);
      }
    } finally { setSaving(false); }
  }
  function laterReview() {
    if (!current) return;
    setLater(previous => [...previous, current.id]);
    if (position + 1 < order.length) moveTo(position + 1);
    else { setOrder([...later, current.id]); setLater([]); setPosition(0); setShown(false); setDeferredReady(true); setDone(true); }
  }
  function jumpTo(pointId: string) {
    const index = order.indexOf(pointId);
    if (index >= 0) moveTo(index);
    else { setOrder(previous => [...previous, pointId]); moveTo(order.length); setLater(previous => previous.filter(id => id !== pointId)); }
    setTocOpen(false);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT|BUTTON|A/.test(target.tagName) || target.isContentEditable) return;
      if (event.code === "Space" && !done) { event.preventDefault(); setShown(true); }
      if (event.key === "ArrowRight" && !done) { event.preventDefault(); advance(); }
      if (event.key === "ArrowLeft" && position > 0) { event.preventDefault(); moveTo(position - 1); }
      if (/^[1-4]$/.test(event.key) && shown && !done) { event.preventDefault(); void rate(Number(event.key) as ReviewLevel); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return <div className={`card-review-page card-size-${preferences.size} card-leading-${preferences.leading} card-bg-${preferences.background}`}>
    <header className="card-mode-header"><button className="card-back" onClick={() => onExit(null)}>← 返回专题</button><span>{category} / 知识点复习</span><div className="card-mode-tools"><button onClick={() => { setTocOpen(value => !value); setSettingsOpen(false); }} aria-expanded={tocOpen}>目录</button><button onClick={() => { setSettingsOpen(value => !value); setTocOpen(false); }} aria-expanded={settingsOpen}>设置</button><button onClick={() => onExit(current?.id || null)}>退出</button></div></header>
    {tocOpen && <div className="card-popover card-toc" role="dialog" aria-label="知识点目录"><strong>本章目录</strong>{sections.map(section => <div key={section.id}><span>{section.title}</span>{points.filter(point => point.parent_id === section.id).map(point => <button key={point.id} className={current?.id === point.id ? "active" : ""} onClick={() => jumpTo(point.id)}>{point.title}</button>)}</div>)}</div>}
    {settingsOpen && <div className="card-popover card-settings" role="dialog" aria-label="卡片阅读设置"><strong>阅读设置</strong>{preferenceGroups.map(group => <fieldset key={group.key}><legend>{group.label}</legend><div>{group.values.map(([value, label]) => <button key={value} className={preferences[group.key] === value ? "active" : ""} onClick={() => onPreferencesChange({ ...preferences, [group.key]: value })}>{label}</button>)}</div></fieldset>)}</div>}
    <main className="card-stage"><div className="card-stage-heading"><span>{topic.title}</span><strong>知识点复习</strong></div>
      {lastRating && <div className="card-undo" role="status">评分已保存，下次复习：{new Date(lastRating.undo.scheduledAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}<button disabled={saving} onClick={() => void undoRating()}>撤销上次评分</button></div>}
      {done ? <div className="flashcard card-done"><h2>{deferredReady ? "稍后复习的卡片已排好" : "本轮复习完成"}</h2><p>{deferredReady ? "准备好后继续复习刚才暂放的知识点。" : "已看完本轮卡片。跳过的题目没有计入掌握度。"}</p>{deferredReady && <button onClick={() => { setDeferredReady(false); moveTo(0); }}>继续复习</button>}<button onClick={() => onExit(null)}>返回专题</button></div> : current ? <div className="flashcard" key={current.id}>
        <div className="card-top"><span>{category}</span><span>{String(position + 1).padStart(2, "0")} / {String(order.length).padStart(2, "0")}</span></div>
        <div className="card-progress" role="progressbar" aria-label="复习进度" aria-valuenow={position + 1} aria-valuemin={1} aria-valuemax={order.length}><span style={{ width: `${((position + 1) / order.length) * 100}%` }} /></div>
        <div className="card-question"><p className="card-prompt">先独立回忆，再查看参考内容</p><h2>{current.title}</h2><div className="card-recall"><strong>先想一想</strong><p>{content.prompt || `尝试解释「${current.title}」的原理、适用场景和关键取舍。`}</p></div>{!shown && <button className="card-reveal" onClick={() => setShown(true)}>显示参考内容</button>}</div>
        {shown && <><div className="card-answer"><div className="card-section-label">参考内容</div><MarkdownContent content={content.reference || "暂无参考内容"} prose />{current.key_takeaways?.length > 0 && <div className="card-detail"><strong>核心结论与补充要点</strong><ul>{current.key_takeaways.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}{current.example_md && <div className="card-detail"><strong>代码或配置示例</strong><MarkdownContent content={current.example_md} /></div>}{current.common_mistakes?.length > 0 && <div className="card-detail"><strong>易错点</strong><ul>{current.common_mistakes.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}{current.interview_questions?.length > 0 && <div className="card-detail"><strong>面试追问</strong><ul>{current.interview_questions.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}</div>
          <div className="card-note"><button onClick={() => setNoteOpen(value => !value)} aria-expanded={noteOpen}>我的补充笔记 {notes[current.id] ? "· 已记录" : ""}</button>{noteOpen && <><textarea aria-label="我的补充笔记" rows={4} placeholder="记录刚才遗漏或容易混淆的内容…" value={noteDraft} onChange={event => setNoteDraft(event.target.value)} /><button className="card-note-save" disabled={saving} onClick={async () => { setSaving(true); try { if (await onSaveNote(current.id, noteDraft)) setNoteOpen(false); } finally { setSaving(false); } }}>保存笔记</button></>}</div>
          <div className="card-review"><div className="card-section-label">这次掌握得怎么样？</div><div className="card-ratings">{ratings.map((label, index) => <button key={label} disabled={saving} onClick={() => void rate((index + 1) as ReviewLevel)}><kbd>{index + 1}</kbd>{label}</button>)}</div></div></>}
        <div className="card-controls"><button disabled={position === 0 || saving} onClick={() => moveTo(position - 1)}>← 上一个</button><span>Space 看答案 · 1–4 评分 · ← → 切换</span><div><button disabled={saving} onClick={laterReview}>稍后复习</button><button disabled={saving} onClick={advance}>跳过本题</button><button disabled={saving} onClick={advance}>下一个 →</button></div></div>
      </div> : <div className="flashcard card-done"><h2>当前没有到期的知识点</h2><p>已评分的知识点会按下次复习时间重新出现。也可以提前复习全部内容。</p><button onClick={() => { setOrder(points.map(point => point.id)); moveTo(0); }}>提前复习全部</button><button onClick={() => onExit(null)}>返回专题</button></div>}
    </main>
  </div>;
}
