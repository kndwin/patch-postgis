import { describe, expect, test } from "bun:test";
import * as Testing from "effect-oxlint/testing";
import { noReactLocalState } from "./module-state.lint";

const filename = "/workspace/apps/browser/src/module/example/example.tsx";
const identifier = (name: string) => ({ type: "Identifier", name });
const source = { type: "Literal", value: "react" };

describe("no React local state lint rule", () => {
  test("reports named and aliased React hook imports", () => {
    const diagnostics = Testing.runRuleMulti(
      noReactLocalState,
      [
        [
          "ImportDeclaration",
          {
            type: "ImportDeclaration",
            source,
            specifiers: [
              {
                type: "ImportSpecifier",
                imported: identifier("useState"),
                local: identifier("localState"),
              },
            ],
          },
        ],
        ["CallExpression", Testing.callExpr("localState")],
      ],
      { filename },
    );
    expect(diagnostics).toHaveLength(1);
  });

  test("reports default and namespace React member calls", () => {
    for (const specifierType of ["ImportDefaultSpecifier", "ImportNamespaceSpecifier"]) {
      const diagnostics = Testing.runRuleMulti(
        noReactLocalState,
        [
          [
            "ImportDeclaration",
            {
              type: "ImportDeclaration",
              source,
              specifiers: [{ type: specifierType, local: identifier("ReactAlias") }],
            },
          ],
          ["CallExpression", Testing.callOfMember("ReactAlias", "useReducer")],
        ],
        { filename },
      );
      expect(diagnostics).toHaveLength(1);
    }
  });

  test("allows unrelated functions and test files", () => {
    const unrelated = Testing.runRuleMulti(
      noReactLocalState,
      [["CallExpression", Testing.callExpr("useState")]],
      { filename },
    );
    const testFile = Testing.runRuleMulti(
      noReactLocalState,
      [["CallExpression", Testing.callOfMember("React", "useState")]],
      { filename: `${filename.slice(0, -4)}.test.tsx` },
    );
    expect(unrelated).toHaveLength(0);
    expect(testFile).toHaveLength(0);
  });
});
