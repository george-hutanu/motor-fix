---
feature: 130-sign-in-gate
date: 2026-10-05
verdict: accepted-with-open-items
---

# Retrospective: 130-sign-in-gate

## Verdict

Accepted with one open item, against the spec's 10 functional requirements.
PR #64 merged as `9e6afb1` after QA laps 2 and 3 passed with no blocking
finding (`pr-review/lap2`, `pr-review/lap3`). Lap 1 found one high: after
signing in through the gate the screen fell back to the account's old
language; it was fixed test-first in `0bb159d` (`auto-run.md`, QA lap 1).

## Evidence

From `node .claude/scripts/retro-evidence.mjs specs/130-sign-in-gate`:

- **Tasks:** 15 done, 0 open.
- **Requirements:** 10 declared, 0 retired.
- **Spec Delta:** `accounts` +8, ~2.
- **Commits:** 6, from `35e039b` (closed-by-default API) to `0bb159d`.
- **Deferred:** 5, each filed as a Notion task.

## What accumulated across the feature

- Closed-by-default routing means every later public route must carry
  `@Public()`: ST-194's Brevo webhook broke on the merge (`e5fee84`), and
  ST-128's sign-out route broke the same way (`specs/128-sign-out/auto-run.md`,
  QA lap 2).

## Where the implementation diverged from the spec

- tasks.md T001 names an expired token in the route sweep; the sweep tests a
  malformed and a foreign-key token, and the expired case is tested once on
  one route (`pr-review/lap3/report.md`, finding 3). The spec is right; the
  test is narrower than the task text.

## Carried in

- None.

## Action items

- [ ] Add the expired-token case to the public-route sweep in `apps/api/src/public-routes.integration.spec.ts` (unassigned).
