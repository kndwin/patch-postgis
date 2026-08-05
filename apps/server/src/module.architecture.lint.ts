import * as Effect from "effect/Effect";
import { Diagnostic, Plugin, Rule, RuleContext } from "effect-oxlint";
import type { ESTree } from "effect-oxlint";

const concerns = new Set(["lot", "sync", "workflow"]);
const allowed =
  /\.(model|schema|service|repo|activity|workflow|cron|arcgis|define|live|cli|test)\.ts$|\.http-api\.(schema|define|live|test)\.ts$|^index\.ts$/;

const relativeModulePath = (filename: string): string | undefined => {
  const normalized = filename.replaceAll("\\", "/");
  const marker = "/src/module/";
  const index = normalized.lastIndexOf(marker);
  return index === -1 ? undefined : normalized.slice(index + marker.length);
};

const moduleArchitecture = Rule.define({
  name: "module-architecture",
  meta: Rule.meta({
    type: "problem",
    description: "Enforce concern-oriented module filenames and folders",
  }),
  // effect-oxlint currently publishes its Rule.create type against a different
  // Effect beta than this application; the runtime contract is identical.
  // @ts-expect-error beta peer typing mismatch
  create: function* () {
    const context = yield* RuleContext;

    return {
      Program: (node: ESTree.Program) => {
        const path = relativeModulePath(context.filename);
        if (!path || path.endsWith(".lint.ts")) return Effect.void;

        const parts = path.split("/");
        const moduleName = parts[0];
        const concern = parts[1];
        const filename = parts.at(-1) ?? "";

        if (moduleName === "cadastre" && parts.length < 3) {
          return context.report(
            Diagnostic.make({
              node,
              message: "Module files must live inside a concern folder.",
            }),
          );
        }
        if (moduleName === "cadastre" && concern && !concerns.has(concern)) {
          return context.report(
            Diagnostic.make({
              node,
              message: `Unknown cadastre concern folder: ${concern}.`,
            }),
          );
        }
        if (!allowed.test(filename)) {
          return context.report(
            Diagnostic.make({
              node,
              message: "Module files must use an approved concern suffix.",
            }),
          );
        }
        return Effect.void;
      },
    };
  },
});

const noEffectGen = Rule.banCallOfMember("Effect", ["gen"], {
  message: "Use a named Effect.fn instead of Effect.gen so the effect is traceable.",
});
const noNewDate = Rule.banNewExpr("Date", {
  message: "Use Effect DateTime instead of new Date.",
});

export default Plugin.define({
  name: "module-architecture",
  rules: {
    "module-suffixes": moduleArchitecture,
    "no-effect-gen": noEffectGen,
    "no-new-date": noNewDate,
  },
});
