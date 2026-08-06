import { Schema } from "effect";

export class CadastreWorkflowConfigError extends Schema.TaggedErrorClass<CadastreWorkflowConfigError>()(
  "CadastreWorkflowConfigError",
  { message: Schema.String },
) {}

export class CadastreWorkflowHttpError extends Schema.TaggedErrorClass<CadastreWorkflowHttpError>()(
  "CadastreWorkflowHttpError",
  { message: Schema.String },
) {}

export class CadastreWorkflowDatabaseError extends Schema.TaggedErrorClass<CadastreWorkflowDatabaseError>()(
  "CadastreWorkflowDatabaseError",
  { message: Schema.String },
) {}

export class CadastreWorkflowJsonError extends Schema.TaggedErrorClass<CadastreWorkflowJsonError>()(
  "CadastreWorkflowJsonError",
  { message: Schema.String },
) {}

export class CadastreWorkflowProviderError extends Schema.TaggedErrorClass<CadastreWorkflowProviderError>()(
  "CadastreWorkflowProviderError",
  { message: Schema.String, status: Schema.Number, response: Schema.Unknown },
) {}

export class CadastreWorkflowNotImplemented extends Schema.TaggedErrorClass<CadastreWorkflowNotImplemented>()(
  "CadastreWorkflowNotImplemented",
  { activity: Schema.String, message: Schema.String },
) {}

export class CadastreDownloadLinkError extends Schema.TaggedErrorClass<CadastreDownloadLinkError>()(
  "CadastreDownloadLinkError",
  { message: Schema.String },
) {}
export class CadastreWorkflowPostgisError extends Schema.TaggedErrorClass<CadastreWorkflowPostgisError>()(
  "CadastreWorkflowPostgisError",
  { message: Schema.String },
) {}
export class CadastreWorkflowPmtilesError extends Schema.TaggedErrorClass<CadastreWorkflowPmtilesError>()(
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
