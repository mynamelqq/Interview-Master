"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").then(async () => {
      const registration = await navigator.serviceWorker.ready;
      const assets = performance.getEntriesByType("resource").map(entry => new URL(entry.name).pathname).filter(path => path.startsWith("/_next/static/"));
      registration.active?.postMessage({ type: "CACHE_APP_ASSETS", urls: [...new Set(assets)] });
    }).catch(() => {});
  }, []);
  return null;
}
