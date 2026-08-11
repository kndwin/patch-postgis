import { Cause, Duration, Effect, Exit, Metric } from "effect";

export type WorkflowOutcome = "succeeded" | "failed" | "cancelled";

const workflowStarted = Metric.counter("cadastre_workflow_started", {
  description: "Cadastre workflows started",
  incremental: true,
});
const workflowCompleted = Metric.counter("cadastre_workflow_completed", {
  description: "Cadastre workflows completed by outcome",
  incremental: true,
});
const workflowDuration = Metric.timer("cadastre_workflow_duration", {
  description: "Cadastre workflow duration",
});
const importLots = Metric.counter("cadastre_import_lots", {
  description: "Cadastre lots imported to staging",
  incremental: true,
});
const pmtilesBuildDuration = Metric.timer("cadastre_pmtiles_build_duration", {
  description: "Successful PMTiles build duration",
});
const pmtilesSize = Metric.histogram("cadastre_pmtiles_size_bytes", {
  description: "Successful PMTiles archive size",
  boundaries: [1_000_000, 10_000_000, 100_000_000, 500_000_000, 1_000_000_000, 2_000_000_000],
  attributes: { unit: "By" },
});
const publication = Metric.counter("cadastre_publication", {
  description: "Cadastre publication attempts by outcome",
  incremental: true,
});

export const recordWorkflowStarted = (trigger: "scheduled" | "manual" | "recovery") =>
  Metric.update(Metric.withAttributes(workflowStarted, { trigger }), 1);

export const recordWorkflowCompleted = (outcome: WorkflowOutcome, duration: Duration.Duration) =>
  Effect.all([
    Metric.update(Metric.withAttributes(workflowCompleted, { outcome }), 1),
    Metric.update(Metric.withAttributes(workflowDuration, { outcome }), duration),
  ]).pipe(Effect.asVoid);

export const workflowOutcome = <A, E>(exit: Exit.Exit<A, E>): WorkflowOutcome =>
  Exit.isSuccess(exit) ? "succeeded" : Cause.hasInterruptsOnly(exit.cause) ? "cancelled" : "failed";

export const recordImportedLots = (count: number) => Metric.update(importLots, count);

export const recordPmtilesBuilt = (duration: Duration.Duration, sizeBytes: number) =>
  Effect.all([
    Metric.update(pmtilesBuildDuration, duration),
    Metric.update(pmtilesSize, sizeBytes),
  ]).pipe(Effect.asVoid);

export const observePublication = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.onExit((exit) =>
      Metric.update(
        Metric.withAttributes(publication, {
          outcome: Exit.isSuccess(exit) ? "succeeded" : "failed",
        }),
        1,
      ),
    ),
  );
