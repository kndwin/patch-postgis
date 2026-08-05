# Machine conventions

`map.machine.ts` owns the browser sync state model and its transitions. UI routes may
consume the model, but API effects and transition rules belong here. Keep changes
type-safe and update the adjacent machine tests when executable linting is added;
this document is convention-only and does not define a lint command.
