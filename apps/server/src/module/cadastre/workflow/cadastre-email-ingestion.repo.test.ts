import { describe, expect, test } from "bun:test";
import { selectNewestTrustedCadastreEmail } from "./cadastre-email-ingestion.repo";

describe("selectNewestTrustedCadastreEmail", () => {
  test("skips a newer invalid provider row and selects the newest trusted export", () => {
    const newestInvalid = {
      extractedDownloadUrl: "https://www.spatial.nsw.gov.au/support",
      messageId: "provider-failure",
    };
    const valid = {
      extractedDownloadUrl: "https://portal.spatial.nsw.gov.au/exports/newer.zip",
      messageId: "valid-newer",
    };
    const olderValid = {
      extractedDownloadUrl: "https://portal.spatial.nsw.gov.au/exports/older.zip",
      messageId: "valid-older",
    };

    expect(
      selectNewestTrustedCadastreEmail([newestInvalid, valid, olderValid] as never)?.messageId,
    ).toBe(valid.messageId);
  });
});
