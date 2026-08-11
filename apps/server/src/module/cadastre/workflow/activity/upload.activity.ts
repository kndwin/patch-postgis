import { Effect, Config } from "effect";
import { Activity } from "effect/unstable/workflow";
import { projectActivity } from "../workflow-projection.activity";
import { activityInterruptRetryPolicy } from "./activity-options.activity";
import {
  CadastreActivityErrorSchema,
  UploadInputSchema,
  UploadSuccessSchema,
} from "./upload.activity.schema";
import { CadastreWorkflowConfigError } from "./cadastre-workflow-error.schema";
import {
  isPublishObjectKey,
  isSha256,
  normalizeEtag,
  normalizeTileBaseUrl,
} from "../../../../platform/cadastre/pmtiles.boundary";

export const UploadActivity = (input: typeof UploadInputSchema.Type) =>
  Activity.make({
    interruptRetryPolicy: activityInterruptRetryPolicy,
    name: "CadastreSyncWorkflow/upload",
    error: CadastreActivityErrorSchema,
    success: UploadSuccessSchema,
    execute: projectActivity(
      "upload",
      Effect.fn("CadastreSyncWorkflow.upload.execute")(function* () {
        const base = yield* Config.string("CADASTRE_TILE_URL").pipe(
          Effect.mapError(
            () => new CadastreWorkflowConfigError({ message: "CADASTRE_TILE_URL is required" }),
          ),
        );
        const token = yield* Config.string("CADASTRE_TILE_PUBLISH_TOKEN").pipe(
          Effect.mapError(
            () =>
              new CadastreWorkflowConfigError({
                message: "CADASTRE_TILE_PUBLISH_TOKEN is required",
              }),
          ),
        );
        const normalizedBase = normalizeTileBaseUrl(base);
        if (!isPublishObjectKey(input.objectKey) || !token || !normalizedBase)
          return yield* new CadastreWorkflowConfigError({
            message: "Invalid publish configuration",
          });
        const response = yield* Effect.tryPromise(() =>
          fetch(`${normalizedBase}/_publish?objectKey=${encodeURIComponent(input.objectKey)}`, {
            method: "HEAD",
            headers: { authorization: `Bearer ${token}` },
          }),
        ).pipe(
          Effect.mapError(
            () => new CadastreWorkflowConfigError({ message: "Tile storage HEAD failed" }),
          ),
        );
        if (!response.ok)
          return yield* new CadastreWorkflowConfigError({
            message: "Tile storage object is not available",
          });
        const size = Number(response.headers.get("content-length"));
        const etag = normalizeEtag(response.headers.get("etag"));
        if (
          size !== input.size ||
          etag === null ||
          etag !== normalizeEtag(input.etag) ||
          response.headers.get("x-expected-size") !== String(input.size) ||
          response.headers.get("x-run-hash") !== input.runHash ||
          response.headers.get("x-content-sha256") !== input.checksum ||
          !isSha256(input.checksum)
        )
          return yield* new CadastreWorkflowConfigError({
            message: "Tile storage metadata conflicts with build",
          });
        return { ...input, etag, checksum: input.checksum };
      })(),
    ),
  });
