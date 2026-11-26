import type { GenerationJob } from "./types.ts";

type JobStatus = Pick<GenerationJob, "id" | "status">;

export function jobStatusSignature(jobs: JobStatus[]): string {
  return jobs.map(job => `${job.id}:${job.status}`).join("|");
}

export function newlyCompletedJobIds(previousIds: string, jobs: JobStatus[]): string[] {
  const previous = new Set(previousIds.split(",").filter(Boolean));
  return jobs.filter(job => job.status === "completed" && !previous.has(job.id)).map(job => job.id);
}
