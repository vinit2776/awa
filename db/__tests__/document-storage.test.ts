import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, describe, expect, it } from "vitest";
import { getRequisitionUploadUrl, getRequisitionDocumentBytes, getRequisitionDocumentUrl } from "../documentStorage";

const TEST_TENANT_ID = "doc-storage-test-tenant";
const uploadedKeys: string[] = [];

afterAll(async () => {
  if (uploadedKeys.length === 0) return;
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  for (const key of uploadedKeys) {
    await client.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }));
  }
});

async function uploadViaPresignedUrl(name: string, type: string, sizeBytes: number) {
  const bytes = new Uint8Array(sizeBytes);
  const presigned = await getRequisitionUploadUrl(TEST_TENANT_ID, name, type, sizeBytes);
  if (presigned.error || !presigned.uploadUrl || !presigned.key) return presigned;

  const putResponse = await fetch(presigned.uploadUrl, { method: "PUT", headers: { "Content-Type": type }, body: bytes });
  if (!putResponse.ok) throw new Error(`PUT failed: ${putResponse.status}`);
  uploadedKeys.push(presigned.key);
  return presigned;
}

describe("getRequisitionUploadUrl", () => {
  it("returns a tenant-scoped key and a presigned URL that actually accepts an upload", async () => {
    const presigned = await uploadViaPresignedUrl("quote.pdf", "application/pdf", 1024);

    expect(presigned.error).toBeUndefined();
    expect(presigned.key).toBeDefined();
    expect(presigned.key).toContain(TEST_TENANT_ID);
    expect(presigned.key).toContain("quote.pdf");
  });

  it("round-trips: uploaded bytes are readable back via getRequisitionDocumentBytes and a signed URL", async () => {
    const presigned = await uploadViaPresignedUrl("proforma.pdf", "application/pdf", 512);

    const read = await getRequisitionDocumentBytes(presigned.key!);
    expect(read.error).toBeUndefined();
    expect(read.bytes?.length).toBe(512);
    expect(read.mimeType).toBe("application/pdf");

    const url = await getRequisitionDocumentUrl(presigned.key!);
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(512);
  });

  it("accepts a file larger than a Vercel Function's 4.5MB body limit, since it never passes through one", async () => {
    // The whole point of the presigned-URL flow: this is well over what
    // a Server Action could ever carry, and it still uploads cleanly
    // because the bytes go straight from this test to R2.
    const presigned = await uploadViaPresignedUrl("large-scan.pdf", "application/pdf", 6 * 1024 * 1024);
    expect(presigned.error).toBeUndefined();
    expect(presigned.key).toBeDefined();
  });

  it("rejects a file over the app's own size limit without generating a URL", async () => {
    const result = await getRequisitionUploadUrl(TEST_TENANT_ID, "huge.pdf", "application/pdf", 11 * 1024 * 1024);
    expect(result.error).toBeDefined();
    expect(result.uploadUrl).toBeUndefined();
  });

  it("rejects an unsupported file type", async () => {
    const result = await getRequisitionUploadUrl(TEST_TENANT_ID, "notes.txt", "text/plain", 10);
    expect(result.error).toBeDefined();
    expect(result.uploadUrl).toBeUndefined();
  });

  it("rejects an empty file", async () => {
    const result = await getRequisitionUploadUrl(TEST_TENANT_ID, "empty.pdf", "application/pdf", 0);
    expect(result.error).toBeDefined();
    expect(result.uploadUrl).toBeUndefined();
  });
});

describe("getRequisitionDocumentBytes", () => {
  it("returns an error for a key that doesn't exist", async () => {
    const result = await getRequisitionDocumentBytes(`requisitions/${TEST_TENANT_ID}/does-not-exist.pdf`);
    expect(result.error).toBeDefined();
    expect(result.bytes).toBeUndefined();
  });
});
