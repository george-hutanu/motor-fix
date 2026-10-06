# Deferred — 432-mutation-floors

Survivors left outside `contracts`, `mcp` and `api` (FR-011), one task per project, counts from the full Mutation runs on the branch.

- `libs/domain`: no full score: the full run exceeds the 360-minute job ceiling with `concurrency: 1` (run 37360166653, cancelled). Give each Stryker runner its own test database keyed on `STRYKER_MUTATOR_WORKER` (ST-432 acceptance criteria), drop `concurrency: 1`, measure it in full, set its floor, then kill its survivors (168 survived, 130 uncovered in the incremental run 37215034382).
- `scripts`: 51.39 (run 37417183265), floor 46; 57 survived, 257 uncovered mutants to kill.
- `apps/web`: 84.28 (run 37360189195), floor 79; 191 survived, 57 uncovered mutants to kill.
- `libs/ui-cockpit`: 71.38 (run 37417179970), floor 66; 61 survived, 22 uncovered mutants to kill.
- `libs/overlays`: 81.85 (run 37417177305), floor 76; 40 survived, 7 uncovered mutants to kill.
- `libs/i18n`: 90.96 (run 37360174934), floor 85; 15 survived, 2 uncovered mutants to kill.
- `libs/media`: 90.63 (run 37360193873), floor 85; 3 survived mutants to kill.
- Harness: `.claude/scripts/diff-audit.mjs` flags `libs/contracts` specs' extensionless relative imports as nodenext errors, but the project resolves with `moduleResolution: bundler` and typechecks clean; teach the import-extension rule to read each project's tsconfig.
