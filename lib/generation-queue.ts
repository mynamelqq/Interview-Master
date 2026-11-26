import { getRequestClient } from "@/lib/supabase";
import { resolveModelConfig } from "@/lib/ai-model-groups";
import { runGenerationJob } from "@/lib/generation-job";

type ClaimedJob = { id: string; topic_id: string; input_title: string; model_group_id: string | null; raw_output: { regeneration?: boolean } | null };

export async function dispatchGenerationJobs(token: string): Promise<number> {
  const db = getRequestClient(token);
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) throw new Error("登录已过期，请重新登录");
  const { data, error } = await db.rpc("claim_generation_jobs", { p_limit: 7 });
  if (error) throw new Error(`启动生成队列失败：${error.message}`);
  const jobs = (data || []) as ClaimedJob[];
  if (!jobs.length) return 0;
  await Promise.all(jobs.map(async job => {
    try {
      const config = await resolveModelConfig(db, auth.user.id, job.model_group_id || "env");
      await runGenerationJob({ token, topicId: job.topic_id, jobId: job.id, title: job.input_title, config, replaceExisting: job.raw_output?.regeneration === true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型配置不可用";
      await db.from("topic_generation_jobs").update({ status: "failed", error_message: message, finished_at: new Date().toISOString() }).eq("id", job.id);
      if (!job.raw_output?.regeneration) await db.from("topics").update({ generation_status: "failed" }).eq("id", job.topic_id);
    }
  }));
  return jobs.length;
}
