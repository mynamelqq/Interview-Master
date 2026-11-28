"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getBrowserClient } from "@/lib/supabase";
import type { KnowledgePoint, Topic } from "@/lib/types";
import type { Visual } from "@/lib/visual-enhancement";
import { extractMermaid } from "@/lib/visual-enhancement";
import { MarkdownContent } from "@/components/markdown-content";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { TopicPagePicker } from "@/components/topic-page-picker";

type VisualJob = { id: string; visual_id: string | null; scan_mode: string; status: string; scanned_topics: number; suggested_count: number; error_message: string | null; created_at: string };
type ScanMode = "topic" | "library" | "mermaid";
type BatchMode = "library" | "mermaid";
type ScanRecord = { topic_id: string; scan_mode: "general" | "mermaid"; scanned_at: string; suggestion_count: number };
type ReviewTab = Visual["status"];
const db = getBrowserClient();

export function VisualCenter() {
  const [access, setAccess] = useState<"loading" | "admin" | "denied">("loading");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState("");
  const [points, setPoints] = useState<KnowledgePoint[]>([]);
  const [visuals, setVisuals] = useState<Visual[]>([]);
  const [reviewTab, setReviewTab] = useState<ReviewTab>("pending");
  const [reviewNotice, setReviewNotice] = useState("");
  const [jobs, setJobs] = useState<VisualJob[]>([]);
  const [scanRecords, setScanRecords] = useState<ScanRecord[]>([]);
  const [topicsWithVisuals, setTopicsWithVisuals] = useState<Set<string>>(new Set());
  const [scanHistoryReady, setScanHistoryReady] = useState(false);
  const [pickerMode, setPickerMode] = useState<BatchMode | null>(null);
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<string>>(new Set());
  const [topicSearch, setTopicSearch] = useState("");
  const [batchPage, setBatchPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [stopping, setStopping] = useState(false);
  const scanJobRef = useRef<string | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [manualPointId, setManualPointId] = useState("");
  const [manualPrompt, setManualPrompt] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const currentTopicRef = useRef(topicId);
  useEffect(() => { currentTopicRef.current = topicId; }, [topicId]);

  const loadTopics = useCallback(async () => {
    if (!db) return;
    const all: Topic[] = [];
    for (let start = 0; ; start += 500) {
      const { data, error: loadError } = await db.from("topics").select("*").eq("status", "published").order("created_at", { ascending: false }).range(start, start + 499);
      if (loadError) throw loadError;
      all.push(...(data as Topic[] || []));
      if (!data || data.length < 500) break;
    }
    setTopics(all);
    const requested = new URLSearchParams(window.location.search).get("topic");
    setTopicId(current => current || (requested && all.some(topic => topic.id === requested) ? requested : all[0]?.id || ""));
  }, []);

  const loadJobs = useCallback(async () => {
    if (!db) return;
    const { data } = await db.from("visual_enhancement_jobs").select("id,visual_id,scan_mode,status,scanned_topics,suggested_count,error_message,created_at").order("created_at", { ascending: false }).limit(8);
    const rows = (data || []) as VisualJob[];
    const stale = rows.filter(job => job.scan_mode === "image" && job.status === "running" && Date.now() - new Date(job.created_at).getTime() > 6 * 60 * 1000);
    for (const job of stale) {
      const message = "图片生成任务超时，请重试";
      await db.from("visual_enhancement_jobs").update({ status: "failed", error_message: message, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "running");
      if (job.visual_id) await db.from("knowledge_point_visuals").update({ generation_status: "failed", generation_error: message, updated_at: new Date().toISOString() }).eq("id", job.visual_id).eq("generation_status", "running");
      job.status = "failed";
      job.error_message = message;
    }
    setJobs(rows);
  }, []);

  const loadScanHistory = useCallback(async () => {
    if (!db) return;
    const records: ScanRecord[] = [];
    const visualTopicIds = new Set<string>();
    for (let start = 0; ; start += 500) {
      const { data, error: loadError } = await db.from("visual_topic_scans").select("topic_id,scan_mode,scanned_at,suggestion_count").order("topic_id").order("scan_mode").range(start, start + 499);
      if (loadError) throw loadError;
      records.push(...(data || []) as ScanRecord[]);
      if (!data || data.length < 500) break;
    }
    for (let start = 0; ; start += 500) {
      const { data, error: loadError } = await db.from("knowledge_point_visuals").select("id,topic_id").order("id").range(start, start + 499);
      if (loadError) throw loadError;
      for (const visual of data || []) visualTopicIds.add(visual.topic_id);
      if (!data || data.length < 500) break;
    }
    setScanRecords(records);
    setTopicsWithVisuals(visualTopicIds);
    setScanHistoryReady(true);
  }, []);

  const loadTopic = useCallback(async (id: string) => {
    if (!db || !id) { setPoints([]); setVisuals([]); return; }
    setLoading(true);
    try {
      const { data: pointRows, error: pointError } = await db.from("knowledge_points").select("*").eq("topic_id", id).not("parent_id", "is", null).order("sort_order");
      if (pointError) throw pointError;
      const loadedPoints = (pointRows || []) as KnowledgePoint[];
      setPoints(loadedPoints);
      setManualPointId(current => loadedPoints.some(point => point.id === current) ? current : loadedPoints[0]?.id || "");
      const { data: visualRows, error: visualError } = await db.from("knowledge_point_visuals").select("*").eq("topic_id", id).order("sort_order");
      if (visualError) throw visualError;
      const next = (visualRows || []) as Visual[];
      setVisuals(next);
      setDrafts(Object.fromEntries(next.map(visual => [visual.id, visual.source_content])));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "读取专题失败"); }
    finally { setLoading(false); }
  }, []);

  const refreshVisuals = useCallback(async (id: string) => {
    if (!db || !id) return;
    const { data, error: refreshError } = await db.from("knowledge_point_visuals").select("*").eq("topic_id", id).order("sort_order");
    if (refreshError || currentTopicRef.current !== id) return;
    const next = (data || []) as Visual[];
    setVisuals(next);
    setDrafts(current => {
      const updated = { ...current };
      for (const visual of next) if (!(visual.id in updated)) updated[visual.id] = visual.source_content;
      return updated;
    });
  }, []);

  useEffect(() => {
    if (!db) { queueMicrotask(() => setAccess("denied")); return; }
    let active = true;
    void (async () => {
      const { data: auth } = await db.auth.getUser();
      if (!auth.user || !active) { if (active) setAccess("denied"); return; }
      const { data: profile } = await db.from("profiles").select("is_admin").eq("id", auth.user.id).single();
      if (!active) return;
      setAccess(profile?.is_admin ? "admin" : "denied");
      if (profile?.is_admin) await Promise.all([loadTopics(), loadJobs(), loadScanHistory()]).catch(caught => setError(caught instanceof Error ? caught.message : "加载失败"));
    })();
    return () => { active = false; };
  }, [loadTopics, loadJobs, loadScanHistory]);

  useEffect(() => { queueMicrotask(() => { void loadTopic(topicId); }); }, [topicId, loadTopic]);

  const hasRunningImages = visuals.some(visual => visual.generation_status === "running") || jobs.some(job => job.scan_mode === "image" && job.status === "running");
  useEffect(() => {
    if (access !== "admin" || !hasRunningImages) return;
    const timer = window.setInterval(() => {
      void Promise.all([refreshVisuals(topicId), loadJobs()]);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [access, hasRunningImages, topicId, refreshVisuals, loadJobs]);

  const selected = topics.find(topic => topic.id === topicId);
  const occupied = useMemo(() => new Set(visuals.map(visual => visual.knowledge_point_id)), [visuals]);
  const mermaidCount = points.filter(point => extractMermaid(point.content_md || "").length).length;
  const approvedCount = visuals.filter(visual => visual.status === "approved").length;
  const pendingCount = visuals.filter(visual => visual.status === "pending").length;
  const rejectedCount = visuals.filter(visual => visual.status === "rejected").length;
  const shownVisuals = visuals.filter(visual => visual.status === reviewTab);
  const scannedTopicIds = useMemo(() => new Set(scanRecords.filter(record => record.scan_mode === (pickerMode === "mermaid" ? "mermaid" : "general")).map(record => record.topic_id)), [scanRecords, pickerMode]);
  const visibleTopicChoices = topics.filter(topic => topic.title.toLowerCase().includes(topicSearch.trim().toLowerCase()));
  const batchPageCount = Math.max(1, Math.ceil(visibleTopicChoices.length / 12));
  const currentBatchPage = Math.min(batchPage, batchPageCount - 1);
  const pagedTopicChoices = visibleTopicChoices.slice(currentBatchPage * 12, (currentBatchPage + 1) * 12);

  function openScanPicker(mode: BatchMode) {
    setSelectedTopicIds(new Set());
    setTopicSearch("");
    setBatchPage(0);
    setPickerMode(mode);
    setProgress("");
  }

  async function api(path: string, body: object, signal?: AbortSignal) {
    if (!db) throw new Error("Supabase 尚未配置");
    const { data, error: authError } = await db.auth.getSession();
    if (authError || !data.session) throw new Error("请先重新登录");
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify(body), signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "操作失败");
    return result;
  }

  async function scan(mode: ScanMode, selectedIds?: string[]) {
    if (!db || !topicId || busy) return;
    const ids = mode === "topic" ? [topicId] : selectedIds || [];
    if (!ids.length) { setError("请至少选择一个专题"); return; }
    setError(""); setBusy(mode);
    if (mode !== "topic") setPickerMode(null);
    stopRequestedRef.current = false;
    scanAbortRef.current = new AbortController();
    let jobId: string | undefined;
    try {
      if (mode !== "topic") {
        const { data: auth } = await db.auth.getUser();
        if (!auth.user) throw new Error("请先重新登录");
        const { data: job, error: jobError } = await db.from("visual_enhancement_jobs").insert({ user_id: auth.user.id, scan_mode: mode, status: "running" }).select("id").single();
        if (jobError || !job) throw jobError || new Error("创建批量任务失败");
        jobId = job.id;
        scanJobRef.current = job.id;
        if (stopRequestedRef.current) {
          await api("/api/visuals/cancel", { jobId: job.id });
          setProgress("已停止：尚未开始扫描专题");
          await loadJobs();
          return;
        }
      }
      let completed = 0;
      let skipped = 0;
      for (let index = 0; index < ids.length; index++) {
        if (stopRequestedRef.current) break;
        setProgress(`正在扫描 ${index + 1} / ${ids.length}：${topics.find(topic => topic.id === ids[index])?.title || "专题"}`);
        const previous = scanRecords.some(record => record.topic_id === ids[index] && record.scan_mode === (mode === "mermaid" ? "mermaid" : "general"));
        const result = await api("/api/visuals/scan", { topicId: ids[index], mode, jobId, force: previous }, scanAbortRef.current?.signal);
        if (result.cancelled) { stopRequestedRef.current = true; break; }
        if (result.skipped) skipped += 1;
        else completed += 1;
      }
      if (!stopRequestedRef.current && jobId) await db.from("visual_enhancement_jobs").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", jobId).eq("status", "running");
      setProgress(stopRequestedRef.current ? `已停止：完成 ${completed} / ${ids.length} 个专题，已生成的建议保留` : `扫描完成：${completed} 个专题${skipped ? `，跳过 ${skipped} 个已扫描专题` : ""}`);
      if (!stopRequestedRef.current) setPickerMode(null);
      await Promise.all([loadTopic(topicId), loadJobs(), loadScanHistory()]);
    } catch (caught) {
      setPickerMode(null);
      if (stopRequestedRef.current) {
        setProgress("已停止：已完成的建议保留，正在分析的专题不会继续入库");
        await Promise.all([loadTopic(topicId), loadJobs(), loadScanHistory()]);
      } else {
        setError(caught instanceof Error ? caught.message : "扫描失败");
        setProgress("");
        if (jobId) await db.from("visual_enhancement_jobs").update({ status: "failed", error_message: caught instanceof Error ? caught.message.slice(0, 500) : "扫描失败", updated_at: new Date().toISOString() }).eq("id", jobId).eq("status", "running");
        await loadJobs();
      }
    } finally { scanJobRef.current = null; scanAbortRef.current = null; stopRequestedRef.current = false; setStopping(false); setBusy(""); }
  }

  async function stopScan() {
    if (!scanAbortRef.current || stopRequestedRef.current) return;
    stopRequestedRef.current = true;
    setStopping(true);
    setProgress("正在停止扫描…");
    const jobId = scanJobRef.current;
    if (!jobId) return;
    try {
      await api("/api/visuals/cancel", { jobId });
      scanAbortRef.current.abort();
      await loadJobs();
    } catch (caught) {
      stopRequestedRef.current = false;
      setStopping(false);
      setError(caught instanceof Error ? caught.message : "停止扫描失败");
    }
  }

  async function stopExistingJob(jobId: string) {
    if (scanJobRef.current === jobId) { await stopScan(); return; }
    if (busy) return;
    setBusy(`cancel:${jobId}`); setError("");
    try {
      await api("/api/visuals/cancel", { jobId });
      setProgress("已停止此前的批量扫描任务；已完成的建议保留");
      await loadJobs();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "停止任务失败"); }
    finally { setBusy(""); }
  }

  async function createImage() {
    if (!db || !manualPointId || !manualPrompt.trim() || busy) return;
    setError(""); setBusy("create");
    try {
      const pointTitle = points.find(point => point.id === manualPointId)?.title || "知识图解";
      const { data, error: saveError } = await db.from("knowledge_point_visuals").insert({ topic_id: topicId, knowledge_point_id: manualPointId, point_title: pointTitle, visual_type: "image", title: pointTitle, source_content: manualPrompt.trim(), caption: "手绘讲解图", rationale: "人工添加", status: "pending" }).select("*").single();
      if (saveError || !data) throw saveError || new Error("保存图片建议失败");
      await api("/api/visuals/generate", { visualId: data.id });
      setManualPrompt("");
      setVisuals(current => [...current, { ...(data as Visual), generation_status: "running" }]);
      setDrafts(current => ({ ...current, [data.id]: data.source_content }));
      setReviewTab("pending");
      setReviewNotice("图片任务已提交；生成完成后会自动通过审核并显示在阅读页。");
      void loadJobs();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "提交生成任务失败"); void refreshVisuals(topicId); void loadJobs(); }
    finally { setBusy(""); }
  }

  async function generate(visual: Visual) {
    if (busy) return;
    setError(""); setBusy(visual.id);
    try {
      await api("/api/visuals/generate", { visualId: visual.id, prompt: drafts[visual.id] });
      setVisuals(current => current.map(item => item.id === visual.id ? { ...item, generation_status: "running", generation_error: null } : item));
      setReviewNotice("图片任务已提交；生成完成后会自动通过审核。");
      void loadJobs();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "提交生成任务失败"); void refreshVisuals(topicId); void loadJobs(); }
    finally { setBusy(""); }
  }

  async function save(visual: Visual, action: "save" | "approve" | "reject" | "restore") {
    if (!db || busy) return;
    if (action === "approve" && visual.visual_type === "image" && !visual.storage_path) { setError("请先生成图片，再审核通过"); return; }
    setError(""); setBusy(visual.id);
    try {
      const source = drafts[visual.id]?.trim() ?? visual.source_content;
      if (action === "approve" && !source) throw new Error("图示内容不能为空");
      const status: ReviewTab = action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "restore" ? "pending" : visual.status;
      const { error: saveError } = await db.from("knowledge_point_visuals").update({ source_content: source, status, updated_at: new Date().toISOString() }).eq("id", visual.id);
      if (saveError) throw saveError;
      setVisuals(current => current.map(item => item.id === visual.id ? { ...item, source_content: source, status } : item));
      setReviewNotice(action === "approve" ? `「${visual.title}」已通过审核` : action === "reject" ? `「${visual.title}」已移到未通过` : action === "restore" ? `「${visual.title}」已移回待审核` : "修改已保存");
      if (action === "approve" && visual.visual_type === "image") {
        const { data: imageJob } = await db.from("visual_enhancement_jobs").select("id").eq("visual_id", visual.id).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (imageJob) await db.from("visual_enhancement_jobs").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", imageJob.id);
      }
      if (action === "approve" && visual.visual_type === "image") await loadJobs();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setBusy(""); }
  }

  async function remove(visual: Visual) {
    if (!db || busy) return;
    if (!window.confirm(`删除图示「${visual.title}」？`)) return;
    setBusy(visual.id); setError("");
    try {
      const { error: deleteError } = await db.from("knowledge_point_visuals").delete().eq("id", visual.id);
      if (deleteError) throw deleteError;
      if (visual.storage_path) await db.storage.from("knowledge-visuals").remove([visual.storage_path]);
      setVisuals(current => current.filter(item => item.id !== visual.id));
      setReviewNotice(`「${visual.title}」已删除`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "删除失败"); }
    finally { setBusy(""); }
  }

  async function reattach(visual: Visual, pointId: string) {
    if (!db || busy || !pointId) return;
    setBusy(visual.id); setError("");
    try {
      const { error: updateError } = await db.from("knowledge_point_visuals").update({ knowledge_point_id: pointId, point_title: points.find(point => point.id === pointId)?.title || visual.point_title, updated_at: new Date().toISOString() }).eq("id", visual.id);
      if (updateError) throw updateError;
      setVisuals(current => current.map(item => item.id === visual.id ? { ...item, knowledge_point_id: pointId, point_title: points.find(point => point.id === pointId)?.title || visual.point_title } : item));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "重新关联失败"); }
    finally { setBusy(""); }
  }

  if (access === "loading") return <main className="visual-center visual-state">正在验证访问权限…</main>;
  if (access === "denied") return <main className="visual-center visual-state"><h1>视觉增强中心</h1><p>请以管理员身份登录后使用。</p><Link href="/">返回学习首页</Link></main>;
  return <main className="visual-center">
    <header className="visual-header"><Link href="/" className="visual-back">← 返回工作空间</Link><div><p>内容工作区</p><h1>视觉增强中心</h1><span>扫描建议后审核图表；图片生成成功后自动发布。</span></div></header>
    <div className="visual-toolbar"><span className="visual-topic-label">当前专题</span><TopicPagePicker topics={topics} value={topicId} disabled={!!busy} onChange={id => { setTopicId(id); setProgress(""); setReviewNotice(""); }} />{selected && <Link href={`/knowledge/${selected.id}`}>查看专题</Link>}</div>
    {error && <div className="visual-error" role="alert">{error}<button onClick={() => setError("")}>关闭</button></div>}
    {selected ? <>
      <section className="visual-overview" aria-label="专题视觉概况"><div><h2>{selected.title}</h2><p>图示和知识正文分开保存，审核通过后才会出现在阅读页。</p></div><dl><div><dt>知识点</dt><dd>{points.length}</dd></div><div><dt>已有 Mermaid</dt><dd>{mermaidCount}</dd></div><div><dt>待审核</dt><dd>{pendingCount}</dd></div><div><dt>已通过</dt><dd>{approvedCount}</dd></div><div><dt>未通过</dt><dd>{rejectedCount}</dd></div></dl></section>
      <section className="visual-actions" aria-label="扫描操作">
        <div><h2>扫描视觉需求</h2><p>只为能明显帮助理解的知识点提出建议。批量任务先选择专题，已扫描的专题默认不选。</p></div>
        <div className="visual-action-buttons"><button disabled={!!busy} onClick={() => void scan("topic")}>扫描当前专题</button><button disabled={!!busy || !scanHistoryReady} onClick={() => openScanPicker("library")}>选择专题批量扫描</button><button disabled={!!busy || !scanHistoryReady} onClick={() => openScanPicker("mermaid")}>选择专题优化 Mermaid</button>{(busy === "library" || busy === "mermaid") && <button className="visual-stop" disabled={stopping} onClick={() => void stopScan()}>{stopping ? "正在停止…" : "停止扫描"}</button>}</div>
        {pickerMode && <div className="visual-scan-picker"><div className="visual-picker-heading"><h3>{pickerMode === "library" ? "选择要扫描的专题" : "选择要优化 Mermaid 的专题"}</h3><span>已选 {selectedTopicIds.size} / {topics.length}</span></div><p>已扫描或已有图示的专题默认不选；需要重新分析时可手动勾选。</p><input type="search" aria-label="搜索专题" placeholder="搜索专题名称" value={topicSearch} onChange={event => { setTopicSearch(event.target.value); setBatchPage(0); }} /><div className="visual-picker-controls"><button type="button" onClick={() => setSelectedTopicIds(new Set(topics.filter(topic => !scannedTopicIds.has(topic.id) && (pickerMode === "mermaid" || !topicsWithVisuals.has(topic.id))).map(topic => topic.id)))}>选择未扫描专题</button><button type="button" onClick={() => setSelectedTopicIds(new Set())}>清空选择</button></div><div className="visual-picker-list">{pagedTopicChoices.map(topic => { const record = scanRecords.find(item => item.topic_id === topic.id && item.scan_mode === (pickerMode === "mermaid" ? "mermaid" : "general")); const hasVisuals = topicsWithVisuals.has(topic.id); return <label key={topic.id}><input type="checkbox" checked={selectedTopicIds.has(topic.id)} onChange={event => setSelectedTopicIds(current => { const next = new Set(current); if (event.target.checked) next.add(topic.id); else next.delete(topic.id); return next; })} /><span>{topic.title}</span><small>{record ? `已扫描 · ${new Date(record.scanned_at).toLocaleDateString("zh-CN")} · ${record.suggestion_count} 条建议` : hasVisuals ? "已有图示" : "未扫描"}</small></label>; })}{!visibleTopicChoices.length && <p>没有匹配的专题。</p>}</div><div className="visual-list-pagination"><span>匹配 {visibleTopicChoices.length} 个 · 第 {currentBatchPage + 1} / {batchPageCount} 页</span><div><button type="button" disabled={currentBatchPage === 0} onClick={() => setBatchPage(currentBatchPage - 1)}>上一页</button><button type="button" disabled={currentBatchPage >= batchPageCount - 1} onClick={() => setBatchPage(currentBatchPage + 1)}>下一页</button></div></div><div className="visual-picker-footer"><button type="button" onClick={() => setPickerMode(null)}>取消</button><button type="button" disabled={!selectedTopicIds.size || !!busy} onClick={() => void scan(pickerMode, [...selectedTopicIds])}>开始扫描 {selectedTopicIds.size} 个专题</button></div></div>}
        {progress && <p className="visual-progress" role="status">{progress}</p>}
      </section>
      <section className="visual-manual"><div><h2>生成手绘讲解图</h2><p>选择一个知识点，描述需要解释的结构或流程。提交后可继续操作页面；生成成功会自动通过审核。</p></div><div className="visual-manual-fields"><select aria-label="选择知识点" value={manualPointId} onChange={event => setManualPointId(event.target.value)}>{points.map(point => <option key={point.id} value={point.id}>{point.title}</option>)}</select><textarea aria-label="图片描述" placeholder="例如：画出 Redis AOF 写入、缓冲区、刷盘的先后关系；手绘讲解风，箭头清晰，不添加正文以外的机制。" value={manualPrompt} onChange={event => setManualPrompt(event.target.value)} rows={3} /><button disabled={!!busy || !manualPointId || !manualPrompt.trim()} onClick={() => void createImage()}>{busy === "create" ? "提交中…" : "生成图片"}</button></div></section>
      <section className="visual-suggestions"><div className="visual-section-heading"><h2>视觉增强建议</h2><span>{visuals.length} 项</span></div><div className="visual-review-tabs" role="tablist" aria-label="视觉建议审核状态">{(["pending", "approved", "rejected"] as const).map(status => <button key={status} type="button" role="tab" id={`visual-tab-${status}`} aria-controls="visual-review-panel" aria-selected={reviewTab === status} className={reviewTab === status ? "active" : ""} onClick={() => { setReviewTab(status); setReviewNotice(""); }}>{status === "pending" ? "待审核" : status === "approved" ? "已通过" : "未通过"}<span>{status === "pending" ? pendingCount : status === "approved" ? approvedCount : rejectedCount}</span></button>)}</div>{reviewNotice && <p className="visual-review-notice" role="status">{reviewNotice}</p>}<div id="visual-review-panel" role="tabpanel" aria-labelledby={`visual-tab-${reviewTab}`}>{loading ? <p>正在读取建议…</p> : shownVisuals.length ? shownVisuals.map(visual => {
        const point = points.find(item => item.id === visual.knowledge_point_id);
        const src = visual.storage_path ? db?.storage.from("knowledge-visuals").getPublicUrl(visual.storage_path).data.publicUrl : null;
        return <article className="visual-row" key={visual.id}><div className="visual-row-head"><span className={`visual-kind kind-${visual.visual_type}`}>{visual.visual_type === "image" ? "手绘图片" : visual.visual_type === "mermaid" ? "流程图" : visual.visual_type === "table" ? "对比表" : visual.visual_type.toUpperCase()}</span><span className="visual-status">{visual.generation_status === "running" ? "图片生成中" : visual.generation_status === "failed" ? "生成失败" : visual.status === "approved" ? "已通过" : visual.status === "rejected" ? "未通过" : "待审核"}</span>{visual.priority_score !== null && <span className="visual-score">视觉收益 {visual.priority_score.toFixed(1)} / 5</span>}</div><h3>{visual.title}</h3><p className="visual-point-name">{point?.title || `原知识点「${visual.point_title}」已替换，请重新关联`}{visual.replaces_mermaid ? " · 替换原 Mermaid" : ""}</p>{!point && <select aria-label={`为${visual.title}重新关联知识点`} defaultValue="" onChange={event => void reattach(visual, event.target.value)} disabled={!!busy}><option value="">选择新的知识点</option>{points.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}{visual.rationale && <p className="visual-rationale">{visual.rationale}</p>}
          {src && <div className="visual-preview"><Image src={src} alt={visual.caption || visual.title} width={1536} height={1024} unoptimized /></div>}
          {visual.visual_type === "mermaid" && <MermaidDiagram source={drafts[visual.id] ?? visual.source_content} />}
          {visual.visual_type === "table" && <MarkdownContent content={drafts[visual.id] ?? visual.source_content} />}
          {visual.status === "pending" && <><label className="visual-prompt-label" htmlFor={`visual-source-${visual.id}`}>{visual.visual_type === "image" ? "图片描述" : visual.visual_type === "mermaid" ? "Mermaid 源码" : "Markdown 表格"}</label><textarea id={`visual-source-${visual.id}`} value={drafts[visual.id] ?? visual.source_content} onChange={event => setDrafts(current => ({ ...current, [visual.id]: event.target.value }))} disabled={visual.generation_status === "running"} rows={visual.visual_type === "image" ? 3 : 5} />{visual.generation_error && <p className="visual-error-inline">{visual.generation_error}</p>}<div className="visual-row-actions">{visual.visual_type === "image" && <button disabled={!!busy || visual.generation_status === "running"} onClick={() => void generate(visual)}>{visual.generation_status === "running" ? "生成中…" : busy === visual.id ? "提交中…" : src ? "重新生成" : "生成图片"}</button>}{visual.visual_type !== "image" && <button disabled={!!busy} onClick={() => void save(visual, "approve")}>审核通过</button>}<button disabled={!!busy || visual.generation_status === "running"} onClick={() => void save(visual, "save")}>保存修改</button><button disabled={!!busy || visual.generation_status === "running"} onClick={() => void save(visual, "reject")}>标记未通过</button></div></>}
          {visual.status === "approved" && <div className="visual-row-actions"><button disabled={!!busy} onClick={() => void save(visual, "restore")}>撤回到待审核</button><button disabled={!!busy} onClick={() => void remove(visual)}>删除图示</button></div>}
          {visual.status === "rejected" && <div className="visual-row-actions"><button disabled={!!busy} onClick={() => void save(visual, "restore")}>恢复到待审核</button><button disabled={!!busy} onClick={() => void remove(visual)}>删除建议</button></div>}
        </article>;
      }) : <div className="visual-empty">{reviewTab === "pending" ? "没有待审核建议。可以扫描专题，或选择知识点生成手绘讲解图。" : reviewTab === "approved" ? "还没有审核通过的图示。" : "还没有标记为未通过的建议。"}</div>}</div></section>
      <section className="visual-uncovered"><h2>尚未添加图示</h2><p>这些知识点还没有建议；简单定义题可以保持纯文字。</p><div>{points.filter(point => !occupied.has(point.id)).map(point => <button key={point.id} onClick={() => { setManualPointId(point.id); document.querySelector(".visual-manual")?.scrollIntoView({ behavior: "smooth" }); }}>{point.title}</button>)}</div></section>
    </> : <div className="visual-empty">知识库暂无已发布专题。</div>}
    {!!jobs.length && <section className="visual-history"><h2>最近任务</h2><ul>{jobs.map(job => <li key={job.id}><span>{job.scan_mode === "library" ? "整个知识库" : job.scan_mode === "mermaid" ? "已有 Mermaid" : job.scan_mode === "image" ? "图片生成" : "单个专题"}</span><span>{job.status === "approved" ? "已审核" : job.status === "completed" ? "完成" : job.status === "running" ? "进行中" : job.status === "cancelled" ? "已停止" : "失败"}</span>{job.scan_mode !== "image" && <span>{job.scanned_topics} 个专题 · {job.suggested_count} 条建议</span>}<time>{new Date(job.created_at).toLocaleString("zh-CN")}</time>{job.status === "running" && (job.scan_mode === "library" || job.scan_mode === "mermaid") && <button disabled={!!busy} onClick={() => void stopExistingJob(job.id)}>停止</button>}{job.error_message && <small>{job.error_message}</small>}</li>)}</ul></section>}
  </main>;
}
