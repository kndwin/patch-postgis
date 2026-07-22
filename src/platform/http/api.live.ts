import { Effect, Layer } from "effect";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";
import { AppApi } from "./api.define";
import { CadastreLive } from "../../module/cadastre/cadastre.http.live";

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
  Layer.provide(HttpApiScalar.layer(AppApi, { path: "/docs" })),
);
