import { Schema } from "effect";
import { Machine } from "@typeonce/effect-machine";
import { AtomMachine } from "@typeonce/effect-machine/reactivity";

export const runStatuses = ["all", "succeeded", "failed", "running", "cancelled"] as const;
export const runSorts = [
  "startedAt-desc",
  "startedAt-asc",
  "duration-desc",
  "duration-asc",
] as const;
export const runPageSizes = [10, 25, 50] as const;

const Status = Schema.Literals(runStatuses);
const Sort = Schema.Literals(runSorts);
const PageSize = Schema.Literals(runPageSizes);

const State = Schema.TaggedUnion({
  Ready: {
    searchQuery: Schema.String,
    statusFilter: Status,
    sort: Sort,
    cursor: Schema.NullOr(Schema.String),
    cursorHistory: Schema.Array(Schema.NullOr(Schema.String)),
    pageSize: PageSize,
    expandedExecutionIds: Schema.Array(Schema.String),
  },
});

export const RunsEvent = Schema.TaggedUnion({
  SearchChanged: { query: Schema.String },
  StatusFilterSet: { status: Status },
  SortChanged: { sort: Sort },
  ResetFilters: {},
  NextPage: { nextCursor: Schema.String },
  PreviousPage: {},
  PageSizeChanged: { pageSize: PageSize },
  ExecutionRowToggled: { executionId: Schema.String },
});

const States = Machine.defineStates(State.cases);

const initialValue = () =>
  State.cases.Ready.make({
    searchQuery: "",
    statusFilter: "all",
    sort: "startedAt-desc",
    cursor: null,
    cursorHistory: [],
    pageSize: 10,
    expandedExecutionIds: [],
  });

export const runsMachine = Machine.make({
  id: "dashboard-runs",
  states: States.states,
  events: Object.values(RunsEvent.cases),
  initial: () => States.initial.Ready(initialValue()),
}).handle({
  Ready: {
    on: {
      SearchChanged: ({ event, state, target }) =>
        target.full.Ready(State.cases.Ready.make({ ...state, searchQuery: event.query })),
      StatusFilterSet: ({ event, state, target }) =>
        target.full.Ready(State.cases.Ready.make({ ...state, statusFilter: event.status })),
      SortChanged: ({ event, state, target }) =>
        target.full.Ready(State.cases.Ready.make({ ...state, sort: event.sort })),
      ResetFilters: ({ state, target }) =>
        target.full.Ready(
          State.cases.Ready.make({
            ...state,
            searchQuery: "",
            statusFilter: "all",
            sort: "startedAt-desc",
          }),
        ),
      NextPage: ({ event, state, target }) =>
        target.full.Ready(
          State.cases.Ready.make({
            ...state,
            cursor: event.nextCursor,
            cursorHistory: [...state.cursorHistory, state.cursor],
          }),
        ),
      PreviousPage: ({ state, target }) => {
        const previous = state.cursorHistory.at(-1);
        if (previous === undefined) return;
        return target.full.Ready(
          State.cases.Ready.make({
            ...state,
            cursor: previous,
            cursorHistory: state.cursorHistory.slice(0, -1),
          }),
        );
      },
      PageSizeChanged: ({ event, state, target }) =>
        target.full.Ready(
          State.cases.Ready.make({
            ...state,
            pageSize: event.pageSize,
            cursor: null,
            cursorHistory: [],
          }),
        ),
      ExecutionRowToggled: ({ event, state, target }) => {
        const expandedExecutionIds = state.expandedExecutionIds.includes(event.executionId)
          ? state.expandedExecutionIds.filter((id) => id !== event.executionId)
          : [...state.expandedExecutionIds, event.executionId];
        return target.full.Ready(State.cases.Ready.make({ ...state, expandedExecutionIds }));
      },
    },
  },
});

export const runsMachineAtom = AtomMachine.make(runsMachine);
