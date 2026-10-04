---
feature: 159-form-saving
date: 2026-10-04
verdict: accepted-with-open-items
---

# Retrospective: 159-form-saving

## Verdict

Accepted with open items, judged against the spec's four success criteria and
its fourteen requirements. SC-001 (ten presses, one request) is asserted by
`libs/overlays/src/form.adversary.spec.ts:205`. SC-002 and SC-003 (typed text
kept, focus on the first invalid field) are covered by `libs/overlays/src/form.spec.ts`.
SC-004 (axe on the invalid and failed states) is covered by
`apps/web-e2e/src/task-form.spec.ts`. The PR tester's lap 1 on the merged head
`a98099d` returned success with no blocking finding (`pr-review/lap1/report.md`),
and the merge was gated on it (`5b99c7d`). Two items are still owed: a medium
accessibility defect in the kit input that predates this feature, and an
end-to-end flow that has to wait for the sign-up story. Both are under Action
items.

## Evidence

`node .claude/scripts/retro-evidence.mjs specs/159-form-saving`:

- Tasks: 14 done, 0 open. Requirements: 14 declared, 0 retired.
- Commits: 6 of the feature's own (`0dce4a3`, `eca84e6`, `2af559c`, `0704113`,
  `99be4ed`, `a98099d`). The merge `5b99c7d` brings 34 files, +3008 −27, into
  `main`. The script's "178 files" also counts the main merges the branch took in.
- Spec Delta: `overlays` +13 ~0 −0, `platform` +1 ~0 −0. These were archived in `0704113`
  before the merge. `capabilities.mjs validate --check` now reports every id as
  "already in" its capability, because the merge has run, not because the delta is wrong.
- QA: lap 1 on `a98099d` succeeded (0 blocking, 2 medium for storage readiness
  with no Docker, 2 low).
- Review (`auto-run.md`, Harden / Review): spec-reviewer APPROVE with one
  MEDIUM (wording of `aria-invalid`), fixed in FR-002 and a usage note.
  code-reviewer BLOCK on one HIGH (an untested Observable or throwing send),
  closed by `form.adversary.spec.ts`. Its MEDIUMs were kept with reasons.
- Deferred: 4 open, each filed as a Notion To do task (`deferred.md`).

## What accumulated across the feature

- The error shape spread across three projects. `libs/contracts` holds the
  problem shape and the status table, the API's `ProblemFilter` passes
  `errors` through, and `libs/overlays/src/form.ts` reads them (`auto-run.md`,
  Implement). A `@motor-fix/contracts/problem` path alias was added
  (`tsconfig.base.json`) so the Angular lib does not pull in the Node-only
  `env.ts`. That is a second entry point into `contracts`, and later stories
  should import the problem shape through it, not through the root.
- `toProblem` is exported only because ST-130 will read failures through it
  (`auto-run.md`, code-reviewer MEDIUM). It has no second caller yet. If ST-130
  does not use it, it is dead.
- `form.adversary.spec.ts` was written to close the HIGH and is now the only
  proof of SC-001 (`:205`).

## Where the implementation diverged from the spec

None that changes a requirement. The PR tester's two lows, two buttons named
"Close" in the confirmation state and the dialog height shifting when the error
line clears, are finish defects inside FR behaviour as written. They are filed
as debt. No `Modifies` is needed.

## Carried in

Two open items from `specs/157-dialog-drawer/retrospective.md`: Back keeping
the page, and a message when a task's code fails to load. This feature did not
cover either one, and neither was in its scope. They stay open on ST-157's debt
tasks and are not taken over here.

## Action items

- [ ] Make the kit's `hlmInput` follow the shared reveal rule, so an empty required
  field is not announced invalid when it opens (`deferred.md`, medium,
  https://app.notion.com/p/3ef607bff0d281c29628f4d727071138) (unassigned)
- [ ] Add the "sign up with an e-mail that is taken" end-to-end flow to the
  create-an-account story, on `taskSave()` (`deferred.md`, low,
  https://app.notion.com/p/3ef607bff0d2819faf63ebbbbeb59415) (unassigned)
- [x] The two PR-tester lows (two "Close" buttons, a height shift when the error
  clears) are filed as To do tasks and need nothing more from this feature
  (`deferred.md`).
