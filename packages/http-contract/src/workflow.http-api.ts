import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi";
import { ActivitySchema, ExecutionSchema, ScheduleSchema } from "./workflow.schema";

const query = { cursor: Schema.optional(Schema.String), limit: Schema.optional(Schema.String) };
const internalError = [HttpApiError.InternalServerErrorNoContent] as const;
const executionId = Schema.String;

export const workflowGroup = HttpApiGroup.make("workflow").add(
  HttpApiEndpoint.post("triggerCadastreSync", "/workflows/cadastre-sync", {
    headers: { authorization: Schema.String },
    payload: Schema.Struct({ idempotencyKey: Schema.optional(Schema.String) }),
    success: Schema.Struct({ executionId: Schema.String, idempotencyKey: Schema.String }),
    error: [
      HttpApiError.BadRequestNoContent,
      HttpApiError.UnauthorizedNoContent,
      HttpApiError.InternalServerErrorNoContent,
    ],
  }),
  HttpApiEndpoint.post("cancelWorkflow", "/workflows/:executionId/cancel", {
    headers: { authorization: Schema.String },
    params: { executionId },
    success: Schema.Struct({ executionId, status: Schema.Literal("cancelled") }),
    error: [
      HttpApiError.BadRequestNoContent,
      HttpApiError.UnauthorizedNoContent,
      HttpApiError.InternalServerErrorNoContent,
    ],
  }),
  HttpApiEndpoint.get("listWorkflows", "/workflows", {
    query,
    success: Schema.Struct({
      items: Schema.Array(ExecutionSchema),
      nextCursor: Schema.NullOr(Schema.String),
      totalCount: Schema.Number,
    }),
    error: internalError,
  }),
  HttpApiEndpoint.get("getWorkflow", "/workflows/:id", {
    params: { id: Schema.String },
    success: Schema.NullOr(
      Schema.Struct({ ...ExecutionSchema.fields, activities: Schema.Array(ActivitySchema) }),
    ),
    error: internalError,
  }),
  HttpApiEndpoint.get("listSchedules", "/schedules", {
    query,
    success: Schema.Struct({
      schedules: Schema.Array(ScheduleSchema),
      occurrences: Schema.Array(Schema.Unknown),
      nextCursor: Schema.NullOr(Schema.String),
    }),
    error: internalError,
  }),
);
