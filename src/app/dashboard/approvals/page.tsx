import { eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import {
  requisitionApprovalRequirements as requirementsTable,
  purchaseRequisitions as purchaseRequisitionsTable,
  users as usersTable,
  departments as departmentsTable,
  costCenters as costCentersTable,
} from "@/db/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { approveRequirement, rejectRequirement, addAdHocApprover } from "./actions";

export default async function ApprovalsInboxPage() {
  const { user, tenant } = await getCurrentUserAndTenant();

  const [pendingRequirements, requisitions, users, departments, costCenters] = await withTenant(
    tenant.id,
    async (tx) => [
      await tx.select().from(requirementsTable).where(eq(requirementsTable.status, "pending")),
      await tx.select().from(purchaseRequisitionsTable).where(eq(purchaseRequisitionsTable.status, "pending_approval")),
      await tx.select().from(usersTable),
      await tx.select().from(departmentsTable),
      await tx.select().from(costCentersTable),
    ],
  );

  const currentGroupByRequisition = new Map<string, number>();
  for (const req of pendingRequirements) {
    const current = currentGroupByRequisition.get(req.requisitionId);
    if (current === undefined || req.groupNo < current) {
      currentGroupByRequisition.set(req.requisitionId, req.groupNo);
    }
  }

  const requisitionById = new Map(requisitions.map((r) => [r.id, r]));
  const userName = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? "—";
  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
  const costCenterName = (id: string | null) => costCenters.find((c) => c.id === id)?.name ?? "—";

  const myActionable = pendingRequirements.filter(
    (req) =>
      req.assignedUserId === user.id &&
      requisitionById.has(req.requisitionId) &&
      currentGroupByRequisition.get(req.requisitionId) === req.groupNo,
  );

  return (
    <div className="flex flex-col gap-8 p-8">
      <div>
        <h1 className="text-lg font-medium">Approvals</h1>
        <p className="text-sm text-muted-foreground">{myActionable.length} awaiting your decision</p>
      </div>

      <div className="flex flex-col gap-6">
        {myActionable.map((req) => {
          const requisition = requisitionById.get(req.requisitionId)!;
          return (
            <div key={req.id} className="flex flex-col gap-3 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {userName(requisition.requestorId)} — {requisition.totalEstimatedValue} {requisition.currency}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {departmentName(requisition.departmentId)} · {costCenterName(requisition.costCenterId)}
                    {req.source === "ad_hoc" && " · ad-hoc addition"}
                  </p>
                  {requisition.justification && (
                    <p className="mt-1 text-xs text-muted-foreground">&quot;{requisition.justification}&quot;</p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <form action={approveRequirement} className="flex items-end gap-2">
                  <input type="hidden" name="requirementId" value={req.id} />
                  <input
                    name="comment"
                    placeholder="Comment (optional)"
                    className="h-8 w-48 rounded-md border px-2 text-sm"
                  />
                  <button type="submit" className={cn(buttonVariants())}>Approve</button>
                </form>
                <form action={rejectRequirement} className="flex items-end gap-2">
                  <input type="hidden" name="requirementId" value={req.id} />
                  <input
                    name="comment"
                    required
                    placeholder="Reason for rejection"
                    className="h-8 w-48 rounded-md border px-2 text-sm"
                  />
                  <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>Reject</button>
                </form>
              </div>

              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Add an approver ad hoc</summary>
                <form action={addAdHocApprover} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="requisitionId" value={req.requisitionId} />
                  <select name="assignedUserId" required className="h-8 rounded-md border px-2 text-sm">
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.fullName}</option>
                    ))}
                  </select>
                  <input
                    name="reason"
                    required
                    placeholder="Why are they needed?"
                    className="h-8 w-56 rounded-md border px-2 text-sm"
                  />
                  <button type="submit" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                    Add
                  </button>
                </form>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
