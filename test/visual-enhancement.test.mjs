import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMermaid, imageBase64, imageGenerationBody, imageGenerationEndpoint, imageResultUrl, isDashscopeImageEndpoint, isPng, isWorthVisualizing, normalizeVisualSuggestions, shouldSkipVisualScan, visualPriority, withoutMermaid } from "../lib/visual-enhancement.ts";

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

test("image endpoint uses the configured gateway host and rejects unsafe result URLs", () => {
  assert.equal(imageGenerationEndpoint("https://example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"), "https://example.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
  assert.equal(imageGenerationEndpoint("https://gateway.example.com", "https://images.example.com/custom/generate"), "https://images.example.com/custom/generate");
  assert.equal(imageGenerationEndpoint("", "https://images.example.com/v1"), "https://images.example.com/v1/images/generations");
  assert.throws(() => imageGenerationEndpoint("", "http://images.example.com/generate"), /HTTPS/);
  assert.throws(() => imageGenerationEndpoint("", "https://user:secret@images.example.com/generate"), /账号或密码/);
  const result = { output: { choices: [{ message: { content: [{ image: "https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/image.png" }] } }] } };
  assert.equal(imageResultUrl(result), result.output.choices[0].message.content[0].image);
  assert.equal(imageResultUrl({ data: [{ url: "https://images.example.com/generated.png" }] }), "https://images.example.com/generated.png");
  assert.throws(() => imageResultUrl({ data: [{ url: "http://images.example.com/generated.png" }] }), /非预期/);
  assert.throws(() => imageResultUrl({ data: [{ url: "https://127.0.0.1/generated.png" }] }), /非预期/);
});

test("image requests match the selected API protocol", () => {
  assert.equal(isDashscopeImageEndpoint("https://example.com/v1/images/generations"), false);
  assert.equal(isDashscopeImageEndpoint("https://example.com/api/v1/services/aigc/multimodal-generation/generation"), true);
  assert.deepEqual(imageGenerationBody("image-model", "画图", false), { model: "image-model", prompt: "画图", n: 1, size: "1536x1024" });
  assert.equal(imageBase64({ data: [{ b64_json: "aGVsbG8=" }] }), "aGVsbG8=");
  assert.equal(imageBase64({ output: { choices: [] } }), null);
});

test("downloaded visual must have a PNG signature before upload", () => {
  assert.equal(isPng(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])), true);
  assert.equal(isPng(new Uint8Array([60, 104, 116, 109, 108, 62])), false);
});
