import { readFile } from "node:fs/promises";
import PostalMime from "postal-mime";

const raw = await readFile("apps/server/src/platform/cloudflare/email/sample.eml");
const email = await PostalMime.parse(raw);
if (email.messageId !== "<sample-cadastre-export@example.test>") {
  throw new Error(`unexpected message id: ${email.messageId}`);
}
if (email.to?.[0]?.address !== "cadastre-export-staging@decoco.work") {
  throw new Error("fixture recipient did not parse");
}
console.log(`parsed ${email.messageId}: ${email.subject}`);

if (process.env.CADASTRE_INGESTION_URL && process.env.CADASTRE_INGESTION_TOKEN) {
  const response = await fetch(process.env.CADASTRE_INGESTION_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.CADASTRE_INGESTION_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messageId: email.messageId,
      envelope: { from: "fixture@example.test", to: "cadastre-export-staging@decoco.work" },
      subject: email.subject ?? null,
      receivedAt: new Date().toISOString(),
      rawR2Key: "local/sample.eml",
      metadataR2Key: "local/sample.json",
      metadata: JSON.stringify({ fixture: true }),
      parsedEmail: JSON.stringify({ subject: email.subject, text: email.text }),
      extractedDownloadUrl: null,
    }),
  });
  if (!response.ok) throw new Error(`local ingestion failed: ${response.status}`);
  console.log("local ingestion callback succeeded");
}
