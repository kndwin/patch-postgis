CREATE TABLE "cadastre_import_checkpoints" (
	"source" text PRIMARY KEY NOT NULL,
	"next_object_id_index" integer DEFAULT 0 NOT NULL,
	"object_ids" integer[] DEFAULT '{}' NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"upserted" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"completed" boolean DEFAULT false NOT NULL
);
