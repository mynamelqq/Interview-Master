export type Category = { id: string; name: string; user_id: string; parent_id: string | null; sort_order: number };
export type Topic = {
  id: string; user_id: string; category_id: string | null; title: string;
  summary: string | null; difficulty: number; importance: number;
  status: "draft" | "published" | "archived";
  generation_status: "pending" | "running" | "completed" | "failed";
  created_at: string;
};
export type KnowledgePoint = {
  id: string; topic_id: string; parent_id: string | null; title: string;
  sort_order: number; content_md: string | null; example_md: string | null;
  key_takeaways: string[]; interview_questions: string[];
  common_mistakes: string[];
  verification_status: "ai_draft" | "checked" | "verified";
};
export type GenerationJob = {
  id: string; topic_id: string | null; input_title: string;
  status: "pending" | "running" | "completed" | "failed";
  raw_output: { stage?: string; completed_sections?: number; total_sections?: number; http_status?: number } | null;
  error_message: string | null;
  created_at: string; finished_at: string | null;
};
