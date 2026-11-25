export type ReviewLevel = 1 | 2 | 3 | 4;
export type ReviewProgress = { mastery_level: number; repetition_count: number; interval_days: number; last_reviewed_at: string | null; next_review_at: string | null };
export type ReviewUndo = { pointId: string; previous: ReviewProgress | null; recordId: string | null; scheduledAt: string };

const intervals = [0, 6, 24, 72, 168];

export function scheduleReview(level: ReviewLevel, now = new Date()) {
  const hours = intervals[level];
  return {
    interval_days: Math.floor(hours / 24),
    next_review_at: new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString(),
  };
}

export function isReviewDue(nextReviewAt: string | null | undefined, now = new Date()): boolean {
  if (!nextReviewAt) return true;
  const due = new Date(nextReviewAt).getTime();
  return !Number.isFinite(due) || due <= now.getTime();
}
