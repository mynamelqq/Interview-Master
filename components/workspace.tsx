"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase";
import type { Category, GenerationJob, KnowledgePoint, Topic } from "@/lib/types";
import { MarkdownContent } from "@/components/markdown-content";
import { normalizeMarkdown } from "@/lib/markdown";
import { FocusReader, defaultReaderPreferences, type ReaderPreferences } from "@/components/focus-reader";
import { TopicAnswerFocus } from "@/components/topic-answer-focus";
import { readTopicAnswer } from "@/lib/topic-answer";
import { scheduleReview, type ReviewLevel, type ReviewProgress, type ReviewUndo } from "@/lib/review-schedule";
import { CardReview } from "@/components/card-review";
import { reviewableDrafts } from "@/lib/topic-workflow";
import { recommendPoints, type PointActivity, type PointCandidate, type PointRecommendation } from "@/lib/point-recommendations";
import { CasualCards } from "@/components/casual-cards";
import { ReadingActivityTracker } from "@/components/reading-activity-tracker";

type View = "home" | "library" | "drafts" | "create" | "reader" | "browse";
type PointsLoad = { topicId: string | null; status: "idle" | "loading" | "loaded" | "error" };
type TopicInsight = { pointCount: number; verifiedCount: number; ratedCount: number; masteredCount: number; weakCount: number; viewedCount: number; lastViewedAt: string | null; lastReviewedAt: string | null };
type SearchPoint = PointCandidate;
const db = getBrowserClient();

function chooseRandomTopic(topics: Topic[], previousId: string | null): Topic | null {
  const choices = topics.filter(topic => topics.length === 1 || topic.id !== previousId);
  return choices.length ? choices[Math.floor(Math.random() * choices.length)] : null;
}

export function Workspace({ initialTopicId }: { initialTopicId?: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const authUserIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>(initialTopicId ? "reader" : "home");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsLoad, setTopicsLoad] = useState<"loading" | "loaded" | "error">("loading");
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [topicInsights, setTopicInsights] = useState<Record<string, TopicInsight>>({});
  const [insightsStatus, setInsightsStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [searchPoints, setSearchPoints] = useState<SearchPoint[]>([]);
  const [pointActivity, setPointActivity] = useState<Record<string, PointActivity>>({});
  const [recommendations, setRecommendations] = useState<PointRecommendation[]>([]);
  const completedJobsRef = useRef("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [points, setPoints] = useState<KnowledgePoint[]>([]);
  const [pointsLoad, setPointsLoad] = useState<PointsLoad>({ topicId: initialTopicId || null, status: initialTopicId ? "loading" : "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(initialTopicId || null);
  const selectedIdRef = useRef<string | null>(initialTopicId || null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState(false);
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(defaultReaderPreferences);
  const readerPreferencesUserId = useRef<string | null>(null);
  const preferenceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [readingNavOpen, setReadingNavOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [topicsHidden, setTopicsHidden] = useState(false);
  const [mobileTopicsOpen, setMobileTopicsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [closedSections, setClosedSections] = useState<string[]>([]);
  const [mastery, setMastery] = useState<Record<string, number>>({});
  const [reviewProgress, setReviewProgress] = useState<Record<string, ReviewProgress>>({});
  const [reviewsReady, setReviewsReady] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"read" | "cards">("read");
  const [lastTopicId, setLastTopicId] = useState<string | null>(null);
  const [lastPointId, setLastPointId] = useState<string | null>(null);
  const [lastRandomTopicId, setLastRandomTopicId] = useState<string | null>(null);
  const pendingReadPointId = useRef<string | null>(null);
  const activityRef = useRef(pointActivity);
  useEffect(() => { activityRef.current = pointActivity; }, [pointActivity]);

  const loadInsights = useCallback(async () => {
    if (!db) return;
    const pageSize = 500;
    async function fetchPointRows() {
      const rows: { id: string; topic_id: string; parent_id: string | null; title: string; verification_status: string }[] = [];
      for (let start = 0; ; start += pageSize) {
        const { data, error: loadError } = await db!.from("knowledge_points").select("id,topic_id,parent_id,title,verification_status").order("id").range(start, start + pageSize - 1);
        if (loadError) throw loadError;
        rows.push(...(data || []));
        if (!data || data.length < pageSize) return rows;
      }
    }
    async function fetchProgressRows() {
      const rows: { knowledge_point_id: string; mastery_level: number; last_reviewed_at: string | null }[] = [];
      for (let start = 0; ; start += pageSize) {
        const { data, error: loadError } = await db!.from("user_point_progress").select("knowledge_point_id,mastery_level,last_reviewed_at").order("knowledge_point_id").range(start, start + pageSize - 1);
        if (loadError) throw loadError;
        rows.push(...(data || []));
        if (!data || data.length < pageSize) return rows;
      }
    }
    async function fetchActivityRows() {
      const rows: PointActivity[] = [];
      for (let start = 0; ; start += pageSize) {
        const { data, error: loadError } = await db!.from("user_point_activity").select("knowledge_point_id,view_count,reading_seconds,last_viewed_at,card_seen_count,last_card_seen_at,is_favorite,excluded_until").order("knowledge_point_id").range(start, start + pageSize - 1);
        if (loadError) throw loadError;
        rows.push(...(data || []));
        if (!data || data.length < pageSize) return rows;
      }
    }
    let pointRows: Awaited<ReturnType<typeof fetchPointRows>>;
    let progressRows: Awaited<ReturnType<typeof fetchProgressRows>>;
    let activityRows: PointActivity[];
    try { [pointRows, progressRows, activityRows] = await Promise.all([fetchPointRows(), fetchProgressRows(), fetchActivityRows()]); }
    catch { setInsightsStatus("error"); return; }
    pointRows = pointRows.filter(point => point.parent_id);
    const progress = new Map(progressRows.map(row => [row.knowledge_point_id, row]));
    const activities = Object.fromEntries(activityRows.map(row => [row.knowledge_point_id, row]));
    const insights: Record<string, TopicInsight> = {};
    for (const point of pointRows) {
      const entry = insights[point.topic_id] ||= { pointCount: 0, verifiedCount: 0, ratedCount: 0, masteredCount: 0, weakCount: 0, viewedCount: 0, lastViewedAt: null, lastReviewedAt: null };
      entry.pointCount += 1;
      const activity = activities[point.id];
      if (activity?.view_count > 0) {
        entry.viewedCount += 1;
        if (activity.last_viewed_at && (!entry.lastViewedAt || activity.last_viewed_at > entry.lastViewedAt)) entry.lastViewedAt = activity.last_viewed_at;
      }
      if (point.verification_status === "verified") entry.verifiedCount += 1;
      const review = progress.get(point.id);
      if (review) {
        entry.ratedCount += 1;
        if (review.mastery_level >= 3) entry.masteredCount += 1;
        else entry.weakCount += 1;
        if (review.last_reviewed_at && (!entry.lastReviewedAt || review.last_reviewed_at > entry.lastReviewedAt)) entry.lastReviewedAt = review.last_reviewed_at;
      }
    }
    setTopicInsights(insights);
    setSearchPoints(pointRows.map(point => ({ id: point.id, topic_id: point.topic_id, title: point.title })));
    setPointActivity(activities);
    setInsightsStatus("loaded");
  }, []);

  const load = useCallback(async () => {
    if (!db) return;
    const [topicResult, categoryResult] = await Promise.all([
      db.from("topics").select("*").order("created_at", { ascending: false }),
      db.from("categories").select("*").order("sort_order").order("name"),
    ]);
    if (topicResult.error) { setError(topicResult.error.message); setTopicsLoad("error"); }
    else { setTopics(topicResult.data as Topic[]); setTopicsLoad("loaded"); }
    if (!categoryResult.error) setCategories(categoryResult.data as Category[]);
  }, []);
  const loadJobs = useCallback(async () => {
    if (!db) return;
    const rows: GenerationJob[] = [];
    for (let start = 0; ; start += 100) {
      const { data, error: jobsError } = await db.from("topic_generation_jobs").select("id,topic_id,input_title,status,raw_output,error_message,created_at,finished_at").order("created_at", { ascending: false }).range(start, start + 99);
      if (jobsError) { setError(jobsError.message); setJobsLoaded(true); return; }
      rows.push(...(data as GenerationJob[] || []));
      if (!data || data.length < 100) break;
    }
    const stale = rows.filter(job => (job.status === "pending" || job.status === "running") && Date.now() - new Date(job.created_at).getTime() > 6 * 60 * 1000);
    for (const job of stale) {
      await db.from("topic_generation_jobs").update({ status: "failed", error_message: "生成任务超时，请重新创建专题。", finished_at: new Date().toISOString() }).eq("id", job.id).in("status", ["pending", "running"]);
      if (job.topic_id) await db.from("topics").update({ generation_status: "failed" }).eq("id", job.topic_id).in("generation_status", ["pending", "running"]);
    }
    setJobs(rows.map(job => stale.some(item => item.id === job.id) ? { ...job, status: "failed", error_message: "生成任务超时，请重新创建专题。" } : job));
    setJobsLoaded(true);
    await load();
    const completedSignature = rows.filter(job => job.status === "completed").map(job => job.id).sort().join(",");
    if (completedSignature !== completedJobsRef.current) {
      completedJobsRef.current = completedSignature;
      await loadInsights();
    }
    if (selectedId && rows.some(job => job.topic_id === selectedId && job.status === "completed")) {
      const { data: latestPoints } = await db.from("knowledge_points").select("*").eq("topic_id", selectedId).order("sort_order");
      if (latestPoints && selectedIdRef.current === selectedId) { setPoints(latestPoints as KnowledgePoint[]); setPointsLoad({ topicId: selectedId, status: "loaded" }); }
    }
  }, [load, loadInsights, selectedId]);

  useEffect(() => {
    if (!db) { queueMicrotask(() => setReady(true)); return; }
    function applyUser(next: User | null) {
      if (authUserIdRef.current !== (next?.id || null)) {
        authUserIdRef.current = next?.id || null;
        setTopics([]);
        setIsAdmin(null);
        setView(initialTopicId ? "reader" : "home");
        setTopicsLoad("loading");
        setJobs([]);
        setJobsLoaded(false);
        setTaskDrawerOpen(false);
        setTopicInsights({});
        setInsightsStatus("loading");
        setSearchPoints([]);
        setPointActivity({});
        completedJobsRef.current = "";
        setPoints([]);
        setReviewsReady(false);
        setPointsLoad({ topicId: selectedIdRef.current, status: selectedIdRef.current ? "loading" : "idle" });
      }
      setUser(next);
    }
    db.auth.getUser().then(({ data }) => { applyUser(data.user); setReady(true); });
    const { data: listener } = db.auth.onAuthStateChange((_event, session) => applyUser(session?.user || null));
    return () => listener.subscription.unsubscribe();
  }, [initialTopicId]);
  useEffect(() => {
    if (!db || !user) return;
    let cancelled = false;
    void db.from("profiles").select("is_admin").eq("id", user.id).single().then(({ data, error: roleError }) => {
      if (cancelled) return;
      if (roleError) setError("无法读取账户权限，请确认已执行管理员迁移。");
      setIsAdmin(!roleError && data?.is_admin === true);
    });
    return () => { cancelled = true; };
  }, [user]);
  useEffect(() => {
    if (!user) return;
    const topicId = window.localStorage.getItem(`im:last-topic:${user.id}`);
    queueMicrotask(() => { setLastTopicId(topicId); setLastPointId(topicId ? window.localStorage.getItem(`im:last-point:${user.id}:${topicId}`) : null); });
  }, [user]);
  useEffect(() => {
    if (!user) { readerPreferencesUserId.current = null; return; }
    if (readerPreferencesUserId.current === user.id) return;
    readerPreferencesUserId.current = user.id;
    const saved = user.user_metadata?.reader_preferences as Partial<ReaderPreferences> | undefined;
    let local: Partial<ReaderPreferences> | undefined;
    try { local = JSON.parse(window.localStorage.getItem(`im:reader-preferences:${user.id}`) || "null") || undefined; } catch { local = undefined; }
    queueMicrotask(() => setReaderPreferences({ ...defaultReaderPreferences, ...(local || {}), ...(saved || {}) }));
  }, [user]);
  useEffect(() => () => { if (preferenceSaveTimer.current) clearTimeout(preferenceSaveTimer.current); }, []);
  useEffect(() => { if (user) { void Promise.resolve().then(load); } }, [user, load]);
  useEffect(() => { if (user) { void Promise.resolve().then(loadInsights); } }, [user, loadInsights]);
  useEffect(() => {
    if (!user || isAdmin !== true) return;
    void Promise.resolve().then(loadJobs);
    const timer = window.setInterval(() => { void loadJobs(); }, 5000);
    return () => window.clearInterval(timer);
  }, [user, isAdmin, loadJobs]);
  useEffect(() => {
    if (!db || !selectedId || !user) return;
    let cancelled = false;
    db.from("knowledge_points").select("*").eq("topic_id", selectedId).order("sort_order").then(({ data, error: loadError }) => {
      if (cancelled) return;
      if (loadError) { setError(loadError.message); setPointsLoad({ topicId: selectedId, status: "error" }); }
      else {
        const loaded = data as KnowledgePoint[];
        setPoints(loaded);
        setPointsLoad({ topicId: selectedId, status: "loaded" });
        const ids = loaded.filter(point => point.parent_id).map(point => point.id);
        if (!ids.length) { setMastery({}); setReviewProgress({}); setNotes({}); setReviewsReady(true); return; }
        void Promise.all([
          db!.from("user_point_progress").select("knowledge_point_id,mastery_level,repetition_count,interval_days,last_reviewed_at,next_review_at").eq("user_id", user.id).in("knowledge_point_id", ids),
          db!.from("user_point_notes").select("knowledge_point_id,content_md").eq("user_id", user.id).in("knowledge_point_id", ids),
        ]).then(([progressResult, noteResult]) => {
          if (cancelled) return;
          if (progressResult.error) setError(progressResult.error.message);
          else {
            setMastery(Object.fromEntries((progressResult.data || []).map(row => [row.knowledge_point_id, row.mastery_level])));
            setReviewProgress(Object.fromEntries((progressResult.data || []).map(({ knowledge_point_id, ...progress }) => [knowledge_point_id, progress])));
          }
          if (noteResult.error) setError(noteResult.error.message);
          else setNotes(Object.fromEntries((noteResult.data || []).map(row => [row.knowledge_point_id, row.content_md])));
          setReviewsReady(true);
        });
      }
    });
    return () => { cancelled = true; };
  }, [selectedId, user]);
  useEffect(() => {
    if (view !== "reader" || mode !== "read") return;
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".article .point-block, .article section[id]"));
    if (!elements.length) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActivePointId(visible[0].target.id);
    }, { rootMargin: "-8% 0px -65% 0px", threshold: 0 });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [view, mode, points, selectedId]);
  useEffect(() => {
    const onHistoryChange = () => {
      const match = window.location.pathname.match(/^\/knowledge\/([^/]+)$/);
      selectedIdRef.current = match?.[1] || null;
      setSelectedId(match?.[1] || null);
      setPoints([]);
      setPointsLoad({ topicId: match?.[1] || null, status: match ? "loading" : "idle" });
      setMastery({});
      setReviewProgress({});
      setReviewsReady(false);
      setNotes({});
      setView(match ? "reader" : "home");
      setFocus(false);
      setReadingNavOpen(false);
    };
    window.addEventListener("popstate", onHistoryChange);
    return () => window.removeEventListener("popstate", onHistoryChange);
  }, []);

  const selected = topics.find(topic => topic.id === selectedId);
  const publishedTopics = topics.filter(topic => topic.status === "published");
  const draftTopics = isAdmin ? reviewableDrafts(topics, jobs, jobsLoaded) : [];
  const sections = points.filter(point => !point.parent_id);
  const cards = points.filter(point => point.parent_id);
  function jumpToTocTarget(event: React.MouseEvent<HTMLAnchorElement>, targetId: string) {
    event.preventDefault();
    const target = document.getElementById(targetId);
    if (!target) return;
    const offset = window.matchMedia("(max-width: 760px)").matches ? 76 : 24;
    window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top - offset, behavior: "instant" });
    window.history.replaceState(window.history.state, "", `#${targetId}`);
    setActivePointId(targetId);
    setTocOpen(false);
  }
  const continueTopic = publishedTopics.find(topic => topic.id === lastTopicId) || publishedTopics[0];
  const recommendationPool = useMemo(() => {
    const publishedIds = new Set(topics.filter(topic => topic.status === "published").map(topic => topic.id));
    return searchPoints.filter(point => publishedIds.has(point.topic_id));
  }, [searchPoints, topics]);
  useEffect(() => {
    queueMicrotask(() => setRecommendations(recommendPoints(recommendationPool, pointActivity, 3)));
  }, [recommendationPool, pointActivity]);
  async function rateCard(pointId: string, level: ReviewLevel): Promise<ReviewUndo | null> {
    if (!db || !user) return null;
    const previous = reviewProgress[pointId] || null;
    const now = new Date();
    const next: ReviewProgress = { mastery_level: level, repetition_count: (previous?.repetition_count || 0) + 1, last_reviewed_at: now.toISOString(), ...scheduleReview(level, now) };
    const { error: saveError } = await db.from("user_point_progress").upsert({ user_id: user.id, knowledge_point_id: pointId, ...next }, { onConflict: "user_id,knowledge_point_id" });
    if (saveError) { setError(saveError.message); return null; }
    const { data: record, error: recordError } = await db.from("review_records").insert({ user_id: user.id, knowledge_point_id: pointId, mastery_before: previous?.mastery_level ?? null, mastery_after: level, viewed_answer: true, reviewed_at: now.toISOString(), next_review_at: next.next_review_at }).select("id").single();
    if (recordError) setError(`掌握度已保存，复习记录保存失败：${recordError.message}`);
    setReviewProgress(current => ({ ...current, [pointId]: next }));
    setMastery(current => ({ ...current, [pointId]: level }));
    void loadInsights();
    return { pointId, previous, recordId: record?.id || null, scheduledAt: next.next_review_at! };
  }
  async function undoCardRating(undo: ReviewUndo): Promise<boolean> {
    if (!db || !user) return false;
    const { error: restoreError } = undo.previous
      ? await db.from("user_point_progress").upsert({ user_id: user.id, knowledge_point_id: undo.pointId, ...undo.previous }, { onConflict: "user_id,knowledge_point_id" })
      : await db.from("user_point_progress").delete().eq("user_id", user.id).eq("knowledge_point_id", undo.pointId);
    if (restoreError) { setError(restoreError.message); return false; }
    if (undo.recordId) {
      const { error: recordError } = await db.from("review_records").delete().eq("id", undo.recordId).eq("user_id", user.id);
      if (recordError) setError(`评分已撤销，复习记录清理失败：${recordError.message}`);
    }
    setReviewProgress(current => { const next = { ...current }; if (undo.previous) next[undo.pointId] = undo.previous; else delete next[undo.pointId]; return next; });
    setMastery(current => { const next = { ...current }; if (undo.previous) next[undo.pointId] = undo.previous.mastery_level; else delete next[undo.pointId]; return next; });
    void loadInsights();
    return true;
  }
  const categoryName = (id: string | null) => {
    const category = categories.find(item => item.id === id);
    if (!category) return "未分类";
    const parent = categories.find(item => item.id === category.parent_id);
    return parent ? `${parent.name} / ${category.name}` : category.name;
  };

  function openTopic(id: string, pointId?: string) {
    pendingReadPointId.current = pointId || null;
    selectedIdRef.current = id;
    setSelectedId(id); setView("reader"); setMode("read");
    setFocus(false);
    setReadingNavOpen(false);
    setPoints([]); setPointsLoad({ topicId: id, status: "loading" }); setMastery({}); setReviewProgress({}); setReviewsReady(false); setNotes({});
    setActivePointId(null); setClosedSections([]); setTocOpen(false); setMobileNavOpen(false);
    if (user) { window.localStorage.setItem(`im:last-topic:${user.id}`, id); setLastTopicId(id); setLastPointId(window.localStorage.getItem(`im:last-point:${user.id}:${id}`)); }
    window.history.pushState({}, "", `/knowledge/${id}`);
  }
  function openRandomTopic() {
    const topic = chooseRandomTopic(publishedTopics, lastRandomTopicId);
    if (!topic) return;
    setLastRandomTopicId(topic.id);
    openTopic(topic.id);
  }
  const onPointViewed = useCallback((id: string) => {
    if (!user || !selectedId) return;
    const now = new Date().toISOString();
    const previous = activityRef.current[id];
    setPointActivity(current => ({ ...current, [id]: { knowledge_point_id: id, view_count: (current[id]?.view_count || 0) + 1, reading_seconds: (current[id]?.reading_seconds || 0) + 8, last_viewed_at: now, card_seen_count: current[id]?.card_seen_count || 0, last_card_seen_at: current[id]?.last_card_seen_at || null, is_favorite: current[id]?.is_favorite || false, excluded_until: current[id]?.excluded_until || null } }));
    if (!previous?.view_count) setTopicInsights(current => ({ ...current, [selectedId]: { ...(current[selectedId] || noInsight), viewedCount: (current[selectedId]?.viewedCount || 0) + 1, lastViewedAt: now } }));
    window.localStorage.setItem(`im:last-point:${user.id}:${selectedId}`, id);
    window.localStorage.setItem(`im:last-topic:${user.id}`, selectedId);
    setLastTopicId(selectedId);
    setLastPointId(id);
  }, [selectedId, user]);
  const onCardSeen = useCallback((id: string) => {
    if (!db) return;
    void db.rpc("record_point_activity", { events: [{ knowledge_point_id: id, views: 0, seconds: 0, cards: 1 }] }).then(({ error: saveError }) => {
      if (saveError) { setError(`卡片浏览记录保存失败：${saveError.message}`); return; }
      const now = new Date().toISOString();
      setPointActivity(current => ({ ...current, [id]: { knowledge_point_id: id, view_count: current[id]?.view_count || 0, reading_seconds: current[id]?.reading_seconds || 0, last_viewed_at: current[id]?.last_viewed_at || null, card_seen_count: (current[id]?.card_seen_count || 0) + 1, last_card_seen_at: now, is_favorite: current[id]?.is_favorite || false, excluded_until: current[id]?.excluded_until || null } }));
    });
  }, []);
  useEffect(() => {
    if (view !== "reader" || mode !== "read" || pointsLoad.status !== "loaded" || !pendingReadPointId.current) return;
    const pointId = pendingReadPointId.current;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`point-${pointId}`)?.scrollIntoView({ behavior: "instant", block: "start" });
      pendingReadPointId.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [view, mode, pointsLoad]);
  function navigate(next: View) {
    if ((next === "create" || next === "drafts") && isAdmin !== true) return;
    setView(next); setError(""); setFocus(false); setMobileNavOpen(false);
    setReadingNavOpen(false);
    window.history.pushState({}, "", "/");
  }
  function changeReaderPreferences(next: ReaderPreferences) {
    setReaderPreferences(next);
    if (!user || !db) return;
    window.localStorage.setItem(`im:reader-preferences:${user.id}`, JSON.stringify(next));
    if (preferenceSaveTimer.current) clearTimeout(preferenceSaveTimer.current);
    preferenceSaveTimer.current = setTimeout(() => {
      void db.auth.updateUser({ data: { ...user.user_metadata, reader_preferences: next } }).then(({ error: saveError }) => {
        if (saveError) setError(`阅读偏好仅保存在当前设备：${saveError.message}`);
      });
    }, 350);
  }
  async function createManual(title: string) {
    if (!db || !user || isAdmin !== true) return;
    setBusy(true); setError("");
    const { data, error: saveError } = await db.from("topics").insert({ title, user_id: user.id, generation_status: "completed" }).select("id").single();
    setBusy(false);
    if (saveError) { setError(saveError.message); return; }
    await load(); openTopic(data.id);
  }
  async function generate(title: string) {
    if (!db || isAdmin !== true) return;
    setBusy(true); setError("");
    try {
      const { data: session } = await db.auth.getSession();
      const response = await fetch("/api/topics/generate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token || ""}` }, body: JSON.stringify({ title }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error || "创建任务失败"); return; }
      await loadJobs();
      navigate("home");
      setTaskDrawerOpen(true);
    } catch { setError("网络请求失败，请重试。"); }
    finally { setBusy(false); }
  }
  async function retryJob(job: GenerationJob) {
    if (!db || isAdmin !== true || job.status !== "failed" || retryingJobId) return;
    setRetryingJobId(job.id); setError("");
    try {
      const { data: session } = await db.auth.getSession();
      const response = await fetch("/api/topics/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token || ""}` },
        body: JSON.stringify({ jobId: job.id }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error || "重试失败"); return; }
      await loadJobs();
    } catch { setError("重试请求失败，请稍后再试。"); }
    finally { setRetryingJobId(null); }
  }
  async function updatePoint(point: KnowledgePoint, content: string) {
    if (!db || isAdmin !== true) return false;
    const normalized = normalizeMarkdown(content, true);
    const { error: saveError } = await db.from("knowledge_points").update({ content_md: normalized, verification_status: "checked" }).eq("id", point.id);
    if (saveError) { setError(saveError.message); return false; }
    setPoints(previous => previous.map(item => item.id === point.id ? { ...item, content_md: normalized, verification_status: "checked" } : item));
    return true;
  }
  async function verifyPoint(point: KnowledgePoint) {
    if (!db || isAdmin !== true) return;
    const { error: saveError } = await db.from("knowledge_points").update({ verification_status: "verified" }).eq("id", point.id);
    if (saveError) setError(saveError.message);
    else { setPoints(previous => previous.map(item => item.id === point.id ? { ...item, verification_status: "verified" } : item)); void loadInsights(); }
  }
  async function saveNote(pointId: string, content: string) {
    if (!db || !user) return false;
    const { error: saveError } = await db.from("user_point_notes").upsert({ user_id: user.id, knowledge_point_id: pointId, content_md: content }, { onConflict: "user_id,knowledge_point_id" });
    if (saveError) { setError(saveError.message); return false; }
    setNotes(previous => ({ ...previous, [pointId]: content }));
    return true;
  }
  async function publish() {
    if (!db || isAdmin !== true || !selected) return;
    const generationJob = jobs.find(job => job.topic_id === selected.id);
    if (generationJob && generationJob.status !== "completed") {
      setError("专题生成尚未成功完成，不能发布到知识库。");
      return;
    }
    const { error: saveError } = await db.from("topics").update({ status: "published" }).eq("id", selected.id);
    if (saveError) setError(saveError.message);
    else await load();
  }
  async function deleteDraft(topic: Topic) {
    if (!db || isAdmin !== true || topic.status !== "draft") return;
    if (jobs.some(job => job.topic_id === topic.id && (job.status === "pending" || job.status === "running"))) {
      setError("专题仍在生成中，完成或失败后才能删除草稿。");
      return;
    }
    const kind = topic.generation_status === "failed" ? "生成任务" : "草稿";
    if (!window.confirm(`确定删除${kind}「${topic.title}」吗？相关内容将一并删除。`)) return;
    const { data: linkedJobs, error: linkedJobsError } = await db.from("topic_generation_jobs").select("id").eq("topic_id", topic.id);
    if (linkedJobsError) { setError(linkedJobsError.message); return; }
    const { data, error: deleteError } = await db.from("topics").delete().eq("id", topic.id).eq("status", "draft").select("id");
    if (deleteError) { setError(deleteError.message); return; }
    if (!data?.length) { setError("草稿未能删除，请刷新后重试。"); return; }
    const relatedJobs = linkedJobs?.map(job => job.id) || [];
    if (relatedJobs.length) {
      const { error: cleanupError } = await db.from("topic_generation_jobs").delete().in("id", relatedJobs);
      if (cleanupError) setError(`草稿已删除，但任务记录清理失败：${cleanupError.message}`);
    }
    if (selectedId === topic.id) { selectedIdRef.current = null; setSelectedId(null); navigate("drafts"); }
    await Promise.all([load(), loadJobs(), loadInsights()]);
  }

  if (!ready) return <div className="center-screen">正在载入知识库…</div>;
  if (!db) return <div className="center-screen setup"><div className="brand-mark">IM</div><h1>Interview Master</h1><p>先配置 Supabase 环境变量并执行数据库迁移，即可开始使用。</p><code>NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY</code></div>;
  if (!user) return <AuthScreen />;
  if (isAdmin === null) return <div className="center-screen" role="status">正在确认账户权限…</div>;

  return <div className={`shell ${navCollapsed ? "shell-nav-collapsed" : ""} ${view === "reader" ? "shell-reading" : ""} ${readingNavOpen ? "shell-reading-nav-open" : ""} ${focus ? "shell-focus" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
    {mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
    <aside className="app-sidebar"><button className="nav-collapse" onClick={() => setNavCollapsed(value => !value)} aria-label={navCollapsed || focus ? "展开主导航" : "折叠主导航"} title={navCollapsed || focus ? "展开主导航" : "折叠主导航"}>{navCollapsed || focus ? "»" : "«"}</button>
      <button className="brand" onClick={() => navigate("home")}><span className="brand-mark">IM</span><span>Interview<br /><strong>Master</strong></span></button>
      <div className="sidebar-caption">工作空间</div>
      <nav className="nav-list" aria-label="主导航">
        <button className={view === "home" ? "active" : ""} onClick={() => navigate("home")}><span>⌂</span>学习首页</button>
        <button className={view === "browse" ? "active" : ""} onClick={() => navigate("browse")}><span>◈</span>随便看看</button>
        <button className={view === "library" || (view === "reader" && selected?.status === "published") ? "active" : ""} onClick={() => navigate("library")}><span>▤</span>我的知识库</button>
        {isAdmin && <button className={view === "drafts" || (view === "reader" && selected?.status === "draft") ? "active" : ""} onClick={() => navigate("drafts")}><span>▣</span>草稿箱 <small>{draftTopics.length}</small></button>}
        {isAdmin && <button className={view === "create" ? "active" : ""} onClick={() => navigate("create")}><span>✳</span>AI 创建专题</button>}
      </nav>
      <div className="sidebar-bottom"><div className="profile-dot">{user.email?.slice(0, 1).toUpperCase()}</div><div className="profile-text"><strong>{user.email?.split("@")[0]}</strong><small>个人知识库</small></div><button aria-label="退出登录" title="退出登录" onClick={() => db?.auth.signOut()}>↪</button></div>
    </aside>
    <main className="main-area">
      <div className="mobile-bar"><button className="mobile-menu-button" aria-label="打开导航" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>☰</button><button className="brand" onClick={() => navigate("home")}><span className="brand-mark">IM</span><strong>Interview Master</strong></button></div>
      {view !== "reader" && <header className="workspace-topbar"><label className="workspace-search"><span aria-hidden="true">⌕</span><input aria-label="全局搜索专题和知识点" placeholder="搜索专题和知识点" value={query} onFocus={() => { if (view !== "library") navigate("library"); }} onChange={event => setQuery(event.target.value)} /></label><div className="topbar-end">{isAdmin && <button className="task-entry" onClick={() => setTaskDrawerOpen(true)}>生成任务{jobs.some(job => job.status === "pending" || job.status === "running") && <span>{jobs.filter(job => job.status === "pending" || job.status === "running").length} 进行中</span>}{!jobs.some(job => job.status === "pending" || job.status === "running") && jobs.some(job => job.status === "failed") && <span className="has-failure">有失败任务</span>}</button>}<span className="workspace-account">{user.email?.split("@")[0]}</span></div></header>}
      {error && <div role="alert" className="error-banner">{error}<button onClick={() => setError("")}>关闭</button></div>}
      {view === "home" && <section className="page-wrap home-page">
        <div className="home-topline"><span>学习工作台</span><span>{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span></div>
        <h1 className="hero-title">今天想看点什么？</h1>
        <p className="hero-copy">不需要制定计划，从感兴趣的知识开始。</p>
        <div className={`home-layout ${isAdmin ? "" : "home-layout-full"}`}><div className="home-main">
          <div className="home-priorities">
            <section className="home-priority"><div className="section-header"><h2>继续上次阅读</h2><button className="text-btn" onClick={() => navigate("library")}>浏览知识库 →</button></div>
              {continueTopic ? <button className="continue-panel" onClick={() => openTopic(continueTopic.id, lastPointId || undefined)}><span className="topic-category">{categoryName(continueTopic.category_id)}</span><strong>{continueTopic.title}</strong><span>{lastPointId ? `上次看到：${searchPoints.find(point => point.id === lastPointId)?.title || "专题知识点"}` : continueTopic.summary || "从上次阅读的专题继续。"}</span><em>继续阅读 <span aria-hidden="true">→</span></em></button> : <div className="empty home-empty">知识库还没有已发布专题。{isAdmin && <button className="primary-btn" onClick={() => navigate("create")}>创建知识专题</button>}</div>}
            </section>
            <section className="home-priority"><div className="section-header"><h2>随便看看</h2><span className="home-heading-meta">无需评分</span></div><div className="home-priority-panel review-panel"><strong>随机翻几张知识卡片</strong><p>想一想，再看参考内容。看完直接翻下一张，随时可以离开。</p><button className="home-priority-action" onClick={() => navigate("browse")}>开始随便看看 <span aria-hidden="true">→</span></button></div></section>
          </div>
          <div className="home-random-topic"><div><strong>随机查看专题</strong><p>想完整读一篇？从已发布的专题里随机挑一个。</p></div><button className="text-btn" disabled={!publishedTopics.length} onClick={openRandomTopic}>随机打开 →</button></div>
          <section className="home-review-focus"><div className="section-header"><h2>为你推荐</h2><button className="text-btn" disabled={recommendationPool.length < 2} onClick={() => { setRecommendations(recommendPoints(recommendationPool, pointActivity, 3, recommendations.map(point => point.id))); }}>换一批 →</button></div>{insightsStatus === "loaded" ? recommendations.length ? <div className="home-review-list">{recommendations.map(point => { const topic = publishedTopics.find(item => item.id === point.topic_id); return <button key={point.id} onClick={() => openTopic(point.topic_id, point.id)}><span><strong>{point.title}</strong><small className="home-recommend-topic">{topic?.title || "专题"}</small><small>{topic ? categoryName(topic.category_id) : "未分类"} · {point.reason === "unread" ? "之前还未阅读" : point.reason === "revisit" ? "最近接触较少" : "换一个知识方向"}</small></span><span className="home-review-stats"><em>{point.reason === "unread" ? "还没看过" : point.reason === "revisit" ? "重新接触" : "随机探索"}</em></span><span aria-hidden="true">→</span></button>; })}</div> : <div className="empty">还没有可推荐的知识点。先发布一个专题吧。</div> : <div className="empty" role="status">{insightsStatus === "error" ? "推荐信息暂时无法加载，请刷新页面重试。" : "正在挑选知识点…"}</div>}</section>
          <div className="section-header"><h2>最近专题</h2><button className="text-btn" onClick={() => navigate("library")}>查看全部 →</button></div>
          {publishedTopics.length ? <div className="recent-list">{publishedTopics.slice(0, 4).map(topic => <TopicTile key={topic.id} topic={topic} category={categoryName(topic.category_id)} onOpen={() => openTopic(topic.id)} />)}</div> : <div className="empty">发布的专题会出现在这里。</div>}
        </div>{isAdmin && <aside className="home-aside"><h2>今日待处理</h2><p>从待审核内容继续整理，再回到知识库阅读。</p><button onClick={() => navigate("drafts")}><strong>{draftTopics.length}</strong><span>份待检查草稿</span><b>查看草稿 →</b></button><button onClick={() => setTaskDrawerOpen(true)}><strong>{jobs.filter(job => job.status === "pending" || job.status === "running").length}</strong><span>项生成任务</span><b>查看任务 →</b></button><button className="aside-create" onClick={() => navigate("create")}>＋ 创建知识专题</button></aside>}</div>
      </section>}
      {view === "library" && <LibraryPanel topics={publishedTopics} drafts={draftTopics} categories={categories} insights={topicInsights} insightsStatus={insightsStatus} topicsStatus={topicsLoad} searchPoints={searchPoints} query={query} categoryName={categoryName} />}
      {view === "browse" && (insightsStatus === "loaded" ? <CasualCards points={recommendationPool} activities={pointActivity} topics={publishedTopics} categories={categories} onSeen={onCardSeen} onExit={() => navigate("home")} onOpenTopic={id => openTopic(id)} /> : <div className="page-wrap empty" role="status">{insightsStatus === "error" ? "知识卡片暂时无法加载，请刷新页面重试。" : "正在准备知识卡片…"}</div>)}
      {view === "drafts" && isAdmin && <DraftPanel topics={draftTopics} insights={topicInsights} insightsStatus={insightsStatus} topicsStatus={topicsLoad} categoryName={categoryName} onOpen={openTopic} onCreate={() => navigate("create")} onDelete={topic => void deleteDraft(topic)} />}
      {view === "create" && isAdmin && <CreatePanel busy={busy} onGenerate={generate} onManual={createManual} />}
      {view === "reader" && focus && selected && mode === "read" && pointsLoad.topicId === selectedId && pointsLoad.status === "loaded" && <FocusReader topic={selected} category={categoryName(selected.category_id)} sections={sections} points={points} notes={notes} userId={user.id} initialPointId={activePointId?.startsWith("point-") ? activePointId.slice(6) : null} preferences={readerPreferences} onPreferencesChange={changeReaderPreferences} onBack={() => navigate("library")} onExit={pointId => { setFocus(false); if (pointId) requestAnimationFrame(() => document.getElementById(`point-${pointId}`)?.scrollIntoView({ behavior: "auto", block: "start" })); }} />}
      {view === "reader" && focus && selected && pointsLoad.status !== "loaded" && (pointsLoad.status === "error" ? <div className="reader-load-error">专题内容加载失败。<button className="text-btn" onClick={() => setFocus(false)}>返回专题页</button></div> : <ReaderLoading full />)}
      {view === "reader" && !focus && <section className={`reader ${focus ? "reader-focus" : ""} ${topicsHidden ? "reader-topics-hidden" : ""} ${mobileTopicsOpen ? "reader-mobile-topics-open" : ""}`}><aside className="reader-left"><button className="back-link" onClick={() => navigate(selected?.status === "draft" ? "drafts" : "library")}>← 返回{selected?.status === "draft" ? "草稿箱" : "知识库"}</button><h3>专题列表</h3>{(selected?.status === "draft" ? draftTopics : publishedTopics).map(topic => <button key={topic.id} className={`reader-topic ${topic.id === selectedId ? "selected" : ""}`} onClick={() => { openTopic(topic.id); setMobileTopicsOpen(false); }}>{topic.title}</button>)}</aside><div className="reader-body">{selected ? <><div className="reader-toolbar"><span>{categoryName(selected.category_id)} / 专题阅读</span><div className="reader-toolbar-actions"><button className="reader-nav-toggle" onClick={() => setReadingNavOpen(value => !value)} aria-expanded={readingNavOpen}>{readingNavOpen ? "隐藏导航" : "显示导航"}</button><button className="reader-topic-toggle" onClick={() => setTopicsHidden(value => !value)}>{topicsHidden ? "显示专题列表" : "隐藏专题列表"}</button><button disabled={pointsLoad.topicId !== selectedId || pointsLoad.status !== "loaded"} onClick={() => { setMode("read"); setFocus(true); }}>专注阅读</button><button className="topics-mobile-toggle" onClick={() => setMobileTopicsOpen(value => !value)} aria-expanded={mobileTopicsOpen}>专题列表</button><button className="toc-mobile-toggle" onClick={() => setTocOpen(value => !value)} aria-expanded={tocOpen}>本章目录</button></div></div><div className="reader-heading"><h1>{selected.title}</h1><TopicAnswerFocus answer={readTopicAnswer(sections[0]?.content_md)} /><p>{selected.summary || "开始整理这份专题，为知识点添加自己的理解。"}</p><div className="reader-actions"><button className={mode === "read" ? "tab active" : "tab"} onClick={() => setMode("read")}>完整阅读</button><button className={mode === "cards" ? "tab active" : "tab"} disabled={pointsLoad.topicId !== selectedId || pointsLoad.status !== "loaded" || cards.length === 0 || !reviewsReady} onClick={() => { setMode("cards"); window.scrollTo({ top: 0, behavior: "instant" }); }}>认真复习</button>{isAdmin && selected.status === "draft" && <button className="publish-btn" onClick={publish}>发布到知识库</button>}{isAdmin && selected.status === "draft" && <button className="delete-reader-btn" disabled={jobs.some(job => job.topic_id === selected.id && (job.status === "pending" || job.status === "running"))} onClick={() => void deleteDraft(selected)}>删除草稿</button>}</div></div>{mode === "read" ? <div className="article">{pointsLoad.topicId !== selectedId || pointsLoad.status === "loading" ? <ReaderLoading /> : pointsLoad.status === "error" ? <div className="reader-load-error">知识点加载失败，请稍后重试或重新打开专题。</div> : sections.length ? sections.map(section => <section key={section.id} id={`section-${section.id}`}><h2>{section.title}</h2>{points.filter(point => point.parent_id === section.id).map(point => <PointBlock key={point.id} point={point} canEdit={isAdmin} note={notes[point.id] || ""} mastery={mastery[point.id] || 0} onSave={updatePoint} onVerify={verifyPoint} onSaveNote={saveNote} />)}</section>) : ((!jobsLoaded && (selected.generation_status === "pending" || selected.generation_status === "running")) || jobs.some(job => job.topic_id === selected.id && (job.status === "pending" || job.status === "running"))) ? <div className="reader-waiting" role="status"><span className="reader-waiting-dot" />正在生成专题内容，完成后会自动显示在这里。</div> : <div className="empty">这个专题还没有知识点。可以先创建内容，生成任务完成后也会自动显示在这里。</div>}</div> : !reviewsReady ? <ReaderLoading /> : <CardReview topic={selected} category={categoryName(selected.category_id)} sections={sections} points={cards} notes={notes} progress={reviewProgress} preferences={readerPreferences} onPreferencesChange={changeReaderPreferences} onSaveNote={saveNote} onRate={rateCard} onUndo={undoCardRating} onExit={pointId => { setMode("read"); if (pointId) requestAnimationFrame(() => document.getElementById(`point-${pointId}`)?.scrollIntoView({ behavior: "instant", block: "start" })); else window.scrollTo({ top: 0, behavior: "instant" }); }} />}</> : topicsLoad === "loading" ? <ReaderLoading full /> : topicsLoad === "error" ? <div className="reader-load-error">专题加载失败，请稍后重试。</div> : <div className="empty">找不到这个专题，或你没有访问权限。</div>}</div><aside className={`reader-right ${tocOpen ? "toc-open" : ""}`} aria-label="本章目录"><h3>本章目录</h3>{sections.map(section => <div className="toc-section" key={section.id}><div className="toc-section-head"><a className={activePointId === `section-${section.id}` || points.some(point => point.parent_id === section.id && activePointId === `point-${point.id}`) ? "active" : ""} href={`#section-${section.id}`} onClick={event => jumpToTocTarget(event, `section-${section.id}`)}>{section.title}</a><button onClick={() => setClosedSections(previous => previous.includes(section.id) ? previous.filter(id => id !== section.id) : [...previous, section.id])} aria-label={`${closedSections.includes(section.id) ? "展开" : "折叠"}${section.title}`} aria-expanded={!closedSections.includes(section.id)}>{closedSections.includes(section.id) ? "+" : "−"}</button></div>{!closedSections.includes(section.id) && points.filter(point => point.parent_id === section.id).map(point => <a className={`toc-point ${activePointId === `point-${point.id}` ? "active" : ""} ${mastery[point.id] >= 3 ? "mastered" : mastery[point.id] > 0 ? "weak" : ""}`} key={point.id} href={`#point-${point.id}`} onClick={event => jumpToTocTarget(event, `point-${point.id}`)}><span>{point.title}</span>{mastery[point.id] > 0 && <i aria-label={mastery[point.id] >= 3 ? "已掌握" : "薄弱知识点"} />}</a>)}</div>)}<div className="reader-note">AI 内容仅作为初稿。请核对技术细节和适用版本，再用于面试准备。</div></aside></section>}
      {view === "reader" && mode === "read" && pointsLoad.status === "loaded" && <ReadingActivityTracker key={`${selectedId}:${focus}`} onViewed={onPointViewed} />}
    </main><nav className="mobile-nav" aria-label="手机导航"><button onClick={() => navigate("home")}>首页</button><button onClick={() => navigate("browse")}>随便看看</button><button onClick={() => navigate("library")}>知识库</button>{isAdmin && <button onClick={() => navigate("drafts")}>草稿</button>}{isAdmin && <button onClick={() => navigate("create")}>创建专题</button>}</nav>
    {isAdmin && taskDrawerOpen && <TaskDrawer jobs={jobs} onClose={() => setTaskDrawerOpen(false)} onOpen={id => { setTaskDrawerOpen(false); openTopic(id); }} onRetry={retryJob} onDelete={id => { const topic = topics.find(item => item.id === id); if (topic) void deleteDraft(topic); }} retryingJobId={retryingJobId} />}
  </div>;
}

function ReaderLoading({ full = false }: { full?: boolean }) {
  return <div className={`reader-loading ${full ? "reader-loading-full" : ""}`} role="status" aria-live="polite">
    <p>正在载入专题内容…</p>
    {full && <div className="loading-line loading-title" aria-hidden="true" />}
    <div className="loading-line loading-heading" aria-hidden="true" />
    <div className="loading-line" aria-hidden="true" />
    <div className="loading-line loading-long" aria-hidden="true" />
    <div className="loading-line loading-medium" aria-hidden="true" />
    <div className="loading-line loading-heading second" aria-hidden="true" />
    <div className="loading-line loading-long" aria-hidden="true" />
    <div className="loading-line loading-medium" aria-hidden="true" />
  </div>;
}

function TaskDrawer({ jobs, onClose, onOpen, onRetry, onDelete, retryingJobId }: { jobs: GenerationJob[]; onClose: () => void; onOpen: (id: string) => void; onRetry: (job: GenerationJob) => void; onDelete: (topicId: string) => void; retryingJobId: string | null }) {
  const [filter, setFilter] = useState<"all" | "active" | "failed" | "completed">("all");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButtonRef.current?.focus(); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const visible = jobs.filter(job => filter === "all" || (filter === "active" ? job.status === "pending" || job.status === "running" : job.status === filter));
  const activeCount = jobs.filter(job => job.status === "pending" || job.status === "running").length;
  const failedCount = jobs.filter(job => job.status === "failed").length;
  return <div className="task-drawer-layer"><button className="task-drawer-backdrop" aria-label="关闭任务中心" onClick={onClose} /><aside className="task-drawer" role="dialog" aria-modal="true" aria-label="生成任务中心"><div className="task-drawer-head"><div><span>生成任务中心</span><h2>专题生成进度</h2></div><button ref={closeButtonRef} onClick={onClose} aria-label="关闭任务中心">×</button></div><div className="task-drawer-summary"><strong>{activeCount}</strong><span>进行中</span><strong>{failedCount}</strong><span>待处理失败</span></div><div className="task-filters" role="group" aria-label="任务筛选">{([ ["all", "全部"], ["active", "进行中"], ["failed", "失败"], ["completed", "已完成"] ] as const).map(([value, label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><JobHistory jobs={visible} onOpen={onOpen} onRetry={onRetry} onDelete={onDelete} retryingJobId={retryingJobId} /></aside></div>;
}

function JobHistory({ jobs, onOpen, onRetry, onDelete, retryingJobId }: { jobs: GenerationJob[]; onOpen: (id: string) => void; onRetry: (job: GenerationJob) => void; onDelete: (topicId: string) => void; retryingJobId: string | null }) {
  if (!jobs.length) return <div className="job-empty">还没有生成记录。创建专题后可在这里查看进度。</div>;
  return <div className="job-history">{jobs.map(job => <JobItem key={job.id} job={job} onOpen={onOpen} onRetry={onRetry} onDelete={onDelete} retrying={retryingJobId === job.id} />)}</div>;
}

function jobErrorText(job: GenerationJob | undefined) {
  const message = job?.error_message?.trim();
  if (job?.raw_output?.http_status === 403 || /^AI 目录请求失败（403）$/.test(message || "")) {
    return "AI 服务网关拒绝请求（403）。请检查网关访问权限后重试。";
  }
  if (!message || message === "生成失败" || message === "生成中断") {
    return "未记录具体失败原因。请重试；如果再次失败，请检查 AI 服务连接。";
  }
  return message;
}

function JobItem({ job, onOpen, onRetry, onDelete, retrying }: { job: GenerationJob; onOpen: (id: string) => void; onRetry: (job: GenerationJob) => void; onDelete: (topicId: string) => void; retrying: boolean }) {
  const label = { pending: "等待中", running: "生成中", completed: "已完成", failed: "失败" }[job.status];
  const detail = job.status === "pending" ? "等待开始" : job.status === "running"
    ? job.raw_output?.stage === "generating_sections"
      ? `章节 ${job.raw_output.completed_sections || 0}/${job.raw_output.total_sections || "…"}`
      : "正在构建目录"
    : job.status === "failed" ? jobErrorText(job) : "可在草稿箱检查内容";
  return <article className={`task-row task-${job.status}`}><div className="task-row-top"><span className={`job-dot ${job.status}`} aria-hidden="true" /><strong>{job.input_title}</strong><span className={`job-list-status ${job.status}`}>{label}</span></div><p>{job.status === "failed" ? "生成未完成，可以重新尝试。" : detail}</p><div className="task-row-bottom"><time>{new Date(job.created_at).toLocaleString("zh-CN")}</time>{job.status === "failed" ? <div className="task-row-actions"><button className="task-retry" disabled={retrying} onClick={() => onRetry(job)}>{retrying ? "重试中…" : "重新生成"}</button>{job.topic_id && <button className="task-delete" disabled={retrying} onClick={() => onDelete(job.topic_id!)}>删除任务</button>}</div> : job.status === "completed" && job.topic_id ? <button onClick={() => onOpen(job.topic_id!)}>打开专题 →</button> : null}</div>{job.status === "failed" && <details className="task-error-details"><summary>查看错误详情</summary><p>{detail}</p></details>}</article>;
}

const noInsight: TopicInsight = { pointCount: 0, verifiedCount: 0, ratedCount: 0, masteredCount: 0, weakCount: 0, viewedCount: 0, lastViewedAt: null, lastReviewedAt: null };

function studyDate(value: string | null) {
  if (!value) return "尚未阅读";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未阅读";
  const today = new Date();
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const reviewedDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (reviewedDay === day) return "今天阅读";
  if (reviewedDay === day - 86400000) return "昨天阅读";
  return `${date.toLocaleDateString("zh-CN")} 阅读`;
}

function LibraryPanel({ topics, drafts, categories, insights, insightsStatus, topicsStatus, searchPoints, query, categoryName }: { topics: Topic[]; drafts: Topic[]; categories: Category[]; insights: Record<string, TopicInsight>; insightsStatus: "loading" | "loaded" | "error"; topicsStatus: "loading" | "loaded" | "error"; searchPoints: SearchPoint[]; query: string; categoryName: (id: string | null) => string }) {
  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => { queueMicrotask(() => setCurrentTime(Date.now())); }, []);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [readingFilter, setReadingFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const searchTerm = query.trim().toLocaleLowerCase();
  const matchingPointTopics = new Set(searchTerm ? searchPoints.filter(point => point.title.toLocaleLowerCase().includes(searchTerm)).map(point => point.topic_id) : []);
  const matchingDrafts = searchTerm ? drafts.filter(topic => topic.title.toLocaleLowerCase().includes(searchTerm) || !!topic.summary?.toLocaleLowerCase().includes(searchTerm) || categoryName(topic.category_id).toLocaleLowerCase().includes(searchTerm) || matchingPointTopics.has(topic.id)) : [];
  const categoryCounts = new Map<string, number>();
  for (const topic of topics) {
    const id = topic.category_id && categories.some(category => category.id === topic.category_id) ? topic.category_id : "uncategorized";
    categoryCounts.set(id, (categoryCounts.get(id) || 0) + 1);
  }
  const availableCategories = categories.filter(category => categoryCounts.has(category.id));
  const visible = topics.filter(topic => {
    const insight = insights[topic.id] || noInsight;
    const search = query.trim().toLocaleLowerCase();
    if (search && !topic.title.toLocaleLowerCase().includes(search) && !topic.summary?.toLocaleLowerCase().includes(search) && !categoryName(topic.category_id).toLocaleLowerCase().includes(search) && !matchingPointTopics.has(topic.id)) return false;
    if (categoryFilter === "uncategorized" && topic.category_id && categories.some(category => category.id === topic.category_id)) return false;
    if (categoryFilter !== "all" && categoryFilter !== "uncategorized" && topic.category_id !== categoryFilter) return false;
    if (readingFilter === "unread" && insight.viewedCount > 0) return false;
    if (readingFilter === "started" && insight.viewedCount === 0) return false;
    if (readingFilter === "less" && !(insight.viewedCount > 0 && insight.lastViewedAt && currentTime - Date.parse(insight.lastViewedAt) > 14 * 86400000)) return false;
    return true;
  }).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort === "created" ? b.created_at.localeCompare(a.created_at) : (insights[b.id]?.lastViewedAt || b.created_at).localeCompare(insights[a.id]?.lastViewedAt || a.created_at));
  const totalPoints = topics.reduce((sum, topic) => sum + (insights[topic.id]?.pointCount || 0), 0);
  const viewedPoints = topics.reduce((sum, topic) => sum + (insights[topic.id]?.viewedCount || 0), 0);
  return <section className="page-wrap management-page library-page"><div className="management-heading"><div><span className="eyebrow">知识资产</span><h1 className="page-title">我的知识库</h1><p>选择专题，在新标签页阅读；这里会保留筛选结果。</p></div><span className="management-count">{topics.length} 个专题</span></div>
    {topicsStatus === "loaded" && insightsStatus === "loaded" && (topics.length >= 2 || totalPoints >= 10) && <div className="library-overview"><div><strong>{topics.length}</strong><span>全部专题</span></div><div><strong>{totalPoints}</strong><span>知识点</span></div><div><strong>{viewedPoints}/{totalPoints}</strong><span>已浏览知识点</span></div></div>}
    <div className="library-categories"><strong>专题分类</strong><div className="library-category-tabs" role="group" aria-label="按专题分类筛选"><button type="button" className={categoryFilter === "all" ? "active" : ""} aria-pressed={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>全部 <span>{topics.length}</span></button>{availableCategories.map(category => <button type="button" key={category.id} className={categoryFilter === category.id ? "active" : ""} aria-pressed={categoryFilter === category.id} onClick={() => setCategoryFilter(category.id)}>{categoryName(category.id)} <span>{categoryCounts.get(category.id)}</span></button>)}{categoryCounts.has("uncategorized") && <button type="button" className={categoryFilter === "uncategorized" ? "active" : ""} aria-pressed={categoryFilter === "uncategorized"} onClick={() => setCategoryFilter("uncategorized")}>未分类 <span>{categoryCounts.get("uncategorized")}</span></button>}</div></div>
    <div className="library-filters"><strong>专题筛选 <span>{visible.length}</span></strong><label>阅读情况<select aria-label="按阅读情况筛选专题" value={readingFilter} onChange={event => setReadingFilter(event.target.value)}><option value="all">全部状态</option><option value="unread">尚未阅读</option><option value="started">已开始阅读</option><option value="less">久未阅读</option></select></label><label>排序<select aria-label="专题排序" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">最近阅读</option><option value="created">最近创建</option><option value="title">标题</option></select></label><div className="library-layout" role="group" aria-label="展示方式"><button className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")}>列表</button><button className={layout === "grid" ? "active" : ""} onClick={() => setLayout("grid")}>卡片</button></div></div>
    {topicsStatus !== "loaded" || insightsStatus !== "loaded" ? <div className="management-empty" role="status">{topicsStatus === "error" || insightsStatus === "error" ? "专题或学习信息暂时无法加载，请刷新页面重试。" : "正在加载专题与学习信息…"}</div> : visible.length ? <div className={`library-list ${layout === "grid" ? "is-grid" : ""}`}>{visible.map(topic => {
      const insight = insights[topic.id] || noInsight;
      const percentage = insight.pointCount ? Math.round(insight.viewedCount / insight.pointCount * 100) : 0;
      return <article className="library-row" key={topic.id}><div className="library-row-content"><span className="category-tag">{categoryName(topic.category_id)}</span><h2><a href={`/knowledge/${topic.id}`} target="_blank" rel="noopener noreferrer">{topic.title}</a></h2>{topic.summary && <p>{topic.summary}</p>}<div className="library-row-meta"><span>{insight.pointCount} 个知识点</span><span>{studyDate(insight.lastViewedAt)}</span></div></div><div className="library-row-progress"><strong>{insight.viewedCount}/{insight.pointCount}</strong><span>已浏览</span><div className="progress-track"><i style={{ width: `${percentage}%` }} /></div></div><a className="library-row-action" href={`/knowledge/${topic.id}`} target="_blank" rel="noopener noreferrer">新标签页阅读</a></article>;
    })}</div> : <div className="management-empty">{topics.length ? "没有符合筛选条件的已发布专题。" : "知识库还没有专题。生成并发布第一份内容后，会在这里开始积累。"}</div>}
    {matchingDrafts.length > 0 && <div className="global-draft-results"><h2>草稿中的结果</h2>{matchingDrafts.map(topic => <a key={topic.id} href={`/knowledge/${topic.id}`} target="_blank" rel="noopener noreferrer"><span className="category-tag">{categoryName(topic.category_id)}</span><strong>{topic.title}</strong><span>新标签页完善</span></a>)}</div>}
  </section>;
}

function DraftPanel({ topics, insights, insightsStatus, topicsStatus, categoryName, onOpen, onCreate, onDelete }: { topics: Topic[]; insights: Record<string, TopicInsight>; insightsStatus: "loading" | "loaded" | "error"; topicsStatus: "loading" | "loaded" | "error"; categoryName: (id: string | null) => string; onOpen: (id: string) => void; onCreate: () => void; onDelete: (topic: Topic) => void }) {
  const [filter, setFilter] = useState<"all" | "review" | "verified">("all");
  const reviewed = (topic: Topic) => { const insight = insights[topic.id] || noInsight; return insight.pointCount > 0 && insight.verifiedCount === insight.pointCount; };
  const visible = topics.filter(topic => filter === "all" || (filter === "verified" ? reviewed(topic) : !reviewed(topic)));
  const verifiedCount = topics.filter(reviewed).length;
  return <section className="page-wrap management-page drafts-page"><div className="management-heading"><div><span className="eyebrow">内容工作区</span><h1 className="page-title">草稿箱</h1><p>检查生成完成的专题，完善后发布到知识库。</p></div><button className="primary-btn" onClick={onCreate}>新建专题</button></div>{topicsStatus === "loaded" && insightsStatus === "loaded" && <div className="draft-tabs" role="group" aria-label="草稿筛选"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部 {topics.length}</button><button className={filter === "review" ? "active" : ""} onClick={() => setFilter("review")}>待审核 {topics.length - verifiedCount}</button><button className={filter === "verified" ? "active" : ""} onClick={() => setFilter("verified")}>已校验 {verifiedCount}</button></div>}
    {topicsStatus !== "loaded" || insightsStatus !== "loaded" ? <div className="management-empty" role="status">{topicsStatus === "error" || insightsStatus === "error" ? "草稿信息暂时无法加载，请刷新页面重试。" : "正在加载待审核专题…"}</div> : visible.length ? <div className="draft-worklist">{visible.map(topic => {
      const insight = insights[topic.id] || noInsight;
      const verified = reviewed(topic);
      return <article className="draft-workrow" key={topic.id}><div className="draft-workrow-main"><div className="draft-workrow-top"><span className="category-tag">{categoryName(topic.category_id)}</span><span className={`review-state ${verified ? "verified" : ""}`}>{verified ? "已校验" : "待审核"}</span></div><h2>{topic.title}</h2><p>{topic.summary || "还没有专题简介，打开后可以继续完善内容。"}</p><div className="draft-workrow-meta"><span>{insight.pointCount} 个知识点</span><span>已校验 {insight.verifiedCount}/{insight.pointCount}</span><span>{new Date(topic.created_at).toLocaleDateString("zh-CN")} 创建</span></div></div><div className="draft-workrow-actions"><button className="draft-workrow-action" onClick={() => onOpen(topic.id)}>{verified ? "查看并发布" : "继续完善"} →</button><button className="draft-workrow-delete" onClick={() => onDelete(topic)}>删除</button></div></article>;
    })}</div> : <div className="management-empty">{topics.length ? "这个筛选下没有草稿。" : "还没有待审核内容。生成任务完成后，专题会出现在这里。"}</div>}
  </section>;
}

function TopicTile({ topic, category, onOpen }: { topic: Topic; category: string; onOpen: () => void }) {
  return <button className="topic-tile" onClick={onOpen}><span className="topic-category">{category}</span><strong>{topic.title}</strong><span className="topic-meta">{new Date(topic.created_at).toLocaleDateString("zh-CN")}</span><span className="tile-arrow">↗</span></button>;
}

function CreatePanel({ busy, onGenerate, onManual }: { busy: boolean; onGenerate: (title: string) => void; onManual: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return <section className="create-wrap"><div className="eyebrow">创建知识专题</div><h1 className="hero-title">你想掌握什么？</h1><p className="hero-copy">输入专题名称，AI 会自动选择分类，生成回答重点、必要原理和练习内容。完成后可在草稿箱检查。</p><form onSubmit={event => { event.preventDefault(); if (title.trim()) onGenerate(title.trim()); }}><label htmlFor="topic-title">专题名称</label><input id="topic-title" required maxLength={120} placeholder="例如：Redis 持久化机制" value={title} onChange={event => setTitle(event.target.value)} /><div className="generation-list"><span>生成内容</span><p>自动分类 · 回答重点 · 原理讲解 · 面试追问</p></div><button className="primary-btn create-submit" disabled={busy || !title.trim()}>{busy ? "正在提交任务…" : "AI 生成专题"}</button><button type="button" className="text-btn" disabled={busy || !title.trim()} onClick={() => onManual(title.trim())}>先创建空白专题</button></form><p className="fine-print">AI 生成的内容可能有误，阅读时请核对技术细节。</p></section>;
}

function PointBlock({ point, note, mastery, canEdit, onSave, onVerify, onSaveNote }: { point: KnowledgePoint; note: string; mastery: number; canEdit: boolean; onSave: (point: KnowledgePoint, content: string) => Promise<boolean>; onVerify: (point: KnowledgePoint) => void; onSaveNote: (pointId: string, content: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState(point.content_md || "");
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  return <div className="point-block" id={`point-${point.id}`}>
    <div className="point-title"><h3>{point.title}</h3>{point.verification_status === "ai_draft" && <span className="point-verification ai_draft">待校验</span>}</div>
    {editing ? <div className="edit-area"><textarea aria-label={`编辑${point.title}`} value={content} onChange={event => setContent(event.target.value)} rows={12} /><div><button className="primary-btn" disabled={saving} onClick={async () => { setSaving(true); const saved = await onSave(point, content); setSaving(false); if (saved) setEditing(false); }}>{saving ? "保存中…" : "保存修改"}</button><button className="text-btn" disabled={saving} onClick={() => { setContent(point.content_md || ""); setEditing(false); }}>取消</button></div></div> : <>
      
      <div className="content-section"><h4>核心原理</h4><MarkdownContent content={point.content_md || (canEdit ? "暂无内容，点击编辑补充知识讲解。" : "暂无内容。")} prose /></div>
      {point.example_md && <div className="content-section example-section"><h4>代码示例</h4><MarkdownContent content={point.example_md} /></div>}
      {point.common_mistakes?.length > 0 && <div className="mistakes"><strong>易错点</strong><ul>{point.common_mistakes.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {point.key_takeaways?.length > 0 && <div className="takeaways"><strong>补充要点</strong><ul>{point.key_takeaways.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {point.interview_questions?.length > 0 && <details className="followups"><summary>面试追问（{point.interview_questions.length}）</summary><ul>{point.interview_questions.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
      <div className="point-actions">{canEdit && <button className="edit-link" onClick={() => { setContent(point.content_md || ""); setEditing(true); }}>编辑知识点</button>}{canEdit && point.verification_status !== "verified" && <button className="verify-link" onClick={() => onVerify(point)}>标记已校验</button>}{mastery > 0 && <span className={`mastery-inline ${mastery >= 3 ? "mastered" : "weak"}`}>{mastery >= 3 ? "已掌握" : "待巩固"}</span>}</div>
      <div className="personal-note"><div className="personal-note-heading"><strong>我的笔记</strong><button onClick={() => { setNoteDraft(note); setNoteEditing(value => !value); }}>{noteEditing ? "收起" : note ? "编辑笔记" : "添加笔记"}</button></div>{noteEditing ? <div className="note-editor"><textarea aria-label={`${point.title}的个人笔记`} value={noteDraft} onChange={event => setNoteDraft(event.target.value)} rows={5} placeholder="写下自己的理解、疑问或补充…" /><button className="primary-btn" disabled={noteSaving} onClick={async () => { setNoteSaving(true); const saved = await onSaveNote(point.id, noteDraft); setNoteSaving(false); if (saved) setNoteEditing(false); }}>{noteSaving ? "保存中…" : "保存笔记"}</button></div> : note ? <MarkdownContent content={note} className="note-content" prose /> : <p>记录自己的理解和补充，复习时更容易想起。</p>}</div>
    </>}
  </div>;
}

function AuthScreen() {
  const [register, setRegister] = useState(false);
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!db) return;
    setBusy(true); setMessage("");
    const result = register ? await db.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } }) : await db.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) { setMessage(result.error.message); return; }
    if (register && !result.data.session) setAwaitingEmail(true);
  }
  async function resend() {
    if (!db) return;
    setBusy(true); setMessage("");
    const { error } = await db.auth.resend({ type: "signup", email, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    setMessage(error ? error.message : "确认邮件已重新发送。请检查收件箱和垃圾邮件文件夹。");
  }
  return <div className="auth-page"><div className="auth-intro"><div className="brand-mark">IM</div><h1>把每个面试专题，<br />学成自己的知识。</h1><p>完整阅读，随时回顾，持续积累。<br />你的技术知识库，从这里开始。</p></div>{awaitingEmail ? <section className="auth-form email-confirm" aria-labelledby="email-confirm-title"><div className="email-symbol" aria-hidden="true">✉</div><h2 id="email-confirm-title">请确认你的邮箱</h2><p>我们已向 <strong>{email}</strong> 发送确认邮件。</p><ol><li>打开邮箱，找到 Interview Master 的确认邮件。</li><li>点击邮件中的确认链接。</li><li>返回这里登录，开始阅读专题。</li></ol><p className="email-help">没有收到？先查看垃圾邮件文件夹。邮件送达可能需要几分钟。</p><button className="primary-btn" disabled={busy} onClick={resend}>{busy ? "正在发送…" : "重新发送确认邮件"}</button><button className="text-btn" onClick={() => { setAwaitingEmail(false); setRegister(false); setMessage(""); }}>已确认，返回登录</button>{message && <p role="status" className="auth-message">{message}</p>}</section> : <form className="auth-form" onSubmit={submit}><h2>{register ? "创建账户" : "欢迎回来"}</h2><p>登录后同步你的专题和学习内容。</p><label htmlFor="email">邮箱</label><input id="email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /><label htmlFor="password">密码</label><input id="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={6} value={password} onChange={event => setPassword(event.target.value)} required /><button className="primary-btn" disabled={busy}>{busy ? "请稍候…" : register ? "注册" : "登录"}</button>{message && <p role="alert" className="auth-message">{message}</p>}<button type="button" className="text-btn" onClick={() => { setRegister(value => !value); setMessage(""); }}>{register ? "已有账户？登录" : "还没有账户？注册"}</button></form>}</div>;
}














