"use client";

import { useState } from "react";
import type { Category } from "@/lib/types";
import type { RecommendationPreferences } from "@/lib/recommendation-preferences";

export function RecommendationSettings({ categories, preferences, onSave, onClose }: {
  categories: Category[];
  preferences: RecommendationPreferences;
  onSave: (next: RecommendationPreferences) => Promise<boolean>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const saved = await onSave(draft);
    setSaving(false);
    if (saved) onClose();
  }
  return <form className="recommendation-settings" onSubmit={submit}>
    <fieldset><legend>推荐分类</legend><p>不选择时推荐全部分类；选择上级分类也包含其子分类。</p>
      <div className="recommendation-category-options"><label><input type="checkbox" checked={draft.category_ids.length === 0} onChange={() => setDraft(current => ({ ...current, category_ids: [] }))} />全部分类</label>{categories.map(category => <label key={category.id}><input type="checkbox" checked={draft.category_ids.includes(category.id)} onChange={event => setDraft(current => ({ ...current, category_ids: event.target.checked ? [...current.category_ids, category.id] : current.category_ids.filter(id => id !== category.id) }))} />{category.name}</label>)}</div>
    </fieldset>
    <label className="recommendation-random-label">随机探索比例 <strong>{draft.random_percent}%</strong><input type="range" min="0" max="100" step="10" value={draft.random_percent} onChange={event => setDraft(current => ({ ...current, random_percent: Number(event.target.value) }))} /></label>
    <p>这是目标比例，每批会按知识点数量取整；其余推荐优先分给未读与久未读内容。</p>
    <div className="recommendation-settings-actions"><button type="button" onClick={onClose} disabled={saving}>取消</button><button type="submit" disabled={saving}>{saving ? "保存中…" : "保存偏好"}</button></div>
  </form>;
}
