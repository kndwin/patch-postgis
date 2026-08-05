import { BunCrypto } from "@effect/platform-bun";
import { Layer } from "effect";
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster";
import { PgClientLive } from "../../../platform/database/client";
import { CadastreSyncRuntimeLive } from "./cadastre-workflow.cron";

/** PostgreSQL-backed runtime for the single-process server deployment. */
export const CadastreWorkflowRuntimeLive = Layer.merge(
  CadastreSyncRuntimeLive,
  ClusterWorkflowEngine.layer,
).pipe(
  Layer.provide(SingleRunner.layer({ runnerStorage: "sql" })),
  Layer.provide(BunCrypto.layer),
  Layer.provide(PgClientLive),
);
