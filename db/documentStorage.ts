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

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // matches next.config.ts's serverActions.bodySizeLimit
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

/**
 * Uploads a requisition's source document (quotation/proforma/GST
 * invoice) and returns the R2 object key to store on the requisition
 * row. Tenant-scoped path so one tenant's documents are never listable
 * or guessable from another's key.
 */
export async function uploadRequisitionDocument(
  tenantId: string,
  file: File,
): Promise<{ key?: string; error?: string }> {
  if (file.size === 0) return { error: "The file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { error: "The file is too large (max 10MB)." };
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return { error: "Only PDF, JPEG, PNG, or WebP files are supported." };
  }

  const key = `requisitions/${tenantId}/${crypto.randomUUID()}-${file.name}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  await r2Client().send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: bytes,
      ContentType: file.type,
    }),
  );

  return { key };
}

/** Short-lived signed URL so an uploaded document can be viewed later without making the bucket public. */
export async function getRequisitionDocumentUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucketName(), Key: key });
  return getSignedUrl(r2Client(), command, { expiresIn: 300 });
}
