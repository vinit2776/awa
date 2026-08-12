import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 — S3-compatible, already provisioned for this app
// specifically for documents (bucket awa-documents; see SETUP.md). The
// bucket has public access disabled, so every read goes through a
// short-lived signed URL rather than a bare object URL.
function r2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials are not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY).");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function bucketName() {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) throw new Error("R2_BUCKET_NAME is not configured.");
  return bucket;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/**
 * Returns a short-lived presigned PUT URL so the browser uploads a
 * requisition's source document (quotation/proforma/GST invoice)
 * directly to R2, not through a Next.js Server Action. Vercel Functions
 * cap request bodies at 4.5MB regardless of Next's own
 * serverActions.bodySizeLimit — routing real scanned documents through
 * one hit that ceiling with a 413 that Next.js then reports as a
 * garbled "unexpected response" client error (found live: looked like
 * the page itself had 404'd). Only the small JSON request/response
 * (filename, MIME type, the resulting key) touches a Server Action;
 * the file bytes never do.
 *
 * fileSize is checked here as a courtesy — it can't be enforced against
 * the presigned PUT itself (a plain presigned URL has no size
 * condition, only a presigned POST policy does, which isn't worth the
 * extra complexity for an internal, authenticated, tenant-scoped
 * upload). A user could still PUT more bytes than they declared; that's
 * an acceptable trust boundary for this app's internal-tool threat
 * model, same as line-item quantities and prices aren't independently
 * re-validated server-side elsewhere in this codebase.
 */
export async function getRequisitionUploadUrl(
  tenantId: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
): Promise<{ key?: string; uploadUrl?: string; error?: string }> {
  if (fileSize <= 0) return { error: "The file is empty." };
  if (fileSize > MAX_UPLOAD_BYTES) return { error: "The file is too large (max 10MB)." };
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { error: "Only PDF, JPEG, PNG, or WebP files are supported." };
  }

  const key = `requisitions/${tenantId}/${crypto.randomUUID()}-${fileName}`;
  const command = new PutObjectCommand({ Bucket: bucketName(), Key: key, ContentType: mimeType });
  const uploadUrl = await getSignedUrl(r2Client(), command, { expiresIn: 300 });

  return { key, uploadUrl };
}

/** Reads back an uploaded document's bytes, e.g. to hand to an extraction provider server-side. */
export async function getRequisitionDocumentBytes(key: string): Promise<{ bytes?: Uint8Array; mimeType?: string; error?: string }> {
  try {
    const result = await r2Client().send(new GetObjectCommand({ Bucket: bucketName(), Key: key }));
    if (!result.Body) return { error: "The document could not be read." };
    const bytes = await result.Body.transformToByteArray();
    return { bytes, mimeType: result.ContentType };
  } catch {
    return { error: "The document could not be found." };
  }
}

/** Short-lived signed URL so an uploaded document can be viewed later without making the bucket public. */
export async function getRequisitionDocumentUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucketName(), Key: key });
  return getSignedUrl(r2Client(), command, { expiresIn: 300 });
}
