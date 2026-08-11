import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  activityWorkflowStatus,
  attemptId,
  initialSteps,
  requireRunningExecution,
  safeActivityError,
  transitionSteps,
} from "./cadastre-workflow.repo";

describe("workflow projection pure transitions", () => {
  test("attempt IDs are stable and distinct", () => {
    expect(attemptId("execution", "upload", 1)).toBe(attemptId("execution", "upload", 1));
    expect(attemptId("execution", "upload", 1)).not.toBe(attemptId("execution", "upload", 2));
  });

  test("step transitions preserve the parser shape", () => {
    const running = transitionSteps(initialSteps("start"), "upload", "running", "running");
    const completed = transitionSteps(running, "upload", "completed", "finished");
    expect(completed.find((step) => step.name === "upload")).toEqual({
      name: "upload",
      status: "completed",
      startedAt: "running",
      finishedAt: "finished",
    });
  });

  test("activity errors are safe labels", () => {
    expect(safeActivityError()).toBe("Activity failed");
  });

  test("activity failures do not finalize the workflow", () => {
    expect(activityWorkflowStatus("failed")).toBe("running");
    expect(activityWorkflowStatus("completed")).toBe("running");
  });

  test("terminal workflow replay stops before pipeline evaluation", async () => {
    let evaluated = false;
    const exit = await Effect.runPromiseExit(
      requireRunningExecution("execution", { status: "succeeded" }).pipe(
        Effect.andThen(Effect.sync(() => void (evaluated = true))),
      ),
    );
    expect(exit._tag).toBe("Failure");
    expect(evaluated).toBe(false);
  });
});
