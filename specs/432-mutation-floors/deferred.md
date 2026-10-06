# Deferred — 432-mutation-floors

Survivors left outside `contracts`, `mcp` and `api` (FR-011), one task per project, counts from the full Mutation runs on the branch.

- `libs/domain`: no full score: the full run exceeds the 360-minute job ceiling with `concurrency: 1` (run 37360166653, cancelled). Give each Stryker runner its own test database keyed on `STRYKER_MUTATOR_WORKER` (ST-432 acceptance criteria), drop `concurrency: 1`, measure it in full, set its floor, then kill its survivors (168 survived, 130 uncovered in the incremental run 37215034382). — Notion: https://app.notion.com/p/3f1607bff0d281358a8df1ef1f5443a3
- `scripts`: 51.39 (run 37417183265), floor 46; 57 survived, 257 uncovered mutants to kill. — Notion: https://app.notion.com/p/3f1607bff0d281328da0c55c729320f9
- `apps/web`: 84.28 (run 37360189195), floor 79; 191 survived, 57 uncovered mutants to kill. — Notion: https://app.notion.com/p/3f1607bff0d281e1a205c5754ba6188a
- `libs/ui-cockpit`: 71.38 (run 37417179970), floor 66; 61 survived, 22 uncovered mutants to kill. — Notion: https://app.notion.com/p/3f1607bff0d28148be48cf579008a352
- `libs/overlays`: 81.85 (run 37417177305), floor 76; 40 survived, 7 uncovered mutants to kill. — Notion: https://app.notion.com/p/3f1607bff0d281d58790eb08181b1f1b
- `libs/i18n`: 90.96 (run 37360174934), floor 85; 15 survived, 2 uncovered mutants to kill. — Notion: https://app.notion.com/p/3f1607bff0d2816da6b7c5b8214ed20d
- `libs/media`: 90.63 (run 37360193873), floor 85; 3 survived mutants to kill. — Notion: https://app.notion.com/p/3f1607bff0d281f49b7ff819e838e69d
- Harness: `.claude/scripts/diff-audit.mjs` flags `libs/contracts` specs' extensionless relative imports as nodenext errors, but the project resolves with `moduleResolution: bundler` and typechecks clean; teach the import-extension rule to read each project's tsconfig. — Notion: https://app.notion.com/p/3f1607bff0d281c89263c4f9b472f79e
- Spec wording: FR-005 names two routes for a survivor (killed by a test, or silenced on its line); `apps/mcp/src/server.ts`'s `req.url ?? '/'` survivor went a third way, a behaviour-preserving rewrite (`req.url?.split`). Name that route in the capability spec or the constitution's Principle VI text. — Notion: https://app.notion.com/p/3f1607bff0d2817a9788fa24a09a8298
- PR test lap 1 (medium): `scripts/mutation-floors.spec.ts` tests `summaryRows` and `flags` away from `scripts/mutation.ts` and repeats `scripts/mutation.spec.ts` (Principle II); move those cases into `mutation.spec.ts` and drop the duplicates. — Notion: https://app.notion.com/p/3f1607bff0d281699e43fe9fd9af646a
- PR test lap 1 (low): the `scripts/mutation-floors.spec.ts` test whose title covers the no-`--incremental` case asserts nothing about it; add the assertion or retitle the test. — Notion: https://app.notion.com/p/3f1607bff0d28132ac33d35eb1c00875
- PR test lap 1 (low): `specs/432-mutation-floors/tasks.md` T008 describes a non-list value, but the test adds a function entry inside a list; correct the task text in the capability record. — Notion: https://app.notion.com/p/3f1607bff0d28144adc6c596c877a1a6
