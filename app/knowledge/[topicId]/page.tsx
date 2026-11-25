import { Workspace } from "@/components/workspace";

export default async function TopicPage({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = await params;
  return <Workspace initialTopicId={topicId} />;
}
