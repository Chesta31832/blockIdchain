import { Storage, LogLevel, FileStatus } from "@apillon/sdk";

let storageClient;

export function getStorage() {
  if (!storageClient) {
    const { APILLON_API_KEY, APILLON_API_SECRET, APILLON_API_BASE } = process.env;
    // Ensure we talk to v1 even if env omits it
    const base = (APILLON_API_BASE || "https://api.apillon.io/v1").replace(/\/$/, "");
    storageClient = new Storage({
      key: APILLON_API_KEY,
      secret: APILLON_API_SECRET,
      baseUrl: base,
      logLevel: LogLevel.WARN,
    });
  }
  return storageClient;
}

export async function uploadToApillon(fileBuffer, fileName, contentType) {
  const { APILLON_BUCKET_ID } = process.env;
  if (!APILLON_BUCKET_ID) {
    throw new Error("APILLON_BUCKET_ID not set");
  }
  const storage = getStorage();
  const bucket = storage.bucket(APILLON_BUCKET_ID);

  const files = [
    {
      fileName,
      contentType,
      content: fileBuffer,
    },
  ];

  // SDK handles multipart and pinning; returns upload session with file info
  await bucket.uploadFiles(files, { wrapWithDirectory: false, directoryPath: "" });

  // Poll for the uploaded file to appear with a CID
  const maxAttempts = 15;
  const delayMs = 5000;
  for (let i = 0; i < maxAttempts; i++) {
    const list = await bucket.listFiles({ limit: 50, orderBy: "createTime", desc: true });
    const match = list?.items?.find((f) => f.name === fileName) || list?.items?.[0];

    console.log("Apillon poll attempt", i + 1, {
      items: list?.items?.length,
      matchedName: !!match,
      matchStatus: match?.status,
      matchCid: match?.CID,
      matchCidv1: match?.CIDv1,
      matchLink: match?.link,
    });

    if (match) {
      if (match.CID || match.CIDv1 || match.link) {
        return {
          cid: match.CID || match.CIDv1,
          fileUuid: match.uuid,
          url: match.link,
          raw: match,
        };
      }
      // If status indicates uploaded or higher but CID missing, continue polling
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  throw new Error("Apillon upload returned no cid after polling");
}
