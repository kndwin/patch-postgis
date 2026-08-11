import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow";
import { activityInterruptRetryPolicy } from "./activity/activity-options.activity";
import { WorkflowProjectionRepo } from "./cadastre-workflow.repo";
import { projectActivity } from "./workflow-projection.activity";

const TestWorkflow = Workflow.make("ProjectionReplayTest", {
  payload: Schema.Struct({}),
  success: Schema.Void,
  idempotencyKey: () => "projection-replay-test",
});

describe("workflow projection replay safety", () => {
  test.each([null, { status: "succeeded", steps: [], activities: [] }])(
    "missing or terminal activity replay does not evaluate side effects",
    async (execution) => {
      let bodyEvaluations = 0;
      let activityStarts = 0;
      const repo = WorkflowProjectionRepo.of({
        detail: () => Effect.succeed(execution),
        startActivity: () => Effect.sync(() => void (activityStarts += 1)),
      } as never);
      const exit = await Effect.runPromiseExit(
        projectActivity(
          "test",
          Effect.sync(() => void (bodyEvaluations += 1)),
        ).pipe(
          Effect.provideService(WorkflowProjectionRepo, repo),
          Effect.provideService(
            WorkflowEngine.WorkflowInstance,
            WorkflowEngine.WorkflowInstance.initial(TestWorkflow, "execution"),
          ),
        ),
      );
      expect(exit._tag).toBe("Failure");
      expect(activityStarts).toBe(0);
      expect(bodyEvaluations).toBe(0);
    },
  );

  test("shared interruption policy performs zero retries", async () => {
    let evaluations = 0;
    const activity = Activity.make({
      name: "ProjectionReplayTest/no-interrupt-retry",
      execute: Effect.sync(() => void (evaluations += 1)).pipe(Effect.andThen(Effect.interrupt)),
      interruptRetryPolicy: activityInterruptRetryPolicy,
    });
    const exit = await Effect.runPromiseExit(
      activity.execute as unknown as Effect.Effect<void, never, never>,
    );
    expect(exit._tag).toBe("Failure");
    expect(evaluations).toBe(1);
  });
});
