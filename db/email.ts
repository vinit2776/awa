/**
 * Transactional email.
 *
 * Resend, over plain `fetch` rather than the `resend` npm package: the send is
 * one POST with a JSON body, so a dependency would buy nothing and would make
 * swapping providers a package change instead of an edit to `send()` below.
 * Postmark and SES fit the same shape — only `send()` changes.
 *
 * Two rules govern everything here, both learned from where this gets called:
 *
 * 1. **It must never throw.** `notifyUser()` runs *inside* the caller's
 *    withTenant transaction (db/approvals.ts:243 and friends), so an exception
 *    escaping this module would abort that transaction and roll back the
 *    approval, requisition or ticket that triggered the email. A failed
 *    notification must never undo the thing it was notifying about. Every path
 *    returns a result object instead.
 *
 * 2. **It must be bounded.** Being inside a transaction also means a slow
 *    provider holds a pooled Postgres connection open for as long as the HTTP
 *    call takes. The timeout below caps that. The real fix is an outbox table —
 *    write the intent inside the transaction, send after commit — which is
 *    worth doing once volume justifies it; see the note in README.
 *
 * Unconfigured is a supported state, not an error: without RESEND_API_KEY the
 * module logs exactly as the console stub always did, so local development and
 * CI keep working without an account or a live key.
 */

const SEND_TIMEOUT_MS = 5_000;
const ENDPOINT = "https://api.resend.com/emails";

export type EmailResult =
  | { delivered: true }
  | { delivered: false; reason: "not_configured" | "suppressed" | "failed"; detail?: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * Never send from a test run, even if a real key is present in the environment.
 * The suites create throwaway tenants with fixture addresses and exercise the
 * notification paths for real; with a key set, a full run would fire live email
 * at every fixture address it invents.
 */
function isSuppressed(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<EmailResult> {
  if (isSuppressed()) return { delivered: false, reason: "suppressed" };
  if (!isEmailConfigured()) return { delivered: false, reason: "not_configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // Body, not just status: Resend puts the actionable part ("domain is not
      // verified", "from address not allowed") in the message field.
      const detail = await response.text().catch(() => "");
      return { delivered: false, reason: "failed", detail: `${response.status} ${detail.slice(0, 300)}` };
    }

    return { delivered: true };
  } catch (error) {
    // Includes the AbortError from the timeout above. Swallowed deliberately —
    // see rule 1 in the module comment.
    const detail = error instanceof Error ? error.message : String(error);
    return { delivered: false, reason: "failed", detail };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Single place that decides what a send outcome looks like in the logs, so the
 * console stub's behaviour is preserved exactly when unconfigured and a real
 * failure is never silent.
 */
export function logEmailResult(tag: string, to: string, subject: string, body: string, result: EmailResult) {
  if (result.delivered) {
    console.log(`[${tag}] sent to=${to} subject="${subject}"`);
    return;
  }
  if (result.reason === "failed") {
    console.error(`[${tag}] FAILED to=${to} subject="${subject}" — ${result.detail ?? "unknown error"}`);
    return;
  }
  // not_configured / suppressed: the original stub behaviour, body included so
  // local development can still read what would have been sent.
  console.log(`[${tag}] (${result.reason}) to=${to} subject="${subject}"\n${body}`);
}
