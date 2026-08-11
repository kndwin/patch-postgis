import { Effect, Schema } from "effect";
import { Machine } from "@typeonce/effect-machine";
import { AtomMachine } from "@typeonce/effect-machine/reactivity";
import { httpClient } from "../../platform/http-client/client";

const State = Schema.TaggedUnion({
  Loading: {},
  Loaded: {
    snapshot: Schema.NullOr(Schema.Unknown),
    runs: Schema.Array(Schema.Unknown),
  },
  Failure: { message: Schema.String },
});
const States = Machine.defineStates(State.cases);
const Refresh = Schema.TaggedStruct("Refresh", {});
const Loaded = Schema.TaggedStruct("CadastreLoaded", {
  snapshot: Schema.NullOr(Schema.Unknown),
  runs: Schema.Array(Schema.Unknown),
});
const Failed = Schema.TaggedStruct("CadastreFailed", { message: Schema.String });

export const cadastreMachine = Machine.make({
  id: "dashboard-cadastre",
  states: States.states,
  events: [Refresh],
  internalEvents: [Loaded, Failed],
  initial: () => States.initial.Loading(State.cases.Loading.make({})),
}).handle({
  Loading: {
    invoke: Machine.invokeEffect({
      id: "load-cadastre-status",
      effect: Effect.fn("CadastreMachine.loadCadastre")(function* () {
        const api = yield* httpClient;
        return yield* Effect.all({
          snapshot: api.cadastre.getCurrentSnapshot({}),
          runs: api.cadastre.getSyncRuns({ query: {} }),
        });
      })(),
      onSuccess: (data) => Loaded.make(data),
      onFailure: (cause) => Failed.make({ message: cause.message }),
    }),
    on: {
      Refresh: ({ target }) => target.full.Loading(State.cases.Loading.make({})),
    },
  },
  Loaded: {
    on: {
      Refresh: ({ target }) => target.full.Loading(State.cases.Loading.make({})),
    },
  },
  Failure: {
    on: {
      Refresh: ({ target }) => target.full.Loading(State.cases.Loading.make({})),
    },
  },
});

export const cadastreMachineAtom = AtomMachine.make(cadastreMachine);
export const cadastreLoadingAtom = AtomMachine.matches(cadastreMachineAtom, "Loading");
export const cadastreLoadedAtom = AtomMachine.select(cadastreMachineAtom, "Loaded");
export const cadastreFailureAtom = AtomMachine.select(cadastreMachineAtom, "Failure");
