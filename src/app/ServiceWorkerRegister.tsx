"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Offline shell / push just won't be available — not fatal to
        // the app working normally.
      });
    }
  }, []);
  return null;
}
