import { BunCrypto } from "@effect/platform-bun";
import { Layer } from "effect";
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster";
import { PgClientLive } from "../../../platform/database/client";
import { CadastreSyncRuntimeLive } from "./cadastre-workflow.cron";

/** PostgreSQL-backed runtime for the single-process server deployment. */
const SingleRunnerLive = SingleRunner.layer({ runnerStorage: "sql" }).pipe(
  Layer.provide(BunCrypto.layer),
  Layer.provide(PgClientLive),
);

const WorkflowEngineLive = ClusterWorkflowEngine.layer.pipe(Layer.provideMerge(SingleRunnerLive));

export const CadastreWorkflowRuntimeLive = CadastreSyncRuntimeLive.pipe(
  Layer.provide(WorkflowEngineLive),
);
