import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ExtractDownloadLinkActivity } from "./extract-download-link.activity";

const run = (parsedEmail: unknown) =>
  Effect.runPromise(
    ExtractDownloadLinkActivity({ parsedEmail }).execute as unknown as Effect.Effect<
      string,
      unknown,
      never
    >,
  );

describe("extract-download-link activity", () => {
  test("extracts a decoded URL from an HTML anchor", async () => {
    expect(
      await run({
        html: '<a href="https://portal.spatial.nsw.gov.au/exports/cadastre.zip?sig=a&amp;x=1">download</a>',
      }),
    ).toBe("https://portal.spatial.nsw.gov.au/exports/cadastre.zip?sig=a&x=1");
  });

  test("extracts a URL from plain text", async () => {
    expect(
      await run({ text: "Your file is https://portal.spatial.nsw.gov.au/exports/latest.ZIP" }),
    ).toBe("https://portal.spatial.nsw.gov.au/exports/latest.ZIP");
  });

  test.each([
    "https://spatial.nsw.gov.au/exports/file.zip",
    "https://portal.spatial.nsw.gov.au.evil.test/exports/file.zip",
    "http://portal.spatial.nsw.gov.au/exports/file.zip",
    "https://portal.spatial.nsw.gov.au:444/exports/file.zip",
    "https://portal.spatial.nsw.gov.au/downloads/file.zip",
    "https://portal.spatial.nsw.gov.au/exports/file.tar.gz",
  ])("rejects invalid URL %s", async (url) => {
    try {
      await run({ text: url });
      throw new Error("expected extraction to fail");
    } catch (error) {
      expect(String(error)).toContain("No valid cadastre download URL");
    }
  });

  test.each([undefined, null, {}, { text: 42 }, { html: null }])(
    "rejects malformed parsed email %#",
    async (parsedEmail) => {
      try {
        await run(parsedEmail);
        throw new Error("expected extraction to fail");
      } catch (error) {
        expect(String(error)).toMatch(/Invalid parsed email shape|no text or html/);
      }
    },
  );
});
