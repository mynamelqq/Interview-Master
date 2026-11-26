"use client";

import { useEffect, useRef, useState } from "react";
import type { KnowledgePoint } from "@/lib/types";

export function InterviewFollowups({ point, canGenerate, onGenerate }: {
  point: KnowledgePoint;
  canGenerate: boolean;
  onGenerate: (point: KnowledgePoint, question: string) => Promise<string | null>;
}) {
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState("");
  const root = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!root.current?.querySelector(".answer-open .interview-answer-wrap")?.contains(event.target as Node)) setOpenQuestion(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenQuestion(null);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);

  return <ul ref={root} className="interview-followup-list">{point.interview_questions.map((question, index) => {
    const answer = point.interview_question_answers?.[question];
    const expanded = openQuestion === question;
    return <li key={`${question}-${index}`} className={`interview-followup-item ${expanded ? "answer-open" : ""}`}>
      {answer ? <span className="interview-answer-wrap"><button type="button" className="interview-question-answer" aria-expanded={expanded} aria-label={`${question}，查看简答`} onClick={() => setOpenQuestion(expanded ? null : question)}>{question}<span className="interview-answer-mark" aria-hidden="true"> ⓘ</span></button><span role="tooltip" className="interview-answer-tooltip">{answer}</span></span> : <span>{question}</span>}
      {canGenerate && !answer && <button type="button" className="interview-generate-answer" disabled={!!generating} onClick={async () => {
        setError("");
        setGenerating(question);
        try {
          const result = await onGenerate(point, question);
          if (result) setOpenQuestion(question);
          else setError(`「${question}」生成失败，请重试`);
        } catch {
          setError(`「${question}」生成失败，请重试`);
        } finally {
          setGenerating(null);
        }
      }}>{generating === question ? "生成中…" : "生成"}</button>}
      {error.startsWith(`「${question}」`) && <span className="interview-answer-error" role="alert">{error}</span>}
    </li>;
  })}</ul>;
}
