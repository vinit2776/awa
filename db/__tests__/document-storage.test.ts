import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, describe, expect, it } from "vitest";
import { uploadRequisitionDocument, getRequisitionDocumentUrl } from "../documentStorage";

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

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe("uploadRequisitionDocument", () => {
  it("uploads a real file to R2 and returns a tenant-scoped key", async () => {
    const file = makeFile("quote.pdf", "application/pdf", 1024);
    const result = await uploadRequisitionDocument(TEST_TENANT_ID, file);

    expect(result.error).toBeUndefined();
    expect(result.key).toBeDefined();
    expect(result.key).toContain(TEST_TENANT_ID);
    expect(result.key).toContain("quote.pdf");
    uploadedKeys.push(result.key!);
  });

  it("round-trips through a signed URL that actually fetches the uploaded bytes", async () => {
    const file = makeFile("proforma.pdf", "application/pdf", 512);
    const { key } = await uploadRequisitionDocument(TEST_TENANT_ID, file);
    uploadedKeys.push(key!);

    const url = await getRequisitionDocumentUrl(key!);
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(512);
  });

  it("rejects a file over the size limit without uploading anything", async () => {
    const file = makeFile("huge.pdf", "application/pdf", 11 * 1024 * 1024);
    const result = await uploadRequisitionDocument(TEST_TENANT_ID, file);
    expect(result.error).toBeDefined();
    expect(result.key).toBeUndefined();
  });

  it("rejects an unsupported file type", async () => {
    const file = makeFile("notes.txt", "text/plain", 10);
    const result = await uploadRequisitionDocument(TEST_TENANT_ID, file);
    expect(result.error).toBeDefined();
    expect(result.key).toBeUndefined();
  });

  it("rejects an empty file", async () => {
    const file = makeFile("empty.pdf", "application/pdf", 0);
    const result = await uploadRequisitionDocument(TEST_TENANT_ID, file);
    expect(result.error).toBeDefined();
    expect(result.key).toBeUndefined();
  });
});
