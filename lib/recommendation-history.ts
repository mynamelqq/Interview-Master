export type RecommendationHistory = { id: string; shownAt: number }[];

export const RECOMMENDATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function recentRecommendationIds(history: RecommendationHistory, availableIds: string[], batchSize: number, now = Date.now()): string[] {
  const available = new Set(availableIds);
  const capacity = Math.max(0, available.size - Math.min(batchSize, available.size));
  if (capacity === 0) return [];
  return history.filter(item => available.has(item.id) && now - item.shownAt < RECOMMENDATION_COOLDOWN_MS)
    .slice(-capacity).map(item => item.id);
}

export function rememberRecommendations(history: RecommendationHistory, ids: string[], now = Date.now()): RecommendationHistory {
  const shown = new Set(ids);
  return [...history.filter(item => !shown.has(item.id) && now - item.shownAt < RECOMMENDATION_COOLDOWN_MS),
    ...ids.map(id => ({ id, shownAt: now }))].slice(-200);
}

export function readRecommendationHistory(key: string): RecommendationHistory {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((item): item is { id: string; shownAt: number } =>
      typeof item?.id === "string" && typeof item?.shownAt === "number") : [];
  } catch { return []; }
}

export function saveRecommendationHistory(key: string, history: RecommendationHistory) {
  try { window.localStorage.setItem(key, JSON.stringify(history)); } catch { /* Storage may be unavailable. */ }
}
