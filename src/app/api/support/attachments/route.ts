import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getCurrentUserAndTenant } from "@/db/session";
import { withTenant } from "@/db/withTenant";
import { isTenantAdmin } from "@/db/permissions";
import {
  buildAttachmentKey,
  isStorageConfigured,
  putObject,
  validateAttachment,
} from "@/db/storage";
import { supportTicketAttachments, supportTickets } from "@/db/schema";

/**
 * Attachment upload. A route handler rather than a presigned URL: the presigner
 * package isn't a dependency, and routing the bytes through the server means
 * content type and size are validated somewhere the client cannot skip, and the
 * bucket stays entirely private.
 *
 * Like a server action, this is reachable by direct POST — so the ticket's
 * ownership is re-checked here from the session, never taken from the payload.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isStorageConfigured()) {
    return Response.json(
      { error: "File storage isn't configured on this environment yet." },
      { status: 503 },
    );
  }

  const { user, tenant } = await getCurrentUserAndTenant();

  const form = await request.formData();
  const ticketId = String(form.get("ticketId") ?? "");
  const file = form.get("file");

  if (!ticketId || !(file instanceof File)) {
    return Response.json({ error: "Expected a ticketId and a file." }, { status: 400 });
  }

  const invalid = validateAttachment({ type: file.type, size: file.size });
  if (invalid) return Response.json({ error: invalid }, { status: 400 });

  const attachmentId = randomUUID();
  const key = buildAttachmentKey({
    tenantId: tenant.id,
    ticketId,
    attachmentId,
    contentType: file.type,
  });

  const allowed = await withTenant(tenant.id, async (tx) => {
    const [ticket] = await tx
      .select()
      .from(supportTickets)
      .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.tenantId, tenant.id)))
      .limit(1);

    if (!ticket) return false;
    if (ticket.reportedByUserId === user.id) return true;
    return isTenantAdmin(tx, tenant.id, user.id);
  });

  if (!allowed) return Response.json({ error: "Ticket not found." }, { status: 404 });

  // Object first, row second. The reverse order can leave a row pointing at an
  // object that was never written — a broken download link with no way to tell
  // it apart from a real one. An orphaned object costs storage and nothing else.
  const bytes = new Uint8Array(await file.arrayBuffer());
  await putObject(key, bytes, file.type);

  await withTenant(tenant.id, async (tx) => {
    await tx.insert(supportTicketAttachments).values({
      id: attachmentId,
      tenantId: tenant.id,
      ticketId,
      storageKey: key,
      fileName: file.name.slice(0, 200),
      contentType: file.type,
      sizeBytes: file.size,
      uploadedByUserId: user.id,
    });
  });

  return Response.json({ id: attachmentId, fileName: file.name });
}
