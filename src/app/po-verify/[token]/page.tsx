import { lookupPoByToken } from "@/db/poVerify";

export default async function PoVerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const po = await lookupPoByToken(token);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="w-full max-w-md rounded-lg border p-6">
        {!po ? (
          <div className="flex flex-col gap-2">
            <h1 className="text-lg font-medium text-destructive">Not verified</h1>
            <p className="text-sm text-muted-foreground">
              This verification code isn&apos;t recognized. If you received a PO referencing this code, contact the
              issuing company directly before proceeding — don&apos;t rely on the document alone.
            </p>
          </div>
        ) : po.status === "cancelled" ? (
          <div className="flex flex-col gap-2">
            <h1 className="text-lg font-medium text-destructive">This PO has been cancelled</h1>
            <p className="text-sm text-muted-foreground">
              {po.poNumber} from {po.tenantName} is on record as cancelled. Do not fulfill it.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <h1 className="text-lg font-medium text-emerald-600">Verified</h1>
              <p className="text-sm text-muted-foreground">This PO is on record and genuine.</p>
            </div>
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">PO number</dt><dd>{po.poNumber}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Issued by</dt><dd>{po.tenantName}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Issued to</dt><dd>{po.vendorName}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Amount</dt><dd>{po.totalAmount} {po.currency}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Status</dt><dd>{po.status}</dd></div>
              {po.issuedAt && (
                <div className="flex justify-between"><dt className="text-muted-foreground">Issued</dt><dd>{po.issuedAt.toISOString().slice(0, 10)}</dd></div>
              )}
            </dl>
            {po.signatory ? (
              <p className="text-sm">
                Signed by <strong>{po.signatory.name}</strong>, {po.signatory.title} — a registered authorized
                signatory at {po.tenantName}.
              </p>
            ) : (
              <p className="text-sm text-amber-600">
                No registered authorized signatory matched this PO. Confirm directly with {po.tenantName} before
                proceeding.
              </p>
            )}
            {po.documentHash && (
              <p className="break-all text-xs text-muted-foreground">
                Document hash: {po.documentHash} — this should match the hash printed on your copy of the PO exactly.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
