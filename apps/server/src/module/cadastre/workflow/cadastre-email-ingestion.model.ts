import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const cadastreEmailIngestions = pgTable(
  "cadastre_email_ingestions",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id").notNull(),
    envelopeFrom: text("envelope_from").notNull(),
    envelopeTo: text("envelope_to").notNull(),
    subject: text("subject"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    rawR2Key: text("raw_r2_key").notNull(),
    metadataR2Key: text("metadata_r2_key").notNull(),
    metadata: jsonb("metadata").notNull(),
    parsedEmail: jsonb("parsed_email").notNull(),
    extractedDownloadUrl: text("extracted_download_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cadastre_email_ingestions_message_id_idx").on(table.messageId),
    index("cadastre_email_ingestions_received_at_idx").on(table.receivedAt),
  ],
);

export type CadastreEmailIngestion = typeof cadastreEmailIngestions.$inferSelect;
