"use client";

import { useState } from "react";
import { categoryPaths } from "@/lib/category-match";
import { getBrowserClient } from "@/lib/supabase";
import type { Category } from "@/lib/types";

export function CategoryManager({ categories, userId, onSaved, onClose }: {
  categories: Category[];
  userId: string;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const paths = categoryPaths(categories);
  const byId = new Map(categories.map(category => [category.id, category]));

  function isDescendantOf(category: Category, ancestorId: string): boolean {
    let current = category.parent_id;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === ancestorId) return true;
      seen.add(current);
      current = byId.get(current)?.parent_id || null;
    }
    return false;
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setParentId("");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) { setMessage("分类名称应为 1 至 80 个字符。"); return; }
    if (categories.some(category => category.id !== editingId && category.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      setMessage("已有同名分类。"); return;
    }
    const selectedParent = parentId ? byId.get(parentId) : null;
    if (parentId && (!selectedParent || parentId === editingId || (editingId && isDescendantOf(selectedParent, editingId)))) {
      setMessage("上级分类不能选自己或自己的下级。"); return;
    }
    const db = getBrowserClient();
    if (!db) { setMessage("数据库尚未配置。"); return; }
    setSaving(true);
    setMessage("");
    const parent_id = parentId || null;
    const { data, error } = editingId
      ? await db.from("categories").update({ name: trimmed, parent_id }).eq("id", editingId).eq("user_id", userId).select("id").maybeSingle()
      : await db.from("categories").insert({
          user_id: userId, name: trimmed, parent_id,
          sort_order: Math.max(0, ...categories.filter(category => category.parent_id === parent_id).map(category => category.sort_order)) + 10,
        }).select("id").single();
    if (error) setMessage(error.message);
    else if (!data) setMessage("分类未能保存，请刷新后重试。");
    else {
      await onSaved();
      resetForm();
      setMessage("分类已保存。");
    }
    setSaving(false);
  }

  return <section className="category-manager" aria-label="管理专题分类">
    <div className="category-manager-head"><strong>管理分类</strong><button type="button" onClick={onClose}>收起</button></div>
    <form onSubmit={event => void save(event)}>
      <label>分类名称<input value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="例如：Go" required /></label>
      <label>上级分类<select value={parentId} onChange={event => setParentId(event.target.value)}><option value="">无（一级分类）</option>{paths.filter(path => {
        const category = byId.get(path.id)!;
        return category.id !== editingId && (!editingId || !isDescendantOf(category, editingId));
      }).map(path => <option key={path.id} value={path.id}>{path.path}</option>)}</select></label>
      <button type="submit" disabled={saving}>{saving ? "保存中…" : editingId ? "保存修改" : "新增分类"}</button>
      {editingId && <button type="button" onClick={resetForm}>取消编辑</button>}
    </form>
    {message && <p role="status">{message}</p>}
    <div className="category-manager-list">{paths.map(path => <div key={path.id}><span>{path.path}</span><button type="button" onClick={() => { const category = byId.get(path.id)!; setEditingId(category.id); setName(category.name); setParentId(category.parent_id || ""); setMessage(""); }}>编辑</button></div>)}</div>
  </section>;
}
