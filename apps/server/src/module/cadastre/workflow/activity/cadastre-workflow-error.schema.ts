import { Schema } from "effect";

export class CadastreWorkflowConfigError extends Schema.TaggedErrorClass<CadastreWorkflowConfigError>()(
  "CadastreWorkflowConfigError",
  { message: Schema.String },
) {}

export class CadastreWorkflowHttpError extends Schema.TaggedErrorClass<CadastreWorkflowHttpError>()(
  "CadastreWorkflowHttpError",
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

export const CadastreActivityErrorSchema = Schema.Union([
  CadastreWorkflowConfigError,
  CadastreWorkflowHttpError,
  CadastreWorkflowJsonError,
  CadastreWorkflowProviderError,
  CadastreWorkflowNotImplemented,
]);
