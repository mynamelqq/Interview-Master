import type { Category, Topic } from "./types";
import type { PointCandidate } from "./point-recommendations";

export type RecommendationPreferences = { category_ids: string[]; random_percent: number };
export const defaultRecommendationPreferences: RecommendationPreferences = { category_ids: [], random_percent: 20 };

export function preferredPoints(points: PointCandidate[], topics: Topic[], categories: Category[], selectedIds: string[]): PointCandidate[] {
  if (!selectedIds.length) return points;
  const selected = new Set(selectedIds);
  const topicCategories = new Map(topics.map(topic => [topic.id, topic.category_id]));
  const parents = new Map(categories.map(category => [category.id, category.parent_id]));
  return points.filter(point => {
    let id = topicCategories.get(point.topic_id);
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      if (selected.has(id)) return true;
      seen.add(id);
      id = parents.get(id) || null;
    }
    return false;
  });
}
