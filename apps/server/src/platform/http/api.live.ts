import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";
import { AppApi } from "@patch/http-contract";
import { CadastreLive } from "../../module/cadastre/lot/lot.http-api.live";
import { WorkflowLive } from "../../module/cadastre/workflow/cadastre-workflow.http-api.live";
import { CadastreEmailIngestionServiceLive } from "../../module/cadastre/workflow/cadastre-email-ingestion.service";

const SystemLive = HttpApiBuilder.group(AppApi, "system", (handlers) =>
  handlers.handle("health", () =>
    Effect.succeed({ status: "ok" } satisfies { readonly status: "ok" }),
  ),
);

export const ApiLive = HttpApiBuilder.layer(AppApi, {
  openapiPath: "/openapi.json",
}).pipe(
  Layer.provide(SystemLive),
  Layer.provide(CadastreLive),
  Layer.provide(WorkflowLive),
  Layer.provide(CadastreEmailIngestionServiceLive),
  Layer.provide(HttpApiScalar.layer(AppApi, { path: "/docs" })),
);
