import { Effect, Schema } from "effect";
import { extractTrustedCadastreDownloadUrl } from "@patch/http-contract";
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
    if (typeof email.html !== "string" && typeof email.text !== "string") {
      return yield* Effect.fail(
        new CadastreDownloadLinkError({ message: "Parsed email has no text or html" }),
      );
    }
    const url = extractTrustedCadastreDownloadUrl(input.parsedEmail);
    if (url !== null) return url;
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
