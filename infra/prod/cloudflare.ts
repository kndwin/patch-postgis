import * as Alchemy from "alchemy";
import * as State from "alchemy/State";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect } from "effect";

const domain = "decoco.work";
const address = "cadastre-export@decoco.work";

export default Alchemy.Stack(
  "patch-postgis",
  {
    providers: Cloudflare.providers(),
    state: State.localState(),
  },
  Effect.gen(function* () {
    const emailArchive = yield* Cloudflare.R2.Bucket("CadastreEmailArchive", {
      name: "patch-postgis-cadastre-email",
      locationHint: "apac",
    });

    const tiles = yield* Cloudflare.R2.Bucket("Tiles", {
      name: "patch-postgis-tiles",
      locationHint: "apac",
      cors: [
        {
          allowedOrigins: ["*"],
          allowedMethods: ["GET", "HEAD"],
          allowedHeaders: ["Range"],
          exposeHeaders: ["Accept-Ranges", "Content-Length", "Content-Range", "ETag"],
          maxAgeSeconds: 86_400,
        },
      ],
    });

    const site = yield* Cloudflare.Website.StaticSite("Site", {
      cwd: "apps/browser",
      command: "sh build-site.sh",
      outdir: "dist",
      assets: { notFoundHandling: "single-page-application" },
      memo: { include: ["apps/browser/**", "packages/http-contract/**"], lockfile: true },
    });

    const emailWorker = yield* Cloudflare.Worker("CadastreEmailWorker", {
      name: "cadastre-email",
      main: "apps/server/src/platform/cloudflare/email/email.worker-handler.ts",
      env: {
        EMAIL_ARCHIVE: emailArchive,
        CADASTRE_INGESTION_URL: yield* Config.redacted("CADASTRE_INGESTION_URL").pipe(
          Config.withDefault("https://app-production-5c3a.up.railway.app/email-ingestions"),
        ),
        CADASTRE_INGESTION_TOKEN: yield* Config.redacted("CADASTRE_INGESTION_TOKEN").pipe(
          Config.withDefault(""),
        ),
      },
      compatibility: { date: "2026-08-04" },
      observability: {
        enabled: true,
        headSamplingRate: 1,
        logs: { enabled: true, invocationLogs: true },
        traces: { enabled: true, headSamplingRate: 1, persist: true },
      },
    });

    const emailRule = yield* Cloudflare.Email.Rule("CadastreEmailRoute", {
      zone: domain,
      name: "Cadastre export production inbox",
      priority: 0,
      matchers: [{ type: "literal", field: "to", value: address }],
      actions: [{ type: "worker", value: ["cadastre-email"] }],
    });

    const tileWorker = yield* Cloudflare.Worker("TileWorker", {
      name: "tile-worker",
      main: "apps/server/src/platform/cloudflare/tiles/tiles.worker-handler.ts",
      env: { TILES: tiles },
      compatibility: { date: "2026-08-04" },
      observability: {
        enabled: true,
        headSamplingRate: 1,
        logs: { enabled: true, invocationLogs: true },
        traces: { enabled: true, headSamplingRate: 1, persist: true },
      },
    });

    return {
      siteUrl: site.url,
      tileUrl: tileWorker.url,
      bucket: tiles.bucketName,
      emailArchive: emailArchive.bucketName,
      emailWorker: emailWorker.workerName,
      emailRule: emailRule.ruleId,
      emailAddress: address,
    };
  }),
);
