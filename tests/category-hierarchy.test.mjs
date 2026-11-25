import assert from "node:assert/strict";
import test from "node:test";
import { categoryPaths, matchCategoryId } from "../lib/category-match.ts";

test("three-level categories have full paths for generation and display", () => {
  const categories = [
    { id: "backend", name: "后端", parent_id: null },
    { id: "languages", name: "编程语言", parent_id: "backend" },
    { id: "java", name: "Java", parent_id: "languages" },
    { id: "queues", name: "消息队列", parent_id: "backend" },
    { id: "kafka", name: "Kafka", parent_id: "queues" },
  ];
  assert.equal(categoryPaths(categories).find(item => item.id === "java")?.path, "后端 / 编程语言 / Java");
  assert.equal(matchCategoryId("后端／消息队列／Kafka", categories), "kafka");
});
