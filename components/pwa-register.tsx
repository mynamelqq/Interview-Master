"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(registrations
        .filter(registration => [registration.active, registration.waiting, registration.installing]
          .some(worker => worker?.scriptURL.endsWith("/sw.js")))
        .map(registration => registration.unregister()))).catch(() => {});
      if ("caches" in window) void caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("im-")).map(key => caches.delete(key)))).catch(() => {});
      return;
    }
    void navigator.serviceWorker.register("/sw.js").then(async () => {
      const registration = await navigator.serviceWorker.ready;
      const assets = performance.getEntriesByType("resource").map(entry => new URL(entry.name).pathname).filter(path => path.startsWith("/_next/static/"));
      registration.active?.postMessage({ type: "CACHE_APP_ASSETS", urls: [...new Set(assets)] });
    }).catch(() => {});
  }, []);
  return null;
}
