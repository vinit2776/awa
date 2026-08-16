import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 object storage.
 *
 * The R2_* environment variables have been in .env.example since Sprint 0 but
 * nothing in the codebase has ever written an object — support attachments are
 * the first. That means the bucket itself may not exist yet on a given
 * environment, so this module reports "not configured" explicitly rather than
 * letting a missing bucket surface as an opaque SDK error mid-upload. Callers
 * check isStorageConfigured() and hide the attachment controls when false; the
 * feature degrades to text-only instead of throwing at the user.
 */

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Deliberately narrow. A support attachment is a screenshot, a log, or a PDF —
// anything else is either a mistake or something we should not be storing.
const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
]);

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME,
  );
}

export const attachmentLimits = {
  maxBytes: MAX_BYTES,
  allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
  maxFilesPerMessage: 5,
};

export function validateAttachment(file: { type: string; size: number }): string | null {
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    return `${file.type || "That file type"} isn't accepted. Attach a PNG, JPEG, WebP, GIF, PDF or text file.`;
  }
  if (file.size > MAX_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`;
  }
  if (file.size === 0) return "That file is empty.";
  return null;
}

function client(): S3Client {
  if (!isStorageConfigured()) {
    throw new Error("R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

/**
 * Key layout: support/<tenant_id>/<ticket_id>/<attachment_id>.<ext>
 *
 * The tenant id sits in the path so that a leaked key still cannot be used to
 * reach another tenant's object without also passing the row-level check in
 * the download route. The attachment id — not the original filename — is the
 * object name, so a hostile filename can never shape the key.
 */
export function buildAttachmentKey(params: {
  tenantId: string;
  ticketId: string;
  attachmentId: string;
  contentType: string;
}): string {
  const ext = EXTENSION_BY_TYPE[params.contentType] ?? "bin";
  return `support/${params.tenantId}/${params.ticketId}/${params.attachmentId}.${ext}`;
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObject(key: string): Promise<{ body: ReadableStream; contentType?: string } | null> {
  const result = await client().send(
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }),
  );
  if (!result.Body) return null;
  return {
    body: result.Body.transformToWebStream(),
    contentType: result.ContentType,
  };
}
