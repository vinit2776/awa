/**
 * Every piece of procurement vocabulary AWA puts on screen, defined once.
 *
 * The interface deliberately keeps the formal terms — a requisition is called
 * a requisition, not "a request", because that is the word customers use with
 * their auditors and the word printed on the PO. The cost of keeping them is
 * that a first-time user meets a dozen words they have never seen; this file
 * is how that cost gets paid.
 *
 * Definitions live here rather than inline at each `<Term>` because the same
 * word appears on five or six screens. Written inline they drift apart, and
 * the version a user happens to hit becomes a coin toss.
 *
 * Shape of an entry, in this order, always:
 *   term       what it is called
 *   definition what it is, in one sentence, no jargon of its own
 *   soWhat     why it matters where the reader is standing, or what happens
 *              next — the half that a dictionary would leave out
 */
export type GlossaryEntry = {
  term: string;
  definition: string;
  soWhat?: string;
};

export const GLOSSARY = {
  requisition: {
    term: "Requisition",
    definition:
      "A request to buy something, raised before anyone has agreed to it. It carries the line items, the department and cost centre it should be charged to, and a justification.",
    soWhat: "Nothing is ordered and no money is committed until it has been approved.",
  },
  department: {
    term: "Department",
    definition: "The part of the organisation a requisition comes from, such as Facilities or Operations.",
    soWhat: "Approval rules can route on it, so the department decides who has to sign off.",
  },
  "cost-center": {
    term: "Cost centre",
    definition:
      "The budget line the spend is charged against — usually a team, site or project rather than a whole department. Each one carries an annual budget.",
    soWhat:
      "AWA shows what is already committed against it before you commit more, and rules can route on it.",
  },
  "catalog-item": {
    term: "Catalogue item",
    definition:
      "A pre-defined thing your organisation buys, with an agreed name and unit of measure. Requisition lines can point at one instead of describing the item in free text.",
    soWhat:
      "Using the catalogue is what makes price history work — AWA can only tell an approver what an item cost last time if it is the same item.",
  },
  uom: {
    term: "Unit of measure",
    definition: "How the quantity is counted: each, box, litre, hour, job.",
    soWhat:
      "It is copied onto the purchase order and the vendor invoices against it. Mismatched units are a common cause of invoice exceptions.",
  },
  "approval-rule": {
    term: "Approval rule",
    definition:
      "A standing instruction saying who must sign off, at what value, for which category, department or cost centre. Rules can combine, so more than one may apply to a single requisition.",
    soWhat:
      "With no rule matching a requisition there is nobody to route it to, so it is approved automatically — which is why an empty rule set means nothing is being controlled.",
  },
  "approval-step": {
    term: "Approval step",
    definition:
      "One stage in an approval chain. A rule can require several steps in order — a department head, then finance — and every approver in a step must decide before the next step opens.",
    soWhat: "“Step 1 of 2” means somebody else still has to approve after you do.",
  },
  "ad-hoc-approver": {
    term: "Ad-hoc approver",
    definition:
      "Somebody added to one specific requisition's approval chain, on top of whoever the rules already selected.",
    soWhat:
      "It changes this requisition only — it does not change the rule for future ones. The reason you give is recorded in the audit log.",
  },
  "blocking-query": {
    term: "Blocking query",
    definition:
      "A question raised against a record that holds the decision until it is answered. The record itself is untouched and keeps its place in the queue.",
    soWhat:
      "It is the cheap alternative to rejecting a requisition over a one-line question — approve and reject unlock the moment it is resolved.",
  },
  escalation: {
    term: "Escalation",
    definition:
      "What happens when an approval sits undecided past its service window: tenant admins are notified that it is overdue.",
    soWhat: "The clock runs from when the step became actionable, not from when the requisition was submitted.",
  },
  rfq: {
    term: "RFQ",
    definition:
      "Request for quotation — an invitation to two or more vendors to price the same approved requisition, so the quotes can be compared side by side.",
    soWhat: "Optional. A purchase order can be issued directly when the vendor and price are already settled.",
  },
  quotation: {
    term: "Quotation",
    definition: "A vendor's priced response to an RFQ, against the same line items every other vendor quoted.",
    soWhat: "Selecting one is what turns an approved requisition into a purchase order.",
  },
  "purchase-order": {
    term: "Purchase order",
    definition:
      "The binding order sent to the vendor, listing what is being bought, at what price, from whom. Issued with a document hash and a QR code.",
    soWhat: "This is the commitment. From here on the vendor can deliver and invoice against it.",
  },
  "po-verification": {
    term: "PO verification",
    definition:
      "The QR code and document hash printed on every purchase order, which a vendor can check against AWA without logging in.",
    soWhat:
      "It is how a vendor confirms a PO is genuine and unaltered, rather than trusting a PDF that arrived by email.",
  },
  signatory: {
    term: "Signatory",
    definition: "A person registered as authorised to issue purchase orders on the organisation's behalf.",
    soWhat: "The registry is what a vendor checks the PO's signature against when verifying it.",
  },
  "goods-receipt": {
    term: "Goods receipt",
    definition:
      "The record that ordered items physically arrived and were accepted. A line can be received across several deliveries if the vendor ships short.",
    soWhat:
      "Until this exists there is nothing for the vendor's invoice to be matched against, so nothing can be paid.",
  },
  "service-acceptance": {
    term: "Service acceptance",
    definition:
      "The services equivalent of a goods receipt — confirmation that work was performed to the standard ordered.",
    soWhat: "A service line can be accepted whole, or milestone by milestone.",
  },
  "service-milestone": {
    term: "Service milestone",
    definition:
      "A billing checkpoint on a service line, worth either a percentage of the line or a fixed value. Each is accepted, rejected or resubmitted on its own.",
    soWhat: "The line is only complete once every milestone on it has been accepted.",
  },
  "partial-fulfilment": {
    term: "Partial fulfilment",
    definition:
      "A purchase order where some ordered quantity has been received and some has not — a short shipment now, the balance later.",
    soWhat: "The PO stays open and keeps accumulating receipts until the ordered quantity is met.",
  },
  "vendor-return": {
    term: "Vendor return",
    definition:
      "The path a quality-rejected quantity takes back to the vendor: initiated, shipped, credited, closed — one step at a time.",
    soWhat: "Shipment and credit-note references are required at the relevant steps, so the paper trail survives.",
  },
  "segregation-of-duties": {
    term: "Segregation of duties",
    definition:
      "The rule that the person who raised a requisition cannot also be the person who confirms the goods arrived.",
    soWhat:
      "AWA enforces this in the database, not just in the screen — ask a colleague to record the receipt.",
  },
  "three-way-match": {
    term: "Three-way match",
    definition:
      "The check AWA runs before any money moves: the purchase order, the goods receipt or service acceptance, and the vendor's invoice must all agree on quantity and value.",
    soWhat: "Any disagreement becomes an exception instead of a payment.",
  },
  "invoice-exception": {
    term: "Invoice exception",
    definition:
      "An invoice that failed the three-way match — the vendor has billed for something that does not agree with what was ordered or what was received.",
    soWhat: "A person has to decide: approve it anyway with a reason, or dispute it with the vendor.",
  },
  "payment-instruction": {
    term: "Payment instruction",
    definition:
      "A matched, approved invoice queued for release, waiting for somebody to actually send the money and record the reference.",
    soWhat: "Confirming it sent closes the loop; a failed payment can be retried with a corrected reference.",
  },
  "bank-detail-lock": {
    term: "Bank detail lock",
    definition:
      "A vendor's bank account cannot be changed on the strength of a request through the same channel it arrived on — the change has to be confirmed out of band.",
    soWhat: "This is the control that stops an invoice-redirection fraud from succeeding on an emailed request alone.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** Every entry, sorted by the term as displayed — for a glossary listing. */
export function allGlossaryEntries(): (GlossaryEntry & { key: GlossaryKey })[] {
  return (Object.keys(GLOSSARY) as GlossaryKey[])
    .map((key) => ({ key, ...GLOSSARY[key] }))
    .sort((a, b) => a.term.localeCompare(b.term));
}
