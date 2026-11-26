"use client";

import { useEffect, useRef, useState } from "react";
import type { AiModelGroup } from "@/lib/ai-model-groups";

export type ModelGroupDraft = { id?: string; name: string; baseUrl: string; model: string; apiKey: string };

export function ModelGroupPicker({ groups, selectedId, status, onSelect, onSave }: {
  groups: AiModelGroup[];
  selectedId: string;
  status: "loading" | "loaded" | "error";
  onSelect: (id: string) => void;
  onSave: (draft: ModelGroupDraft) => Promise<{ group?: AiModelGroup; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ModelGroupDraft>({ name: "", baseUrl: "", model: "", apiKey: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const selected = groups.find(group => group.id === selectedId);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) setOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, saving]);

  function edit(group?: AiModelGroup) {
    setDraft(group ? { id: group.id, name: group.name, baseUrl: group.baseUrl, model: group.model, apiKey: "" } : { name: "", baseUrl: "", model: "", apiKey: "" });
    setError("");
    setOpen(true);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    const result = await onSave(draft);
    setSaving(false);
    if (result.error || !result.group) { setError(result.error || "保存分组失败"); return; }
    onSelect(result.group.id);
    setOpen(false);
  }

  return <div className="model-group-control"><div className="model-group-label"><label htmlFor="model-group-select">模型分组</label><span>本次生成使用所选模型配置</span></div><div className="model-group-row"><select id="model-group-select" value={selected?.id || ""} onChange={event => onSelect(event.target.value)} disabled={status !== "loaded" || !groups.length}><option value="" disabled>{status === "loading" ? "正在加载模型分组…" : status === "error" ? "分组加载失败" : "请新增模型分组"}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name} · {group.model}</option>)}</select><button type="button" onClick={() => edit()} disabled={status === "error"}>新增分组</button><button type="button" onClick={() => selected && edit(selected)} disabled={!selected || selected.source === "environment"}>修改分组</button></div>{selected && <p className="model-group-hint">接口：{selected.baseUrl}　模型：{selected.model}{selected.source === "environment" && "　·　由服务器环境变量提供"}</p>}
    {open && <div className="model-group-overlay"><button className="model-group-backdrop" aria-label="关闭模型分组表单" onClick={() => !saving && setOpen(false)} /><aside className="model-group-drawer" role="dialog" aria-modal="true" aria-labelledby="model-group-drawer-title"><div className="model-group-drawer-head"><div><span>AI 模型配置</span><h2 id="model-group-drawer-title">{draft.id ? "修改分组" : "新增分组"}</h2></div><button type="button" aria-label="关闭" onClick={() => setOpen(false)} disabled={saving}>×</button></div><form onSubmit={event => void submit(event)}><label>分组名称<input ref={nameRef} required maxLength={80} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="例如：日常生成" /></label><label>模型 URL<input required type="url" maxLength={2048} value={draft.baseUrl} onChange={event => setDraft(current => ({ ...current, baseUrl: event.target.value }))} placeholder="https://example.com/v1" /></label><label>模型名<input required maxLength={120} value={draft.model} onChange={event => setDraft(current => ({ ...current, model: event.target.value }))} placeholder="例如：your-model-name" /></label><label>API Key<input type="password" autoComplete="new-password" required={!draft.id} maxLength={500} value={draft.apiKey} onChange={event => setDraft(current => ({ ...current, apiKey: event.target.value }))} placeholder={draft.id ? "留空则保持原密钥" : "输入 API Key"} /></label><p className="model-group-secret-note">密钥仅在保存时发送到服务器；修改分组时留空会保留原密钥。</p>{error && <p className="model-group-error" role="alert">{error}</p>}<div className="model-group-drawer-actions"><button type="button" onClick={() => setOpen(false)} disabled={saving}>取消</button><button type="submit" disabled={saving}>{saving ? "保存中…" : "保存分组"}</button></div></form></aside></div>}
  </div>;
}
