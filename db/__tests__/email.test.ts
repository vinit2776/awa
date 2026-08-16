import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEmailConfigured, logEmailResult, sendEmail } from "../email";

/**
 * The properties that matter here are the safety ones, not the happy path.
 *
 * sendEmail() is called from inside withTenant transactions (notifyUser →
 * deliver → sendEmail), so anything it throws would abort the caller's
 * transaction and roll back the approval or ticket that triggered the mail.
 * Every test below is ultimately checking the same thing: it returns rather
 * than throws.
 */

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "AWA <noreply@example.com>";
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...ORIGINAL };
});

const message = { to: "someone@example.com", subject: "Subject", text: "Body" };

describe("email — configuration", () => {
  it("needs both the key and the from address", () => {
    expect(isEmailConfigured()).toBe(true);

    delete process.env.EMAIL_FROM;
    expect(isEmailConfigured()).toBe(false);

    process.env.EMAIL_FROM = "AWA <noreply@example.com>";
    delete process.env.RESEND_API_KEY;
    expect(isEmailConfigured()).toBe(false);
  });
});

describe("email — never sends from a test run", () => {
  it("suppresses the send even with a real key present", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await sendEmail(message);

    // The whole point: the suites invent fixture addresses and exercise the
    // notification paths for real. A live key must not turn that into mail.
    expect(result).toEqual({ delivered: false, reason: "suppressed" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("email — failure modes never throw", () => {
  // Suppression short-circuits before the network, so these drive the
  // post-suppression paths directly by clearing the vitest markers.
  // vi.stubEnv rather than direct assignment: NODE_ENV is typed readonly, so
  // assigning to it compiles under vitest but fails `tsc --noEmit`.
  function unsuppress() {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VITEST", "false");
  }

  it("reports not_configured rather than throwing", async () => {
    unsuppress();
    delete process.env.RESEND_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(sendEmail(message)).resolves.toEqual({ delivered: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a provider rejection, carrying the body for diagnosis", async () => {
    unsuppress();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"message":"The example.com domain is not verified"}', { status: 403 }),
    );

    const result = await sendEmail(message);
    expect(result.delivered).toBe(false);
    if (result.delivered) throw new Error("unreachable");
    expect(result.reason).toBe("failed");
    // Status alone wouldn't say why — an unverified sending domain is the most
    // common real cause and only appears in the body.
    expect(result.detail).toContain("403");
    expect(result.detail).toContain("not verified");
  });

  it("swallows a network error instead of propagating it into the caller's transaction", async () => {
    unsuppress();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await sendEmail(message);
    expect(result).toMatchObject({ delivered: false, reason: "failed" });
    if (!result.delivered) expect(result.detail).toContain("ECONNREFUSED");
  });

  it("reports success on a 2xx", async () => {
    unsuppress();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"id":"abc"}', { status: 200 }),
    );

    await expect(sendEmail(message)).resolves.toEqual({ delivered: true });
  });

  it("sends the provider exactly the fields Resend expects", async () => {
    unsuppress();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    await sendEmail({ ...message, replyTo: "support@example.com" });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "AWA <noreply@example.com>",
      to: ["someone@example.com"],
      subject: "Subject",
      text: "Body",
      reply_to: "support@example.com",
    });
  });
});

describe("email — logging", () => {
  it("logs a real failure at error level, so a broken provider isn't silent", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logEmailResult("notification:test", "a@example.com", "Subj", "Body", {
      delivered: false,
      reason: "failed",
      detail: "403 domain not verified",
    });
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(String(errorSpy.mock.calls[0][0])).toContain("FAILED");
  });

  it("keeps the old stub behaviour when unconfigured — body included", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logEmailResult("notification:test", "a@example.com", "Subj", "Body text", {
      delivered: false,
      reason: "not_configured",
    });
    expect(String(logSpy.mock.calls[0][0])).toContain("Body text");
  });
});
