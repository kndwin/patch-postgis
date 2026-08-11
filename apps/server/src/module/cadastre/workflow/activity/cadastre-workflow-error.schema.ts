import { Schema } from "effect";

export class CadastreWorkflowConfigError extends Schema.TaggedError<CadastreWorkflowConfigError>()(
  "CadastreWorkflowConfigError",
  { message: Schema.String },
) {}

export class CadastreWorkflowHttpError extends Schema.TaggedError<CadastreWorkflowHttpError>()(
  "CadastreWorkflowHttpError",
  { message: Schema.String },
) {}

export class CadastreWorkflowDatabaseError extends Schema.TaggedError<CadastreWorkflowDatabaseError>()(
  "CadastreWorkflowDatabaseError",
  { message: Schema.String },
) {}

export class CadastreWorkflowJsonError extends Schema.TaggedError<CadastreWorkflowJsonError>()(
  "CadastreWorkflowJsonError",
  { message: Schema.String },
) {}

export class CadastreWorkflowProviderError extends Schema.TaggedError<CadastreWorkflowProviderError>()(
  "CadastreWorkflowProviderError",
  { message: Schema.String, status: Schema.Number, response: Schema.Unknown },
) {}

export class CadastreWorkflowNotImplemented extends Schema.TaggedError<CadastreWorkflowNotImplemented>()(
  "CadastreWorkflowNotImplemented",
  { activity: Schema.String, message: Schema.String },
) {}

export class CadastreDownloadLinkError extends Schema.TaggedError<CadastreDownloadLinkError>()(
  "CadastreDownloadLinkError",
  { message: Schema.String },
) {}
export class CadastreWorkflowPostgisError extends Schema.TaggedError<CadastreWorkflowPostgisError>()(
  "CadastreWorkflowPostgisError",
  { message: Schema.String },
) {}
export class CadastreWorkflowPmtilesError extends Schema.TaggedError<CadastreWorkflowPmtilesError>()(
  "CadastreWorkflowPmtilesError",
  { message: Schema.String },
) {}

export const CadastreActivityErrorSchema = Schema.Union([
  CadastreWorkflowConfigError,
  CadastreWorkflowHttpError,
  CadastreWorkflowDatabaseError,
  CadastreWorkflowJsonError,
  CadastreWorkflowProviderError,
  CadastreWorkflowNotImplemented,
  CadastreDownloadLinkError,
  CadastreWorkflowPostgisError,
  CadastreWorkflowPmtilesError,
]);
