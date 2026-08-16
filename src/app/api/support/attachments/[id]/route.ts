import { and, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { isTenantAdmin } from "@/db/permissions";
import { getObject, isStorageConfigured } from "@/db/storage";
import { supportTicketAttachments, supportTickets } from "@/db/schema";

/**
 * Attachment download. Streams through the server rather than redirecting to a
 * presigned URL, so the bucket stays private and every fetch re-checks that
 * this signed-in user may see this ticket. A storage key is not a credential
 * here — the row check is.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isStorageConfigured()) {
    return new Response("File storage isn't configured on this environment.", { status: 503 });
  }

  const { id } = await params;
  const { user, tenant } = await getCurrentUserAndTenant();

  const attachment = await withTenant(tenant.id, async (tx) => {
    const [row] = await tx
      .select({ attachment: supportTicketAttachments, ticket: supportTickets })
      .from(supportTicketAttachments)
      .innerJoin(supportTickets, eq(supportTickets.id, supportTicketAttachments.ticketId))
      .where(
        and(eq(supportTicketAttachments.id, id), eq(supportTicketAttachments.tenantId, tenant.id)),
      )
      .limit(1);

    if (!row) return null;
    if (row.ticket.reportedByUserId === user.id) return row.attachment;
    const admin = await isTenantAdmin(tx, tenant.id, user.id);
    return admin ? row.attachment : null;
  });

  if (!attachment) return new Response("Not found", { status: 404 });

  const object = await getObject(attachment.storageKey);
  if (!object) return new Response("Not found", { status: 404 });

  return new Response(object.body, {
    headers: {
      "content-type": object.contentType ?? attachment.contentType,
      // attachment, not inline: an uploaded file rendered in-origin is an XSS
      // vector, and nothing here needs to display in the browser frame.
      "content-disposition": `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
      "cache-control": "private, no-store",
    },
  });
}
