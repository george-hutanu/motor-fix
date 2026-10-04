---
feature: 470-chart-reduced-motion
date: 2026-10-04
verdict: accepted
---

# Retrospective: 470-chart-reduced-motion

## Verdict

Accepted, judged against the spec's two success criteria and its four
requirements. SC-001 says that switching reduced motion on while a chart grows
leaves its pixels unchanged from the next frame on. It is asserted by the new
`/cockpit` test in `apps/web-e2e/src/charts.spec.ts`, which failed before the
change (`auto-run.md`, section 9) and then passed 8 runs out of 8 with
`--repeat-each=8` (section 10). SC-002 holds: `libs/ui-cockpit/src/lib/chart.ts`
no longer queries `prefers-reduced-motion`, and `chart.spec.ts` checks this
(FR-001). The PR tester's lap 1 on the merged head `6a11659` returned success
with no blocking finding (`pr-review/lap1/report.md`), and the merge was gated
on it (`4586f6e`). The three open deferred lows are all about how strong the
tests are, not about the behaviour. Each is filed as a To do task, so nothing
this feature owes is outstanding.

## Evidence

`node .claude/scripts/retro-evidence.mjs specs/470-chart-reduced-motion`:

- Tasks: 4 done, 0 open. Requirements: 4 declared, 0 retired.
- Commits: 3 of the feature's own (`3f27cd2`, `772f2a5`, `ce4ecfd`). The merge
  `4586f6e` brings 10 files, +285 −4, into `main`. The script's "113 files" also counts
  the main merge the branch took in (`6a11659`).
- Spec Delta: `cockpit-charts` +4 ~0 −0, which merges cleanly (`capabilities.mjs validate
  --check`).
- Red first: unit `3 failed, 12 passed`, e2e `1 failed, 9 passed` before the
  change (`auto-run.md`, section 9).
- Review: spec-reviewer APPROVE with 1 LOW, patched. code-reviewer APPROVE with
  2 LOW: one patched (`ce4ecfd`), one deferred (e2e mid-growth timing).
- QA: lap 1 success, 1 medium (storage readiness, no Docker on this machine) and 2 low,
  deferred with their Notion tasks (`deferred.md`).

## What accumulated across the feature

- This feature closes ST-52's deferral (`specs/053-motion/deferred.md`, now
  ticked). The charts now read the same `REDUCED_MOTION` signal (053-FR-009 and
  053-FR-013) as the rest of the kit, so there is one source for reduced motion,
  not two.
- The end-to-end suite now has two tests that rely on the switch landing inside
  the 1000 ms growth: "grows the bars in" and the new live-switch test
  (`deferred.md`, `charts.spec.ts:138`). That timing assumption is now shared,
  and a slower CI runner would break both at once.
- The unit tests here are thinner than the requirement. `chart.spec.ts:281`
  never restores `matchMedia`, and `chart.spec.ts:302` proves the animation
  stopped but not the final drawing (pr-tester lap 1). The e2e pixel check covers
  the behaviour, so the unit file is not the only proof of FR-002.

## Where the implementation diverged from the spec

None. FR-001 to FR-003 were built as written, and 052-FR-008 (no growth at first
draw under reduced motion) still holds, as the spec's Assumptions say.
`470-FR-004` is a delivery constraint ("the tests that predate 470 stay
green"), not behaviour. Its wording was made self-standing when it was merged
into `cockpit-charts`, so it still reads correctly outside the feature.

## Carried in

Two open items from `specs/157-dialog-drawer/retrospective.md`: Back keeping
the page, and a message when a task's code fails to load. Neither belongs to the
charts, and this feature was not expected to address them. They stay with ST-157.

## Action items

- [x] None owed by this feature. The three test-strength lows are To do tasks in
  Notion (`deferred.md`: 3ef607bff0d2817aa0dec871ab9e2964,
  3ef607bff0d281d4b1bafe5d38db3c74, 3ef607bff0d281709490d45cfe4b3f24).
