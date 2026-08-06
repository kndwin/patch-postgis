import { Cause, DateTime, Effect, Option } from "effect";
import { Activity } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow";
import {
  WorkflowProjectionRepo,
  activityWorkflowStatus,
  attemptId,
  safeActivityError,
  transitionSteps,
} from "./cadastre-workflow.repo";

/** Keeps projection writes inside the Activity execution context. */
export const projectActivity = <A, E, R>(
  name: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | WorkflowProjectionRepo | WorkflowEngine.WorkflowInstance> =>
  Effect.fn(`CadastreSyncWorkflow.project.${name}`)(function* () {
    const repoOption = yield* Effect.serviceOption(WorkflowProjectionRepo);
    if (Option.isNone(repoOption)) return yield* effect;
    const repo = repoOption.value;
    const instance = yield* WorkflowEngine.WorkflowInstance;
    const attempt = yield* Activity.CurrentAttempt;
    const id = attemptId(instance.executionId, name, attempt);
    const startedAt = yield* DateTime.now;
    yield* repo.startActivity({
      id,
      executionId: instance.executionId,
      activityName: name,
      attempt,
      startedAt: DateTime.toDate(startedAt),
    });
    const startedExecution = yield* repo.detail(instance.executionId);
    if (startedExecution)
      yield* repo.updateWorkflow({
        id: instance.executionId,
        status: "running",
        steps: transitionSteps(startedExecution.steps ?? [], name, "running", startedAt.toString()),
      });

    const update = (status: "completed" | "failed", error?: string) =>
      Effect.fn(`CadastreSyncWorkflow.project.${name}.${status}`)(function* () {
        const finishedAt = yield* DateTime.now;
        yield* repo.finishActivity({ id, status, finishedAt: DateTime.toDate(finishedAt), error });
        const execution = yield* repo.detail(instance.executionId);
        if (execution) {
          yield* repo.updateWorkflow({
            id: instance.executionId,
            status: activityWorkflowStatus(status),
            steps: transitionSteps(execution.steps ?? [], name, status, finishedAt.toString()),
            ...(status === "failed" ? { failedStep: name, error: safeActivityError() } : {}),
          });
        }
      })();

    return yield* Effect.matchCauseEffect(effect, {
      onSuccess: (value) => update("completed").pipe(Effect.as(value)),
      onFailure: (cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : update("failed", safeActivityError()).pipe(Effect.andThen(Effect.failCause(cause))),
    });
  })() as unknown as Effect.Effect<
    A,
    E,
    R | WorkflowProjectionRepo | WorkflowEngine.WorkflowInstance
  >;
