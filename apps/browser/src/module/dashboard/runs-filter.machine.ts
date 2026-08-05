import { Schema } from "effect";
import { Machine } from "@typeonce/effect-machine";

// Event types
export type SearchChanged = {
  readonly _tag: "SearchChanged";
  readonly query: string;
};

export type StatusFilterSet = {
  readonly _tag: "StatusFilterSet";
  readonly status: "all" | "succeeded" | "failed" | "running";
};

export type SortChanged = {
  readonly _tag: "SortChanged";
  readonly sort: "startedAt-desc" | "startedAt-asc" | "duration-desc" | "duration-asc";
};

export type ResetFilters = {
  readonly _tag: "ResetFilters";
};

export type FilterEvent = SearchChanged | StatusFilterSet | SortChanged | ResetFilters;

// State type
export type FilterState = {
  readonly _tag: "Idle";
  readonly searchQuery: string;
  readonly statusFilter: "all" | "succeeded" | "failed" | "running";
  readonly sort: "startedAt-desc" | "startedAt-asc" | "duration-desc" | "duration-asc";
};

// Initial state
const initialState: FilterState = {
  _tag: "Idle",
  searchQuery: "",
  statusFilter: "all",
  sort: "startedAt-desc",
};

// Reducer function for the machine
export const runsFilterMachine = {
  initial: (): FilterState => initialState,

  transition: (state: FilterState, event: FilterEvent): FilterState => {
    if (event._tag === "SearchChanged") {
      return { ...state, searchQuery: event.query };
    } else if (event._tag === "StatusFilterSet") {
      return { ...state, statusFilter: event.status };
    } else if (event._tag === "SortChanged") {
      return { ...state, sort: event.sort };
    } else if (event._tag === "ResetFilters") {
      return initialState;
    }
    return state;
  },
};
