import type { Category, Topic } from "./types";

export type Coverage = { total: number; viewed: number };

export function categoryCoverage(topics: Topic[], categories: Category[], insights: Record<string, Coverage>): Record<string, Coverage> {
  const parents = new Map(categories.map(category => [category.id, category.parent_id]));
  const result: Record<string, Coverage> = {};
  for (const topic of topics) {
    let id = topic.category_id || "uncategorized";
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const current = result[id] || { total: 0, viewed: 0 };
      result[id] = { total: current.total + (insights[topic.id]?.total || 0), viewed: current.viewed + (insights[topic.id]?.viewed || 0) };
      id = parents.get(id) || "";
    }
  }
  return result;
}
