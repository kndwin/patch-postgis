import { projectActivity } from "../workflow-projection.activity";
import { activityInterruptRetryPolicy } from "./activity-options.activity";
import { DateTime, Duration, Effect, Schema } from "effect";
import { Activity, DurableClock } from "effect/unstable/workflow";
import { CadastreEmailIngestionService } from "../cadastre-email-ingestion.service";
import { isTrustedCadastreDownloadUrl } from "@patch/http-contract";
import {
  CadastreEmailTimeoutError,
  CadastreEmailLookupError,
  WaitCadastreEmailLookupErrorSchema,
  WaitCadastreEmailLookupResultSchema,
} from "./wait-cadastre-email.activity.schema";

export interface CadastreEmailWaitInput {
  readonly requestedAt: string;
  readonly emailAddress: string;
}

const activityName = (input: CadastreEmailWaitInput, poll: number) =>
  `CadastreSyncWorkflow/wait-cadastre-email/${encodeURIComponent(input.requestedAt)}/${encodeURIComponent(input.emailAddress)}/${poll}`;

/** Creates one durable, parameterized lookup for a particular poll. */
/** Construct a single durable lookup. Exported so its DB boundary can be tested without a live DB. */
export const lookupCadastreEmail = Effect.fn("WaitCadastreEmailActivity.lookup")(function* (
  input: CadastreEmailWaitInput,
) {
  const ingestion = yield* CadastreEmailIngestionService;
  const row = yield* ingestion
    .findNewestTrustedExportAfter(
      input.emailAddress,
      DateTime.toDate(DateTime.makeUnsafe(input.requestedAt)),
    )
    .pipe(Effect.mapError(() => new CadastreEmailLookupError({ message: "Email lookup failed" })));
  return row === null || !isTrustedCadastreDownloadUrl(row.extractedDownloadUrl)
    ? null
    : Schema.decodeUnknownSync(WaitCadastreEmailLookupResultSchema)({
        messageId: row.messageId,
        receivedAt: row.receivedAt.toISOString(),
        parsedEmail: row.parsedEmail,
      });
});

export const lookupCadastreEmailActivity = (input: CadastreEmailWaitInput, poll: number) =>
  Activity.make({
    interruptRetryPolicy: activityInterruptRetryPolicy,
    name: activityName(input, poll),
    success: WaitCadastreEmailLookupResultSchema,
    error: WaitCadastreEmailLookupErrorSchema,
    execute: projectActivity("wait-cadastre-email/*", lookupCadastreEmail(input)),
  });

const EmailPollInterval = Duration.minutes(30);
const EmailPollCount = 13;

/**
 * The wait is a facade because each poll must be its own Activity; putting the
 * clock in one Activity worker would make the six-hour wait non-durable.
 */
export const WaitCadastreEmailActivity = {
  execute: Effect.fn("WaitCadastreEmailActivity.execute")(function* (
    input: CadastreEmailWaitInput,
    options: { readonly pollInterval?: Duration.Duration; readonly pollCount?: number } = {},
  ) {
    const pollInterval = options.pollInterval ?? EmailPollInterval;
    const pollCount = options.pollCount ?? EmailPollCount;
    for (let poll = 0; poll < pollCount; poll += 1) {
      const result = yield* lookupCadastreEmailActivity(input, poll).execute;
      if (result !== null) return result;
      if (poll < pollCount - 1) {
        yield* DurableClock.sleep({
          name: `${activityName(input, poll)}/sleep`,
          duration: pollInterval,
          inMemoryThreshold: Duration.zero,
        });
      }
    }
    return yield* Effect.fail(
      new CadastreEmailTimeoutError({
        message: "No cadastre export email arrived within six hours",
        attempts: pollCount,
      }),
    );
  }),
};
