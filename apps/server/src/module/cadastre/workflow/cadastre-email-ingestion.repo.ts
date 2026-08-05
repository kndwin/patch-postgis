import { and, desc, eq, gt } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Db } from "../../../platform/database/client";
import { cadastreEmailIngestions } from "./cadastre-email-ingestion.model";

export type EmailIngestionInput = Omit<
  typeof cadastreEmailIngestions.$inferInsert,
  "id" | "createdAt" | "updatedAt"
>;

export class CadastreEmailIngestionRepo extends Context.Service<CadastreEmailIngestionRepo>()(
  "CadastreEmailIngestionRepo",
  {
    make: Effect.fn("CadastreEmailIngestionRepo.make")(function* () {
      const db = yield* Db;
      return {
        upsert: (input: EmailIngestionInput) =>
          db
            .insert(cadastreEmailIngestions)
            .values({
              ...input,
              id: crypto.randomUUID(),
            })
            .onConflictDoUpdate({
              target: cadastreEmailIngestions.messageId,
              set: { ...input, updatedAt: DateTime.toDate(DateTime.nowUnsafe()) },
            })
            .returning()
            .pipe(Effect.map(([row]) => row)),
        findNewestAfter: (envelopeTo: string, receivedAfter: Date) =>
          db
            .select()
            .from(cadastreEmailIngestions)
            .where(
              and(
                eq(cadastreEmailIngestions.envelopeTo, envelopeTo),
                gt(cadastreEmailIngestions.receivedAt, receivedAfter),
              ),
            )
            .orderBy(desc(cadastreEmailIngestions.receivedAt))
            .limit(1)
            .pipe(Effect.map(([row]) => row ?? null)),
      };
    })(),
  },
) {
  declare readonly upsert: (
    input: EmailIngestionInput,
  ) => Effect.Effect<typeof cadastreEmailIngestions.$inferSelect, EffectDrizzleQueryError>;
  declare readonly findNewestAfter: (
    envelopeTo: string,
    receivedAfter: Date,
  ) => Effect.Effect<typeof cadastreEmailIngestions.$inferSelect | null, EffectDrizzleQueryError>;
}

export const CadastreEmailIngestionRepoLive = Layer.effect(
  CadastreEmailIngestionRepo,
  CadastreEmailIngestionRepo.make,
);
