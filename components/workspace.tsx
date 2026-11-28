"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase";
import type { Category, GenerationJob, KnowledgePoint, Topic } from "@/lib/types";
import { MarkdownContent } from "@/components/markdown-content";
import { PointContent } from "@/components/point-content";
import { InterviewFollowups } from "@/components/interview-followups";
import { normalizeMarkdown } from "@/lib/markdown";
import { FocusReader, defaultReaderPreferences, type ReaderPreferences } from "@/components/focus-reader";
import { TopicAnswerFocus } from "@/components/topic-answer-focus";
import { readTopicAnswer } from "@/lib/topic-answer";
import { categoryPaths } from "@/lib/category-match";
import { CategoryManager } from "@/components/category-manager";
import { TopicCategoryEditor } from "@/components/topic-category-editor";
import { NotesPanel } from "@/components/notes-panel";
import { scheduleReview, type ReviewLevel, type ReviewProgress, type ReviewUndo } from "@/lib/review-schedule";
import { CardReview } from "@/components/card-review";
import { reviewableDrafts } from "@/lib/topic-workflow";
import { jobStatusSignature, newlyCompletedJobIds } from "@/lib/generation-job-state";
import { recommendPoints, type PointActivity, type PointCandidate, type PointRecommendation } from "@/lib/point-recommendations";
import { CasualCards } from "@/components/casual-cards";
import { ReadingActivityTracker } from "@/components/reading-activity-tracker";
import { readRecommendationHistory, recentRecommendationIds, rememberRecommendations, saveRecommendationHistory } from "@/lib/recommendation-history";
import { defaultRecommendationPreferences, preferredPoints, type RecommendationPreferences } from "@/lib/recommendation-preferences";
import { RecommendationSettings } from "@/components/recommendation-settings";
import { categoryCoverage } from "@/lib/category-coverage";
import { FavoritesPanel } from "@/components/favorites-panel";
import { ModelGroupPicker, type ModelGroupDraft } from "@/components/model-group-picker";
import type { AiModelGroup } from "@/lib/ai-model-groups";
import { MobileHome } from "@/components/mobile-home";
import { getOfflineTopic, listOfflineTopicIds, listOfflineTopics, removeOfflineTopic, saveOfflineTopic, type OfflineTopic } from "@/lib/offline-topics";
import { PointVisuals } from "@/components/point-visuals";
import type { Visual } from "@/lib/visual-enhancement";

type View = "home" | "library" | "favorites" | "notes" | "drafts" | "create" | "reader" | "browse" | "profile";
type PointsLoad = { topicId: string | null; status: "idle" | "loading" | "loaded" | "error" };
type RetryAllProgress = { attempted: number; total: number; started: number; rejected: number; running: boolean; message?: string };
type TopicInsight = { pointCount: number; verifiedCount: number; ratedCount: number; masteredCount: number; weakCount: number; viewedCount: number; lastViewedAt: string | null; lastReviewedAt: string | null };
type SearchPoint = PointCandidate;
const db = getBrowserClient();
const LIBRARY_BATCH_SIZE = 24;

function saveLibraryScope(userId: string, ids: string[]): string {
  const key = crypto.randomUUID();
  window.localStorage.setItem(`im:library-scope:${userId}:${key}`, JSON.stringify(ids));
  return key;
}

function readLibraryScope(userId: string): string[] {
  const key = new URLSearchParams(window.location.search).get("scope");
  if (!key) return [];
  try {
    const ids: unknown = JSON.parse(window.localStorage.getItem(`im:library-scope:${userId}:${key}`) || "[]");
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(0, 500) : [];
  } catch { return []; }
}

class SessionExpiredError extends Error {
  constructor() { super("登录已过期，请重新登录"); }
}

async function postGenerationRequest(client: SupabaseClient, path: string, body: object, signal?: AbortSignal): Promise<Response> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new SessionExpiredError();
  let token = data.session.access_token;
  // A generation can keep using this token after the HTTP response has returned.
  if (data.session.expires_at && data.session.expires_at * 1000 - Date.now() < 15 * 60 * 1000) {
    const { data: refreshed, error: refreshError } = await client.auth.refreshSession();
    if (refreshError || !refreshed.session) throw new SessionExpiredError();
    token = refreshed.session.access_token;
  }
  const send = (token: string) => fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  let response = await send(token);
  if (response.status === 401) {
    const { data: refreshed, error: refreshError } = await client.auth.refreshSession();
    if (refreshError || !refreshed.session) throw new SessionExpiredError();
    response = await send(refreshed.session.access_token);
  }
  return response;
}

function chooseRandomTopic(topics: Topic[], previousId: string | null): Topic | null {
  const choices = topics.filter(topic => topics.length === 1 || topic.id !== previousId);
  return choices.length ? choices[Math.floor(Math.random() * choices.length)] : null;
}

export function Workspace({ initialTopicId }: { initialTopicId?: string }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const currentUserId = user?.id;
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const authUserIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [offlineTopics, setOfflineTopics] = useState<OfflineTopic[]>([]);
  const [savedOfflineIds, setSavedOfflineIds] = useState<string[]>([]);
  const [view, setView] = useState<View>(initialTopicId ? "reader" : "home");
  const [readerReturnView, setReaderReturnView] = useState<"library" | "favorites" | "drafts">("library");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [readerTopicIds, setReaderTopicIds] = useState<string[] | null>(null);
  const initialReaderScopeActive = useRef(!!initialTopicId);
  const initialReaderScopeIds = useRef<string[] | null>(null);
  const [topicsLoad, setTopicsLoad] = useState<"loading" | "loaded" | "error">("loading");
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [modelGroups, setModelGroups] = useState<AiModelGroup[]>([]);
  const [modelGroupsStatus, setModelGroupsStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [selectedModelGroupId, setSelectedModelGroupId] = useState("");
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);
  const [retryAllProgress, setRetryAllProgress] = useState<RetryAllProgress | null>(null);
  const retryAllRunningRef = useRef(false);
  const [topicInsights, setTopicInsights] = useState<Record<string, TopicInsight>>({});
  const [insightsStatus, setInsightsStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [searchPoints, setSearchPoints] = useState<SearchPoint[]>([]);
  const [pointActivity, setPointActivity] = useState<Record<string, PointActivity>>({});
  const [recommendations, setRecommendations] = useState<PointRecommendation[]>([]);
  const [recommendationPreferences, setRecommendationPreferences] = useState<RecommendationPreferences>(defaultRecommendationPreferences);
  const [recommendationPreferencesReady, setRecommendationPreferencesReady] = useState(false);
  const [recommendationSettingsOpen, setRecommendationSettingsOpen] = useState(false);
  const recommendedPoolSignature = useRef("");
  const completedJobsRef = useRef("");
  const jobsSnapshotRef = useRef<string | null>(null);
  const jobsDisplaySnapshotRef = useRef("");
  const initialInsightsUserRef = useRef<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [points, setPoints] = useState<KnowledgePoint[]>([]);
  const [visuals, setVisuals] = useState<Visual[]>([]);
  const [pointsLoad, setPointsLoad] = useState<PointsLoad>({ topicId: initialTopicId || null, status: initialTopicId ? "loading" : "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(initialTopicId || null);
  const selectedIdRef = useRef<string | null>(initialTopicId || null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const [regeneratingTopicId, setRegeneratingTopicId] = useState<string | null>(null);
  const [deletingTopicId, setDeletingTopicId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState(false);
  const [readerPreferences, setReaderPreferences] = useState<ReaderPreferences>(defaultReaderPreferences);
  const readerPreferencesUserId = useRef<string | null>(null);
  const preferenceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [readingNavOpen, setReadingNavOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
  const shortcutHandled = useRef(false);
  const pendingReadTargetId = useRef<string | null>(null);
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
    catch { if (navigator.onLine) setInsightsStatus("error"); return; }
    if (!navigator.onLine) return;
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
    if (!navigator.onLine && currentUserId) {
      const saved = await listOfflineTopics(currentUserId).catch(() => []);
      setOfflineTopics(saved);
      setSavedOfflineIds(saved.map(item => item.topic.id));
      setTopics(saved.map(item => item.topic));
      setTopicsLoad("loaded");
      return;
    }
    if (initialReaderScopeActive.current && !initialReaderScopeIds.current && initialTopicId) {
      initialReaderScopeIds.current = [...new Set([...readLibraryScope(currentUserId || ""), initialTopicId])];
    }
    const scopedIds = initialReaderScopeActive.current ? initialReaderScopeIds.current : null;
    const topicResult = await (scopedIds ? db.from("topics").select("*").in("id", scopedIds).order("created_at", { ascending: false }) : db.from("topics").select("*").order("created_at", { ascending: false }));
    if (topicResult.error) {
      const saved = currentUserId ? await listOfflineTopics(currentUserId).catch(() => []) : [];
      if (saved.length) { setOfflineTopics(saved); setSavedOfflineIds(saved.map(item => item.topic.id)); setTopics(saved.map(item => item.topic)); setTopicsLoad("loaded"); }
      else { setError(topicResult.error.message); setTopicsLoad("error"); }
    }
    else { setTopics(topicResult.data as Topic[]); setReaderTopicIds(scopedIds); setTopicsLoad("loaded"); }
    void db.from("categories").select("*").order("sort_order").order("name").then(({ data, error: categoryError }) => {
      if (!categoryError && authUserIdRef.current === currentUserId) setCategories(data as Category[]);
    });
  }, [currentUserId, initialTopicId]);
  const loadJobs = useCallback(async () => {
    if (!db) return;
    const rows: GenerationJob[] = [];
    const seenJobIds = new Set<string>();
    for (let start = 0; ; start += 100) {
      const jobsQuery = db.from("topic_generation_jobs").select("id,topic_id,input_title,status,raw_output,error_message,created_at,finished_at").order("created_at", { ascending: false }).order("id", { ascending: false });
      const { data, error: jobsError } = await (initialReaderScopeActive.current && selectedId ? jobsQuery.eq("topic_id", selectedId) : jobsQuery).range(start, start + 99);
      if (jobsError) { setError(jobsError.message); setJobsLoaded(true); return; }
      for (const job of data as GenerationJob[] || []) {
        if (seenJobIds.has(job.id)) continue;
        seenJobIds.add(job.id);
        rows.push(job);
      }
      if (!data || data.length < 100) break;
    }
    const stale = rows.filter(job => job.status === "running" && Date.now() - new Date(job.raw_output?.started_at || job.created_at).getTime() > 7 * 60 * 1000);
    for (const job of stale) {
      await db.from("topic_generation_jobs").update({ status: "failed", error_message: job.raw_output?.regeneration ? "重新生成超时，原专题内容已保留，可重试。" : "生成任务超时，请重新创建专题。", finished_at: new Date().toISOString() }).eq("id", job.id).eq("status", "running");
      if (job.topic_id && !job.raw_output?.regeneration) await db.from("topics").update({ generation_status: "failed" }).eq("id", job.topic_id).in("generation_status", ["pending", "running"]);
    }
    const visibleJobs = rows.map(job => stale.some(item => item.id === job.id) ? { ...job, status: "failed" as const, error_message: job.raw_output?.regeneration ? "重新生成超时，原专题内容已保留，可重试。" : "生成任务超时，请重新创建专题。" } : job);
    const snapshot = jobStatusSignature(visibleJobs);
    const displaySnapshot = visibleJobs.map(job => `${job.id}:${job.status}:${job.raw_output?.stage || ""}:${job.raw_output?.completed_sections || 0}:${job.raw_output?.total_sections || 0}:${job.error_message || ""}`).join("|");
    const hadJobsSnapshot = jobsSnapshotRef.current !== null;
    const jobsChanged = hadJobsSnapshot && jobsSnapshotRef.current !== snapshot;
    jobsSnapshotRef.current = snapshot;
    if (jobsDisplaySnapshotRef.current !== displaySnapshot) { jobsDisplaySnapshotRef.current = displaySnapshot; setJobs(visibleJobs); }
    if (rows.some(job => job.status === "pending")) {
      void postGenerationRequest(db, "/api/topics/dispatch", {}).catch(() => {});
    }
    setJobsLoaded(true);
    const topicRefresh = jobsChanged ? load() : null;
    const completedSignature = rows.filter(job => job.status === "completed").map(job => job.id).sort().join(",");
    const newlyCompletedIds = newlyCompletedJobIds(completedJobsRef.current, rows);
    if (completedSignature !== completedJobsRef.current) {
      completedJobsRef.current = completedSignature;
    }
    if (hadJobsSnapshot && selectedId && rows.some(job => job.topic_id === selectedId && newlyCompletedIds.includes(job.id))) {
      const { data: latestPoints } = await db.from("knowledge_points").select("*").eq("topic_id", selectedId).order("sort_order");
      if (latestPoints && selectedIdRef.current === selectedId) { setPoints(latestPoints as KnowledgePoint[]); setPointsLoad({ topicId: selectedId, status: "loaded" }); }
    }
    if (topicRefresh) await topicRefresh;
    if (hadJobsSnapshot && newlyCompletedIds.length && !initialReaderScopeActive.current) void loadInsights();
  }, [load, loadInsights, selectedId]);

  useEffect(() => {
    if (!db) { queueMicrotask(() => setReady(true)); return; }
    const offlineIdentityKey = "im:offline-identity";
    function applyUser(next: User | null) {
      if (authUserIdRef.current !== (next?.id || null)) {
        authUserIdRef.current = next?.id || null;
        setTopics([]);
        setOfflineTopics([]);
        setSavedOfflineIds([]);
        setIsAdmin(null);
        setView(initialTopicId ? "reader" : "home");
        setTopicsLoad("loading");
        setJobs([]);
        setModelGroups([]);
        setModelGroupsStatus("loading");
        setSelectedModelGroupId("");
        setJobsLoaded(false);
        setTaskDrawerOpen(false);
        setTopicInsights({});
        setInsightsStatus("loading");
        setSearchPoints([]);
        setPointActivity({});
        setRecommendations([]);
        setRecommendationPreferences(defaultRecommendationPreferences);
        setRecommendationPreferencesReady(false);
        recommendedPoolSignature.current = "";
        completedJobsRef.current = "";
        jobsSnapshotRef.current = null;
        jobsDisplaySnapshotRef.current = "";
        initialInsightsUserRef.current = null;
        setPoints([]);
        setReviewsReady(false);
        setPointsLoad({ topicId: selectedIdRef.current, status: selectedIdRef.current ? "loading" : "idle" });
      }
      setUser(next);
    }
    function remember(user: User) {
      window.localStorage.setItem(offlineIdentityKey, JSON.stringify({ id: user.id, email: user.email }));
    }
    function restoreOfflineUser(): User | null {
      try {
        const saved = JSON.parse(window.localStorage.getItem(offlineIdentityKey) || "null");
        return typeof saved?.id === "string" ? saved as User : null;
      } catch { return null; }
    }
    if (!navigator.onLine) {
      applyUser(restoreOfflineUser());
      queueMicrotask(() => { setOffline(true); setReady(true); });
    } else {
      db.auth.getUser().then(({ data }) => {
        if (data.user) { remember(data.user); applyUser(data.user); }
        else if (!navigator.onLine) { applyUser(restoreOfflineUser()); setOffline(true); }
        else applyUser(null);
        setReady(true);
      });
    }
    const { data: listener } = db.auth.onAuthStateChange((event, session) => {
      if (session?.user) { remember(session.user); applyUser(session.user); setOffline(!navigator.onLine); }
      else if (event === "SIGNED_OUT" && navigator.onLine) { window.localStorage.removeItem(offlineIdentityKey); applyUser(null); }
      else if (navigator.onLine) applyUser(null);
      if (event === "INITIAL_SESSION") setReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, [initialTopicId]);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    if (!user || offline) return;
    const refresh = () => { void load(); if (!initialReaderScopeActive.current) void loadInsights(); };
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [user, offline, load, loadInsights]);
  useEffect(() => {
    if (!currentUserId) return;
    if (offline) return;
    void listOfflineTopicIds(currentUserId).then(ids => { if (authUserIdRef.current === currentUserId) setSavedOfflineIds(ids); }).catch(() => {});
  }, [currentUserId, offline]);
  useEffect(() => {
    if (!currentUserId || offline || view !== "profile") return;
    void listOfflineTopics(currentUserId).then(saved => { if (authUserIdRef.current === currentUserId) setOfflineTopics(saved); }).catch(() => {});
  }, [currentUserId, offline, view]);
  useEffect(() => {
    if (!db || !user) return;
    if (offline) { queueMicrotask(() => setIsAdmin(false)); return; }
    let cancelled = false;
    void db.from("profiles").select("is_admin").eq("id", user.id).single().then(({ data, error: roleError }) => {
      if (cancelled) return;
      if (roleError) setError("无法读取账户权限，请确认已执行管理员迁移。");
      setIsAdmin(!roleError && data?.is_admin === true);
    });
    return () => { cancelled = true; };
  }, [user, offline]);
  useEffect(() => {
    if (!user) return;
    const topicId = window.localStorage.getItem(`im:last-topic:${user.id}`);
    queueMicrotask(() => { setLastTopicId(topicId); setLastPointId(topicId ? window.localStorage.getItem(`im:last-point:${user.id}:${topicId}`) : null); });
    if (!offline && db) {
      void db.from("user_reading_positions").select("topic_id,point_id,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(1).maybeSingle().then(({ data }) => {
        if (!data || data.updated_at <= (window.localStorage.getItem(`im:last-topic-at:${user.id}`) || "")) return;
        window.localStorage.setItem(`im:last-topic:${user.id}`, data.topic_id);
        window.localStorage.setItem(`im:last-topic-at:${user.id}`, data.updated_at);
        if (data.point_id) window.localStorage.setItem(`im:last-point:${user.id}:${data.topic_id}`, data.point_id);
        setLastTopicId(data.topic_id);
        setLastPointId(data.point_id);
      });
    }
  }, [user, offline]);
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
  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNavOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [mobileNavOpen]);
  useEffect(() => { if (user && !offline) { void Promise.resolve().then(load); } }, [user, offline, load]);
  useEffect(() => { if (user && offline) { void Promise.resolve().then(load); } }, [user, offline, load]);
  useEffect(() => {
    if (!currentUserId || offline || initialTopicId || view === "reader" || topicsLoad !== "loaded" || initialInsightsUserRef.current === currentUserId) return;
    let cancelled = false;
    const start = () => {
      if (cancelled || initialInsightsUserRef.current === currentUserId) return;
      initialInsightsUserRef.current = currentUserId;
      void loadInsights();
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(start, { timeout: 1200 });
      return () => { cancelled = true; window.cancelIdleCallback(id); };
    }
    const id = setTimeout(start, 0);
    return () => { cancelled = true; clearTimeout(id); };
  }, [currentUserId, offline, initialTopicId, view, topicsLoad, loadInsights]);
  useEffect(() => {
    if (!db || !currentUserId) return;
    if (offline) { queueMicrotask(() => { setRecommendationPreferencesReady(true); setRecommendationPreferences(defaultRecommendationPreferences); }); return; }
    let cancelled = false;
    void db.from("user_recommendation_preferences").select("category_ids,random_percent").eq("user_id", currentUserId).maybeSingle().then(({ data, error: loadError }) => {
      if (cancelled) return;
      if (loadError) setError(`推荐偏好加载失败，请执行最新数据库迁移：${loadError.message}`);
      setRecommendationPreferences(data ? { category_ids: data.category_ids, random_percent: data.random_percent } : defaultRecommendationPreferences);
      setRecommendationPreferencesReady(true);
    });
    return () => { cancelled = true; };
  }, [currentUserId, offline]);
  useEffect(() => {
    if (!offline) return;
    queueMicrotask(() => {
      setSearchPoints(offlineTopics.flatMap(item => item.points.filter(point => point.parent_id).map(point => ({ id: point.id, topic_id: point.topic_id, title: point.title }))));
      setTopicInsights(Object.fromEntries(offlineTopics.map(item => [item.topic.id, { ...noInsight, pointCount: item.points.filter(point => point.parent_id).length }])));
      setInsightsStatus("loaded");
    });
  }, [offline, offlineTopics]);
  useEffect(() => {
    if (!user || isAdmin !== true || topicsLoad !== "loaded" || (view === "reader" && pointsLoad.status === "loading")) return;
    void Promise.resolve().then(loadJobs);
    const timer = window.setInterval(() => { void loadJobs(); }, 5000);
    return () => window.clearInterval(timer);
  }, [user, isAdmin, topicsLoad, view, pointsLoad.status, loadJobs]);
  useEffect(() => {
    if (!db || !currentUserId || isAdmin !== true || modelGroupsStatus === "loaded" || (view !== "create" && view !== "reader" && !taskDrawerOpen) || topicsLoad !== "loaded" || (view === "reader" && pointsLoad.status === "loading")) return;
    let cancelled = false;
    void db.auth.getSession().then(async ({ data }) => {
      const token = data.session?.access_token;
      if (!token) throw new Error("登录已过期");
      const response = await fetch("/api/ai-model-groups", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result: { groups?: AiModelGroup[]; error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error || "加载模型分组失败");
      if (cancelled) return;
      const groups = result.groups || [];
      const saved = window.localStorage.getItem(`im:model-group:${currentUserId}`);
      setModelGroups(groups);
      setSelectedModelGroupId(groups.find(group => group.id === saved)?.id || groups[0]?.id || "");
      setModelGroupsStatus("loaded");
    }).catch(error => { if (!cancelled) { setModelGroupsStatus("error"); setError(error instanceof Error ? error.message : "加载模型分组失败"); } });
    return () => { cancelled = true; };
  }, [currentUserId, isAdmin, modelGroupsStatus, taskDrawerOpen, topicsLoad, view, pointsLoad.status]);
  function selectModelGroup(id: string) {
    setSelectedModelGroupId(id);
    if (currentUserId) window.localStorage.setItem(`im:model-group:${currentUserId}`, id);
  }
  async function saveModelGroup(draft: ModelGroupDraft): Promise<{ group?: AiModelGroup; error?: string }> {
    if (!db) return { error: "请先登录" };
    try {
      const { data } = await db.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return { error: "登录已过期，请重新登录" };
      const response = await fetch("/api/ai-model-groups", { method: draft.id ? "PATCH" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const result: { group?: AiModelGroup; error?: string } = await response.json();
      if (!response.ok || !result.group) return { error: result.error || "保存模型分组失败" };
      const group = result.group;
      setModelGroups(current => draft.id ? current.map(item => item.id === group.id ? group : item) : [...current, group]);
      return { group };
    } catch { return { error: "网络请求失败，请重试" }; }
  }
  useEffect(() => {
    if (!db || !selectedId || !user) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setVisuals([]); });
    if (offline) {
      void getOfflineTopic(user.id, selectedId).then(saved => {
        if (cancelled) return;
        if (saved) { setPoints(saved.points); setPointsLoad({ topicId: selectedId, status: "loaded" }); setReviewsReady(true); }
        else setPointsLoad({ topicId: selectedId, status: "error" });
      });
      return () => { cancelled = true; };
    }
    db.from("knowledge_points").select("*").eq("topic_id", selectedId).order("sort_order").then(({ data, error: loadError }) => {
      if (cancelled) return;
      if (loadError) {
        void getOfflineTopic(user.id, selectedId).then(saved => {
          if (cancelled) return;
          if (saved) { setPoints(saved.points); setPointsLoad({ topicId: selectedId, status: "loaded" }); setReviewsReady(true); }
          else { setError(loadError.message); setPointsLoad({ topicId: selectedId, status: "error" }); }
        });
      }
      else {
        const loaded = data as KnowledgePoint[];
        setPoints(loaded);
        setPointsLoad({ topicId: selectedId, status: "loaded" });
        const pointIds = loaded.filter(point => point.parent_id).map(point => point.id);
        if (pointIds.length) void db!.from("knowledge_point_visuals").select("*").in("knowledge_point_id", pointIds).eq("status", "approved").order("sort_order").then(({ data: visualRows }) => {
          if (!cancelled && visualRows) setVisuals(visualRows as Visual[]);
        });
        void getOfflineTopic(user.id, selectedId).then(saved => {
          if (saved && loaded.length) void saveOfflineTopic(user.id, saved.topic, saved.categoryName, loaded);
        }).catch(() => {});
        const ids = loaded.filter(point => point.parent_id).map(point => point.id);
        const sectionIds = loaded.filter(point => !point.parent_id).map(point => point.id);
        if (!sectionIds.length) { setMastery({}); setReviewProgress({}); setNotes({}); setReviewsReady(true); return; }
        void Promise.all([
          ids.length ? db!.from("user_point_progress").select("knowledge_point_id,mastery_level,repetition_count,interval_days,last_reviewed_at,next_review_at").eq("user_id", user.id).in("knowledge_point_id", ids) : Promise.resolve({ data: [], error: null }),
          db!.from("user_point_notes").select("knowledge_point_id,content_md").eq("user_id", user.id).in("knowledge_point_id", sectionIds),
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
  }, [selectedId, user, offline]);
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
    if (view !== "reader" || mode !== "read" || !activePointId) return;
    const outline = document.querySelector<HTMLElement>(".reader-right");
    const activeLink = outline?.querySelector<HTMLElement>(".toc-point.active") || outline?.querySelector<HTMLElement>(".toc-section-head a.active");
    if (!outline || !activeLink || outline.scrollHeight <= outline.clientHeight) return;
    const outlineTop = outline.getBoundingClientRect().top;
    const linkTop = activeLink.getBoundingClientRect().top;
    const nextTop = outline.scrollTop + linkTop - outlineTop - outline.clientHeight * 0.35;
    outline.scrollTo({ top: Math.max(0, nextTop), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  }, [activePointId, mode, view, closedSections]);
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
  useEffect(() => {
    document.title = view === "reader" && selected?.title ? selected.title : "Interview Master — AI 技术面试知识库";
  }, [view, selected?.title]);
  const effectiveReaderReturnView = readerReturnView === "library" && selected?.status === "draft" ? "drafts" : readerReturnView;
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
  const favoriteCount = searchPoints.filter(point => pointActivity[point.id]?.is_favorite).length;
  const preferredRecommendationPool = useMemo(() => preferredPoints(recommendationPool, publishedTopics, categories, recommendationPreferences.category_ids), [recommendationPool, publishedTopics, categories, recommendationPreferences.category_ids]);
  const recommendationUserId = currentUserId;
  const showRecommendations = useCallback((pool: PointCandidate[], activities: Record<string, PointActivity>, userId: string) => {
    const key = `im:recommendations:${userId}`;
    const history = readRecommendationHistory(key);
    const avoid = recentRecommendationIds(history, pool.map(point => point.id), 3);
    const next = recommendPoints(pool, activities, 3, avoid, Date.now(), Math.random, recommendationPreferences.random_percent);
    saveRecommendationHistory(key, rememberRecommendations(history, next.map(point => point.id)));
    setRecommendations(next);
  }, [recommendationPreferences.random_percent]);
  useEffect(() => {
    if (!recommendationUserId || insightsStatus !== "loaded" || !recommendationPreferencesReady) return;
    const signature = `${recommendationUserId}:${recommendationPreferences.random_percent}:${preferredRecommendationPool.map(point => point.id).join(",")}`;
    if (recommendedPoolSignature.current === signature) return;
    recommendedPoolSignature.current = signature;
    queueMicrotask(() => showRecommendations(preferredRecommendationPool, activityRef.current, recommendationUserId));
  }, [preferredRecommendationPool, insightsStatus, recommendationUserId, recommendationPreferencesReady, recommendationPreferences.random_percent, showRecommendations]);
  async function saveRecommendationPreferences(next: RecommendationPreferences) {
    if (!db || !user) return false;
    const { error: saveError } = await db.from("user_recommendation_preferences").upsert({ user_id: user.id, ...next, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (saveError) { setError(`推荐偏好保存失败：${saveError.message}`); return false; }
    setRecommendationPreferences(next);
    return true;
  }
  async function setPointControl(id: string, action: "favorite" | "unfavorite" | "exclude" | "restore") {
    if (!db) return false;
    const { error: saveError } = await db.rpc("set_point_recommendation_control", { p_point_id: id, p_action: action });
    if (saveError) { setError(`推荐设置保存失败：${saveError.message}`); return false; }
    const previous = activityRef.current[id];
    const next: PointActivity = { knowledge_point_id: id, view_count: previous?.view_count || 0, reading_seconds: previous?.reading_seconds || 0,
      last_viewed_at: previous?.last_viewed_at || null, card_seen_count: previous?.card_seen_count || 0, last_card_seen_at: previous?.last_card_seen_at || null,
      is_favorite: action === "favorite" ? true : action === "unfavorite" ? false : previous?.is_favorite || false,
      excluded_until: action === "exclude" ? new Date(Date.now() + 7 * 86400000).toISOString() : action === "restore" ? null : previous?.excluded_until || null };
    activityRef.current = { ...activityRef.current, [id]: next };
    setPointActivity(activityRef.current);
    if (action === "exclude" && user) showRecommendations(preferredRecommendationPool, activityRef.current, user.id);
    return true;
  }
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
  const categoryPathById = new Map(categoryPaths(categories).map(category => [category.id, category.path]));
  const categoryName = (id: string | null) => id ? categoryPathById.get(id) || offlineTopics.find(item => item.topic.category_id === id)?.categoryName || "未分类" : "未分类";

  function openTopic(id: string, pointId?: string, chapterId?: string) {
    if (view !== "reader" && view !== "library") setReaderTopicIds(null);
    setReaderReturnView(view === "favorites" ? "favorites" : topics.find(topic => topic.id === id)?.status === "draft" ? "drafts" : "library");
    pendingReadTargetId.current = chapterId ? `section-${chapterId}` : pointId ? `point-${pointId}` : null;
    selectedIdRef.current = id;
    setSelectedId(id); setView("reader"); setMode("read");
    setFocus(false);
    setReadingNavOpen(false);
    setPoints([]); setPointsLoad({ topicId: id, status: "loading" }); setMastery({}); setReviewProgress({}); setReviewsReady(false); setNotes({});
    setActivePointId(pointId ? `point-${pointId}` : null); setClosedSections([]); setTocOpen(false); setMobileNavOpen(false);
    if (user) { window.localStorage.setItem(`im:last-topic:${user.id}`, id); window.localStorage.setItem(`im:last-topic-at:${user.id}`, new Date().toISOString()); setLastTopicId(id); setLastPointId(window.localStorage.getItem(`im:last-point:${user.id}:${id}`)); }
    window.history.pushState({}, "", `/knowledge/${id}`);
  }
  function openRandomTopic() {
    const topic = chooseRandomTopic(publishedTopics, lastRandomTopicId);
    if (!topic) return;
    setLastRandomTopicId(topic.id);
    openTopic(topic.id);
  }
  async function toggleOfflineTopic() {
    if (!user || !selected || selected.status !== "published" || pointsLoad.status !== "loaded") return;
    try {
      if (savedOfflineIds.includes(selected.id)) await removeOfflineTopic(user.id, selected.id);
      else await saveOfflineTopic(user.id, selected, categoryName(selected.category_id), points);
      if (offline) {
        const saved = await listOfflineTopics(user.id);
        setOfflineTopics(saved);
        setSavedOfflineIds(saved.map(item => item.topic.id));
        setTopics(saved.map(item => item.topic));
      } else {
        setSavedOfflineIds(await listOfflineTopicIds(user.id));
      }
    } catch { setError("保存离线专题失败，请检查浏览器存储空间。"); }
  }
  useEffect(() => {
    if (shortcutHandled.current || !user || topicsLoad !== "loaded") return;
    const mode = new URLSearchParams(window.location.search).get("mode");
    shortcutHandled.current = true;
    queueMicrotask(() => {
      if (mode === "cards") setView("browse");
      if (mode === "continue") {
        const topicId = window.localStorage.getItem(`im:last-topic:${user.id}`);
        if (topicId && topics.some(topic => topic.id === topicId)) openTopic(topicId);
      }
      if (mode) window.history.replaceState(window.history.state, "", window.location.pathname);
    });
  // The shortcut is consumed once after the first topic load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, topicsLoad, topics]);
  useEffect(() => {
    if (view === "reader" && !focus && pointsLoad.status === "loaded" && window.matchMedia("(max-width: 760px)").matches) queueMicrotask(() => setFocus(true));
  }, [view, focus, pointsLoad.status]);
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
    if (!db || !navigator.onLine) return;
    void db.rpc("record_point_activity", { events: [{ knowledge_point_id: id, views: 0, seconds: 0, cards: 1 }] }).then(({ error: saveError }) => {
      if (saveError) { setError(`卡片浏览记录保存失败：${saveError.message}`); return; }
      const now = new Date().toISOString();
      setPointActivity(current => ({ ...current, [id]: { knowledge_point_id: id, view_count: current[id]?.view_count || 0, reading_seconds: current[id]?.reading_seconds || 0, last_viewed_at: current[id]?.last_viewed_at || null, card_seen_count: (current[id]?.card_seen_count || 0) + 1, last_card_seen_at: now, is_favorite: current[id]?.is_favorite || false, excluded_until: current[id]?.excluded_until || null } }));
    });
  }, []);
  useEffect(() => {
    if (view !== "reader" || mode !== "read" || pointsLoad.status !== "loaded" || !pendingReadTargetId.current) return;
    const targetId = pendingReadTargetId.current;
    const frame = requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "instant", block: "start" });
      pendingReadTargetId.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [view, mode, pointsLoad]);
  function navigate(next: View) {
    if ((next === "create" || next === "drafts") && isAdmin !== true) return;
    setView(next); setError(""); setFocus(false); setMobileNavOpen(false);
    setReadingNavOpen(false);
    window.history.pushState({}, "", "/");
    if (initialReaderScopeActive.current) { initialReaderScopeActive.current = false; setReaderTopicIds(null); void loadAllTopics(); }
  }
  async function loadAllTopics() {
    if (!db) return;
    setTopicsLoad("loading");
    setInsightsStatus("loading");
    const { data, error: loadError } = await db.from("topics").select("*").order("created_at", { ascending: false });
    if (loadError) { setTopicsLoad("error"); setError(loadError.message); return; }
    setTopics(data as Topic[]);
    setTopicsLoad("loaded");
    await loadInsights();
  }
  function changeReaderPreferences(next: ReaderPreferences) {
    setReaderPreferences(next);
    if (!user || !db) return;
    window.localStorage.setItem(`im:reader-preferences:${user.id}`, JSON.stringify(next));
    if (offline) return;
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
  async function generate(titles: string[]): Promise<{ createdCount: number; skippedTitles: string[]; failedTitles: string[] } | null> {
    if (!db || isAdmin !== true) return null;
    setBusy(true); setError("");
    try {
      const response = await postGenerationRequest(db, "/api/topics/generate", { titles, groupId: selectedModelGroupId });
      const result: { error?: string; created?: { title: string }[]; skipped?: { title: string; reason: string }[]; failed?: { title: string; error: string }[] } = await response.json();
      const created = result.created || [];
      const skipped = result.skipped || [];
      const failed = result.failed || [];
      if (created.length) void loadJobs().catch(() => setError("任务已提交，但任务列表刷新失败，请稍后再查看。"));
      if (failed.length) {
        setError(`已创建 ${created.length} 个任务，${failed.length} 个失败：${failed.map(item => `${item.title}（${item.error}）`).join("；")}`);
        return { createdCount: created.length, skippedTitles: skipped.map(item => item.title), failedTitles: failed.map(item => item.title) };
      }
      if (!response.ok || (!created.length && !skipped.length)) { setError(result.error || "创建任务失败"); return null; }
      return { createdCount: created.length, skippedTitles: skipped.map(item => item.title), failedTitles: [] };
    } catch (error) { setError(error instanceof SessionExpiredError ? error.message : "网络请求失败，请重试。"); return null; }
    finally { setBusy(false); }
  }
  async function regeneratePublishedTopic(topic: Topic) {
    if (!db || isAdmin !== true || topic.status !== "published" || regeneratingTopicId) return;
    if (!window.confirm(`重新生成「${topic.title}」？生成成功后会替换专题内容，并重置知识点的学习记录和笔记；生成失败时原内容会保留。`)) return;
    setRegeneratingTopicId(topic.id); setError("");
    try {
      const response = await postGenerationRequest(db, "/api/topics/regenerate", { topicId: topic.id, groupId: selectedModelGroupId });
      const result = await response.json();
      if (!response.ok) { setError(result.error || "重新生成失败"); return; }
      await loadJobs();
      setTaskDrawerOpen(true);
    } catch (error) { setError(error instanceof SessionExpiredError ? error.message : "重新生成请求失败，请稍后再试。"); }
    finally { setRegeneratingTopicId(null); }
  }
  async function retryJob(job: GenerationJob) {
    if (!db || isAdmin !== true || job.status !== "failed" || retryingJobId || retryAllRunningRef.current) return;
    if (modelGroupsStatus !== "loaded" || !selectedModelGroupId) { setError("请先选择本次重试使用的模型分组"); return; }
    setRetryingJobId(job.id); setError("");
    try {
      const response = await postGenerationRequest(db, "/api/topics/retry", { jobId: job.id, groupId: selectedModelGroupId });
      const result = await response.json();
      if (!response.ok) { setError(result.error || "重试失败"); return; }
      await loadJobs();
    } catch (error) { setError(error instanceof SessionExpiredError ? error.message : "重试请求失败，请稍后再试。"); }
    finally { setRetryingJobId(null); }
  }
  async function retryAllJobs() {
    if (!db || isAdmin !== true || retryingJobId || retryAllRunningRef.current) return;
    if (modelGroupsStatus !== "loaded" || !selectedModelGroupId) { setError("请先选择本次重试使用的模型分组"); return; }
    const failedJobs = jobs.filter(job => job.status === "failed");
    if (!failedJobs.length) return;
    const groupId = selectedModelGroupId;
    retryAllRunningRef.current = true;
    setError("");
    setRetryAllProgress({ attempted: 0, total: failedJobs.length, started: 0, rejected: 0, running: true });
    let started = 0;
    let rejected = 0;
    let attempted = 0;
    let interruption = "";
    try {
      for (const job of failedJobs) {
        try {
          const response = await postGenerationRequest(db, "/api/topics/retry", { jobId: job.id, groupId });
          if (response.ok) started++;
          else rejected++;
        } catch (error) {
          if (error instanceof SessionExpiredError) { interruption = error.message; break; }
          rejected++;
        }
        attempted++;
        setRetryAllProgress({ attempted, total: failedJobs.length, started, rejected, running: true });
      }
    } finally {
      try { await loadJobs(); }
      catch { setError("重试已提交，但任务列表刷新失败，请稍后重新打开任务中心。"); }
      finally {
        retryAllRunningRef.current = false;
        setRetryAllProgress({
          attempted, total: failedJobs.length, started, rejected, running: false,
          message: interruption || (rejected ? `${rejected} 项未能重试，仍保留在失败列表中。` : "已提交全部重试，生成进度见下方列表。"),
        });
      }
    }
  }
  async function deleteJob(job: GenerationJob) {
    if (!db || isAdmin !== true || job.status !== "failed" || retryAllRunningRef.current) return;
    if (job.topic_id) {
      const topic = topics.find(item => item.id === job.topic_id);
      if (topic) await deleteDraft(topic);
      return;
    }
    if (!window.confirm(`确定删除「${job.input_title}」的失败记录？`)) return;
    const { error: deleteError } = await db.from("topic_generation_jobs").delete().eq("id", job.id).is("topic_id", null);
    if (deleteError) { setError(deleteError.message); return; }
    await loadJobs();
  }
  async function updatePoint(point: KnowledgePoint, content: string) {
    if (!db || isAdmin !== true) return false;
    const normalized = normalizeMarkdown(content, true);
    const { error: saveError } = await db.from("knowledge_points").update({ content_md: normalized, verification_status: "checked" }).eq("id", point.id);
    if (saveError) { setError(saveError.message); return false; }
    setPoints(previous => previous.map(item => item.id === point.id ? { ...item, content_md: normalized, verification_status: "checked" } : item));
    return true;
  }
  async function generateFollowupAnswer(point: KnowledgePoint, question: string): Promise<string | null> {
    if (!db || isAdmin !== true || offline) return null;
    try {
      const response = await postGenerationRequest(db, "/api/interview-question-answer", { pointId: point.id, question }, AbortSignal.timeout(75000));
      const result: { answer?: string; error?: string } = await response.json();
      if (!response.ok || !result.answer) { setError(result.error || "追问答案生成失败"); return null; }
      setPoints(previous => previous.map(item => item.id === point.id ? { ...item, interview_question_answers: { ...item.interview_question_answers, [question]: result.answer! } } : item));
      return result.answer;
    } catch (error) { setError(error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "追问答案生成超时，请重试" : error instanceof Error ? error.message : "追问答案生成失败"); return null; }
  }
  async function verifyPoint(point: KnowledgePoint) {
    if (!db || isAdmin !== true) return;
    const { error: saveError } = await db.from("knowledge_points").update({ verification_status: "verified" }).eq("id", point.id);
    if (saveError) setError(saveError.message);
    else { setPoints(previous => previous.map(item => item.id === point.id ? { ...item, verification_status: "verified" } : item)); void loadInsights(); }
  }
  async function saveNote(sectionId: string, content: string) {
    if (!db || !user) return false;
    const { error: saveError } = await db.from("user_point_notes").upsert({ user_id: user.id, knowledge_point_id: sectionId, content_md: content, updated_at: new Date().toISOString() }, { onConflict: "user_id,knowledge_point_id" });
    if (saveError) { setError(saveError.message); return false; }
    setNotes(previous => ({ ...previous, [sectionId]: content }));
    return true;
  }
  async function updateTopicCategory(categoryId: string | null) {
    if (!db || !user || isAdmin !== true || !selected || offline) return false;
    if (categoryId && !categories.some(category => category.id === categoryId && category.user_id === user.id)) return false;
    const { data, error: saveError } = await db.from("topics")
      .update({ category_id: categoryId })
      .eq("id", selected.id)
      .eq("user_id", user.id)
      .select("id,category_id")
      .maybeSingle();
    if (saveError || !data) {
      setError(saveError?.message || "专题分类未能保存，请刷新后重试。");
      return false;
    }
    setTopics(previous => previous.map(topic => topic.id === data.id ? { ...topic, category_id: data.category_id } : topic));
    return true;
  }
  async function publish() {
    if (!db || isAdmin !== true || !selected) return;
    const generationJob = jobs.find(job => job.topic_id === selected.id);
    if (generationJob && generationJob.status !== "completed") {
      setError("专题生成尚未成功完成，不能发布到知识库。");
      return;
    }
    const { data: existing, error: duplicateCheckError } = await db.from("topics")
      .select("id").eq("status", "published").eq("title", selected.title).limit(1);
    if (duplicateCheckError) { setError(duplicateCheckError.message); return; }
    if (existing?.length) { setError("知识库已有同名专题，无法重复发布。"); return; }
    const { error: saveError } = await db.from("topics").update({ status: "published" }).eq("id", selected.id).eq("status", "draft");
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

  async function deletePublishedTopic(topic: Topic) {
    if (!db || !user || isAdmin !== true || offline || topic.status !== "published" || deletingTopicId) return;
    if (!window.confirm(`确定删除已发布专题「${topic.title}」吗？知识点、学习记录和图示会一并删除，且无法恢复。`)) return;
    setDeletingTopicId(topic.id);
    setError("");
    try {
      const response = await postGenerationRequest(db, "/api/topics/delete", { topicId: topic.id });
      const result: { deleted?: boolean; cleanupWarning?: string; error?: string } = await response.json();
      if (!response.ok || !result.deleted) throw new Error(result.error || "删除专题失败");
      setTopics(current => current.filter(item => item.id !== topic.id));
      setTopicInsights(current => { const next = { ...current }; delete next[topic.id]; return next; });
      setSearchPoints(current => current.filter(point => point.topic_id !== topic.id));
      setReaderTopicIds(current => current?.filter(id => id !== topic.id) || null);
      if (lastTopicId === topic.id) {
        setLastTopicId(null);
        window.localStorage.removeItem(`im:last-topic:${user.id}`);
        window.localStorage.removeItem(`im:last-topic-at:${user.id}`);
      }
      let offlineWarning = "";
      if (savedOfflineIds.includes(topic.id)) {
        try {
          await removeOfflineTopic(user.id, topic.id);
          setSavedOfflineIds(current => current.filter(id => id !== topic.id));
          setOfflineTopics(current => current.filter(item => item.topic.id !== topic.id));
        } catch { offlineWarning = "专题已删除，但本机离线副本清理失败"; }
      }
      if (selectedId === topic.id) { selectedIdRef.current = null; setSelectedId(null); navigate("library"); }
      if (result.cleanupWarning || offlineWarning) setError([result.cleanupWarning, offlineWarning].filter(Boolean).join("；"));
      void Promise.all([loadJobs(), loadInsights()]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "删除专题失败"); }
    finally { setDeletingTopicId(null); }
  }

  if (!ready) return <div className="center-screen">正在载入知识库…</div>;
  if (!db) return <div className="center-screen setup"><div className="brand-mark">IM</div><h1>Interview Master</h1><p>先配置 Supabase 环境变量并执行数据库迁移，即可开始使用。</p><code>NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY</code></div>;
  if (!user) return <AuthScreen />;

  return <div className={`shell shell-view-${view} ${navCollapsed ? "shell-nav-collapsed" : ""} ${view === "reader" ? "shell-reading" : ""} ${readingNavOpen ? "shell-reading-nav-open" : ""} ${focus ? "shell-focus" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
    {mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
    <aside className="app-sidebar" aria-label="侧栏导航"><button className="mobile-sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="关闭侧栏">×</button><button className="nav-collapse" onClick={() => setNavCollapsed(value => !value)} aria-label={navCollapsed || focus ? "展开主导航" : "折叠主导航"} title={navCollapsed || focus ? "展开主导航" : "折叠主导航"}>{navCollapsed || focus ? "»" : "«"}</button>
      <button className="brand" onClick={() => navigate("home")}><span className="brand-mark">IM</span><span>Interview<br /><strong>Master</strong></span></button>
      <div className="sidebar-caption">工作空间</div>
      <nav className="nav-list" aria-label="主导航">
        <button className={view === "home" ? "active" : ""} onClick={() => navigate("home")}><span>⌂</span>学习首页</button>
        <button className={view === "browse" ? "active" : ""} onClick={() => navigate("browse")}><span>◈</span>随便看看</button>
        <button className={view === "library" || (view === "reader" && selected?.status === "published") ? "active" : ""} onClick={() => navigate("library")}><span>▤</span>我的知识库</button>
        <button className={view === "favorites" ? "active" : ""} onClick={() => navigate("favorites")}><span>☆</span>我的收藏{favoriteCount > 0 && <small>{favoriteCount}</small>}</button>
        <button className={view === "notes" ? "active" : ""} onClick={() => navigate("notes")}><span>✎</span>我的笔记</button>
        <button className={view === "profile" ? "active" : ""} onClick={() => navigate("profile")}><span>◉</span>我的数据</button>
        {isAdmin && <button className={view === "drafts" || (view === "reader" && selected?.status === "draft") ? "active" : ""} onClick={() => navigate("drafts")}><span>▣</span>草稿箱 <small>{draftTopics.length}</small></button>}
        {isAdmin && <button className={view === "create" ? "active" : ""} onClick={() => navigate("create")}><span>✳</span>AI 创建专题</button>}{isAdmin && <button onClick={() => router.push("/visuals")}><span>◇</span>视觉增强中心</button>}
      </nav>
      <div className="sidebar-bottom"><div className="profile-dot">{user.email?.slice(0, 1).toUpperCase()}</div><div className="profile-text"><strong>{user.email?.split("@")[0]}</strong><small>个人知识库</small></div><button aria-label="退出登录" title="退出登录" onClick={() => db?.auth.signOut()}>↪</button></div>
    </aside>
    <main className="main-area">
      <div className="mobile-bar"><button className="mobile-menu-button" aria-label="打开导航" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(true)}>☰</button><button className="brand" onClick={() => navigate("home")}><span className="brand-mark">IM</span><strong>Interview Master</strong></button></div>
      {view !== "reader" && <header className="workspace-topbar"><label className="workspace-search"><span aria-hidden="true">⌕</span><input aria-label="全局搜索专题和知识点" placeholder="搜索专题和知识点" value={query} onFocus={() => { if (view !== "library") navigate("library"); }} onChange={event => setQuery(event.target.value)} /></label><div className="topbar-end">{isAdmin && <button className="task-entry" onClick={() => setTaskDrawerOpen(true)}>生成任务{jobs.some(job => job.status === "pending" || job.status === "running") && <span>{jobs.filter(job => job.status === "pending" || job.status === "running").length} 进行中</span>}{!jobs.some(job => job.status === "pending" || job.status === "running") && jobs.some(job => job.status === "failed") && <span className="has-failure">有失败任务</span>}</button>}<span className="workspace-account">{user.email?.split("@")[0]}</span></div></header>}
      {error && <div role="alert" className="error-banner">{error}<button onClick={() => setError("")}>关闭</button></div>}
      {view === "home" && <MobileHome
        recommendation={publishedTopics.find(topic => topic.id === recommendations[0]?.topic_id) || publishedTopics[0] || null}
        recommendations={recommendations}
        topics={publishedTopics}
        continueTopic={publishedTopics.find(topic => topic.id === lastTopicId) || null}
        continuePoint={searchPoints.find(point => point.id === lastPointId)?.title || null}
        topicCount={publishedTopics.length}
        favoriteCount={favoriteCount}
        savedCount={savedOfflineIds.length}
        draftCount={draftTopics.length}
        activeJobCount={jobs.filter(job => job.status === "pending" || job.status === "running").length}
        canManage={isAdmin === true && !offline}
        offline={offline}
        loading={topicsLoad === "loading"}
        recommendationStatus={recommendationPreferencesReady ? insightsStatus : "loading"}
        canMore={preferredRecommendationPool.length > recommendations.length}
        categoryName={categoryName}
        onRead={id => openTopic(id)}
        onPointRead={(topicId, pointId) => openTopic(topicId, pointId)}
        onCards={() => navigate("browse")}
        onContinue={() => { if (lastTopicId) openTopic(lastTopicId, lastPointId || undefined); }}
        onRandomTopic={openRandomTopic}
        onMore={() => user && showRecommendations(preferredRecommendationPool, pointActivity, user.id)}
        onLibrary={() => navigate("library")}
        onFavorites={() => navigate("favorites")}
        onNotes={() => navigate("notes")}
        onDrafts={() => navigate("drafts")}
        onTasks={() => setTaskDrawerOpen(true)}
        onCreate={() => navigate("create")}
      />}
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
          <RecommendationSection points={recommendations} activities={pointActivity} topics={publishedTopics} categories={categories.filter(category => recommendationPreferences.category_ids.includes(category.id) || preferredPoints(recommendationPool, publishedTopics, categories, [category.id]).length > 0)} categoryName={categoryName} poolSize={preferredRecommendationPool.length} status={recommendationPreferencesReady ? insightsStatus : "loading"} settingsOpen={recommendationSettingsOpen} preferences={recommendationPreferences} onSettingsOpen={() => setRecommendationSettingsOpen(true)} onSettingsClose={() => setRecommendationSettingsOpen(false)} onSavePreferences={saveRecommendationPreferences} onMore={() => user && showRecommendations(preferredRecommendationPool, pointActivity, user.id)} onOpen={openTopic} onControl={setPointControl} />
          <div className="section-header"><h2>最近专题</h2><button className="text-btn" onClick={() => navigate("library")}>查看全部 →</button></div>
          {publishedTopics.length ? <div className="recent-list">{publishedTopics.slice(0, 4).map(topic => <TopicTile key={topic.id} topic={topic} category={categoryName(topic.category_id)} onOpen={() => openTopic(topic.id)} />)}</div> : <div className="empty">发布的专题会出现在这里。</div>}
        </div>{isAdmin && <aside className="home-aside"><h2>今日待处理</h2><p>从待审核内容继续整理，再回到知识库阅读。</p><button onClick={() => navigate("drafts")}><strong>{draftTopics.length}</strong><span>份待检查草稿</span><b>查看草稿 →</b></button><button onClick={() => setTaskDrawerOpen(true)}><strong>{jobs.filter(job => job.status === "pending" || job.status === "running").length}</strong><span>项生成任务</span><b>查看任务 →</b></button><button className="aside-create" onClick={() => navigate("create")}>＋ 创建知识专题</button></aside>}</div>
      </section>}
      {view === "library" && <LibraryPanel topics={publishedTopics} drafts={draftTopics} categories={categories} insights={topicInsights} insightsStatus={insightsStatus} topicsStatus={topicsLoad} searchPoints={searchPoints} query={query} categoryName={categoryName} canManage={isAdmin === true && !offline} userId={user.id} onCategoriesChanged={load} onOpen={(id, ids) => { setReaderTopicIds(ids); openTopic(id); }} onDelete={topic => void deletePublishedTopic(topic)} deletingTopicId={deletingTopicId} />}
      {view === "favorites" && <FavoritesPanel points={searchPoints} activities={pointActivity} topics={topics} categories={categories} status={insightsStatus === "error" || topicsLoad === "error" ? "error" : insightsStatus === "loaded" && topicsLoad === "loaded" ? "loaded" : "loading"} categoryName={categoryName} onOpen={openTopic} onRemove={id => setPointControl(id, "unfavorite")} onBrowse={() => navigate("library")} />}
      {view === "notes" && <NotesPanel userId={user.id} topics={topics} categoryName={categoryName} onOpen={(topicId, chapterId) => openTopic(topicId, undefined, chapterId)} />}
      {view === "browse" && (insightsStatus === "loaded" && recommendationPreferencesReady ? <CasualCards userId={user.id} points={preferredRecommendationPool} activities={pointActivity} topics={publishedTopics} categories={categories} offline={offline} onSeen={onCardSeen} onControl={setPointControl} onExit={() => navigate("home")} onOpenTopic={id => openTopic(id)} /> : <div className="page-wrap empty" role="status">{insightsStatus === "error" ? "知识卡片暂时无法加载，请刷新页面重试。" : "正在准备知识卡片…"}</div>)}
      {view === "profile" && <ProfilePanel email={user.email || "离线阅读"} topics={publishedTopics} categories={categories} insights={topicInsights} insightsStatus={insightsStatus} topicsStatus={topicsLoad} categoryName={categoryName} offlineTopics={offlineTopics} onOpen={openTopic} onSignOut={() => { window.localStorage.removeItem("im:offline-identity"); authUserIdRef.current = null; setUser(null); setOfflineTopics([]); setSavedOfflineIds([]); setTopics([]); void db?.auth.signOut({ scope: "local" }); }} />}
      {view === "drafts" && isAdmin && <DraftPanel topics={draftTopics} insights={topicInsights} insightsStatus={insightsStatus} topicsStatus={topicsLoad} categoryName={categoryName} onOpen={openTopic} onCreate={() => navigate("create")} onDelete={topic => void deleteDraft(topic)} />}
      {view === "create" && isAdmin && <CreatePanel busy={busy} groups={modelGroups} groupsStatus={modelGroupsStatus} selectedGroupId={selectedModelGroupId} onSelectGroup={selectModelGroup} onSaveGroup={saveModelGroup} onGenerate={generate} onManual={createManual} onViewTasks={() => setTaskDrawerOpen(true)} />}
      {view === "reader" && focus && selected && mode === "read" && pointsLoad.topicId === selectedId && pointsLoad.status === "loaded" && <FocusReader topic={selected} category={categoryName(selected.category_id)} sections={sections} points={points} visuals={visuals} notes={notes} userId={user.id} initialPointId={activePointId?.startsWith("point-") ? activePointId.slice(6) : null} preferences={readerPreferences} onPreferencesChange={changeReaderPreferences} savedOffline={savedOfflineIds.includes(selected.id)} onToggleOffline={() => void toggleOfflineTopic()} onOpenMenu={() => setMobileNavOpen(true)} backLabel={effectiveReaderReturnView === "favorites" ? "我的收藏" : effectiveReaderReturnView === "drafts" ? "草稿箱" : "知识库"} onBack={() => navigate(effectiveReaderReturnView)} canGenerateAnswers={isAdmin === true && !offline} onGenerateAnswer={generateFollowupAnswer} onExit={pointId => { setFocus(false); if (pointId) requestAnimationFrame(() => document.getElementById(`point-${pointId}`)?.scrollIntoView({ behavior: "auto", block: "start" })); }} />}
      {view === "reader" && focus && selected && pointsLoad.status !== "loaded" && (pointsLoad.status === "error" ? <div className="reader-load-error">专题内容加载失败。<button className="text-btn" onClick={() => setFocus(false)}>返回专题页</button></div> : <ReaderLoading full />)}
      {view === "reader" && !focus && <section className={`reader ${focus ? "reader-focus" : ""} ${mobileTopicsOpen ? "reader-mobile-topics-open" : ""}`}><aside className="reader-left"><button className="back-link" onClick={() => navigate(effectiveReaderReturnView)}>← 返回{effectiveReaderReturnView === "favorites" ? "我的收藏" : effectiveReaderReturnView === "drafts" ? "草稿箱" : "知识库"}</button><h3>{readerTopicIds ? "专题列表" : "切换专题"}</h3>{(selected?.status === "draft" ? draftTopics : readerTopicIds ? readerTopicIds.map(id => publishedTopics.find(topic => topic.id === id)).filter((topic): topic is Topic => !!topic) : publishedTopics).map(topic => <button key={topic.id} className={`reader-topic ${topic.id === selectedId ? "selected" : ""}`} title={topic.title} onClick={() => { openTopic(topic.id); setMobileTopicsOpen(false); }}><span>{topic.title}</span></button>)}</aside><div className="reader-body">{selected ? <><div className="reader-toolbar"><TopicCategoryEditor key={selected.id} categoryId={selected.category_id} categories={categories} canEdit={isAdmin === true && !offline && selected.user_id === user.id} onSave={updateTopicCategory} /><div className="reader-toolbar-actions"><button className="reader-nav-toggle" onClick={() => setReadingNavOpen(value => !value)} aria-expanded={readingNavOpen}>{readingNavOpen ? "隐藏导航" : "显示导航"}</button><button disabled={pointsLoad.topicId !== selectedId || pointsLoad.status !== "loaded"} onClick={() => { setMode("read"); setFocus(true); }}>专注阅读</button><button className="topics-mobile-toggle" onClick={() => setMobileTopicsOpen(value => !value)} aria-expanded={mobileTopicsOpen}>切换专题</button><button className="toc-mobile-toggle" onClick={() => setTocOpen(value => !value)} aria-expanded={tocOpen}>当前专题目录</button><button className="reader-top-toggle" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}>↑</button></div></div><div className="reader-heading"><h1>{selected.title}</h1><TopicAnswerFocus answer={readTopicAnswer(sections[0]?.content_md)} /><p>{selected.summary || "开始整理这份专题，为知识点添加自己的理解。"}</p><div className="reader-actions"><button className={mode === "read" ? "tab active" : "tab"} onClick={() => setMode("read")}>专题阅读</button><button className={mode === "cards" ? "tab active" : "tab"} disabled={pointsLoad.topicId !== selectedId || pointsLoad.status !== "loaded" || cards.length === 0 || !reviewsReady} onClick={() => { setMode("cards"); window.scrollTo({ top: 0, behavior: "instant" }); }}>知识点复习</button>{isAdmin && <button className="visual-reader-btn" onClick={() => router.push("/visuals?topic=" + selected.id)}>视觉增强</button>}{isAdmin && selected.status === "published" && <button className="regenerate-reader-btn" disabled={regeneratingTopicId === selected.id || jobs.some(job => job.topic_id === selected.id && (job.status === "pending" || job.status === "running"))} onClick={() => void regeneratePublishedTopic(selected)}>{regeneratingTopicId === selected.id ? "提交中…" : "重新生成"}</button>}{isAdmin && !offline && selected.status === "published" && <button className="delete-reader-btn" disabled={!!deletingTopicId} onClick={() => void deletePublishedTopic(selected)}>{deletingTopicId === selected.id ? "删除中…" : "删除专题"}</button>}{isAdmin && selected.status === "draft" && <button className="publish-btn" onClick={publish}>发布到知识库</button>}{isAdmin && selected.status === "draft" && <button className="delete-reader-btn" disabled={jobs.some(job => job.topic_id === selected.id && (job.status === "pending" || job.status === "running"))} onClick={() => void deleteDraft(selected)}>删除草稿</button>}</div></div>{mode === "read" ? <div className="article">{pointsLoad.topicId !== selectedId || pointsLoad.status === "loading" ? <ReaderLoading /> : pointsLoad.status === "error" ? <div className="reader-load-error">知识点加载失败，请稍后重试或重新打开专题。</div> : sections.length ? sections.map((section, sectionIndex) => <section key={section.id} id={`section-${section.id}`}><span className="chapter-kicker">章节 {String(sectionIndex + 1).padStart(2, "0")}</span><h2>{section.title}</h2>{points.filter(point => point.parent_id === section.id).map(point => <PointBlock key={point.id} point={point} visuals={visuals.filter(visual => visual.knowledge_point_id === point.id)} activity={pointActivity[point.id]} canEdit={isAdmin === true} mastery={mastery[point.id] || 0} onSave={updatePoint} onVerify={verifyPoint} onControl={setPointControl} onGenerateAnswer={generateFollowupAnswer} />)}<ChapterNote section={section} note={notes[section.id] || ""} onSave={saveNote} /></section>) : ((!jobsLoaded && (selected.generation_status === "pending" || selected.generation_status === "running")) || jobs.some(job => job.topic_id === selected.id && (job.status === "pending" || job.status === "running"))) ? <div className="reader-waiting" role="status"><span className="reader-waiting-dot" />正在生成专题内容，完成后会自动显示在这里。</div> : <div className="empty">这个专题还没有知识点。可以先创建内容，生成任务完成后也会自动显示在这里。</div>}</div> : !reviewsReady ? <ReaderLoading /> : <CardReview topic={selected} category={categoryName(selected.category_id)} sections={sections} points={cards} notes={notes} progress={reviewProgress} preferences={readerPreferences} onPreferencesChange={changeReaderPreferences} onSaveNote={saveNote} onRate={rateCard} onUndo={undoCardRating} onExit={pointId => { setMode("read"); if (pointId) requestAnimationFrame(() => document.getElementById(`point-${pointId}`)?.scrollIntoView({ behavior: "instant", block: "start" })); else window.scrollTo({ top: 0, behavior: "instant" }); }} />}</> : topicsLoad === "loading" ? <ReaderLoading full /> : topicsLoad === "error" ? <div className="reader-load-error">专题加载失败，请稍后重试。</div> : <div className="empty">找不到这个专题，或你没有访问权限。</div>}</div><aside className={`reader-right ${tocOpen ? "toc-open" : ""}`} aria-label="当前专题目录"><h3>当前专题目录</h3>{sections.map(section => <div className="toc-section" key={section.id}><div className="toc-section-head"><a className={activePointId === `section-${section.id}` || points.some(point => point.parent_id === section.id && activePointId === `point-${point.id}`) ? "active" : ""} href={`#section-${section.id}`} onClick={event => jumpToTocTarget(event, `section-${section.id}`)}>{section.title}</a><button onClick={() => setClosedSections(previous => previous.includes(section.id) ? previous.filter(id => id !== section.id) : [...previous, section.id])} aria-label={`${closedSections.includes(section.id) ? "展开" : "折叠"}${section.title}`} aria-expanded={!closedSections.includes(section.id)}>{closedSections.includes(section.id) ? "+" : "−"}</button></div>{!closedSections.includes(section.id) && points.filter(point => point.parent_id === section.id).map(point => <a className={`toc-point ${activePointId === `point-${point.id}` ? "active" : ""} ${mastery[point.id] >= 3 ? "mastered" : mastery[point.id] > 0 ? "weak" : ""}`} key={point.id} href={`#point-${point.id}`} onClick={event => jumpToTocTarget(event, `point-${point.id}`)}><span>{point.title}</span>{mastery[point.id] > 0 && <i aria-label={mastery[point.id] >= 3 ? "已掌握" : "薄弱知识点"} />}</a>)}</div>)}<div className="reader-note"></div></aside></section>}
      {view === "reader" && mode === "read" && pointsLoad.status === "loaded" && !offline && <ReadingActivityTracker key={`${selectedId}:${focus}`} onViewed={onPointViewed} />}
    </main><nav className="mobile-nav" aria-label="手机导航"><button className={view === "home" ? "active" : ""} onClick={() => navigate("home")}><span aria-hidden="true">⌂</span>首页</button><button className={view === "library" ? "active" : ""} onClick={() => navigate("library")}><span aria-hidden="true">▤</span>知识库</button><button className={view === "browse" ? "active" : ""} onClick={() => navigate("browse")}><span aria-hidden="true">▧</span>卡片</button><button className={view === "profile" ? "active" : ""} onClick={() => navigate("profile")}><span aria-hidden="true">◉</span>我的</button></nav>
    {isAdmin && taskDrawerOpen && <TaskDrawer jobs={jobs} modelGroups={modelGroups} modelGroupsStatus={modelGroupsStatus} selectedModelGroupId={selectedModelGroupId} onSelectModelGroup={selectModelGroup} onClose={() => setTaskDrawerOpen(false)} onOpen={id => { setTaskDrawerOpen(false); openTopic(id); }} onRetry={retryJob} onRetryAll={() => void retryAllJobs()} retryAllProgress={retryAllProgress} onDelete={job => void deleteJob(job)} retryingJobId={retryingJobId} />}
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

function TaskDrawer({ jobs, modelGroups, modelGroupsStatus, selectedModelGroupId, onSelectModelGroup, onClose, onOpen, onRetry, onRetryAll, retryAllProgress, onDelete, retryingJobId }: { jobs: GenerationJob[]; modelGroups: AiModelGroup[]; modelGroupsStatus: "loading" | "loaded" | "error"; selectedModelGroupId: string; onSelectModelGroup: (id: string) => void; onClose: () => void; onOpen: (id: string) => void; onRetry: (job: GenerationJob) => void; onRetryAll: () => void; retryAllProgress: RetryAllProgress | null; onDelete: (job: GenerationJob) => void; retryingJobId: string | null }) {
  const [filter, setFilter] = useState<"all" | "active" | "failed" | "completed">("all");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButtonRef.current?.focus(); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const visible = jobs.filter(job => filter === "all" || (filter === "active" ? job.status === "pending" || job.status === "running" : job.status === filter));
  const queuedCount = jobs.filter(job => job.status === "pending").length;
  const activeCount = jobs.filter(job => job.status === "running").length;
  const failedCount = jobs.filter(job => job.status === "failed").length;
  const bulkRunning = retryAllProgress?.running === true;
  const canRetry = modelGroupsStatus === "loaded" && !!selectedModelGroupId && !bulkRunning;
  return <div className="task-drawer-layer"><button className="task-drawer-backdrop" aria-label="关闭任务中心" onClick={onClose} /><aside className="task-drawer" role="dialog" aria-modal="true" aria-label="生成任务中心">
    <div className="task-drawer-head"><div><span>生成任务中心</span><h2>专题生成进度</h2></div><button ref={closeButtonRef} onClick={onClose} aria-label="关闭任务中心">×</button></div>
    <div className="task-drawer-summary"><strong>{activeCount}</strong><span>生成中</span><strong>{queuedCount}</strong><span>排队中</span><strong>{failedCount}</strong><span>待处理失败</span></div>
    <label className="task-model-group">本次重试使用的模型分组<select value={modelGroups.some(group => group.id === selectedModelGroupId) ? selectedModelGroupId : ""} onChange={event => onSelectModelGroup(event.target.value)} disabled={modelGroupsStatus !== "loaded" || !modelGroups.length || bulkRunning}><option value="" disabled>{modelGroupsStatus === "loading" ? "正在加载分组…" : "请选择模型分组"}</option>{modelGroups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.model}</option>)}</select></label>
    <div className="task-bulk-actions"><button type="button" onClick={onRetryAll} disabled={!canRetry || !!retryingJobId || failedCount === 0}>{bulkRunning ? `提交中 ${retryAllProgress?.attempted || 0}/${retryAllProgress?.total || 0}` : `全部重试（${failedCount}）`}</button>{retryAllProgress && <p role="status" aria-live="polite">{bulkRunning ? `已提交 ${retryAllProgress.started} 项，处理 ${retryAllProgress.attempted}/${retryAllProgress.total} 项。` : `${retryAllProgress.message} 已提交 ${retryAllProgress.started}/${retryAllProgress.total} 项。`}</p>}</div>
    <div className="task-filters" role="group" aria-label="任务筛选">{([ ["all", "全部"], ["active", "进行中"], ["failed", "失败"], ["completed", "已完成"] ] as const).map(([value, label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>
    <JobHistory jobs={visible} onOpen={onOpen} onRetry={onRetry} onDelete={onDelete} retryingJobId={retryingJobId} canRetry={canRetry} bulkRetrying={bulkRunning} />
  </aside></div>;
}

function JobHistory({ jobs, onOpen, onRetry, onDelete, retryingJobId, canRetry, bulkRetrying }: { jobs: GenerationJob[]; onOpen: (id: string) => void; onRetry: (job: GenerationJob) => void; onDelete: (job: GenerationJob) => void; retryingJobId: string | null; canRetry: boolean; bulkRetrying: boolean }) {
  if (!jobs.length) return <div className="job-empty">还没有生成记录。创建专题后可在这里查看进度。</div>;
  return <div className="job-history">{jobs.map(job => <JobItem key={job.id} job={job} onOpen={onOpen} onRetry={onRetry} onDelete={onDelete} retrying={retryingJobId === job.id} canRetry={canRetry} bulkRetrying={bulkRetrying} />)}</div>;
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

function JobItem({ job, onOpen, onRetry, onDelete, retrying, canRetry, bulkRetrying }: { job: GenerationJob; onOpen: (id: string) => void; onRetry: (job: GenerationJob) => void; onDelete: (job: GenerationJob) => void; retrying: boolean; canRetry: boolean; bulkRetrying: boolean }) {
  const label = { pending: "等待中", running: "生成中", completed: "已完成", failed: "失败" }[job.status];
  const detail = job.status === "pending" ? "等待开始" : job.status === "running"
    ? job.raw_output?.stage === "generating_sections"
      ? `章节 ${job.raw_output.completed_sections || 0}/${job.raw_output.total_sections || "…"}`
      : "正在构建目录"
    : job.status === "failed" ? jobErrorText(job) : "可在草稿箱检查内容";
  return <article className={`task-row task-${job.status}`}><div className="task-row-top"><span className={`job-dot ${job.status}`} aria-hidden="true" /><strong>{job.input_title}</strong><span className={`job-list-status ${job.status}`}>{label}</span></div><p>{job.status === "failed" ? job.raw_output?.stage === "duplicate_title" ? detail : "生成未完成，可以重新尝试。" : detail}</p><div className="task-row-bottom"><time>{new Date(job.created_at).toLocaleString("zh-CN")}</time>{job.status === "failed" ? <div className="task-row-actions"><button className="task-retry" disabled={retrying || !canRetry} onClick={() => onRetry(job)}>{retrying ? "重试中…" : "重新生成"}</button>{!job.raw_output?.regeneration && <button className="task-delete" disabled={retrying || bulkRetrying} onClick={() => onDelete(job)}>删除任务</button>}</div> : job.status === "completed" && job.topic_id ? <button onClick={() => onOpen(job.topic_id!)}>打开专题 →</button> : null}</div>{job.status === "failed" && <details className="task-error-details"><summary>查看错误详情</summary><p>{detail}</p></details>}</article>;
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

function RecommendationSection({ points, activities, topics, categories, categoryName, poolSize, status, settingsOpen, preferences, onSettingsOpen, onSettingsClose, onSavePreferences, onMore, onOpen, onControl }: {
  points: PointRecommendation[]; activities: Record<string, PointActivity>; topics: Topic[]; categories: Category[];
  categoryName: (id: string | null) => string; poolSize: number; status: "loading" | "loaded" | "error";
  settingsOpen: boolean; preferences: RecommendationPreferences; onSettingsOpen: () => void; onSettingsClose: () => void;
  onSavePreferences: (next: RecommendationPreferences) => Promise<boolean>; onMore: () => void;
  onOpen: (topicId: string, pointId: string) => void; onControl: (id: string, action: "favorite" | "unfavorite" | "exclude" | "restore") => Promise<boolean>;
}) {
  return <section className="home-review-focus"><div className="section-header"><h2>为你推荐</h2><div className="recommendation-heading-actions"><button className="text-btn" onClick={onSettingsOpen} aria-expanded={settingsOpen}>推荐设置</button><button className="text-btn" disabled={poolSize <= points.length} onClick={onMore}>换一批 →</button></div></div>
    {settingsOpen && <RecommendationSettings categories={categories} preferences={preferences} onSave={onSavePreferences} onClose={onSettingsClose} />}
    {status === "loaded" ? points.length ? <div className="home-review-list">{points.map(point => {
      const topic = topics.find(item => item.id === point.topic_id);
      const favorite = activities[point.id]?.is_favorite || false;
      return <article className="recommendation-row" key={point.id}><button className="recommendation-open" onClick={() => onOpen(point.topic_id, point.id)}><span><strong>{point.title}</strong><small className="home-recommend-topic">{topic?.title || "专题"}</small><small>{topic ? categoryName(topic.category_id) : "未分类"} · {point.reason === "unread" ? "之前还未阅读" : point.reason === "revisit" ? "七天以上未读" : "随机探索"}</small></span><span className="home-review-stats"><em>{point.reason === "unread" ? "还没看过" : point.reason === "revisit" ? "重新接触" : "随机探索"}</em></span><span aria-hidden="true">→</span></button><div className="recommendation-controls"><button onClick={() => void onControl(point.id, favorite ? "unfavorite" : "favorite")} aria-pressed={favorite}>{favorite ? "★ 已收藏" : "☆ 收藏"}</button><button onClick={() => void onControl(point.id, "exclude")}>暂不推荐 7 天</button></div></article>;
    })}</div> : <div className="empty">所选分类还没有可推荐的知识点。可以调整推荐设置。</div> : <div className="empty" role="status">{status === "error" ? "推荐信息暂时无法加载，请刷新页面重试。" : "正在挑选知识点…"}</div>}
  </section>;
}

function ProfilePanel({ email, topics, categories, insights, insightsStatus, topicsStatus, categoryName, offlineTopics, onOpen, onSignOut }: { email: string; topics: Topic[]; categories: Category[]; insights: Record<string, TopicInsight>; insightsStatus: "loading" | "loaded" | "error"; topicsStatus: "loading" | "loaded" | "error"; categoryName: (id: string | null) => string; offlineTopics: OfflineTopic[]; onOpen: (id: string) => void; onSignOut: () => void }) {
  const loaded = topicsStatus === "loaded" && insightsStatus === "loaded";
  const totalPoints = topics.reduce((sum, topic) => sum + (insights[topic.id]?.pointCount || 0), 0);
  const viewedPoints = topics.reduce((sum, topic) => sum + (insights[topic.id]?.viewedCount || 0), 0);
  const coverage = categoryCoverage(topics, categories, Object.fromEntries(Object.entries(insights).map(([id, insight]) => [id, { total: insight.pointCount, viewed: insight.viewedCount }])));
  const categoryIds = categories.filter(category => Object.hasOwn(coverage, category.id)).map(category => category.id);
  if (Object.hasOwn(coverage, "uncategorized")) categoryIds.push("uncategorized");

  return <section className="page-wrap management-page profile-page">
    <div className="management-heading"><div><span className="eyebrow">个人学习记录</span><h1 className="page-title">我的数据</h1><p>{email}</p></div></div>
    {!loaded ? <div className="management-empty" role="status">{topicsStatus === "error" || insightsStatus === "error" ? "学习数据暂时无法加载，请刷新页面重试。" : "正在加载学习数据…"}</div> : <>
      <div className="library-overview profile-overview"><div><strong>{topics.length}</strong><span>全部专题</span></div><div><strong>{totalPoints}</strong><span>知识点</span></div><div><strong>{viewedPoints}/{totalPoints}</strong><span>已浏览知识点</span></div></div>
      <section className="category-coverage" aria-label="分类阅读覆盖率"><h2>分类阅读覆盖率</h2>{categoryIds.length ? <div className="category-coverage-grid">{categoryIds.map(id => { const value = coverage[id]; const name = id === "uncategorized" ? "未分类" : categoryName(id); const percent = value.total ? Math.round(value.viewed / value.total * 100) : 0; return <div className="category-coverage-item" key={id}><div><strong>{name}</strong><span>{value.viewed}/{value.total} · {percent}%</span></div><div className="progress-track" role="progressbar" aria-label={`${name}阅读覆盖率`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }} /></div></div>; })}</div> : <p className="profile-empty">还没有可统计的专题分类。</p>}</section>
    </>}
    <section className="profile-offline"><div className="mobile-section-title"><h2>离线专题</h2><span>{offlineTopics.length} 篇</span></div>{offlineTopics.length ? <div className="mobile-saved-list">{offlineTopics.map(item => <button key={item.key} onClick={() => onOpen(item.topic.id)}><strong>{item.topic.title}</strong><small>已保存 · 离线可读</small></button>)}</div> : <p className="mobile-empty">打开专题后，点“存离线”即可在没网时阅读。</p>}</section>
    <p className="mobile-install-hint">想从 iPhone 主屏幕打开？在 Safari 点“分享”，再选“添加到主屏幕”。</p><button className="mobile-signout" onClick={onSignOut}>退出登录</button>
  </section>;
}

function LibraryPanel({ topics, drafts, categories, insights, insightsStatus, topicsStatus, searchPoints, query, categoryName, canManage, userId, onCategoriesChanged, onOpen, onDelete, deletingTopicId }: { topics: Topic[]; drafts: Topic[]; categories: Category[]; insights: Record<string, TopicInsight>; insightsStatus: "loading" | "loaded" | "error"; topicsStatus: "loading" | "loaded" | "error"; searchPoints: SearchPoint[]; query: string; categoryName: (id: string | null) => string; canManage: boolean; userId: string; onCategoriesChanged: () => Promise<void>; onOpen: (id: string, ids: string[]) => void; onDelete: (topic: Topic) => void; deletingTopicId: string | null }) {
  const [currentTime, setCurrentTime] = useState(0);
  useEffect(() => { queueMicrotask(() => setCurrentTime(Date.now())); }, []);
  const [showBackToTop, setShowBackToTop] = useState(false);
  useEffect(() => {
    const updateVisibility = () => setShowBackToTop(window.scrollY > 320);
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateVisibility);
  }, []);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [readingFilter, setReadingFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [lastRandomTopicId, setLastRandomTopicId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(LIBRARY_BATCH_SIZE);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const searchTerm = query.trim().toLocaleLowerCase();
  const matchingPointTopics = new Set(searchTerm ? searchPoints.filter(point => point.title.toLocaleLowerCase().includes(searchTerm)).map(point => point.topic_id) : []);
  const matchingDrafts = searchTerm ? drafts.filter(topic => topic.title.toLocaleLowerCase().includes(searchTerm) || !!topic.summary?.toLocaleLowerCase().includes(searchTerm) || categoryName(topic.category_id).toLocaleLowerCase().includes(searchTerm) || matchingPointTopics.has(topic.id)) : [];
  const categoryById = new Map(categories.map(category => [category.id, category]));
  function ancestorIds(id: string | null): string[] {
    const ids: string[] = [];
    while (id && categoryById.has(id) && !ids.includes(id)) {
      ids.push(id);
      id = categoryById.get(id)!.parent_id;
    }
    return ids;
  }
  const categoryCounts = new Map<string, number>();
  for (const topic of topics) {
    const ids = ancestorIds(topic.category_id);
    for (const id of ids.length ? ids : ["uncategorized"]) categoryCounts.set(id, (categoryCounts.get(id) || 0) + 1);
  }
  const availableCategories = categories.filter(category => categoryCounts.has(category.id));
  const visible = topics.filter(topic => {
    const insight = insights[topic.id] || noInsight;
    const search = query.trim().toLocaleLowerCase();
    if (search && !topic.title.toLocaleLowerCase().includes(search) && !topic.summary?.toLocaleLowerCase().includes(search) && !categoryName(topic.category_id).toLocaleLowerCase().includes(search) && !matchingPointTopics.has(topic.id)) return false;
    const topicCategories = ancestorIds(topic.category_id);
    if (categoryFilter === "uncategorized" && topicCategories.length) return false;
    if (categoryFilter !== "all" && categoryFilter !== "uncategorized" && !topicCategories.includes(categoryFilter)) return false;
    if (readingFilter === "unread" && insight.viewedCount > 0) return false;
    if (readingFilter === "started" && insight.viewedCount === 0) return false;
    if (readingFilter === "less" && !(insight.viewedCount > 0 && insight.lastViewedAt && currentTime - Date.parse(insight.lastViewedAt) > 14 * 86400000)) return false;
    return true;
  }).sort((a, b) => {
    if (sort === "title" || sort === "title_desc") {
      const order = a.title.localeCompare(b.title, "zh-CN");
      return sort === "title_desc" ? -order : order;
    }
    const aDate = sort.startsWith("created") ? a.created_at : insights[a.id]?.lastViewedAt || a.created_at;
    const bDate = sort.startsWith("created") ? b.created_at : insights[b.id]?.lastViewedAt || b.created_at;
    const order = aDate.localeCompare(bDate);
    return sort.endsWith("_asc") ? order : -order;
  });
  const displayed = visible.slice(0, visibleCount);
  const scopeIds = visible.map(topic => topic.id);
  useEffect(() => { queueMicrotask(() => setVisibleCount(LIBRARY_BATCH_SIZE)); }, [query, categoryFilter, readingFilter, sort]);
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || visibleCount >= visible.length) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) setVisibleCount(count => Math.min(count + LIBRARY_BATCH_SIZE, visible.length));
    }, { rootMargin: "300px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, visible.length, topicsStatus, insightsStatus]);
  function scopedUrl(id: string) {
    try { return `/knowledge/${id}?scope=${saveLibraryScope(userId, scopeIds)}`; }
    catch { return `/knowledge/${id}`; }
  }
  function prepareLink(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    event.currentTarget.href = scopedUrl(id);
    if (window.matchMedia("(max-width: 760px)").matches && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      onOpen(id, scopeIds);
      window.history.replaceState({}, "", event.currentTarget.href);
    }
  }
  function openRandomVisibleTopic() {
    const topic = chooseRandomTopic(displayed, lastRandomTopicId);
    if (!topic) return;
    setLastRandomTopicId(topic.id);
    if (window.matchMedia("(max-width: 760px)").matches) { onOpen(topic.id, scopeIds); window.history.replaceState({}, "", scopedUrl(topic.id)); }
    else window.open(scopedUrl(topic.id), "_blank", "noopener,noreferrer");
  }
  return <section className="page-wrap management-page library-page"><div className="management-heading"><div><span className="eyebrow">知识资产</span><h1 className="page-title">我的知识库</h1><p>选择专题，接着阅读。</p></div><span className="management-count">{topics.length} 个专题</span></div>
    <div className="library-categories"><div className="library-categories-heading"><strong>专题分类</strong>{canManage && <button type="button" onClick={() => setCategoriesOpen(value => !value)} aria-expanded={categoriesOpen}>管理分类</button>}</div><div className="library-category-tabs" role="group" aria-label="按专题分类筛选"><button type="button" className={categoryFilter === "all" ? "active" : ""} aria-pressed={categoryFilter === "all"} onClick={() => setCategoryFilter("all")}>全部 <span>{topics.length}</span></button>{availableCategories.map(category => <button type="button" key={category.id} className={categoryFilter === category.id ? "active" : ""} aria-pressed={categoryFilter === category.id} onClick={() => setCategoryFilter(category.id)}>{categoryName(category.id)} <span>{categoryCounts.get(category.id)}</span></button>)}{categoryCounts.has("uncategorized") && <button type="button" className={categoryFilter === "uncategorized" ? "active" : ""} aria-pressed={categoryFilter === "uncategorized"} onClick={() => setCategoryFilter("uncategorized")}>未分类 <span>{categoryCounts.get("uncategorized")}</span></button>}</div></div>
    {canManage && categoriesOpen && <CategoryManager categories={categories} userId={userId} onSaved={onCategoriesChanged} onClose={() => setCategoriesOpen(false)} />}
    <div className="library-filters"><strong>专题筛选 <span>{visible.length}</span></strong><label>阅读情况<select aria-label="按阅读情况筛选专题" value={readingFilter} onChange={event => setReadingFilter(event.target.value)}><option value="all">全部状态</option><option value="unread">尚未阅读</option><option value="started">已开始阅读</option><option value="less">久未阅读</option></select></label><label>排序<select aria-label="专题排序" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">最近阅读</option><option value="recent_asc">最早阅读</option><option value="created">最近创建</option><option value="created_asc">最早创建</option><option value="title">标题正序</option><option value="title_desc">标题倒序</option></select></label><button type="button" className="library-random-button" aria-label="从当前筛选结果中随机查看专题" title="随机查看当前列表中的专题" disabled={topicsStatus !== "loaded" || insightsStatus !== "loaded" || !visible.length} onClick={openRandomVisibleTopic}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1" fill="currentColor" stroke="none"/></svg></button><div className="library-layout" role="group" aria-label="展示方式"><button className={layout === "list" ? "active" : ""} onClick={() => setLayout("list")}>列表</button><button className={layout === "grid" ? "active" : ""} onClick={() => setLayout("grid")}>卡片</button></div></div>
    {topicsStatus !== "loaded" || insightsStatus !== "loaded" ? <div className="management-empty" role="status">{topicsStatus === "error" || insightsStatus === "error" ? "专题或学习信息暂时无法加载，请刷新页面重试。" : "正在加载专题与学习信息…"}</div> : visible.length ? <div className={`library-list ${layout === "grid" ? "is-grid" : ""}`}>{displayed.map(topic => {
      const insight = insights[topic.id] || noInsight;
      const percentage = insight.pointCount ? Math.round(insight.viewedCount / insight.pointCount * 100) : 0;
      return <article className="library-row" key={topic.id}><div className="library-row-content"><span className="category-tag">{categoryName(topic.category_id)}</span><h2><a href={`/knowledge/${topic.id}`} target="_blank" rel="noopener noreferrer" onClick={event => prepareLink(event, topic.id)}>{topic.title}</a></h2><div className="library-row-meta"><span>{insight.pointCount} 个知识点</span><span>{studyDate(insight.lastViewedAt)}</span></div></div><div className="library-row-progress"><strong>{insight.viewedCount}/{insight.pointCount}</strong><span>已浏览</span><div className="progress-track"><i style={{ width: `${percentage}%` }} /></div></div><div className="library-row-actions"><a className="library-row-action" href={`/knowledge/${topic.id}`} target="_blank" rel="noopener noreferrer" onClick={event => prepareLink(event, topic.id)}><span className="library-read-desktop">新标签页阅读</span><span className="library-read-mobile">开始阅读</span></a>{canManage && <button type="button" className="library-delete-topic" disabled={!!deletingTopicId} onClick={() => onDelete(topic)} aria-label={`删除专题${topic.title}`}>{deletingTopicId === topic.id ? "删除中…" : "删除"}</button>}</div></article>;
    })}</div> : <div className="management-empty">{topics.length ? "没有符合筛选条件的已发布专题。" : "知识库还没有专题。生成并发布第一份内容后，会在这里开始积累。"}</div>}
    {topicsStatus === "loaded" && insightsStatus === "loaded" && displayed.length < visible.length && <div ref={loadMoreRef} className="library-load-more"><span>已显示 {displayed.length} / {visible.length} 个专题</span><button type="button" onClick={() => setVisibleCount(count => Math.min(count + LIBRARY_BATCH_SIZE, visible.length))}>加载更多专题</button></div>}
    {matchingDrafts.length > 0 && <div className="global-draft-results"><h2>草稿中的结果</h2>{matchingDrafts.map(topic => <a key={topic.id} href={`/knowledge/${topic.id}`} target="_blank" rel="noopener noreferrer"><span className="category-tag">{categoryName(topic.category_id)}</span><strong>{topic.title}</strong><span>新标签页完善</span></a>)}</div>}
    {showBackToTop && <button type="button" className="library-back-to-top" aria-label="返回顶部" title="返回顶部" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 14 7-7 7 7" /><path d="M12 7v12" /></svg></button>}
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

function CreatePanel({ busy, groups, groupsStatus, selectedGroupId, onSelectGroup, onSaveGroup, onGenerate, onManual, onViewTasks }: { busy: boolean; groups: AiModelGroup[]; groupsStatus: "loading" | "loaded" | "error"; selectedGroupId: string; onSelectGroup: (id: string) => void; onSaveGroup: (draft: ModelGroupDraft) => Promise<{ group?: AiModelGroup; error?: string }>; onGenerate: (titles: string[]) => Promise<{ createdCount: number; skippedTitles: string[]; failedTitles: string[] } | null>; onManual: (title: string) => void; onViewTasks: () => void }) {
  const [input, setInput] = useState("");
  const [fileError, setFileError] = useState("");
  const [readingFile, setReadingFile] = useState(false);
  const [submission, setSubmission] = useState<{ createdCount: number; skippedTitles: string[] } | null>(null);
  const titles = [...new Set(input.split(/[;；]/).map(title => title.trim()).filter(Boolean))];
  const invalidTitle = titles.find(title => title.length > 120);
  const canSubmit = titles.length > 0 && titles.length <= 100 && !invalidTitle && !readingFile && !busy && groupsStatus === "loaded" && !!selectedGroupId;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmission(null);
    const result = await onGenerate(titles);
    if (!result) return;
    setInput(result.failedTitles.join(";"));
    setSubmission({ createdCount: result.createdCount, skippedTitles: result.skippedTitles });
  }

  async function importFile(file?: File) {
    if (!file) return;
    setFileError("");
    setSubmission(null);
    if (!file.name.toLowerCase().endsWith(".txt")) { setFileError("请选择 .txt 文本文件。"); return; }
    if (file.size > 100 * 1024) { setFileError("文本文件不能超过 100 KB。"); return; }
    setReadingFile(true);
    try {
      const content = (await file.text()).replace(/^\uFEFF/, "").trim();
      if (!content) { setFileError("文本文件没有内容。"); return; }
      setInput(current => current.trim() ? `${current.trim()};${content}` : content);
    } catch { setFileError("读取文本文件失败，请重试。"); }
    finally { setReadingFile(false); }
  }

  return <section className="create-wrap"><div className="eyebrow">创建知识专题</div><h1 className="hero-title">你想掌握什么？</h1><p className="hero-copy">输入一个或多个专题名称，AI 会自动选择分类并生成内容。多个名称用 ; 分隔，也可以导入 .txt 文件。完成后可在草稿箱检查。</p><ModelGroupPicker groups={groups} selectedId={selectedGroupId} status={groupsStatus} onSelect={onSelectGroup} onSave={onSaveGroup} /><form onSubmit={submit}><label htmlFor="topic-title">专题名称</label><textarea id="topic-title" rows={5} placeholder="例如：Redis 持久化机制;MySQL 索引原理" value={input} disabled={busy} onChange={event => { setInput(event.target.value); setFileError(""); setSubmission(null); }} aria-describedby="topic-input-help" /><p id="topic-input-help" className="create-input-help">用英文 ; 或中文 ； 分隔，每个名称最多 120 字，单次最多 100 个任务。</p><label className="create-file-label" htmlFor="topic-file">导入文本文件（.txt）</label><input id="topic-file" type="file" accept=".txt,text/plain" disabled={busy || readingFile} onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />{fileError && <p className="create-input-error" role="alert">{fileError}</p>}{invalidTitle && <p className="create-input-error" role="alert">专题名称不能超过 120 字：{invalidTitle}</p>}{titles.length > 100 && <p className="create-input-error" role="alert">单次最多提交 100 个专题。</p>}<div className="generation-list"><span>生成内容 · {titles.length} 个专题</span><p>自动分类 · 回答重点 · 原理讲解 · 面试追问</p></div><button className="primary-btn create-submit" disabled={!canSubmit}>{busy ? "正在提交任务…" : titles.length > 1 ? `AI 生成 ${titles.length} 个专题` : "AI 生成专题"}</button>{submission && <div className="create-submit-success" role="status">{submission.createdCount > 0 && <><strong>已提交 {submission.createdCount} 个生成任务</strong><button type="button" onClick={onViewTasks}>查看生成任务 →</button></>}{submission.skippedTitles.length > 0 && <p>已跳过同名专题：{submission.skippedTitles.join("、")}</p>}</div>}<button type="button" className="text-btn" disabled={busy || readingFile || titles.length !== 1 || !!invalidTitle} onClick={() => onManual(titles[0])}>先创建空白专题</button></form><p className="fine-print">AI 生成的内容可能有误，阅读时请核对技术细节。</p></section>;
}

function PointBlock({ point, visuals, activity, mastery, canEdit, onSave, onVerify, onControl, onGenerateAnswer }: { point: KnowledgePoint; visuals: Visual[]; activity?: PointActivity; mastery: number; canEdit: boolean; onSave: (point: KnowledgePoint, content: string) => Promise<boolean>; onVerify: (point: KnowledgePoint) => void; onControl: (id: string, action: "favorite" | "unfavorite" | "exclude" | "restore") => Promise<boolean>; onGenerateAnswer: (point: KnowledgePoint, question: string) => Promise<string | null> }) {
  const [editing, setEditing] = useState(false);
  const [mountedAt] = useState(() => Date.now());
  const excluded = !!activity?.excluded_until && Date.parse(activity.excluded_until) > mountedAt;
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState(point.content_md || "");
  return <div className="point-block" id={`point-${point.id}`}>
    <div className="point-title"><h3>{point.title}</h3></div>
    {editing ? <div className="edit-area"><textarea aria-label={`编辑${point.title}`} value={content} onChange={event => setContent(event.target.value)} rows={12} /><div><button className="primary-btn" disabled={saving} onClick={async () => { setSaving(true); const saved = await onSave(point, content); setSaving(false); if (saved) setEditing(false); }}>{saving ? "保存中…" : "保存修改"}</button><button className="text-btn" disabled={saving} onClick={() => { setContent(point.content_md || ""); setEditing(false); }}>取消</button></div></div> : <>
      
      <div className="content-section"><PointContent content={point.content_md || (canEdit ? "暂无内容，点击编辑补充知识讲解。" : "暂无内容。")} hideMermaid={visuals.some(visual => visual.replaces_mermaid)} /></div>
      <PointVisuals visuals={visuals} />
      {point.example_md && <div className="content-section example-section"><MarkdownContent content={point.example_md} /></div>}
      {point.common_mistakes?.length > 0 && <div className="mistakes"><strong>易错点</strong><ul>{point.common_mistakes.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {point.key_takeaways?.length > 0 && <div className="takeaways"><strong>补充要点</strong><ul>{point.key_takeaways.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
      {point.interview_questions?.length > 0 && <details className="followups"><summary>面试追问（{point.interview_questions.length}）</summary><InterviewFollowups point={point} canGenerate={canEdit} onGenerate={onGenerateAnswer} /></details>}
      <div className="point-actions"><div className="point-action-group"><span className="point-action-label">知识管理</span><button onClick={() => void onControl(point.id, activity?.is_favorite ? "unfavorite" : "favorite")} aria-pressed={activity?.is_favorite || false}>{activity?.is_favorite ? "★ 已收藏" : "☆ 收藏"}</button>{canEdit && <button className="edit-link" onClick={() => { setContent(point.content_md || ""); setEditing(true); }}>编辑</button>}<details className="point-more"><summary>更多</summary><button onClick={() => void onControl(point.id, excluded ? "restore" : "exclude")}>{excluded ? "恢复推荐" : "暂不推荐 7 天"}</button></details></div>{canEdit && <div className="point-action-group point-check-group"><span className="point-action-label">内容校验</span><span className={`point-check-status ${point.verification_status === "verified" ? "verified" : ""}`}>{point.verification_status === "verified" ? "已校验" : "待校验"}</span>{point.verification_status !== "verified" && <button className="verify-link" onClick={() => onVerify(point)}>标记已校验</button>}</div>}{mastery >= 3 && <span className="mastery-inline mastered">已掌握</span>}</div>
    </>}
  </div>;
}

function ChapterNote({ section, note, onSave }: { section: KnowledgePoint; note: string; onSave: (sectionId: string, content: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  return <div className="personal-note chapter-note"><div className="personal-note-heading"><strong>本章笔记</strong><button onClick={() => { setDraft(note); setEditing(value => !value); }}>{editing ? "收起" : note ? "编辑笔记" : "添加笔记"}</button></div>{editing ? <div className="note-editor"><textarea aria-label={`${section.title}的笔记`} value={draft} onChange={event => setDraft(event.target.value)} rows={6} placeholder="记录这一章的理解、疑问或补充…" /><button className="primary-btn" disabled={saving} onClick={async () => { setSaving(true); const saved = await onSave(section.id, draft); setSaving(false); if (saved) setEditing(false); }}>{saving ? "保存中…" : "保存笔记"}</button></div> : note ? <MarkdownContent content={note} className="note-content" prose /> : <p>把这一章的重点和疑问记在这里。</p>}</div>;
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














