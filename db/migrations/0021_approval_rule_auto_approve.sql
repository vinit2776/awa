-- A deliberate "no review needed" outcome for an approval rule, distinct
-- from the accidental auto-approval that already happens when no rule
-- matches a requisition's value/category at all. auto_approve rules carry
-- zero approval_rule_requirements rows on purpose. See db/approvals.ts.
create type approval_rule_type as enum ('requires_approval', 'auto_approve');

alter table approval_rules
  add column rule_type approval_rule_type not null default 'requires_approval';
