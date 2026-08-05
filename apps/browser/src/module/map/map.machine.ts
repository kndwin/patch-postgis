import { Schema } from "effect";
import { Machine } from "@typeonce/effect-machine";
export const syncPhases = [
  "idle",
  "downloading",
  "validating",
  "importing",
  "building_tiles",
  "uploading",
  "verifying",
  "published",
  "failed",
] as const;
export type SyncPhase = (typeof syncPhases)[number];

export type SyncState = {
  phase: SyncPhase;
  progress: number | null;
  message: string;
};

// The machine is the source of truth for the cadastre sync transitions.
const State = Schema.TaggedUnion({
  Idle: {},
  Syncing: { progress: Schema.Number },
  Complete: {},
  Error: {},
});
const States = Machine.defineStates(State.cases);
const Events = Schema.TaggedUnion({
  Start: {},
  Progress: { value: Schema.Number },
  Finish: {},
  Fail: {},
});
export const syncMachine = Machine.make({
  id: "cadastre-sync",
  states: States.states,
  events: [Events.cases.Start, Events.cases.Progress, Events.cases.Finish, Events.cases.Fail],
  initial: () => States.initial.Idle(State.cases.Idle.make({})),
}).handle({
  Idle: {
    on: {
      Start: ({ target }) => target.full.Syncing(State.cases.Syncing.make({ progress: 0 })),
    },
  },
  Syncing: {
    on: {
      Progress: ({ event, target }) =>
        target.full.Syncing(State.cases.Syncing.make({ progress: event.value })),
      Finish: ({ target }) => target.full.Complete(State.cases.Complete.make({})),
      Fail: ({ target }) => target.full.Error(State.cases.Error.make({})),
    },
  },
  Complete: {
    on: {
      Start: ({ target }) => target.full.Syncing(State.cases.Syncing.make({ progress: 0 })),
    },
  },
  Error: {
    on: {
      Start: ({ target }) => target.full.Syncing(State.cases.Syncing.make({ progress: 0 })),
    },
  },
});

export const initialSyncState: SyncState = {
  phase: "idle",
  progress: null,
  message: "Waiting for sync status",
};
export function transition(
  state: SyncState,
  event: "refresh" | "progress" | "complete" | "error",
  value: number | null = 0,
): SyncState {
  if (event === "refresh")
    return {
      phase: "idle",
      progress: null,
      message: "Fetching sync status...",
    };
  if (event === "progress")
    return {
      phase: "importing",
      progress: value,
      message: "Snapshot is being indexed",
    };
  if (event === "complete")
    return {
      phase: "published",
      progress: 100,
      message: "Snapshot is current",
    };
  return {
    ...state,
    phase: "failed",
    message: "Sync status unavailable",
  };
}
