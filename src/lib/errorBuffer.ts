"use client";

import type { ConsoleErrorEntry } from "@/db/schema";

/**
 * A ring buffer of the last few uncaught browser errors, attached to a bug
 * report so support sees what the browser saw rather than only what the
 * reporter thought to mention. The plan calls this the single highest-value
 * addition for triage speed (§10).
 *
 * Deliberately narrow about what it keeps. An uncaught error message can quote
 * application data, and this app holds bank details and vendor pricing — so:
 *
 *  - only message, source file, line and timestamp; no stack, no local
 *    variables, no arbitrary console.log output;
 *  - the message is truncated, because the long tail of a message is where
 *    interpolated data tends to live;
 *  - the report form states that this is attached, rather than gathering it
 *    silently. Capture the user can't see is the thing to avoid here, not
 *    capture itself.
 */

const MAX_ENTRIES = 20;
const MAX_MESSAGE_LENGTH = 300;

let buffer: ConsoleErrorEntry[] = [];
let installed = false;

function record(message: string, source?: string, line?: number) {
  const trimmed = message.trim();
  if (!trimmed) return;

  buffer.push({
    message: trimmed.slice(0, MAX_MESSAGE_LENGTH),
    // Only the filename — the full URL adds query strings, which is exactly
    // where identifiers and tokens end up.
    source: source ? source.split("/").pop()?.split("?")[0] : undefined,
    line,
    at: new Date().toISOString(),
  });

  // Keep the most recent: when something breaks repeatedly, the last errors
  // are the ones that describe the state the user is actually reporting from.
  if (buffer.length > MAX_ENTRIES) buffer = buffer.slice(-MAX_ENTRIES);
}

export function installErrorBuffer() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    record(event.message ?? String(event.error ?? "Unknown error"), event.filename, event.lineno);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    record(reason instanceof Error ? `${reason.name}: ${reason.message}` : `Unhandled rejection: ${String(reason)}`);
  });
}

export function getRecentErrors(): ConsoleErrorEntry[] {
  return [...buffer];
}

export function clearErrorBuffer() {
  buffer = [];
}
