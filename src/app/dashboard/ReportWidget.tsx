"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bug, Lightbulb, MessageSquare, Paperclip, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { submitReport } from "./support/actions";

type ReportType = "bug" | "feature_request" | "feedback";

const TYPE_CHOICES: { value: ReportType; label: string; icon: typeof Bug }[] = [
  { value: "bug", label: "Bug", icon: Bug },
  { value: "feature_request", label: "Feature", icon: Lightbulb },
  { value: "feedback", label: "Feedback", icon: MessageSquare },
];

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain"];

/**
 * Report widget, mounted once in the dashboard shell.
 *
 * A dialog rather than a navigation, so the page being reported on stays on
 * screen and in state behind it. Uses the native <dialog> element — it gives
 * focus trapping, Escape-to-close and the top layer for free, which is the
 * whole of what a dependency would have provided here.
 */
export function ReportWidget({ storageEnabled }: { storageEnabled: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ReportType>("bug");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function reset() {
    setType("bug");
    setFiles([]);
    setError(null);
  }

  function addFiles(incoming: FileList | File[]) {
    const accepted: File[] = [];
    for (const file of Array.from(incoming)) {
      if (!ACCEPTED.includes(file.type)) {
        setError(`${file.name || "That file"} isn't an accepted type.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setError(`${file.name} is over the 10 MB limit.`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length > 0) {
      setError(null);
      setFiles((prev) => [...prev, ...accepted].slice(0, MAX_FILES));
    }
  }

  // Paste is the primary path for screenshots: everyone already knows
  // Cmd+Shift+4 / PrtScn, and it captures what the user actually saw —
  // including native dialogs and other windows a DOM-to-canvas render misses.
  function handlePaste(event: React.ClipboardEvent) {
    const pasted = event.clipboardData?.files;
    if (pasted && pasted.length > 0) {
      event.preventDefault();
      addFiles(pasted);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("type", type);
    data.set("pagePath", pathname);
    data.set("pageUrl", window.location.href);
    data.set("appVersion", process.env.NEXT_PUBLIC_APP_VERSION ?? "dev");
    data.set("userAgent", navigator.userAgent);
    data.set("viewport", `${window.innerWidth}×${window.innerHeight}`);

    startTransition(async () => {
      try {
        const { id } = await submitReport(data);

        for (const file of files) {
          const upload = new FormData();
          upload.set("ticketId", id);
          upload.set("file", file);
          const res = await fetch("/api/support/attachments", { method: "POST", body: upload });
          if (!res.ok) {
            // The ticket exists and is the thing that matters; a failed
            // attachment should not swallow the report.
            const detail = await res.json().catch(() => null);
            setError(detail?.error ?? "The report was sent, but an attachment failed to upload.");
          }
        }

        setOpen(false);
        reset();
        form.reset();
        router.push(`/dashboard/support/${id}`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Something went wrong sending that report.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
      >
        Help &amp; feedback
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        aria-labelledby="report-widget-title"
        className={cn(
          "m-0 ml-auto h-dvh max-h-dvh w-full max-w-md border-l border-border bg-card p-0 text-foreground shadow-lg",
          "backdrop:bg-foreground/30",
        )}
      >
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border p-4">
            <div>
              <h2 id="report-widget-title" className="font-serif text-lg">
                Report something
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">From {pathname}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-xs font-medium text-muted-foreground">
                What kind of thing is this?
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {TYPE_CHOICES.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setType(value)}
                    aria-pressed={type === value}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs font-medium transition-colors",
                      type === value
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-input text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <Icon className="size-4" />
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Subject</span>
              <input
                name="subject"
                required
                maxLength={200}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {type === "bug" ? "What happened?" : "Tell us more"}
              </span>
              <textarea
                name="description"
                required
                rows={5}
                onPaste={handlePaste}
                placeholder={
                  type === "bug"
                    ? "What you did, what you expected, what happened instead. Paste a screenshot here."
                    : "Paste a screenshot here if it helps."
                }
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            {storageEnabled && (
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted-foreground">Screenshots &amp; files</span>
                <div className="flex flex-wrap gap-2">
                  {files.map((file, i) => (
                    <span
                      key={`${file.name}-${i}`}
                      className="flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground"
                    >
                      <Paperclip className="size-3" />
                      <span className="max-w-32 truncate">{file.name || "pasted image"}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${file.name || "attachment"}`}
                        onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ))}
                  {files.length < MAX_FILES && (
                    <label
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "cursor-pointer text-xs",
                      )}
                    >
                      Choose files
                      <input
                        type="file"
                        multiple
                        accept={ACCEPTED.join(",")}
                        className="sr-only"
                        onChange={(e) => e.target.files && addFiles(e.target.files)}
                      />
                    </label>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Or press <kbd className="rounded border border-input px-1">Cmd/Ctrl+V</kbd> in the box above to
                  paste a screenshot.
                </p>
              </div>
            )}

            {/* Stated up front, not buried. This app holds bank details and
                vendor pricing — a support widget that silently harvested page
                state would be exfiltrating exactly what db/crypto.ts exists to
                protect. Nothing beyond these four fields is captured. */}
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
              <p className="text-xs text-muted-foreground">
                We&apos;ll include this page, your browser, and your name and organisation. Nothing else from the
                screen is captured.
              </p>
              <div className="flex flex-wrap gap-1.5 font-mono text-[10px] text-muted-foreground">
                <span className="rounded bg-accent px-1.5 py-0.5">{pathname}</span>
                <span className="rounded bg-accent px-1.5 py-0.5">
                  {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
                </span>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border bg-background p-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className={cn(buttonVariants({ size: "sm" }))}
            >
              {pending ? "Sending…" : "Send report"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
