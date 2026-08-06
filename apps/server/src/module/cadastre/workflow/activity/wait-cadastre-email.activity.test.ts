/* oxlint-disable no-explicit-any -- Effect's polymorphic test seams require an erased environment. */
import { describe, expect, test } from "bun:test";
import { DateTime, Effect, Layer, Schema } from "effect";
import { Workflow, WorkflowEngine } from "effect/unstable/workflow";
import { CadastreEmailIngestionService } from "../cadastre-email-ingestion.service";
import { WaitCadastreEmailSuccessSchema } from "./wait-cadastre-email.activity.schema";
import {
  lookupCadastreEmailActivity,
  WaitCadastreEmailActivity,
  type CadastreEmailWaitInput,
} from "./wait-cadastre-email.activity";

const input: CadastreEmailWaitInput = {
  requestedAt: "2026-08-05T00:00:00.000Z",
  emailAddress: "cadastre@example.test",
};

const row = {
  messageId: "message-1",
  receivedAt: DateTime.toDate(DateTime.makeUnsafe("2026-08-05T00:01:00.000Z")),
  parsedEmail: { text: "export body", html: "<p>export body</p>" },
};

const serviceLayer = (findNewestAfter: CadastreEmailIngestionService["findNewestAfter"]) =>
  Layer.succeed(CadastreEmailIngestionService, {
    ingest: (() => Effect.die("unused")) as never,
    findNewestAfter,
  } as never);

const runActivity = <A, E>(
  activity: { readonly execute: Effect.Effect<A, E, any> },
  layer: Layer.Layer<any>,
) => Effect.runPromise((activity.execute as Effect.Effect<A, E, any>).pipe(Effect.provide(layer)));

describe("lookupCadastreEmailActivity", () => {
  test("returns the newest matching row in the durable result shape", async () => {
    const result = await runActivity(
      lookupCadastreEmailActivity(input, 0),
      serviceLayer(
        (() => Effect.succeed(row) as never) as CadastreEmailIngestionService["findNewestAfter"],
      ),
    );
    expect(result).toEqual({
      messageId: row.messageId,
      receivedAt: row.receivedAt.toISOString(),
      parsedEmail: row.parsedEmail,
    });
  });

  test("returns null when no matching row exists", async () => {
    const result = await runActivity(
      lookupCadastreEmailActivity(input, 1),
      serviceLayer(
        (() => Effect.succeed(null) as never) as CadastreEmailIngestionService["findNewestAfter"],
      ),
    );
    expect(result).toBeNull();
  });

  test("maps a typed database failure to CadastreEmailLookupError", async () => {
    const result = await Effect.runPromiseExit(
      (lookupCadastreEmailActivity(input, 0).execute as Effect.Effect<any, any, any>).pipe(
        Effect.provide(
          serviceLayer(
            (() =>
              Effect.fail(
                new Error("database unavailable"),
              ) as never) as CadastreEmailIngestionService["findNewestAfter"],
          ),
        ),
      ) as any,
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure")
      expect(String(result.cause)).toContain("CadastreEmailLookupError");
  });

  test("uses deterministic names for poll activities", () => {
    expect(lookupCadastreEmailActivity(input, 3).name).toBe(
      "CadastreSyncWorkflow/wait-cadastre-email/2026-08-05T00%3A00%3A00.000Z/cadastre%40example.test/3",
    );
  });
});

const MemoryWaitWorkflow = Workflow.make("MemoryWaitWorkflow", {
  payload: Schema.Struct({ request: Schema.String }),
  success: WaitCadastreEmailSuccessSchema,
  error: Schema.Unknown,
  idempotencyKey: (payload) => payload.request,
});

describe("wait activity with the in-memory workflow engine", () => {
  test("executes the workflow boundary without a real clock or database", async () => {
    const workflowLayer = MemoryWaitWorkflow.toLayer(
      () =>
        WaitCadastreEmailActivity.execute(input, { pollCount: 1 }) as Effect.Effect<
          {
            readonly messageId: string;
            readonly receivedAt: string;
            readonly parsedEmail: unknown;
          },
          unknown,
          never
        >,
    );
    const result = await Effect.runPromise(
      MemoryWaitWorkflow.execute({ request: "resume-test" }).pipe(
        Effect.provide(
          Layer.mergeAll(
            WorkflowEngine.layerMemory,
            workflowLayer.pipe(Layer.provide(WorkflowEngine.layerMemory)),
            serviceLayer(
              (() =>
                Effect.succeed(row) as never) as CadastreEmailIngestionService["findNewestAfter"],
            ),
          ),
        ),
      ),
    );
    expect(result).toEqual({
      messageId: row.messageId,
      receivedAt: row.receivedAt.toISOString(),
      parsedEmail: row.parsedEmail,
    });
  });
});
