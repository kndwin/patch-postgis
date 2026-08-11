import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Config, Effect, Layer } from "effect";
import { HttpMiddleware, HttpRouter } from "effect/unstable/http";
import { ApiLive } from "./platform/http/api.live";
import { CorsLive } from "./platform/http/cors";
import { CadastreService } from "./module/cadastre/lot/lot.service";
import { DbLive } from "./platform/database/client";
import { CadastreStatusService } from "./module/cadastre/sync/cadastre-sync-status.service";
import { WorkflowProjectionLive } from "./module/cadastre/workflow/cadastre-workflow.service";
import { CadastreEmailIngestionServiceLive } from "./module/cadastre/workflow/cadastre-email-ingestion.service";
import { CadastreWorkflowRuntimeLive } from "./module/cadastre/workflow/cadastre-workflow.runtime.live";
import { ObservabilityLive } from "./platform/observability/observability.live";

const ServerLive = Layer.unwrap(
  Effect.fn("ServerLive")(function* () {
    const port = yield* Config.number("PORT").pipe(Config.withDefault(3000));

    return HttpRouter.serve(Layer.merge(ApiLive, CorsLive), {
      middleware: HttpMiddleware.tracer,
    }).pipe(
      Layer.provide(BunHttpServer.layer({ port })),
      Layer.provide(
        Layer.merge(
          Layer.effect(CadastreService)(CadastreService.make),
          Layer.effect(CadastreStatusService)(CadastreStatusService.make),
        ).pipe(
          Layer.provide(DbLive),
          Layer.merge(WorkflowProjectionLive),
          Layer.merge(CadastreEmailIngestionServiceLive),
        ),
      ),
    );
  })(),
);

BunRuntime.runMain(
  Layer.launch(ServerLive).pipe(
    Effect.provide(CadastreWorkflowRuntimeLive),
    Effect.provide(ObservabilityLive),
  ) as Effect.Effect<never, unknown, never>,
);
