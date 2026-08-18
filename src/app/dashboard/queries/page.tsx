import Link from "next/link";
import { listMyQueries } from "@/db/clarifications";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { cn } from "@/lib/utils";
import { entityLabel } from "@/lib/entityLinks";
import { ListControls, ListFilter } from "@/components/ui/list-controls";
import { formatRelative } from "../support/ui";

/**
 * The personal inbox. This is what stops queries dying inside a record nobody
 * revisits — "Asked of me" is the actionable half and leads.
 */
export default async function QueriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().toLowerCase() : "";
  const statusFilter =
    params.status === "open" || params.status === "answered" || params.status === "resolved"
      ? params.status
      : null;

  const all = await listMyQueries();

  // Both lists are already scoped to this person by listMyQueries(), and a
  // personal inbox is small, so filtering here beats another round trip
  // and a second copy of the matching rules.
  // Structurally typed, not `typeof all.askedOfMe[number]`: that list is an
  // inner join so counterpartName is non-null, while "I asked" is a left
  // join and can be null. One predicate has to accept both.
  const matches = (row: {
    clarification: { question: string; status: string; entityType: string };
    counterpartName: string | null;
  }) => {
    if (statusFilter && row.clarification.status !== statusFilter) return false;
    if (!q) return true;
    return (
      row.clarification.question.toLowerCase().includes(q) ||
      (row.counterpartName ?? "").toLowerCase().includes(q) ||
      entityLabel(row.clarification.entityType).toLowerCase().includes(q)
    );
  };

  const askedOfMe = all.askedOfMe.filter(matches);
  const iAsked = all.iAsked.filter(matches);
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

      <ListControls
        q={typeof params.q === "string" ? params.q : ""}
        searchPlaceholder="Question, person, record…"
        searchMatches="the question itself, the other person's name, and the kind of record it was raised on"
        clearHref={q || statusFilter ? "/dashboard/queries" : undefined}
        count={askedOfMe.length + iAsked.length}
      >
        <ListFilter
          name="status"
          label="Status"
          value={statusFilter ?? ""}
          options={[
            { value: "", label: "All" },
            { value: "open", label: "Open" },
            { value: "answered", label: "Answered" },
            { value: "resolved", label: "Resolved" },
          ]}
        />
      </ListControls>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
          Asked of me · {askedOfMe.length}
        </h2>
        {askedOfMe.length === 0 ? (
          <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
            {q || statusFilter ? "Nothing waiting on you matches that." : "Nothing waiting on you."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {askedOfMe.map(({ clarification, counterpartName, href }) => (
              <QueryRow
                key={clarification.id}
                clarification={clarification}
                href={href}
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
            {iAsked.map(({ clarification, counterpartName, href }) => (
              <QueryRow
                key={clarification.id}
                clarification={clarification}
                href={href}
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
  href,
  counterpart,
  emphasise,
}: {
  clarification: Row;
  href: string;
  counterpart: string;
  emphasise?: boolean;
}) {

  return (
    <li
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-3.5",
        emphasise && clarification.status === "open" ? "border-warning/40 bg-warning/5" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{entityLabel(clarification.entityType)}</span>
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
