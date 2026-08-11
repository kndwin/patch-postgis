import * as Effect from "effect/Effect";
import { Diagnostic, Plugin, Rule, RuleContext } from "effect-oxlint";
import type { ESTree } from "effect-oxlint";

const hooks = new Set(["useState", "useReducer"]);

const isProductionModule = (filename: string) => {
  const normalized = filename.replaceAll("\\", "/");
  return normalized.includes("/src/module/") && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized);
};

export const noReactLocalState = Rule.define({
  name: "no-react-local-state",
  meta: Rule.meta({
    type: "problem",
    description: "Production browser modules keep interaction state in Effect machines",
  }),
  create: function* () {
    const context = yield* RuleContext;
    const directHooks = new Set<string>();
    const reactObjects = new Set<string>();

    if (!isProductionModule(context.filename)) return {};

    return {
      ImportDeclaration: (node: ESTree.Node) => {
        if (node.type !== "ImportDeclaration" || node.source.value !== "react") return Effect.void;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") {
            const imported =
              specifier.imported.type === "Identifier"
                ? specifier.imported.name
                : String(specifier.imported.value);
            if (hooks.has(imported)) directHooks.add(specifier.local.name);
          } else {
            reactObjects.add(specifier.local.name);
          }
        }
        return Effect.void;
      },
      CallExpression: (node: ESTree.Node) => {
        if (node.type !== "CallExpression") return Effect.void;
        const callee = node.callee;
        const direct = callee.type === "Identifier" && directHooks.has(callee.name);
        const member =
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          reactObjects.has(callee.object.name) &&
          ((callee.property.type === "Identifier" && hooks.has(callee.property.name)) ||
            (callee.computed &&
              callee.property.type === "Literal" &&
              hooks.has(String(callee.property.value))));
        return direct || member
          ? context.report(
              Diagnostic.make({
                node,
                message:
                  "Use an Effect Machine and AtomMachine instead of React local state in production browser modules.",
              }),
            )
          : Effect.void;
      },
    };
  },
});

export default Plugin.define({
  name: "browser-module-state",
  rules: { "no-react-local-state": noReactLocalState },
});
