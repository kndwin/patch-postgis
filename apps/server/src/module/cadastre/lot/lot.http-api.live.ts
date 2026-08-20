import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";
import { AppApi } from "@patch/http-contract";
import { CadastreService } from "./lot.service";
import { parseArcgisQuery } from "./lot.arcgis";
import { CadastreStatusService } from "../sync/cadastre-sync-status.service";
import { Config, DateTime, Effect, Option } from "effect";
import { CadastreEmailIngestionService } from "../workflow/cadastre-email-ingestion.service";
import { extractTrustedCadastreDownloadUrl } from "@patch/http-contract";

export const CadastreLive = HttpApiBuilder.group(AppApi, "cadastre", (handlers) =>
  handlers
    .handle(
      "ingestEmail",
      Effect.fn("CadastreLive.ingestEmail")(function* ({ headers, payload }) {
        const expected = yield* Config.string("CADASTRE_EMAIL_INGESTION_TOKEN").pipe(
          Effect.catchTag("ConfigError", () => Effect.succeed("")),
        );
        if (!expected || headers.authorization !== `Bearer ${expected}`)
          return yield* new HttpApiError.Unauthorized();
        const receivedAt = DateTime.make(payload.receivedAt);
        if (Option.isNone(receivedAt)) return yield* new HttpApiError.BadRequest();
        let metadata: object;
        let parsedEmail: object;
        try {
          metadata = JSON.parse(payload.metadata) as object;
          parsedEmail = JSON.parse(payload.parsedEmail) as object;
        } catch {
          return yield* new HttpApiError.BadRequest();
        }
        const service = yield* CadastreEmailIngestionService;
        yield* service
          .ingest({
            messageId: payload.messageId,
            envelopeFrom: payload.envelope.from,
            envelopeTo: payload.envelope.to,
            subject: payload.subject,
            receivedAt: DateTime.toDate(receivedAt.value),
            rawR2Key: payload.rawR2Key,
            metadataR2Key: payload.metadataR2Key,
            metadata,
            parsedEmail,
            extractedDownloadUrl: extractTrustedCadastreDownloadUrl(parsedEmail),
          })
          .pipe(
            Effect.catchTag("EffectDrizzleQueryError", () =>
              Effect.fail(new HttpApiError.InternalServerError()),
            ),
          );
        return { messageId: payload.messageId, created: true };
      }),
    )
    .handle(
      "getLot",
      Effect.fn("CadastreLive.getLot")(function* ({ params }) {
        const service = yield* CadastreService;
        const { id, lotNumber, geometry } = yield* service.getLot({ id: params.id }).pipe(
          Effect.catchTags({
            LotNotFoundError: () => Effect.fail(new HttpApiError.NotFound()),
            EffectDrizzleQueryError: () => Effect.fail(new HttpApiError.InternalServerError()),
          }),
        );

        return { id, lotNumber, geometry };
      }),
    )
    .handle(
      "getLotTile",
      Effect.fn("CadastreLive.getLotTile")(function* ({ params }) {
        const z = Number(params.z);
        const x = Number(params.x);
        const y = Number(params.y);
        if (
          !Number.isInteger(z) ||
          !Number.isInteger(x) ||
          !Number.isInteger(y) ||
          z < 0 ||
          z > 22 ||
          x < 0 ||
          y < 0 ||
          x >= 2 ** z ||
          y >= 2 ** z
        )
          return yield* new HttpApiError.BadRequest();
        const service = yield* CadastreService;
        const tile = yield* service.getTile({ z, x, y }).pipe(
          Effect.catchTags({
            EffectDrizzleQueryError: () => Effect.fail(new HttpApiError.InternalServerError()),
          }),
        );
        // Cadastre tiles are immutable for a given snapshot. A snapshot
        // version in the tile URL (for example, ?v=20260801) makes this
        // safe for browser and Railway CDN caches indefinitely.
        return HttpServerResponse.uint8Array(tile, {
          contentType: "application/vnd.mapbox-vector-tile",
          headers: {
            "cache-control": "public, max-age=31536000, s-maxage=31536000, immutable",
          },
        });
      }),
    )
    .handle(
      "getArcgisLot",
      Effect.fn("CadastreLive.getArcgisLot")(function* ({ query }) {
        const parsed = parseArcgisQuery(query);
        if (parsed._tag === "Invalid") return yield* new HttpApiError.BadRequest();
        const service = yield* CadastreService;
        const lot = yield* service.getLot({ id: parsed.id }).pipe(
          Effect.catchTags({
            LotNotFoundError: () => Effect.succeed(null),
            EffectDrizzleQueryError: () => Effect.fail(new HttpApiError.InternalServerError()),
          }),
        );
        return {
          type: "FeatureCollection" as const,
          features:
            lot === null
              ? []
              : [
                  {
                    type: "Feature" as const,
                    id: lot.id,
                    geometry: parsed.returnGeometry ? lot.geometry : null,
                    properties: {
                      CADID: lot.id,
                      LotDescription: lot.lotNumber,
                    },
                  },
                ],
        };
      }),
    )
    .handle(
      "getCurrentSnapshot",
      Effect.fn("CadastreLive.getCurrentSnapshot")(function* () {
        const service = yield* CadastreStatusService;
        return yield* service
          .currentSnapshot()
          .pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.InternalServerError())));
      }),
    )
    .handle(
      "getSyncRuns",
      Effect.fn("CadastreLive.getSyncRuns")(function* ({ query: _query }) {
        const service = yield* CadastreStatusService;
        return yield* service
          .runs()
          .pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.InternalServerError())));
      }),
    ),
);
