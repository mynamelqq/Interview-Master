import assert from "node:assert/strict";
import test from "node:test";
import { decryptApiKey, encryptApiKey, followupModelConfig, resolveModelConfig, validateBaseUrl } from "../lib/ai-model-groups.ts";

test("followup answers require their own fast model configuration", () => {
  const names = ["AI_FOLLOWUP_BASE_URL", "AI_FOLLOWUP_MODEL", "AI_FOLLOWUP_API_KEY"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    assert.throws(() => followupModelConfig(), /AI_FOLLOWUP_BASE_URL/);
    process.env.AI_FOLLOWUP_BASE_URL = "https://fast.example.com/v1";
    process.env.AI_FOLLOWUP_MODEL = "fast-model";
    process.env.AI_FOLLOWUP_API_KEY = "fast-secret";
    assert.deepEqual(followupModelConfig(), { baseUrl: "https://fast.example.com/v1", model: "fast-model", apiKey: "fast-secret" });
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
import { generateOutline } from "../lib/ai.ts";

test("model group API keys are encrypted with authenticated encryption", () => {
  const previous = process.env.AI_CONFIG_ENCRYPTION_KEY;
  process.env.AI_CONFIG_ENCRYPTION_KEY = "1".repeat(64);
  try {
    const encrypted = encryptApiKey("secret-model-key");
    assert.ok(!encrypted.includes("secret-model-key"));
    assert.equal(decryptApiKey(encrypted), "secret-model-key");
    const parts = encrypted.split(".");
    parts[2] = (parts[2][0] === "A" ? "B" : "A") + parts[2].slice(1);
    assert.throws(() => decryptApiKey(parts.join(".")));
  } finally {
    if (previous === undefined) delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    else process.env.AI_CONFIG_ENCRYPTION_KEY = previous;
  }
});

test("a selected model group controls URL, model, and key for generation", async () => {
  const originalFetch = globalThis.fetch;
  const db = { from(table) {
    assert.equal(table, "ai_model_groups");
    return { select() { return { eq(column, value) {
      assert.equal(column, "id"); assert.equal(value, "group-1");
      return { eq(ownerColumn, ownerId) {
        assert.equal(ownerColumn, "user_id"); assert.equal(ownerId, "owner-1");
        return { async single() { return { data: { base_url: "https://model.example/v1", model: "custom-model", encrypted_api_key: encrypted }, error: null }; } };
      } };
    } }; } };
  } };
  const previous = process.env.AI_CONFIG_ENCRYPTION_KEY;
  process.env.AI_CONFIG_ENCRYPTION_KEY = "2".repeat(64);
  const encrypted = encryptApiKey("custom-secret");
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://model.example/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer custom-secret");
    assert.equal(JSON.parse(options.body).model, "custom-model");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "摘要", answer_focus: "直接回答", sections: [{ title: "第一章", points: ["知识点"] }] }) } }] }), { status: 200 });
  };
  try {
    const config = await resolveModelConfig(db, "owner-1", "group-1");
    assert.equal((await generateOutline("专题", [], config)).answer_focus, "直接回答");
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.AI_CONFIG_ENCRYPTION_KEY;
    else process.env.AI_CONFIG_ENCRYPTION_KEY = previous;
  }
});

test("model URLs require a secure endpoint without embedded credentials", () => {
  assert.equal(validateBaseUrl("https://model.example/v1/"), "https://model.example/v1");
  assert.throws(() => validateBaseUrl("https://user:secret@model.example/v1"));
  assert.throws(() => validateBaseUrl("https://model.example/v1?key=secret"));
});
