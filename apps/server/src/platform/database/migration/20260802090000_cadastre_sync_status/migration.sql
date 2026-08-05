CREATE TABLE "cadastre_snapshots" (
	"version" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"lot_count" integer NOT NULL,
	"imported_at" timestamptz NOT NULL,
	"pmtiles_status" text NOT NULL,
	"pmtiles_url" text
);
--> statement-breakpoint
CREATE INDEX "cadastre_snapshots_imported_at_idx" ON "cadastre_snapshots" USING btree ("imported_at");
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"phase" text NOT NULL,
	"source" text,
	"snapshot_version" text,
	"error" text,
	"started_at" timestamptz NOT NULL,
	"finished_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX "sync_runs_started_at_idx" ON "sync_runs" USING btree ("started_at");
--> statement-breakpoint
CREATE INDEX "sync_runs_status_idx" ON "sync_runs" USING btree ("status");
