import Link from "next/link";
import { listMyQueries } from "@/db/clarifications";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { formatRelative } from "../support/ui";

const ENTITY_LABEL: Record<string, string> = {
  requisition: "Requisition",
  purchase_order: "Purchase order",
  invoice: "Invoice",
  goods_receipt: "Goods receipt",
  quotation: "Quotation",
};

const ENTITY_HREF: Record<string, (id: string) => string> = {
  requisition: (id) => `/dashboard/requisitions/${id}`,
  purchase_order: (id) => `/dashboard/sourcing/${id}`,
  invoice: (id) => `/dashboard/invoices/${id}`,
  goods_receipt: (id) => `/dashboard/fulfillment/${id}`,
  quotation: (id) => `/dashboard/sourcing/${id}`,
};

/**
 * The personal inbox. This is what stops queries dying inside a record nobody
 * revisits — "Asked of me" is the actionable half and leads.
 */
export default async function QueriesPage() {
  const { askedOfMe, iAsked } = await listMyQueries();
  const openIAsked = iAsked.filter(
    (r) => r.clarification.status === "open" || r.clarification.status === "answered",
  );

  return (
    <div className="flex flex-1 flex-col gap-5 p-6">
      <Breadcrumbs items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Queries" }]} />

      <div>
        <h1 className="font-serif text-xl">Queries</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Questions raised on requisitions, purchase orders and invoices — between you and your colleagues.
          Nothing here reaches AWA support.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
          Asked of me · {askedOfMe.length}
        </h2>
        {askedOfMe.length === 0 ? (
          <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
            Nothing waiting on you.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {askedOfMe.map(({ clarification, counterpartName }) => (
              <QueryRow
                key={clarification.id}
                clarification={clarification}
                counterpart={`${counterpartName} asked`}
                emphasise
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
          I asked · {openIAsked.length} open
        </h2>
        {iAsked.length === 0 ? (
          <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
            You haven&apos;t raised any queries. Open a requisition, purchase order or invoice and use the Queries
            panel to ask a colleague a question without rejecting the record.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {iAsked.map(({ clarification, counterpartName }) => (
              <QueryRow
                key={clarification.id}
                clarification={clarification}
                counterpart={counterpartName ? `asked ${counterpartName}` : "asked anyone"}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Row = Awaited<ReturnType<typeof listMyQueries>>["askedOfMe"][number]["clarification"];

function QueryRow({
  clarification,
  counterpart,
  emphasise,
}: {
  clarification: Row;
  counterpart: string;
  emphasise?: boolean;
}) {
  const href = ENTITY_HREF[clarification.entityType]?.(clarification.entityId) ?? "/dashboard";

  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-3.5",
        emphasise && clarification.status === "open" ? "border-warning/40 bg-warning/5" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{ENTITY_LABEL[clarification.entityType] ?? clarification.entityType}</span>
        {clarification.blocksProgress &&
          (clarification.status === "open" || clarification.status === "answered") && (
            <span className="rounded border border-input px-1.5 py-0.5 text-muted-foreground">Blocking</span>
          )}
        <span className="capitalize text-muted-foreground">{clarification.status}</span>
        <span className="ml-auto text-muted-foreground">{formatRelative(clarification.createdAt)}</span>
      </div>
      <Link href={href} className="text-sm font-medium hover:underline">
        {clarification.question}
      </Link>
      <p className="text-xs text-muted-foreground">{counterpart}</p>
    </li>
  );
}
