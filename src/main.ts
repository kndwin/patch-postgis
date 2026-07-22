import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { ApiLive } from "./platform/http/api.live";
import { CadastreService } from "./module/cadastre/cadastre.service";
import { DbLive } from "./platform/db/client";

const port = Number(process.env.PORT ?? 3000);

const ServerLive = HttpRouter.serve(ApiLive).pipe(
  Layer.provide(BunHttpServer.layer({ port })),
  Layer.provide(
    Layer.effect(CadastreService)(CadastreService.make).pipe(
      Layer.provide(DbLive),
    ),
  ),
);

BunRuntime.runMain(Layer.launch(ServerLive));
