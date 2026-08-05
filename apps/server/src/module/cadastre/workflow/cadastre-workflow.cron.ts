import { Cron, DateTime, Effect, Layer } from "effect";
import { ClusterCron } from "effect/unstable/cluster";
import { CadastreSyncWorkflow, CadastreSyncWorkflowLive } from "./cadastre-workflow.workflow";

export const CadastreSyncClusterCronLive = ClusterCron.make({
  name: "cadastre-sync-daily",
  cron: Cron.parseUnsafe("0 0 2 * * *", "Australia/Sydney"),
  execute: Effect.fn("CadastreSyncClusterCronLive.execute")(function* () {
    yield* CadastreSyncWorkflow.execute(
      {
        idempotencyKey: `scheduled-${DateTime.formatIso(yield* DateTime.now).slice(0, 10)}`,
        trigger: "scheduled",
      },
      { discard: true },
    );
  })(),
});

export const CadastreSyncRuntimeLive = Layer.merge(
  CadastreSyncWorkflowLive,
  CadastreSyncClusterCronLive,
);

export const cadastreSyncCron = {
  id: "cadastre-sync-daily",
  expression: "0 0 2 * * *",
  timezone: "Australia/Sydney",
  workflowName: "CadastreSyncWorkflow",
} as const;
