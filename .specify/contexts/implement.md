Mode: implement — traced failing tests exist and tasks are open.

- Work task by task from `tasks.md`, marking `[X]` as each one lands. Commit per
  logical chunk, one Conventional Commit line, no batching at the end.
- A `feat`/`fix`/`perf` commit that stages `apps/` or `libs/` must stage `specs/`
  in the same commit; pure code motion is `refactor`/`chore`.
- `/speckit-converge` diffs the code against spec/plan/tasks and appends what is
  still unbuilt — use it instead of hand-auditing.
- One root toolchain (constitution IV): no per-project eslint, prettier or second
  Biome config; the root `biome.jsonc` governs, with scoped `overrides` only.
