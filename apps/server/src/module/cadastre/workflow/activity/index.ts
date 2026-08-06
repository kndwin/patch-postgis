export { BuildPmtilesActivity } from "./build-pmtiles.activity";
export { DownloadGdbActivity } from "./download-gdb.activity";
export { ExtractDownloadLinkActivity } from "./extract-download-link.activity";
export { ImportPostgisActivity } from "./import-postgis.activity";
export { RequestDatasetApiActivity, RequestDatasetApiEffect } from "./request-dataset-api.activity";
export type { DatasetExportMetadata } from "./request-dataset-api.activity";
export { UploadActivity } from "./upload.activity";
export { ValidatePromoteActivity } from "./validate-promote.activity";
export { VerifyPublishActivity } from "./verify-publish.activity";
export { WaitCadastreEmailActivity } from "./wait-cadastre-email.activity";
export type { CadastreEmailWaitInput } from "./wait-cadastre-email.activity";
export {
  CadastreActivityErrorSchema,
  CadastreWorkflowConfigError,
  CadastreWorkflowHttpError,
  CadastreWorkflowJsonError,
  CadastreWorkflowNotImplemented,
  CadastreWorkflowPostgisError,
  CadastreWorkflowProviderError,
  CadastreDownloadLinkError,
} from "./cadastre-workflow-error.schema";

export const ActivityNames = [
  "request-dataset-api",
  "wait-cadastre-email/*",
  "extract-download-link",
  "download-gdb",
  "import-postgis",
  "validate-promote",
  "build-pmtiles",
  "upload",
  "verify-publish",
] as const;
export type ActivityName = (typeof ActivityNames)[number];
