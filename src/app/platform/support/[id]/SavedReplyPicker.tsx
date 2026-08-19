"use client";

import { useState } from "react";

type SavedReply = { id: string; title: string; body: string };

/**
 * Fills the composer from a canned reply.
 *
 * Inserts the text rather than sending it: a macro is a starting point, and an
 * agent who can't edit before sending ends up pasting an answer that doesn't
 * quite fit the ticket. Appends to whatever is already typed instead of
 * replacing it, so picking one by accident never destroys work in progress.
 */
export function SavedReplyPicker({ replies, targetId }: { replies: SavedReply[]; targetId: string }) {
  const [used, setUsed] = useState<string | null>(null);

  if (replies.length === 0) return null;

  function insert(reply: SavedReply) {
    const textarea = document.getElementById(targetId) as HTMLTextAreaElement | null;
    if (!textarea) return;

    const existing = textarea.value.trim();
    textarea.value = existing ? `${existing}\n\n${reply.body}` : reply.body;
    // React doesn't observe direct value assignment, but this textarea is
    // uncontrolled and read by the form on submit, so the DOM value is the
    // source of truth. Focus so the agent lands where they need to edit.
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    setUsed(reply.id);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Saved replies:</span>
      {replies.map((reply) => (
        <button
          key={reply.id}
          type="button"
          onClick={() => insert(reply)}
          className="rounded-md border border-input px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {reply.title}
        </button>
      ))}
      {used && <span className="text-xs text-muted-foreground">Inserted — edit before sending.</span>}
    </div>
  );
}
