type WorkflowTopic = { id: string; status: string; generation_status: string };
type WorkflowJob = { topic_id: string | null; status: string };

export function reviewableDrafts<T extends WorkflowTopic>(topics: T[], jobs: WorkflowJob[], jobsLoaded = true): T[] {
  return topics.filter(topic => {
    if (topic.status !== "draft") return false;
    const linkedJobs = jobs.filter(job => job.topic_id === topic.id);
    if (jobsLoaded && !linkedJobs.length && topic.generation_status === "pending") return true;
    if (topic.generation_status !== "completed") return false;
    return !jobs.some(job => job.topic_id === topic.id && (job.status === "pending" || job.status === "running" || job.status === "failed"));
  });
}
