import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

const domain = "decoco.work";
const address = "cadastre-export-staging@decoco.work";

export default Alchemy.Stack(
  "patch-postgis-email-staging",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const archive = yield* Cloudflare.R2.Bucket("CadastreEmailArchive", {
      name: "patch-postgis-cadastre-email-staging",
      locationHint: "apac",
    });

    const worker = yield* Cloudflare.Worker("CadastreEmailWorker", {
      name: "cadastre-email-staging",
      main: "apps/server/src/platform/cloudflare/email/email.worker-handler.ts",
      env: {
        EMAIL_ARCHIVE: archive,
        CADASTRE_INGESTION_URL:
          process.env.CADASTRE_INGESTION_URL ?? "http://localhost:3000/email-ingestions",
        CADASTRE_INGESTION_TOKEN: process.env.CADASTRE_INGESTION_TOKEN ?? "",
      },
      compatibility: { date: "2026-08-04" },
      observability: {
        enabled: true,
        headSamplingRate: 1,
        logs: { enabled: true, invocationLogs: true },
        traces: { enabled: true, headSamplingRate: 1, persist: true },
      },
    });

    const rule = yield* Cloudflare.Email.Rule("CadastreEmailRoute", {
      zone: domain,
      name: "Cadastre export staging inbox",
      priority: 0,
      matchers: [{ type: "literal", field: "to", value: address }],
      actions: [{ type: "worker", value: ["cadastre-email-staging"] }],
    });

    return {
      archive: archive.bucketName,
      worker: "cadastre-email-staging",
      rule: rule.ruleId,
      address,
    };
  }),
);
