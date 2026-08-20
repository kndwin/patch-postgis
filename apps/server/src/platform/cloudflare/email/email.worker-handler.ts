/// <reference types="@cloudflare/workers-types" />

import { Config, DateTime, Effect, Schema } from "effect";
import { R2, Worker } from "effect-cf";
import PostalMime, { type Email } from "postal-mime";
import { CadastreEmailIngestionPayloadJsonSchema } from "@patch/http-contract";

const EmailArchive = R2.make("EmailArchive");

function safeMessageId(messageId: string | undefined): string {
  const value = messageId?.replace(/^<|>$/g, "").replace(/[^a-zA-Z0-9._-]/g, "-");
  return value || "no-message-id";
}

function metadata(email: Email, message: ForwardableEmailMessage, receivedAt: string) {
  return {
    receivedAt,
    envelope: { from: message.from, to: message.to },
    headers: email.headers,
    from: email.from,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    messageId: email.messageId,
    inReplyTo: email.inReplyTo,
    references: email.references,
    date: email.date,
    textLength: email.text?.length ?? 0,
    htmlLength: email.html?.length ?? 0,
    attachments: email.attachments.map(({ content, ...attachment }) => ({
      ...attachment,
      size: typeof content === "string" ? content.length : content.byteLength,
    })),
  };
}

const ingestEmail = Effect.fn("CadastreEmailWorker.ingestEmail")(function* (
  message: ForwardableEmailMessage,
) {
  const archive = yield* EmailArchive;
  const raw = yield* Effect.tryPromise(() => new Response(message.raw).arrayBuffer());
  const parsed = yield* Effect.tryPromise(() =>
    PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" }),
  );
  const receivedAt = DateTime.formatIso(yield* DateTime.now);
  const timestamp = receivedAt.replace(/[:.]/g, "-");
  const stem = `received/${timestamp}-${safeMessageId(parsed.messageId)}`;
  const info = metadata(parsed, message, receivedAt);
  const rawR2Key = `${stem}.eml`;
  const metadataR2Key = `${stem}.json`;

  yield* archive.put(rawR2Key, raw, {
    httpMetadata: { contentType: "message/rfc822" },
  });
  yield* archive.put(metadataR2Key, JSON.stringify(info, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });

  const ingestionUrl = yield* Config.string("CADASTRE_INGESTION_URL");
  const ingestionToken = yield* Config.string("CADASTRE_INGESTION_TOKEN");
  const callbackBody = yield* Schema.encodeUnknownEffect(CadastreEmailIngestionPayloadJsonSchema)({
    messageId: parsed.messageId ?? message.headers.get("Message-ID") ?? "",
    envelope: { from: message.from, to: message.to },
    subject: parsed.subject ?? null,
    receivedAt: info.receivedAt,
    rawR2Key,
    metadataR2Key,
    metadata: JSON.stringify(info),
    parsedEmail: JSON.stringify({
      ...parsed,
      attachments: parsed.attachments.map(({ content: _content, ...attachment }) => attachment),
    }),
  });
  const callback = yield* Effect.tryPromise(() =>
    fetch(ingestionUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ingestionToken}`,
        "content-type": "application/json",
      },
      body: callbackBody,
    }),
  );
  if (!callback.ok) {
    return yield* Effect.fail(new Error(`Railway ingestion callback failed: ${callback.status}`));
  }
});

const fetchHandler = Effect.fn("CadastreEmailWorker.fetch")(() =>
  Effect.succeed(new Response("Not Found", { status: 404 })),
);

const WorkerEntrypoint = Worker.make(EmailArchive.layer({ binding: "EMAIL_ARCHIVE" }), {
  fetch: fetchHandler(),
  rpc: {
    email: (message: ForwardableEmailMessage) => ingestEmail(message),
  },
});

export default WorkerEntrypoint;
