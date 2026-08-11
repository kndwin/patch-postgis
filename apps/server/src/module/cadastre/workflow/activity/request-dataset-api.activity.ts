import { Config, DateTime, Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Activity } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow";
import { projectActivity } from "../workflow-projection.activity";
import { activityInterruptRetryPolicy } from "./activity-options.activity";
import { CadastreExportRequestRepo, exportRequestShouldSend } from "./request-dataset-api.repo";
import {
  CadastreActivityErrorSchema,
  ProviderResponseSchema,
} from "./request-dataset-api.activity.schema";
import {
  CadastreWorkflowConfigError,
  CadastreWorkflowDatabaseError,
  CadastreWorkflowHttpError,
  CadastreWorkflowJsonError,
  CadastreWorkflowProviderError,
} from "./cadastre-workflow-error.schema";

const DefaultServiceUrl =
  "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme_multiCRS/FeatureServer";
const DefaultApiUrl = "https://portal.spatial.nsw.gov.au/api/exportcontent";
const DefaultSelectionGeometry = JSON.stringify({
  type: "Polygon",
  coordinates: [
    [
      [140.09261760059334, -38.82778924088004],
      [140.09261760059334, -26.83199543618797],
      [159.98913929139331, -26.83199543618797],
      [159.98913929139331, -38.82778924088004],
      [140.09261760059334, -38.82778924088004],
    ],
  ],
});

export interface DatasetExportMetadata {
  readonly requestedAt: string;
  readonly emailAddress: string;
}

const DatasetExportMetadataSchema = Schema.Struct({
  requestedAt: Schema.String,
  emailAddress: Schema.String,
});

const ExportConfig = {
  ApiUrl: DefaultApiUrl,
  ServiceUrl: DefaultServiceUrl,
  ExportFormat: "FILEGDB",
  ExportDatum: "GDA2020",
  ServiceCoordinateSystem: 7844,
  ExportCoordinateSystem: "Geographic",
  WgsExportDatum: "GDA2020",
  SelectionGeometry: DefaultSelectionGeometry,
} as const;

export const RequestDatasetApiEffect = Effect.fn("RequestDatasetApi")(function* () {
  const config = ExportConfig;
  const emailAddress = yield* Config.string("CADASTRE_EXPORT_EMAIL").pipe(
    Config.withDefault("cadastre-export-staging@decoco.work"),
  );
  const requestedAt = yield* DateTime.now;
  const instance = yield* WorkflowEngine.WorkflowInstance;
  const requests = yield* CadastreExportRequestRepo;
  const claim = yield* requests
    .claim(instance.executionId, DateTime.toDate(requestedAt), emailAddress)
    .pipe(
      Effect.mapError(
        () => new CadastreWorkflowDatabaseError({ message: "Dataset export request guard failed" }),
      ),
    );
  if (!exportRequestShouldSend(claim)) {
    return {
      requestedAt: claim.request.requestedAt.toISOString(),
      emailAddress: claim.request.emailAddress,
    } satisfies DatasetExportMetadata;
  }

  const payload = {
    layers: "Lot",
    layerIds: "8",
    tables: "",
    tableIds: "",
    exportFormat: config.ExportFormat,
    emailAddress,
    exportDatum: config.ExportDatum,
    serviceCoordinateSystem: config.ServiceCoordinateSystem,
    exportCoordinateSystem: config.ExportCoordinateSystem,
    wgsInputEpoch: null,
    wgsExportEpoch: config.WgsExportDatum,
    featureServerName: "NSW_Land_Parcel_Property_Theme_multiCRS",
    serviceUrl: config.ServiceUrl,
    metadataUrl: "/",
    selectionGeometry: config.SelectionGeometry,
    portalToken: "",
    portalAuthenticationType: "None",
  };

  yield* Effect.logInfo("cadastre dataset export request started");
  const Request = HttpClientRequest.post(config.ApiUrl, {
    headers: { accept: "application/json" },
  }).pipe(HttpClientRequest.bodyText(JSON.stringify(payload), "text/plain"));
  const Response = yield* HttpClient.execute(Request).pipe(
    Effect.mapError(
      () => new CadastreWorkflowHttpError({ message: "Dataset export request failed" }),
    ),
  );
  if (Response.status < 200 || Response.status >= 300) {
    yield* Effect.logWarning(`cadastre dataset export failed (status ${Response.status})`);
    return yield* Effect.fail(
      new CadastreWorkflowProviderError({
        message: `Cadastre export provider returned HTTP ${Response.status}`,
        status: Response.status,
        response: null,
      }),
    );
  }

  const Body = yield* Response.json.pipe(
    Effect.mapError(
      () => new CadastreWorkflowJsonError({ message: "Dataset export response was invalid" }),
    ),
  );
  const ProviderResponse = Schema.is(ProviderResponseSchema)(Body) ? Body : undefined;
  const ProviderRequestId =
    ProviderResponse?.requestId ?? ProviderResponse?.jobId ?? ProviderResponse?.id;
  yield* requests
    .markQueued(instance.executionId, ProviderRequestId)
    .pipe(
      Effect.mapError(
        () => new CadastreWorkflowDatabaseError({ message: "Dataset export request guard failed" }),
      ),
    );
  yield* Effect.logInfo(
    `cadastre dataset export queued (status ${Response.status}, provider id ${ProviderRequestId === undefined ? "none" : "present"})`,
  );
  return {
    requestedAt: DateTime.formatIso(requestedAt),
    emailAddress,
  } satisfies DatasetExportMetadata;
})();

/** Requests the provider to queue the configured Lot FileGDB export. */
export const RequestDatasetApiActivity = Activity.make({
  interruptRetryPolicy: activityInterruptRetryPolicy,
  name: "CadastreSyncWorkflow/request-dataset-api",
  success: DatasetExportMetadataSchema,
  error: CadastreActivityErrorSchema,
  execute: projectActivity(
    "request-dataset-api",
    RequestDatasetApiEffect.pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.mapError((error) =>
        error._tag === "ConfigError"
          ? new CadastreWorkflowConfigError({ message: "Dataset export configuration is invalid" })
          : error,
      ),
    ),
  ),
});
