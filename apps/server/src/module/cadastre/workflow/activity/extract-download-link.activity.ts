import { Effect, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import { projectActivity } from "../workflow-projection.activity";
import { activityInterruptRetryPolicy } from "./activity-options.activity";
import {
  CadastreActivityErrorSchema,
  CadastreDownloadLinkError,
} from "./extract-download-link.activity.schema";

const inputSchema = Schema.Struct({ parsedEmail: Schema.Unknown });

export const extractDownloadLink = Effect.fn("CadastreSyncWorkflow.extract-download-link")(
  function* (input: Schema.Schema.Type<typeof inputSchema>) {
    if (typeof input.parsedEmail !== "object" || input.parsedEmail === null) {
      return yield* Effect.fail(
        new CadastreDownloadLinkError({ message: "Invalid parsed email shape" }),
      );
    }
    const email = input.parsedEmail as { readonly text?: unknown; readonly html?: unknown };
    const sources = [email.html, email.text].filter(
      (value): value is string => typeof value === "string",
    );
    if (sources.length === 0) {
      return yield* Effect.fail(
        new CadastreDownloadLinkError({ message: "Parsed email has no text or html" }),
      );
    }
    const candidates = sources.flatMap((source) => {
      const decoded = source.replaceAll(/&amp;/gi, "&");
      return Array.from(decoded.matchAll(/https?:\/\/[^\s"'<>]+/gi), (match) =>
        match[0].replace(/[),.;]+$/, ""),
      );
    });
    for (const candidate of candidates) {
      try {
        const url = new URL(candidate);
        if (
          url.protocol === "https:" &&
          url.hostname === "portal.spatial.nsw.gov.au" &&
          !url.port &&
          !url.username &&
          !url.password &&
          url.pathname.startsWith("/exports/") &&
          url.pathname.toLowerCase().endsWith(".zip")
        )
          return url.toString();
      } catch {
        // Ignore malformed candidates and continue searching the email.
      }
    }
    return yield* Effect.fail(
      new CadastreDownloadLinkError({ message: "No valid cadastre download URL" }),
    );
  },
);

export const ExtractDownloadLinkActivity = (input: Schema.Schema.Type<typeof inputSchema>) =>
  Activity.make({
    interruptRetryPolicy: activityInterruptRetryPolicy,
    name: "CadastreSyncWorkflow/extract-download-link",
    success: Schema.String,
    error: CadastreActivityErrorSchema,
    execute: projectActivity("extract-download-link", extractDownloadLink(input)),
  });
