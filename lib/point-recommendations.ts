export type PointCandidate = { id: string; topic_id: string; title: string };
export type PointActivity = {
  knowledge_point_id: string;
  view_count: number;
  reading_seconds: number;
  last_viewed_at: string | null;
  card_seen_count: number;
  last_card_seen_at: string | null;
  is_favorite: boolean;
  excluded_until: string | null;
};
export type PointRecommendation = PointCandidate & { reason: "unread" | "revisit" | "explore" };

export function recommendPoints(
  points: PointCandidate[],
  activities: Record<string, PointActivity>,
  count = 3,
  avoidIds: string[] = [],
  now = Date.now(),
  random = Math.random,
): PointRecommendation[] {
  const avoid = new Set(avoidIds);
  const eligible = points.filter(point => {
    const activity = activities[point.id];
    return !avoid.has(point.id) && (!activity?.excluded_until || Date.parse(activity.excluded_until) <= now);
  });
  const shuffle = <T,>(items: T[]) => items.map(value => ({ value, order: random() })).sort((a, b) => a.order - b.order).map(item => item.value);
  const unread = shuffle(eligible.filter(point => !activities[point.id]?.view_count));
  const visited = eligible.filter(point => (activities[point.id]?.view_count || 0) > 0);
  const revisit = shuffle(visited).sort((a, b) => {
    const score = (point: PointCandidate) => {
      const activity = activities[point.id];
      const days = Math.max(0, (now - Date.parse(activity.last_viewed_at || "")) / 86400000);
      const recency = Number.isFinite(days) ? Math.min(days / 30, 1) : 1;
      const frequency = 1 / Math.sqrt(Math.max(1, activity.view_count));
      const cardDays = activity.last_card_seen_at ? Math.max(0, (now - Date.parse(activity.last_card_seen_at)) / 86400000) : 30;
      const novelty = Math.min(cardDays / 14, 1);
      return .45 * recency + .35 * frequency + .20 * novelty + (activity.is_favorite ? .05 : 0);
    };
    return score(b) - score(a);
  });
  const result: PointRecommendation[] = [];
  const used = new Set<string>();
  const take = (pool: PointCandidate[], reason: PointRecommendation["reason"], amount: number) => {
    for (const point of pool) {
      if (result.length >= count || amount <= 0) break;
      if (used.has(point.id)) continue;
      // Keep consecutive recommendations from different topics where possible.
      if (result.at(-1)?.topic_id === point.topic_id && pool.some(other => !used.has(other.id) && other.topic_id !== point.topic_id)) continue;
      result.push({ ...point, reason });
      used.add(point.id);
      amount -= 1;
    }
  };
  const unreadTarget = Math.round(count * .4);
  const revisitTarget = Math.round(count * .4);
  take(unread, "unread", unreadTarget);
  take(revisit, "revisit", revisitTarget);
  take(shuffle(eligible), "explore", count - result.length);
  if (result.length < count) {
    const fallback = shuffle(points.filter(point => {
      const activity = activities[point.id];
      return !activity?.excluded_until || Date.parse(activity.excluded_until) <= now;
    }));
    take(fallback, "explore", count - result.length);
  }
  return result;
}
