import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Db } from "../../../platform/database/client";
import { cadastreEmailIngestions } from "./cadastre-email-ingestion.model";
import { isTrustedCadastreDownloadUrl } from "@patch/http-contract";

export type EmailIngestionInput = Omit<
  typeof cadastreEmailIngestions.$inferInsert,
  "id" | "createdAt" | "updatedAt"
>;

export const selectNewestTrustedCadastreEmail = (
  rows: readonly (typeof cadastreEmailIngestions.$inferSelect)[],
) => rows.find((row) => isTrustedCadastreDownloadUrl(row.extractedDownloadUrl)) ?? null;

export class CadastreEmailIngestionRepo extends Context.Service<CadastreEmailIngestionRepo>()(
  "CadastreEmailIngestionRepo",
  {
    make: Effect.fn("CadastreEmailIngestionRepo.make")(function* () {
      const db = yield* Db;
      return {
        upsert: Effect.fn("CadastreEmailIngestionRepo.upsert")(function* (
          input: EmailIngestionInput,
        ) {
          const updatedAt = yield* DateTime.now;
          return yield* db
            .insert(cadastreEmailIngestions)
            .values({ ...input, id: crypto.randomUUID() })
            .onConflictDoUpdate({
              target: cadastreEmailIngestions.messageId,
              set: { ...input, updatedAt: DateTime.toDate(updatedAt) },
            })
            .returning()
            .pipe(Effect.map(([row]) => row));
        }),
        findNewestTrustedExportAfter: Effect.fn(
          "CadastreEmailIngestionRepo.findNewestTrustedExportAfter",
        )(function* (envelopeTo: string, receivedAfter: Date) {
          return yield* db
            .select()
            .from(cadastreEmailIngestions)
            .where(
              and(
                eq(cadastreEmailIngestions.envelopeTo, envelopeTo),
                gt(cadastreEmailIngestions.receivedAt, receivedAfter),
                isNotNull(cadastreEmailIngestions.extractedDownloadUrl),
              ),
            )
            .orderBy(desc(cadastreEmailIngestions.receivedAt))
            .pipe(Effect.map(selectNewestTrustedCadastreEmail));
        }),
      };
    })(),
  },
) {
  declare readonly upsert: (
    input: EmailIngestionInput,
  ) => Effect.Effect<typeof cadastreEmailIngestions.$inferSelect, EffectDrizzleQueryError>;
  declare readonly findNewestTrustedExportAfter: (
    envelopeTo: string,
    receivedAfter: Date,
  ) => Effect.Effect<typeof cadastreEmailIngestions.$inferSelect | null, EffectDrizzleQueryError>;
}

export const CadastreEmailIngestionRepoLive = Layer.effect(
  CadastreEmailIngestionRepo,
  CadastreEmailIngestionRepo.make,
);
