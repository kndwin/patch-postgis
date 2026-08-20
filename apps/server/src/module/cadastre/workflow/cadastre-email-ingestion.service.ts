import { Context, Effect, Layer } from "effect";
import {
  CadastreEmailIngestionRepo,
  CadastreEmailIngestionRepoLive,
  type EmailIngestionInput,
} from "./cadastre-email-ingestion.repo";
import { DbLive } from "../../../platform/database/client";

export class CadastreEmailIngestionService extends Context.Service<CadastreEmailIngestionService>()(
  "CadastreEmailIngestionService",
  {
    make: Effect.fn("CadastreEmailIngestionService.make")(function* () {
      const repo = yield* CadastreEmailIngestionRepo;
      return {
        ingest: repo.upsert,
        findNewestTrustedExportAfter: repo.findNewestTrustedExportAfter,
      };
    })(),
  },
) {
  declare readonly ingest: (
    input: EmailIngestionInput,
  ) => ReturnType<CadastreEmailIngestionRepo["upsert"]>;
  declare readonly findNewestTrustedExportAfter: CadastreEmailIngestionRepo["findNewestTrustedExportAfter"];
}

export const CadastreEmailIngestionServiceLive = Layer.effect(
  CadastreEmailIngestionService,
  CadastreEmailIngestionService.make,
).pipe(Layer.provide(CadastreEmailIngestionRepoLive), Layer.provide(DbLive));
