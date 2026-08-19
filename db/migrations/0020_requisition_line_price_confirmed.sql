-- Whether a requisition line's estimated_unit_price is a real quoted/invoiced
-- price or a requester's guess/ceiling — display-only, never fed into
-- approval-rule or budget arithmetic. See db/schema.ts.
alter table purchase_requisition_lines
  add column price_confirmed boolean not null default false;
