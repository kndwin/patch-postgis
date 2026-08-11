import { Atom } from "effect/unstable/reactivity";
import { Duration } from "effect";
import { AppHttpClient } from "../../platform/http-client/client";

// Retain inactive page queries briefly so revisiting a page can reuse its result.
const workflowQueryTtl = Duration.seconds(30);
const schedulesQueryTtl = Duration.minutes(5);

export const workflowQueryAtom = Atom.family(
  ({ cursor, pageSize }: { readonly cursor: string | null; readonly pageSize: number }) =>
    AppHttpClient.query("workflow", "listWorkflows", {
      query: { limit: String(pageSize), ...(cursor ? { cursor } : {}) },
      reactivityKeys: ["workflow", "executions"],
      timeToLive: workflowQueryTtl,
    }),
);

export const schedulesQueryAtom = AppHttpClient.query("workflow", "listSchedules", {
  query: {},
  reactivityKeys: ["workflow", "schedules"],
  timeToLive: schedulesQueryTtl,
});
