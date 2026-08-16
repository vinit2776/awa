/**
 * Extracts the real Postgres error from a rejected Drizzle query.
 *
 * Drizzle wraps the driver error, so `error.message` is only ever
 * "Failed query: insert into …" — the constraint name, SQLSTATE and the
 * database's own message all live on `error.cause`. Asserting on the wrapper
 * would pass for any failure at all, which is exactly the assertion you don't
 * want when the thing under test is which constraint fired.
 *
 * Note that a failed statement aborts its transaction, so each expected
 * rejection needs its own withTenant() call — a second probe inside the same
 * transaction comes back as 25P02 (transaction aborted) rather than the
 * constraint you were testing for.
 */
export type DbFailure = {
  /** SQLSTATE — 23514 check constraint, 23505 unique, 42501 insufficient privilege / RLS. */
  code?: string;
  constraint?: string;
  message: string;
};

export async function failureFrom(fn: () => Promise<unknown>): Promise<DbFailure> {
  try {
    await fn();
  } catch (error) {
    const cause = (error as { cause?: Record<string, unknown> }).cause;
    return {
      code: cause?.code as string | undefined,
      constraint: cause?.constraint_name as string | undefined,
      message: (cause?.message as string | undefined) ?? String(error),
    };
  }
  throw new Error("Expected the statement to be rejected by the database, but it succeeded.");
}
