-- Requisition-from-document upload (§04 extension): lets a requestor
-- upload a quotation, proforma, or GST invoice to prefill line items
-- instead of typing them by hand. source_document_key stores the R2
-- object key (private bucket, not a public URL) so the original
-- document stays linked to the requisition for audit/reference even
-- after extraction runs.
alter table purchase_requisitions
  add column source_document_key text;
