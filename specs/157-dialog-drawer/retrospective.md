---
feature: 157-dialog-drawer
date: 2026-10-04
verdict: accepted-with-open-items
---

# Retrospective: 157-dialog-drawer

## Verdict

Accepted with open items, against the spec's four success criteria and its
sixteen requirements. Each criterion has an end-to-end test in
`apps/web-e2e/src/overlays.spec.ts`: SC-001 the three closes keep the address
and scroll (line 108), SC-002 20 Tabs and Shift+Tabs stay inside (line 163),
SC-003 the 480 and 720 px drawers and no sideways scroll at 320 px (lines 203,
218), SC-004 axe on an open dialog and drawer in both languages and schemes
(line 332). The PR tester's lap 2 on the merged head `0afa541` returned
success with no blocking finding (`pr-review/lap2/report.md`), and the merge
`a27b286` was gated on it. Two behaviours from the Build brief were
deliberately left out (spec Clarifications) and are filed as Notion To do
tasks; they are the open items below.

## Evidence

`node .claude/scripts/retro-evidence.mjs specs/157-dialog-drawer`:

- Tasks: 18 done, 0 open. Requirements: 16 declared, 0 retired.
- Commits: 5 (`da5acf7`, `6e93aec` a main merge, `eed0826`, `4e8bab5`,
  `597a38a`); the merge `a27b286` brings 37 files, +2540 −1 into `main`. The
  script's "128 files" counts the main merges the branch took in.
- Spec Delta: `overlays` +16 ~0 −0, into the capability file `eed0826` created.
- Deferred: two bullets in `deferred.md`, each linked to its Notion task (the
  script reports "0 open of 0" because it counts checkboxes and these are
  plain bullets).
- Carryover: none.
- QA: lap 2 on `0afa541` succeeded, 1 medium (no object store, an
  environment limit) and 1 low (a jsdom render near Jest's 5 s timeout under
  load).

## What accumulated across the feature

- The run log stops early. `auto-run.md` (26 lines) ends at section 2,
  Specify; plan, tests, implement, harden, review and hand-off were never
  logged there, unlike 287-public-tab-bar's. What happened in those phases is
  recoverable only from the commits, `tasks.md` Phase 7 and the PR body. Nor did `spec.md`'s
  status line move past `Draft` before this archive.
- `pr-review/` holds only lap 2. Its report says lap 2, so a lap 1 ran, but
  its report was not kept in the worktree the leftovers came from.
- A race survived implementation: a loader that resolved after its panel
  closed still set the task. Code review and spec review both raised it as
  HIGH (`tasks.md` T017), and `4e8bab5` drops it
  (`libs/overlays/src/panel.ts`, a `DestroyRef` check) with a 486-line
  adversary spec (`libs/overlays/src/overlays.adversary.spec.ts`, T016), now
  the largest test of the library.
- The low QA finding: `/cockpit`'s first jsdom render runs close to Jest's
  5 s default timeout under load, and this feature added `@motor-fix/overlays` to the catalogue it
  loads (`pr-review/lap2/report.md`, finding 2).

## Where the implementation diverged from the spec

None. The two places the code does less than the Build brief, the Back button
and a failed loader's message, were decided in the spec's Clarifications
before the code, and FR-012 states the skeleton-and-X behaviour as built. No
`Modifies` is needed in the Spec Delta.

## Carried in

No earlier retrospective exists in this repository, so nothing was carried in.

## Action items

- [ ] Back closes the open task and keeps the page (Build brief scenario 8):
  https://app.notion.com/p/3ef607bff0d281368c38d78fcc7b10ff (unassigned)
- [ ] A task whose code fails to load shows an error message and a retry,
  with the shared saving-and-errors story:
  https://app.notion.com/p/3ef607bff0d28133a3efcea722e5d92b (unassigned)
