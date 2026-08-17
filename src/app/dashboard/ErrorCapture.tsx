"use client";

import { useEffect } from "react";
import { installErrorBuffer } from "@/lib/errorBuffer";

/**
 * Installs the error buffer as early as the dashboard shell renders. Its own
 * component rather than a hook inside ReportWidget so the listeners are up
 * regardless of whether the widget has been opened — errors worth reporting
 * happen before anyone thinks to open a report form.
 */
export function ErrorCapture() {
  useEffect(() => {
    installErrorBuffer();
  }, []);
  return null;
}
