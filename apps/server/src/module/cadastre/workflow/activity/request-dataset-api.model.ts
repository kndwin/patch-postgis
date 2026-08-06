import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const cadastreExportRequestStatus = pgEnum("cadastre_export_request_status", [
  "requesting",
  "queued",
]);

export const cadastreExportRequests = pgTable("cadastre_export_requests", {
  executionId: text("execution_id").primaryKey(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
  emailAddress: text("email_address").notNull(),
  status: cadastreExportRequestStatus("status").notNull(),
  providerRequestId: text("provider_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CadastreExportRequest = typeof cadastreExportRequests.$inferSelect;
