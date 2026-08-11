import { describe, expect, test } from "bun:test";
import { Cause } from "effect";
import { safeWorkflowExecuteCause } from "./cadastre-workflow-logging.service";

describe("workflow execute logging", () => {
  test("records cause structure without serializing error details", () => {
    const sensitive = "https://example.invalid/source?objectKey=runs/private&token=secret";
    const annotations = safeWorkflowExecuteCause(Cause.die(new Error(sensitive)));

    expect(annotations).toEqual({
      "cause.reason_count": 1,
      "cause.reason_tags": "Die",
      "cause.error_labels": "Error",
    });
    expect(JSON.stringify(annotations)).not.toContain(sensitive);
  });

  test("does not accept arbitrary tagged values as labels", () => {
    const sensitive = "https://example.invalid/private";
    const annotations = safeWorkflowExecuteCause(Cause.fail({ _tag: sensitive }));

    expect(annotations["cause.error_labels"]).toBe("object");
    expect(JSON.stringify(annotations)).not.toContain(sensitive);
  });
});
