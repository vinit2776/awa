// Hand-written to match db/migrations/0001_init.sql exactly. The SQL
// migration is the source of truth for DDL (including RLS policies, the
// segregation-of-duties trigger, and indexes) — this file exists only to
// give the app typed query access. If the two drift, the migration wins;
// update this file to match it, not the other way around.
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  numeric,
  jsonb,
  date,
  unique,
  check,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// =========================================================================
// Enums
// =========================================================================
export const tenantStatus = pgEnum("tenant_status", ["active", "suspended", "offboarded"]);
export const platformAdminRole = pgEnum("platform_admin_role", ["super_admin", "support"]);
export const userStatus = pgEnum("user_status", ["invited", "active", "disabled"]);
export const roleScopeType = pgEnum("role_scope_type", ["global", "department", "cost_center"]);
export const catalogItemStatus = pgEnum("catalog_item_status", ["unverified", "verified", "merged"]);
export const vendorStatus = pgEnum("vendor_status", ["pending", "active", "blacklisted"]);
export const bankAccountStatus = pgEnum("bank_account_status", ["pending_verification", "active", "superseded"]);
export const requisitionStatus = pgEnum("requisition_status", [
  "draft", "submitted", "pending_approval", "approved",
  "rejected_revisable", "rejected_closed", "converted_to_po", "cancelled",
]);
export const fulfillmentType = pgEnum("fulfillment_type", ["goods", "service"]);
export const combinationMode = pgEnum("combination_mode", ["additive", "exclusive"]);
export const approvalSource = pgEnum("approval_source", ["rule", "ad_hoc"]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected", "delegated"]);
export const approvalAction = pgEnum("approval_action", [
  "approved", "rejected", "delegated", "approver_added", "commented",
]);
export const rfqStatus = pgEnum("rfq_status", ["open", "closed", "cancelled"]);
export const invitationStatus = pgEnum("invitation_status", ["invited", "quoted", "declined"]);
export const quotationStatus = pgEnum("quotation_status", ["submitted", "selected", "rejected"]);
export const poStatus = pgEnum("po_status", [
  "draft", "issued", "partially_fulfilled", "fulfilled", "cancelled",
]);
export const grnCondition = pgEnum("grn_condition", ["good", "damaged", "short"]);
export const serviceAcceptanceType = pgEnum("service_acceptance_type", ["milestone", "full_completion"]);
export const serviceLineStatus = pgEnum("service_line_status", ["accepted", "rejected", "partial"]);
export const invoiceStatus = pgEnum("invoice_status", [
  "submitted", "matched", "exception", "approved_for_payment", "paid", "disputed",
]);
export const matchStatus = pgEnum("match_status", ["matched", "exception"]);
export const fulfillmentRefType = pgEnum("fulfillment_ref_type", ["goods_receipt_line", "service_acceptance_line"]);
export const paymentStatus = pgEnum("payment_status", ["queued", "released", "failed"]);

// =========================================================================
// Foundation (§10)
// =========================================================================

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: tenantStatus("status").notNull().default("active"),
  // Set deliberately by a platform admin onboarding a customer — never
  // auto-created from a sign-in attempt. See §14 Sprint 1 / 0002 migration.
  workosOrganizationId: text("workos_organization_id").unique(),
  // "Basic" flags for the platform console (§14 Sprint 2) — a per-tenant
  // toggle bag, not a targeting/rollout system.
  featureFlags: jsonb("feature_flags").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platformAdmins = pgTable("platform_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  role: platformAdminRole("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  status: userStatus("status").notNull().default("invited"),
  // Set on first successful WorkOS sign-in (JIT linking, app-side) once a
  // row already exists for this email within a matching tenant.
  workosUserId: text("workos_user_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.email)]);

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  key: text("key").notNull(),
  displayName: text("display_name").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.key)]);

export const costCenters = pgTable("cost_centers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  code: text("code").notNull(),
  currency: text("currency").notNull().default("INR"),
  annualBudget: numeric("annual_budget", { precision: 14, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.code)]);

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  parentDepartmentId: uuid("parent_department_id").references((): AnyPgColumn => departments.id),
  defaultCostCenterId: uuid("default_cost_center_id").references(() => costCenters.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userRoles = pgTable("user_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  scopeType: roleScopeType("scope_type").notNull().default("global"),
  scopeId: uuid("scope_id"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index().on(t.tenantId, t.roleId, t.scopeType, t.scopeId)]);

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index().on(t.tenantId, t.entityType, t.entityId),
  index().on(t.tenantId, t.occurredAt),
]);

// =========================================================================
// Catalog & vendors (§07, §05)
// =========================================================================

export const catalogCategories = pgTable("catalog_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  parentCategoryId: uuid("parent_category_id").references((): AnyPgColumn => catalogCategories.id),
  assetEligible: boolean("asset_eligible").notNull().default(false),
  assetValueThreshold: numeric("asset_value_threshold", { precision: 14, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const catalogItems = pgTable("catalog_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  categoryId: uuid("category_id").references(() => catalogCategories.id),
  uom: text("uom").notNull().default("each"),
  status: catalogItemStatus("status").notNull().default("unverified"),
  canonicalItemId: uuid("canonical_item_id").references((): AnyPgColumn => catalogItems.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
// Note: the trigram index on catalog_items.name (for §07 fuzzy typeahead)
// is defined in the SQL migration, not redeclared here — pg_trgm gin
// opclasses aren't something the query builder needs to know about.

export const vendors = pgTable("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  taxId: text("tax_id"),
  status: vendorStatus("status").notNull().default("pending"),
  // The number someone calls for out-of-band bank-detail verification
  // (§05) — captured once at onboarding, never taken alongside a
  // change request itself.
  registeredPhone: text("registered_phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vendorBankAccounts = pgTable("vendor_bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  accountHolderName: text("account_holder_name").notNull(),
  accountNumberEnc: text("account_number_enc").notNull(),
  accountNumberLast4: text("account_number_last4").notNull(),
  bankName: text("bank_name").notNull(),
  ifscOrSwift: text("ifsc_or_swift").notNull(),
  status: bankAccountStatus("status").notNull().default("pending_verification"),
  verifiedBy: uuid("verified_by").references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vendorUsers = pgTable("vendor_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  status: userStatus("status").notNull().default("invited"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.vendorId, t.email)]);

export const signatories = pgTable("signatories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  maxAuthorizedValue: numeric("max_authorized_value", { precision: 14, scale: 2 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.tenantId, t.userId)]);

// =========================================================================
// Requisition & approval engine (§04)
// =========================================================================

export const purchaseRequisitions = pgTable("purchase_requisitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  requestorId: uuid("requestor_id").notNull().references(() => users.id),
  departmentId: uuid("department_id").references(() => departments.id),
  costCenterId: uuid("cost_center_id").references(() => costCenters.id),
  status: requisitionStatus("status").notNull().default("draft"),
  totalEstimatedValue: numeric("total_estimated_value", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("INR"),
  justification: text("justification"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index().on(t.tenantId, t.status)]);

export const purchaseRequisitionLines = pgTable("purchase_requisition_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  requisitionId: uuid("requisition_id").notNull().references(() => purchaseRequisitions.id),
  catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id),
  freeTextDescription: text("free_text_description"),
  categoryId: uuid("category_id").references(() => catalogCategories.id),
  fulfillmentType: fulfillmentType("fulfillment_type").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull().default("1"),
  uom: text("uom").notNull().default("each"),
  estimatedUnitPrice: numeric("estimated_unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
});

export const approvalRules = pgTable("approval_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  categoryId: uuid("category_id").references(() => catalogCategories.id),
  departmentId: uuid("department_id").references(() => departments.id),
  costCenterId: uuid("cost_center_id").references(() => costCenters.id),
  minValue: numeric("min_value", { precision: 14, scale: 2 }).notNull().default("0"),
  maxValue: numeric("max_value", { precision: 14, scale: 2 }),
  currency: text("currency").notNull().default("INR"),
  combinationMode: combinationMode("combination_mode").notNull().default("additive"),
  priority: integer("priority").notNull().default(0),
  active: boolean("active").notNull().default(true),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index().on(t.tenantId, t.active, t.categoryId, t.departmentId)]);

export const approvalRuleRequirements = pgTable("approval_rule_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  ruleId: uuid("rule_id").notNull().references(() => approvalRules.id),
  approverRoleId: uuid("approver_role_id").notNull().references(() => roles.id),
  groupNo: integer("group_no").notNull().default(1),
  groupSequence: integer("group_sequence").notNull().default(1),
  minApprovalsInGroup: integer("min_approvals_in_group").notNull().default(1),
});

export const requisitionApprovalRequirements = pgTable("requisition_approval_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  requisitionId: uuid("requisition_id").notNull().references(() => purchaseRequisitions.id),
  source: approvalSource("source").notNull(),
  sourceRuleId: uuid("source_rule_id").references(() => approvalRules.id),
  assignedUserId: uuid("assigned_user_id").notNull().references(() => users.id),
  groupNo: integer("group_no").notNull().default(1),
  groupSequence: integer("group_sequence").notNull().default(1),
  addedByUserId: uuid("added_by_user_id").references(() => users.id),
  reason: text("reason"),
  status: approvalStatus("status").notNull().default("pending"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionComment: text("decision_comment"),
  delegateOfUserId: uuid("delegate_of_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index().on(t.tenantId, t.requisitionId, t.status),
  check(
    "source_reason_check",
    sql`${t.source} <> 'ad_hoc' OR (${t.reason} IS NOT NULL AND ${t.addedByUserId} IS NOT NULL)`,
  ),
]);

export const approvalDecisionLog = pgTable("approval_decision_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  requisitionApprovalRequirementId: uuid("requisition_approval_requirement_id")
    .notNull()
    .references(() => requisitionApprovalRequirements.id),
  actorUserId: uuid("actor_user_id").notNull().references(() => users.id),
  action: approvalAction("action").notNull(),
  comment: text("comment"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({}),
});

// =========================================================================
// Sourcing & purchase orders (§05)
// =========================================================================

export const rfqs = pgTable("rfqs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  requisitionId: uuid("requisition_id").notNull().references(() => purchaseRequisitions.id),
  status: rfqStatus("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rfqVendorInvitations = pgTable("rfq_vendor_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  rfqId: uuid("rfq_id").notNull().references(() => rfqs.id),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  status: invitationStatus("status").notNull().default("invited"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.rfqId, t.vendorId)]);

export const vendorQuotations = pgTable("vendor_quotations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  rfqId: uuid("rfq_id").notNull().references(() => rfqs.id),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  validUntil: date("valid_until"),
  status: quotationStatus("status").notNull().default("submitted"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  requisitionId: uuid("requisition_id").notNull().references(() => purchaseRequisitions.id),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  poNumber: text("po_number").notNull(),
  status: poStatus("status").notNull().default("draft"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("INR"),
  documentHash: text("document_hash"),
  qrToken: text("qr_token"),
  signedBy: uuid("signed_by").references(() => users.id),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique().on(t.tenantId, t.poNumber),
  unique().on(t.qrToken),
]);

export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  poId: uuid("po_id").notNull().references(() => purchaseOrders.id),
  requisitionLineId: uuid("requisition_line_id").references(() => purchaseRequisitionLines.id),
  fulfillmentType: fulfillmentType("fulfillment_type").notNull(),
  itemId: uuid("item_id").references(() => catalogItems.id),
  serviceDescription: text("service_description"),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull().default("1"),
  uom: text("uom").notNull().default("each"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
  status: poStatus("status").notNull().default("draft"),
}, (t) => [index().on(t.tenantId, t.poId)]);

// =========================================================================
// Fulfillment: goods receipt & service acceptance (§03)
// =========================================================================

export const goodsReceiptNotes = pgTable("goods_receipt_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  poId: uuid("po_id").notNull().references(() => purchaseOrders.id),
  deliveryNoteRef: text("delivery_note_ref"),
  receivedBy: uuid("received_by").references(() => users.id),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("draft"),
});

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  grnId: uuid("grn_id").notNull().references(() => goodsReceiptNotes.id),
  poLineId: uuid("po_line_id").notNull().references(() => purchaseOrderLines.id),
  quantityDelivered: numeric("quantity_delivered", { precision: 14, scale: 3 }).notNull(),
  quantityAccepted: numeric("quantity_accepted", { precision: 14, scale: 3 }).notNull().default("0"),
  quantityRejected: numeric("quantity_rejected", { precision: 14, scale: 3 }).notNull().default("0"),
  condition: grnCondition("condition").notNull().default("good"),
  serialNumbers: jsonb("serial_numbers").notNull().default([]),
  rejectionReason: text("rejection_reason"),
  // Must differ from the requisition's requestor — enforced by a trigger
  // in the SQL migration (app.enforce_receiver_not_requestor), not here.
  verifiedBy: uuid("verified_by").notNull().references(() => users.id),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vendorReturns = pgTable("vendor_returns", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  grnLineId: uuid("grn_line_id").notNull().references(() => goodsReceiptLines.id),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull(),
  reason: text("reason").notNull(),
  returnShipmentRef: text("return_shipment_ref"),
  creditNoteRef: text("credit_note_ref"),
  status: text("status").notNull().default("initiated"),
});

export const serviceAcceptances = pgTable("service_acceptances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  poId: uuid("po_id").notNull().references(() => purchaseOrders.id),
  acceptanceType: serviceAcceptanceType("acceptance_type").notNull().default("full_completion"),
  status: text("status").notNull().default("open"),
});

export const serviceMilestones = pgTable("service_milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  poId: uuid("po_id").notNull().references(() => purchaseOrders.id),
  milestoneNo: integer("milestone_no").notNull(),
  description: text("description").notNull(),
  percentOfValue: numeric("percent_of_value", { precision: 5, scale: 2 }),
  fixedValue: numeric("fixed_value", { precision: 14, scale: 2 }),
  dueDate: date("due_date"),
});

export const serviceAcceptanceLines = pgTable("service_acceptance_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  serviceAcceptanceId: uuid("service_acceptance_id").notNull().references(() => serviceAcceptances.id),
  poLineId: uuid("po_line_id").notNull().references(() => purchaseOrderLines.id),
  milestoneId: uuid("milestone_id").references(() => serviceMilestones.id),
  acceptedValue: numeric("accepted_value", { precision: 14, scale: 2 }).notNull().default("0"),
  deliverableReferenceUrl: text("deliverable_reference_url"),
  status: serviceLineStatus("status").notNull().default("accepted"),
  rejectionReason: text("rejection_reason"),
  acceptedBy: uuid("accepted_by").notNull().references(() => users.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
});

// =========================================================================
// Invoicing & payment (§03, §06)
// =========================================================================

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  vendorId: uuid("vendor_id").notNull().references(() => vendors.id),
  poId: uuid("po_id").references(() => purchaseOrders.id),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date").notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  documentUrl: text("document_url"),
  documentHash: text("document_hash"),
  status: invoiceStatus("status").notNull().default("submitted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Phase-1 duplicate-invoice baseline (§06): exact match on vendor + number.
  unique().on(t.tenantId, t.vendorId, t.invoiceNumber),
]);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  poLineId: uuid("po_line_id").references(() => purchaseOrderLines.id),
  quantity: numeric("quantity", { precision: 14, scale: 3 }).notNull().default("1"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull().default("0"),
});

export const invoiceLineMatches = pgTable("invoice_line_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  invoiceLineId: uuid("invoice_line_id").notNull().references(() => invoiceLines.id),
  poLineId: uuid("po_line_id").notNull().references(() => purchaseOrderLines.id),
  matchedFulfillmentType: fulfillmentRefType("matched_fulfillment_type").notNull(),
  // Polymorphic reference (goods_receipt_line | service_acceptance_line) —
  // enforced in application code, not a DB-level FK. See §03.
  matchedFulfillmentId: uuid("matched_fulfillment_id").notNull(),
  matchedQuantity: numeric("matched_quantity", { precision: 14, scale: 3 }),
  matchedValue: numeric("matched_value", { precision: 14, scale: 2 }),
  variance: numeric("variance", { precision: 14, scale: 2 }).notNull().default("0"),
  status: matchStatus("status").notNull().default("matched"),
});

export const paymentInstructions = pgTable("payment_instructions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  status: paymentStatus("status").notNull().default("queued"),
  // The deliberate human step (§05) — never automated.
  releasedBy: uuid("released_by").references(() => users.id),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
