import { Config, Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Activity } from "effect/unstable/workflow";
import { projectActivity } from "../workflow-projection.activity";
import {
  CadastreActivityErrorSchema,
  DownloadGdbSuccessSchema,
  type DownloadGdbInput,
} from "./download-gdb.activity.schema";
import {
  CadastreWorkflowConfigError,
  CadastreWorkflowHttpError,
  CadastreWorkflowJsonError,
  CadastreWorkflowProviderError,
} from "./cadastre-workflow-error.schema";

export const sourceObjectKey = (idempotencyKey: string, downloadUrl: string) =>
  Effect.tryPromise(async () => {
    const bytes = new TextEncoder().encode(`${idempotencyKey}\0${downloadUrl}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return `runs/${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}/source/export.zip`;
  });

/** Downloads and persists the provider GDB through the artifact worker. */
export const DownloadGdbActivity = (input: DownloadGdbInput) =>
  Activity.make({
    name: "CadastreSyncWorkflow/download-gdb",
    error: CadastreActivityErrorSchema,
    success: DownloadGdbSuccessSchema,
    execute: projectActivity(
      "download-gdb",
      Effect.fn("CadastreSyncWorkflow.downloadGdb")(function* () {
        const url = yield* Config.string("CADASTRE_ARTIFACT_URL").pipe(
          Effect.mapError(
            () => new CadastreWorkflowConfigError({ message: "Artifact URL is not configured" }),
          ),
        );
        const token = yield* Config.string("CADASTRE_ARTIFACT_TOKEN").pipe(
          Effect.mapError(
            () => new CadastreWorkflowConfigError({ message: "Artifact token is not configured" }),
          ),
        );
        if (url.trim() === "" || token.trim() === "")
          return yield* Effect.fail(
            new CadastreWorkflowConfigError({ message: "Artifact configuration is incomplete" }),
          );
        const objectKey = yield* sourceObjectKey(input.idempotencyKey, input.downloadUrl).pipe(
          Effect.mapError(
            () => new CadastreWorkflowHttpError({ message: "Unable to generate artifact key" }),
          ),
        );
        const request = HttpClientRequest.post(`${url.replace(/\/$/, "")}/source`, {
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        }).pipe(
          HttpClientRequest.bodyText(
            JSON.stringify({ downloadUrl: input.downloadUrl, objectKey }),
            "application/json",
          ),
        );
        const response = yield* HttpClient.execute(request).pipe(
          Effect.mapError(
            () => new CadastreWorkflowHttpError({ message: "Artifact request failed" }),
          ),
        );
        const body = yield* response.json.pipe(
          Effect.mapError(
            () => new CadastreWorkflowJsonError({ message: "Invalid artifact response" }),
          ),
        );
        if (response.status < 200 || response.status >= 300)
          return yield* Effect.fail(
            new CadastreWorkflowProviderError({
              message: `Artifact worker returned HTTP ${response.status}`,
              status: response.status,
              response: null,
            }),
          );
        const result = yield* Schema.decodeUnknownEffect(DownloadGdbSuccessSchema)(body).pipe(
          Effect.mapError(
            () => new CadastreWorkflowJsonError({ message: "Invalid artifact response" }),
          ),
        );
        if (
          result.objectKey !== objectKey ||
          !Number.isFinite(result.size) ||
          result.size < 0 ||
          result.size > 2 * 1024 * 1024 * 1024 ||
          result.etag.trim() === ""
        )
          return yield* Effect.fail(
            new CadastreWorkflowJsonError({ message: "Invalid artifact response" }),
          );
        return result;
      })().pipe(Effect.provide(FetchHttpClient.layer)),
    ),
  });
