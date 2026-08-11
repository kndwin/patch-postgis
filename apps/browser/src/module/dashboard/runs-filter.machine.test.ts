import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Machine } from "@typeonce/effect-machine";
import { RunsEvent, runsMachine } from "./runs-filter.machine";

type Snapshot = Awaited<ReturnType<typeof initial>>;

const initial = async () => (await Effect.runPromise(Machine.planInitial(runsMachine))).state;
const transition = async (state: Snapshot, event: Machine.Machine.InputEvent<typeof runsMachine>) =>
  (await Effect.runPromise(Machine.plan(runsMachine, state, event))).next;

describe("runs machine", () => {
  test("changes and resets filters without resetting process state", async () => {
    let state = await initial();
    state = await transition(state, RunsEvent.cases.SearchChanged.make({ query: "cadastre" }));
    state = await transition(state, RunsEvent.cases.StatusFilterSet.make({ status: "failed" }));
    state = await transition(state, RunsEvent.cases.SortChanged.make({ sort: "duration-desc" }));
    state = await transition(
      state,
      RunsEvent.cases.ExecutionRowToggled.make({ executionId: "run-1" }),
    );
    state = await transition(state, RunsEvent.cases.ResetFilters.make({}));

    expect(state.value).toMatchObject({
      searchQuery: "",
      statusFilter: "all",
      sort: "startedAt-desc",
      expandedExecutionIds: ["run-1"],
    });
  });

  test("moves next and previous using a safe cursor history", async () => {
    let state = await initial();
    state = await transition(state, RunsEvent.cases.NextPage.make({ nextCursor: "page-2" }));
    state = await transition(state, RunsEvent.cases.NextPage.make({ nextCursor: "page-3" }));
    expect(state.value).toMatchObject({
      cursor: "page-3",
      cursorHistory: [null, "page-2"],
    });

    state = await transition(state, RunsEvent.cases.PreviousPage.make({}));
    expect(state.value).toMatchObject({ cursor: "page-2", cursorHistory: [null] });
    state = await transition(state, RunsEvent.cases.PreviousPage.make({}));
    expect(state.value).toMatchObject({ cursor: null, cursorHistory: [] });
    state = await transition(state, RunsEvent.cases.PreviousPage.make({}));
    expect(state.value).toMatchObject({ cursor: null, cursorHistory: [] });
  });

  test("page size resets pagination and expansion toggles by execution id", async () => {
    let state = await initial();
    state = await transition(state, RunsEvent.cases.NextPage.make({ nextCursor: "page-2" }));
    state = await transition(
      state,
      RunsEvent.cases.ExecutionRowToggled.make({ executionId: "run-1" }),
    );
    state = await transition(state, RunsEvent.cases.PageSizeChanged.make({ pageSize: 25 }));
    expect(state.value).toMatchObject({
      pageSize: 25,
      cursor: null,
      cursorHistory: [],
      expandedExecutionIds: ["run-1"],
    });

    state = await transition(
      state,
      RunsEvent.cases.ExecutionRowToggled.make({ executionId: "run-1" }),
    );
    expect(state.value.expandedExecutionIds).toEqual([]);
  });
});
