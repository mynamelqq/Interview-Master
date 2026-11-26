import { AiOutputError, AiRequestError, generateOutline, generateSection, type Outline } from "@/lib/ai";
import { getRequestClient } from "@/lib/supabase";
import { categoryPaths, matchCategoryId, type CategoryOption } from "@/lib/category-match";
import { formatTopicAnswer } from "@/lib/topic-answer";
import { formatCardContent } from "@/lib/card-content";
import type { AiModelConfig } from "@/lib/ai-model-groups";

type JobInput = { token: string; topicId: string; jobId: string; title: string; config: AiModelConfig; replaceExisting?: boolean };

export async function runGenerationJob({ token, topicId, jobId, title, config, replaceExisting = false }: JobInput) {
  const db = getRequestClient(token);
  let outline: Outline | null = null;
  let failureStage = "generation_failed";
  try {
    const { error: startError } = await db.from("topic_generation_jobs").update({ status: "running" }).eq("id", jobId);
    if (startError) throw startError;
    if (!replaceExisting) {
      const { data: existing, error: duplicateError } = await db.from("topics")
        .select("id").neq("id", topicId).neq("status", "archived").neq("generation_status", "failed").eq("title", title).limit(1);
      if (duplicateError) throw duplicateError;
      if (existing?.length) {
        failureStage = "duplicate_title";
        throw new Error("已有同名专题，已跳过生成");
      }
    }
    const { data: categoryRows, error: categoryError } = await db.from("categories").select("id,name,parent_id").order("sort_order").order("name");
    if (categoryError) throw categoryError;
    const categories = (categoryRows || []) as CategoryOption[];
    outline = await generateOutline(title, categoryPaths(categories).map(category => category.path), config);
    const { error: outlineError } = await db.from("topic_generation_jobs").update({ raw_output: { stage: "generating_sections", outline, regeneration: replaceExisting } }).eq("id", jobId);
    if (outlineError) throw outlineError;

    const sectionRows = [];
    for (const section of outline.sections) {
      sectionRows.push({ section, points: await generateSection(title, section, config) });
      const { error: progressError } = await db.from("topic_generation_jobs").update({ raw_output: { stage: "generating_sections", outline, completed_sections: sectionRows.length, total_sections: outline.sections.length, regeneration: replaceExisting } }).eq("id", jobId);
      if (progressError) throw progressError;
    }

    const categoryId = matchCategoryId(outline.category, categories);
    if (replaceExisting) {
      const answerFocus = outline.answer_focus;
      const { error: replaceError } = await db.rpc("replace_published_topic_content", {
        p_topic_id: topicId,
        p_summary: outline.summary,
        p_category_id: categoryId,
        p_sections: sectionRows.map(({ section, points }, index) => ({
          title: section.title,
          content_md: index === 0 ? formatTopicAnswer(answerFocus) : null,
          points: points.map(point => ({
            title: point.title,
            content_md: formatCardContent(point.recall_prompt, point.content_md),
            example_md: point.example_md,
            key_takeaways: point.key_takeaways,
            common_mistakes: point.common_mistakes,
            interview_questions: point.interview_questions,
          })),
        })),
      });
      if (replaceError) throw replaceError;
    } else {
      let order = 0;
      for (const { section, points } of sectionRows) {
        const content = order === 0 ? formatTopicAnswer(outline.answer_focus) : null;
        const { data: parent, error: parentError } = await db.from("knowledge_points").insert({ topic_id: topicId, title: section.title, sort_order: order++, point_type: "section", content_md: content, verification_status: "ai_draft" }).select("id").single();
        if (parentError || !parent) throw parentError || new Error("保存章节失败");
        const { error: pointError } = await db.from("knowledge_points").insert(points.map((point, index) => ({ topic_id: topicId, parent_id: parent.id, title: point.title, sort_order: index, point_type: "point", content_md: formatCardContent(point.recall_prompt, point.content_md), example_md: point.example_md, key_takeaways: point.key_takeaways, common_mistakes: point.common_mistakes, interview_questions: point.interview_questions, verification_status: "ai_draft" })));
        if (pointError) throw pointError;
      }
      const { error: topicError } = await db.from("topics").update({ summary: outline.summary, category_id: categoryId, generation_status: "completed" }).eq("id", topicId);
      if (topicError) throw topicError;
    }
    if (!replaceExisting) {
      const { data: existing, error: duplicateCheckError } = await db.from("topics")
        .select("id").neq("id", topicId).neq("status", "archived").neq("generation_status", "failed").eq("title", title).limit(1);
      if (duplicateCheckError) throw duplicateCheckError;
      if (existing?.length) {
        failureStage = "duplicate_title";
        throw new Error("已有同名专题，已跳过发布");
      }
    }
    const { error: finishError } = await db.from("topic_generation_jobs").update({ status: "completed", raw_output: { stage: "completed", outline, regeneration: replaceExisting }, finished_at: new Date().toISOString() }).eq("id", jobId);
    if (finishError) throw finishError;
    if (!replaceExisting) {
      const { error: publishError } = await db.from("topics")
        .update({ status: "published" }).eq("id", topicId).eq("status", "draft").eq("generation_status", "completed");
      if (publishError) console.error("专题已生成，但自动发布失败", publishError);
    }
  } catch (error) {
    const errorLike = error !== null && typeof error === "object" ? error as { message?: unknown; details?: unknown } : null;
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : typeof errorLike?.message === "string" && errorLike.message.trim()
        ? errorLike.message
        : typeof errorLike?.details === "string" && errorLike.details.trim()
          ? errorLike.details
          : "生成失败，服务未返回具体错误原因";
    if (!replaceExisting) await db.from("topics").update({ generation_status: "failed" }).eq("id", topicId);
    await db.from("topic_generation_jobs").update({
      status: "failed",
      error_message: message,
      raw_output: error instanceof AiOutputError ? { stage: error.stage, outline, model_output: error.rawOutput, regeneration: replaceExisting }
        : error instanceof AiRequestError ? { stage: error.stage, outline, http_status: error.status, request_id: error.requestId, regeneration: replaceExisting }
        : { stage: failureStage, outline, regeneration: replaceExisting },
      finished_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
}
