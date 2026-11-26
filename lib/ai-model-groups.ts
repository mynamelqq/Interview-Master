import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AiModelConfig = { baseUrl: string; model: string; apiKey: string };
export type AiModelGroup = { id: string; name: string; baseUrl: string; model: string; source: "environment" | "custom" };

function encryptionKey(): Buffer {
  const value = process.env.AI_CONFIG_ENCRYPTION_KEY;
  if (!value || !/^[a-f\d]{64}$/i.test(value)) throw new Error("AI_CONFIG_ENCRYPTION_KEY 尚未配置为 64 位十六进制密钥");
  return Buffer.from(value, "hex");
}

export function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString("base64url")).join(".");
}

export function decryptApiKey(value: string): string {
  const [rawIv, rawTag, rawCiphertext] = value.split(".");
  if (!rawIv || !rawTag || !rawCiphertext) throw new Error("模型分组密钥格式无效");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(rawIv, "base64url"));
  decipher.setAuthTag(Buffer.from(rawTag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(rawCiphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function environmentModelConfig(): AiModelConfig | null {
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  return apiKey && model ? { baseUrl: process.env.AI_BASE_URL || "https://api.openai.com/v1", model, apiKey } : null;
}

export function validateBaseUrl(input: string): string {
  const parsed = new URL(input.trim());
  if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) throw new Error("模型 URL 必须使用 HTTPS；本地开发可使用 localhost HTTP");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("模型 URL 不应包含账号、参数或锚点");
  return parsed.href.replace(/\/$/, "");
}

export async function resolveModelConfig(db: SupabaseClient, userId: string, groupId: string | null | undefined): Promise<AiModelConfig> {
  if (!groupId || groupId === "env") {
    const config = environmentModelConfig();
    if (!config) throw new Error("默认环境模型尚未配置，请选择或新增模型分组");
    return config;
  }
  const { data, error } = await db.from("ai_model_groups").select("base_url,model,encrypted_api_key").eq("id", groupId).eq("user_id", userId).single();
  if (error || !data) throw new Error("所选模型分组不存在或无法访问");
  try { return { baseUrl: data.base_url, model: data.model, apiKey: decryptApiKey(data.encrypted_api_key) }; }
  catch { throw new Error("模型分组密钥无法解密，请检查 AI_CONFIG_ENCRYPTION_KEY"); }
}
