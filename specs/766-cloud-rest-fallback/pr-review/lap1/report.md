**Agent review: failure** — PR #160 at `1fbafa9`, lap 1

Blocking: 1 (blocker 0, high 1) · medium 0 · low 0. Booted: nothing (harness and tooling only, no screens).
- Ran on the cloud session's VM (Actions workflow dispatch is refused from it), Node 24: `npm run test:harness` (exit 0), `harness-eval.mjs --check` (82/82), `doctor.mjs` (0 failures), and the REST layer live against this PR.
- No API operation changed.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | gh REST `pr checks` reports a green PR as failed: it keeps the cancelled runs a re-triggered workflow leaves on the commit, where gh keeps only the latest run of each check | .claude/scripts/lib/gh-rest.mjs:185 | `body: cancel`, `PR title: cancel` beside their passing reruns; exit 1 on an all-green head |

### Reproduction
1. `node .claude/scripts/gh.mjs pr checks 160 --json name,bucket` on 1fbafa9 → lists `body: cancel` and `PR title: cancel` (superseded runs) and exits 1, though every check's latest run passed (FR-001: gh's exit codes).

Screenshots: 0, no screens changed.
