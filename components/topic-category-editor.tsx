"use client";

import { useState } from "react";
import { categoryPaths } from "@/lib/category-match";
import type { Category } from "@/lib/types";

export function TopicCategoryEditor({ categoryId, categories, canEdit, onSave }: {
  categoryId: string | null;
  categories: Category[];
  canEdit: boolean;
  onSave: (categoryId: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(categoryId || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const paths = categoryPaths(categories);
  const current = paths.find(path => path.id === categoryId)?.path || "未分类";

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (value && !categories.some(category => category.id === value)) {
      setMessage("所选分类已不存在，请重新选择。");
      return;
    }
    setSaving(true);
    setMessage("");
    const saved = await onSave(value || null);
    setSaving(false);
    if (saved) setEditing(false);
    else setMessage("分类保存失败，请稍后重试。");
  }

  return <div className="reader-category-editor">
    {editing ? <form onSubmit={event => void save(event)}>
      <label htmlFor="reader-topic-category">专题分类</label>
      <select id="reader-topic-category" value={value} onChange={event => { setValue(event.target.value); setMessage(""); }} disabled={saving}>
        <option value="">未分类</option>
        {paths.map(path => <option key={path.id} value={path.id}>{path.path}</option>)}
      </select>
      <button type="submit" disabled={saving || value === (categoryId || "")}>{saving ? "保存中…" : "保存"}</button>
      <button type="button" disabled={saving} onClick={() => { setValue(categoryId || ""); setMessage(""); setEditing(false); }}>取消</button>
      {message && <span className="reader-category-error" role="alert">{message}</span>}
    </form> : <><span>{current} / 专题阅读</span>{canEdit && <button type="button" onClick={() => { setValue(categoryId || ""); setMessage(""); setEditing(true); }}>修改分类</button>}</>}
  </div>;
}
