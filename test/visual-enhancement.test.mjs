import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMermaid, imageGenerationEndpoint, imageResultUrl, isPng, isWorthVisualizing, normalizeVisualSuggestions, shouldSkipVisualScan, visualPriority, withoutMermaid } from "../lib/visual-enhancement.ts";

test("batch visual scans skip completed topics unless explicitly selected for rescan", () => {
  assert.equal(shouldSkipVisualScan("library", true, false), true);
  assert.equal(shouldSkipVisualScan("mermaid", true, false), true);
  assert.equal(shouldSkipVisualScan("library", true, true), false);
  assert.equal(shouldSkipVisualScan("topic", true, false), false);
  assert.equal(shouldSkipVisualScan("library", false, false), false);
});

test("visual priority favors diagrams that clarify complex relationships", () => {
  assert.equal(visualPriority(5, 4, 5), 4.7);
  assert.equal(visualPriority(1, 1, 1), 1);
});

test("visual suggestions reject unknown points and invalid scores", () => {
  const valid = { point_id: "point-1", visual_type: "image", title: "写入流程", prompt: "画出写入流程", complexity: 4, relationships: 4, benefit: 5 };
  const rows = normalizeVisualSuggestions({ suggestions: [valid, { ...valid, point_id: "unknown" }, { ...valid, benefit: 9 }] }, new Set(["point-1"]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].point_id, "point-1");
});

test("a visual needs a clear learning benefit even when its topic is complex", () => {
  const suggestion = { complexity: 5, relationships: 5, benefit: 3 };
  assert.equal(isWorthVisualizing(suggestion), false);
  assert.equal(isWorthVisualizing({ ...suggestion, benefit: 4 }), true);
});

test("an approved replacement can hide only the original Mermaid block", () => {
  const markdown = "机制说明\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n记住刷盘时机。";
  assert.deepEqual(extractMermaid(markdown), ["flowchart LR\n A-->B"]);
  assert.equal(withoutMermaid(markdown), "机制说明\n\n\n\n记住刷盘时机。");
});

test("image endpoint uses the configured gateway host and rejects unsafe result hosts", () => {
  assert.equal(imageGenerationEndpoint("https://example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"), "https://example.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
  const result = { output: { choices: [{ message: { content: [{ image: "https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/image.png" }] } }] } };
  assert.equal(imageResultUrl(result), result.output.choices[0].message.content[0].image);
  assert.throws(() => imageResultUrl({ output: { choices: [{ message: { content: [{ image: "https://example.com/secret" }] } }] } }), /非预期/);
});

test("downloaded visual must have a PNG signature before upload", () => {
  assert.equal(isPng(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])), true);
  assert.equal(isPng(new Uint8Array([60, 104, 116, 109, 108, 62])), false);
});
