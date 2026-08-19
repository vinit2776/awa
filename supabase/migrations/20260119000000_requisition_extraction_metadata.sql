-- Structured vendor/document/tax metadata extracted from an uploaded
-- quotation/proforma/GST invoice (extends 0011_requisition_source_document.sql).
-- Display-only alongside the requisition's line items — never written to
-- the vendors table. See db/documentExtraction.ts (ExtractedDocumentMeta).
alter table purchase_requisitions
  add column extracted_document_meta jsonb not null default '{}';
