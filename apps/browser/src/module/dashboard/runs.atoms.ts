import { Atom } from "effect/unstable/reactivity";
import { Effect } from "effect";
import { httpClient } from "../../platform/http-client/client";

// Current pagination cursor for the workflow execution list.
export const workflowCursorAtom = Atom.make<string | null>(null);

// Fetches workflows (for the current cursor) and schedules from the API.
export const runsDataAtom = Atom.make((get) => {
  const cursor = get(workflowCursorAtom);
  return httpClient.pipe(
    Effect.flatMap((api) =>
      Effect.all({
        workflows: api.workflow.listWorkflows({
          query: { limit: "25", ...(cursor ? { cursor } : {}) },
        }),
        schedules: api.workflow.listSchedules({ query: {} }),
      }),
    ),
  );
});
