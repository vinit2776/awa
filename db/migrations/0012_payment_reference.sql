-- Closes the loop on payment release (lifecycle audit, §07): captures a
-- reference/UTR number as part of releasing a payment, so "released"
-- means something reconcilable rather than just an internal click, and
-- a failure_reason so a failed release stays visible and retryable
-- instead of silently looking identical to "queued".
alter table payment_instructions
  add column reference_number text,
  add column failure_reason text;
