"use client";

import { useEffect } from "react";
import { getBrowserClient } from "@/lib/supabase";

type ActivityDelta = { knowledge_point_id: string; views: number; seconds: number; cards: number };

export function ReadingActivityTracker({ onViewed }: { onViewed: (id: string) => void }) {
  useEffect(() => {
    const db = getBrowserClient();
    if (!db) return;
    const elements = Array.from(document.querySelectorAll<HTMLElement>(".article .point-block[id^='point-'], .focus-article [id^='focus-point-']"));
    if (!elements.length) return;
    const visible = new Set<string>();
    const seconds = new Map<string, number>();
    const viewed = new Set<string>();
    const pending = new Map<string, ActivityDelta>();
    let token: string | null = null;
    void db.auth.getSession().then(({ data }) => { token = data.session?.access_token || null; });
    const { data: authListener } = db.auth.onAuthStateChange((_event, session) => { token = session?.access_token || null; });
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.pointId;
        if (!id) continue;
        if (entry.isIntersecting) visible.add(id);
        else { visible.delete(id); if (!viewed.has(id)) seconds.delete(id); }
      }
    }, { rootMargin: "-15% 0px -35% 0px", threshold: 0 });
    for (const element of elements) {
      element.dataset.pointId = element.id.startsWith("focus-point-") ? element.id.slice(12) : element.id.slice(6);
      observer.observe(element);
    }
    const add = (id: string, views: number, extraSeconds: number) => {
      const previous = pending.get(id) || { knowledge_point_id: id, views: 0, seconds: 0, cards: 0 };
      pending.set(id, { ...previous, views: previous.views + views, seconds: previous.seconds + extraSeconds });
    };
    async function flush(keepalive = false) {
      if (!pending.size) return;
      const events = [...pending.values()];
      pending.clear();
      try {
        if (keepalive && token && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
          const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/record_point_activity`, {
            method: "POST", keepalive: true,
            headers: { "Content-Type": "application/json", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
            body: JSON.stringify({ events }),
          });
          if (!response.ok) throw new Error("Activity save failed");
        } else {
          const { error } = await db!.rpc("record_point_activity", { events });
          if (error) throw error;
        }
      } catch {
        for (const event of events) add(event.knowledge_point_id, event.views, event.seconds);
      }
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !visible.size) return;
      const id = visible.values().next().value as string;
      const duration = (seconds.get(id) || 0) + 1;
      seconds.set(id, duration);
      if (duration === 8 && !viewed.has(id)) {
        viewed.add(id);
        add(id, 1, 8);
        onViewed(id);
      } else if (duration > 8) add(id, 0, 1);
    }, 1000);
    const batchTimer = window.setInterval(() => { void flush(); }, 20000);
    const onVisibility = () => { if (document.visibilityState === "hidden") { for (const id of seconds.keys()) if (!viewed.has(id)) seconds.delete(id); void flush(); } };
    const onPageHide = () => { void flush(true); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      window.clearInterval(batchTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      authListener.subscription.unsubscribe();
      void flush();
    };
  }, [onViewed]);
  return null;
}
