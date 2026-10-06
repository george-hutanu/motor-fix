**Agent review: failure** — PR #149 at `c0ef3b1`, lap 1

Blocking: 1 (blocker 0, high 1) · medium 2 · low 1. Booted: postgres, redis, minio, api, web, worker.
- Ran on GitHub Actions (https://github.com/george-hutanu/motor-fix/actions/runs/37451448558): PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow.
- No API operation changed.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | Unused exports added to level.mjs (Principle I: no unused exports) |  | .claude/scripts/level.mjs:139: export function changedFiles(repo) {  /  :167: export function tripwires(repo, featureDir, files) {  /  :561: export function sizeFromFacts(facts, classified) { |
| 2 | medium | Notion floor answers 2 without the text path, so a story Jev would size 3 is lowered (FR-012: a rule only raises) |  | .claude/scripts/level.mjs:572: if (floors.length) return { level: 2, confidence: 0.8, by: "notion", reason: floors.join("; ") }; |
| 3 | medium | Pre-ready check refuses any feature reading as level 2 without plan.md, including one whose level was never recorded (DEFAULT_LEVEL 2) |  | .claude/scripts/level.mjs:223: } else if (result.level >= 2) {  /  .claude/scripts/lib/feature.mjs:47: export const DEFAULT_LEVEL = 2; |
| 4 | low | tasks.md T008 names a function that does not exist |  | specs/678-measurable-sizing/tasks.md:22: - [x] T008 [US2] Add `checkTripwires(repo)` and the `check [--ready] [--json]` command |

### Reproduction
1. grep -rlw changedFiles\|tripwires\|sizeFromFacts .claude --include='*.mjs': each is referenced only inside .claude/scripts/level.mjs (tripwires appears in level.spec.mjs only as describe-title prose) → Drop the export keyword from changedFiles, tripwires and sizeFromFacts, or test them directly
2. Story with Design boards whose text the local classifier finds unsure → sizeFromFacts returns level 2 by notion at 0.8 and --set records it; suggestText/Jev never runs, so a Jev answer of 3 is lost → Fix: on a floor with an unsure classifier, run the text path and take max(2, its answer)
3. Feature with spec.md and tasks.md, no plan.md, and feature.json level not applying to it (unsized, expired 'next', or sized for another feature) → lifecycle.mjs ready -> level.mjs check --ready: featureLevel returns DEFAULT_LEVEL 2, missing [plan.md], exit 2, ready stops → Spec Assumptions cover a recorded level 3, not an unrecorded level; 10+ existing specs/ dirs (e.g. specs/433-pr-template, specs/450-pr-tester-env-gaps) have no plan.md. Consider refusing only a level promoted or recorded, or say so in the spec
4. T008 is [x] for `checkTripwires(repo)`; the code adds checkLevel(repo, opts) and tripwires(repo, featureDir, files)

Screenshots: 32, one per route × viewport × scheme × language.
