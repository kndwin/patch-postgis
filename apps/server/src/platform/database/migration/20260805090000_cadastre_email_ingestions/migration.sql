CREATE TABLE IF NOT EXISTS "cadastre_email_ingestions" (
  "id" text PRIMARY KEY NOT NULL,
  "message_id" text NOT NULL,
  "envelope_from" text NOT NULL,
  "envelope_to" text NOT NULL,
  "subject" text,
  "received_at" timestamptz NOT NULL,
  "raw_r2_key" text NOT NULL,
  "metadata_r2_key" text NOT NULL,
  "metadata" jsonb NOT NULL,
  "parsed_email" jsonb NOT NULL,
  "extracted_download_url" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "cadastre_email_ingestions_message_id_idx" ON "cadastre_email_ingestions" ("message_id");
CREATE INDEX IF NOT EXISTS "cadastre_email_ingestions_received_at_idx" ON "cadastre_email_ingestions" ("received_at");
