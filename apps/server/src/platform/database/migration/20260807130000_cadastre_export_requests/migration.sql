DO $$ BEGIN
  CREATE TYPE "cadastre_export_request_status" AS ENUM ('requesting', 'queued');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "cadastre_export_requests" (
  "execution_id" text PRIMARY KEY NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "email_address" text NOT NULL,
  "status" "cadastre_export_request_status" NOT NULL,
  "provider_request_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
