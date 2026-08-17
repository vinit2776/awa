"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Not in development. sw.js serves /_next/static/ cache-first, which
    // is safe in production because those filenames are content-hashed —
    // but `next dev` reuses stable chunk names, so cache-first pins the
    // first bundle fetched and never lets go. The symptom is silent and
    // very hard to read: a newly-added Tailwind utility lands in the
    // HTML while the pinned stylesheet has no rule for it, so the class
    // is present, computes to nothing, and throws no error. An icon
    // import removed from a module gives the same shape of failure as a
    // module-factory crash instead.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        // Unregister rather than just skip: anyone who ran the app before
        // this change already has one installed and would keep being
        // served the stale bundle forever otherwise.
        for (const registration of registrations) void registration.unregister();
      });
      void caches?.keys().then((keys) => {
        for (const key of keys) void caches.delete(key);
      });
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline shell / push just won't be available — not fatal to
      // the app working normally.
    });
  }, []);
  return null;
}
