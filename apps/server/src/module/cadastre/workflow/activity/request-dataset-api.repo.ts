import { eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Db } from "../../../../platform/database/client";
import { cadastreExportRequests, type CadastreExportRequest } from "./request-dataset-api.model";

export type ExportRequestClaim =
  | { readonly claimed: true; readonly request: CadastreExportRequest }
  | { readonly claimed: false; readonly request: CadastreExportRequest };

export class ExportRequestClaimError extends Schema.TaggedError<ExportRequestClaimError>()(
  "ExportRequestClaimError",
  { message: Schema.String },
) {}

export const existingExportRequestClaim = (
  request: CadastreExportRequest | undefined,
): Effect.Effect<ExportRequestClaim, ExportRequestClaimError> =>
  request === undefined
    ? Effect.fail(new ExportRequestClaimError({ message: "Export request claim disappeared" }))
    : Effect.succeed({ claimed: false, request });

/** The insert winner is the only fiber permitted to cross the HTTP boundary. */
export const exportRequestShouldSend = (claim: ExportRequestClaim): boolean => claim.claimed;

export class CadastreExportRequestRepo extends Context.Service<CadastreExportRequestRepo>()(
  "CadastreExportRequestRepo",
  {
    make: Effect.fn("CadastreExportRequestRepo.make")(function* () {
      const db = yield* Db;
      return {
        claim: Effect.fn("CadastreExportRequestRepo.claim")(function* (
          executionId: string,
          requestedAt: Date,
          emailAddress: string,
        ) {
          return yield* db
            .insert(cadastreExportRequests)
            .values({ executionId, requestedAt, emailAddress, status: "requesting" })
            .onConflictDoNothing({ target: cadastreExportRequests.executionId })
            .returning()
            .pipe(
              Effect.flatMap(
                (
                  inserted,
                ): Effect.Effect<
                  ExportRequestClaim,
                  ExportRequestClaimError | EffectDrizzleQueryError
                > =>
                  inserted.length > 0
                    ? Effect.succeed({ claimed: true, request: inserted[0] } as const)
                    : db
                        .select()
                        .from(cadastreExportRequests)
                        .where(eq(cadastreExportRequests.executionId, executionId))
                        .pipe(Effect.flatMap(([request]) => existingExportRequestClaim(request))),
              ),
            );
        }),
        markQueued: Effect.fn("CadastreExportRequestRepo.markQueued")(function* (
          executionId: string,
          providerRequestId: string | undefined,
        ) {
          const updatedAt = yield* DateTime.now;
          return yield* db
            .update(cadastreExportRequests)
            .set({
              status: "queued",
              providerRequestId,
              updatedAt: DateTime.toDate(updatedAt),
            })
            .where(eq(cadastreExportRequests.executionId, executionId))
            .pipe(Effect.asVoid);
        }),
      };
    })(),
  },
) {
  declare readonly claim: (
    executionId: string,
    requestedAt: Date,
    emailAddress: string,
  ) => Effect.Effect<ExportRequestClaim, EffectDrizzleQueryError | ExportRequestClaimError>;
  declare readonly markQueued: (
    executionId: string,
    providerRequestId: string | undefined,
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
}

export const CadastreExportRequestRepoLive = Layer.effect(
  CadastreExportRequestRepo,
  CadastreExportRequestRepo.make,
);
