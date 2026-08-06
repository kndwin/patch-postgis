import { describe, expect, it } from "bun:test";
import { DateTime, Effect } from "effect";
import {
  existingExportRequestClaim,
  exportRequestShouldSend,
  type ExportRequestClaim,
} from "./request-dataset-api.repo";

const now = DateTime.toDate(DateTime.makeUnsafe("2026-08-07T00:00:00.000Z"));
const request = {
  executionId: "execution-1",
  requestedAt: now,
  emailAddress: "cadastre@example.test",
  status: "requesting" as const,
  providerRequestId: null,
  createdAt: now,
  updatedAt: now,
};

describe("cadastre export request claim", () => {
  it("lets the insert winner send exactly once", () => {
    expect(exportRequestShouldSend({ claimed: true, request })).toBe(true);
  });

  it("reuses an existing claim without sending HTTP", () => {
    const claim: ExportRequestClaim = { claimed: false, request };
    expect(exportRequestShouldSend(claim)).toBe(false);
  });

  it("fails safely when the conflict row is unexpectedly absent", async () => {
    const exit = await Effect.runPromiseExit(existingExportRequestClaim(undefined));
    expect(exit._tag).toBe("Failure");
  });
});
