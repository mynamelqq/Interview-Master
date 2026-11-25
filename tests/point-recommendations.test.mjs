import assert from "node:assert/strict";
import { test } from "node:test";
import { recommendPoints } from "../lib/point-recommendations.ts";

const now = Date.parse("2026-11-25T12:00:00Z");
const points = Array.from({ length: 12 }, (_, index) => ({ id: String(index), topic_id: String(index % 4), title: `Point ${index}` }));
const activity = Object.fromEntries(points.slice(6).map((point, index) => [point.id, {
  knowledge_point_id: point.id, view_count: index + 1, reading_seconds: 20,
  last_viewed_at: new Date(now - (index + 1) * 86400000).toISOString(),
  card_seen_count: 0, last_card_seen_at: null, is_favorite: false, excluded_until: null,
}]));

test("recommendations mix unread, revisit, and exploration without scoring mastery", () => {
  const result = recommendPoints(points, activity, 10, [], now, () => .5);
  assert.equal(result.length, 10);
  assert.equal(result.filter(point => point.reason === "unread").length, 4);
  assert.equal(result.filter(point => point.reason === "revisit").length, 4);
  assert.equal(result.filter(point => point.reason === "explore").length, 2);
  assert.equal(new Set(result.map(point => point.id)).size, 10);
});

test("exclusions and recently shown points are avoided where possible", () => {
  activity["11"].excluded_until = new Date(now + 86400000).toISOString();
  const result = recommendPoints(points, activity, 3, ["0", "1", "2"], now, () => .5);
  assert.equal(result.length, 3);
  assert.ok(result.every(point => !["0", "1", "2", "11"].includes(point.id)));
  const small = recommendPoints(points.slice(0, 2), activity, 3, ["0", "1"], now, () => .5);
  assert.equal(small.length, 2);
});
