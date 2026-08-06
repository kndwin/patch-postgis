import { BunCrypto } from "@effect/platform-bun";
import { Layer } from "effect";
import { ClusterWorkflowEngine, SingleRunner } from "effect/unstable/cluster";
import { PgClientLive } from "../../../platform/database/client";
import { DbLive } from "../../../platform/database/client";
import { CadastreSyncService } from "../sync/cadastre-sync.service";
import { CadastreSyncRuntimeLive } from "./cadastre-workflow.cron";
import { CadastreExportRequestRepoLive } from "./activity/request-dataset-api.repo";

/** PostgreSQL-backed runtime for the single-process server deployment. */
const SingleRunnerLive = SingleRunner.layer({ runnerStorage: "sql" }).pipe(
  Layer.provide(BunCrypto.layer),
  Layer.provide(PgClientLive),
);

const WorkflowEngineLive = ClusterWorkflowEngine.layer.pipe(Layer.provideMerge(SingleRunnerLive));

export const CadastreWorkflowRuntimeLive = CadastreSyncRuntimeLive.pipe(
  Layer.provideMerge(WorkflowEngineLive),
  Layer.provideMerge(DbLive),
  Layer.provideMerge(CadastreExportRequestRepoLive),
  Layer.provide(
    Layer.effect(CadastreSyncService, CadastreSyncService.make).pipe(Layer.provide(DbLive)),
  ),
);
