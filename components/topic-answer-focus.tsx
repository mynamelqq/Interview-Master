export function TopicAnswerFocus({ answer }: { answer: string | null }) {
  if (!answer) return null;
  return <section className="topic-answer-focus" aria-label="专题回答重点"><strong>回答重点</strong><p>{answer}</p></section>;
}
