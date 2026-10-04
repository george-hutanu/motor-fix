---
feature: 287-public-tab-bar
date: 2026-10-04
verdict: accepted
---

# Retrospective: 287-public-tab-bar

## Verdict

Accepted, against the spec's four success criteria and its twelve requirements.
SC-001 (one tap from Home to each section at 375 px), SC-002 (no sideways
scroll and 44 px tabs at 320 px) and SC-003 (hidden at 768 and 1024 px) are
asserted by `apps/web-e2e/src/tab-bar.spec.ts` (lines 16, 142, 160), green on
the production build; SC-004 rests on the i18n check that `tasks.md` T012
names, run with `npm run test`. The PR tester's lap 2 on the merged head `1f75879` returned success with
no blocking finding (`pr-review/lap2/report.md`), and the merge was gated on it
(`74f397f`). Nothing this feature owes is outstanding.

## Evidence

`node .claude/scripts/retro-evidence.mjs specs/287-public-tab-bar`:

- Tasks: 15 done, 0 open. Requirements: 12 declared, 0 retired.
- Commits: 4 own commits (`3793649`, `79d2fc4`, `445f3ab`, `37f035d`); the
  merge `74f397f` brings 22 files, +2686 −3 into `main`. The script's
  "152 files" counts the main merges the branch took in, not the feature.
- Spec Delta: `phone-layout` +12 ~0 −0. Deferred: none. Carryover: none.
- QA: lap 1 on `445f3ab` failed (1 high, 16 medium), lap 2 on `1f75879`
  succeeded (0 blocking, 2 medium), `pr-review/lap1/`, `pr-review/lap2/`.
- Review: spec-reviewer APPROVE with 3 LOW fixed; code-reviewer 1 HIGH,
  1 MEDIUM, 3 LOW, all fixed tests first (`auto-run.md`, section 14).

## What accumulated across the feature

- The account screen's session call moved twice. The first build asked
  `/me` during server rendering (code-reviewer HIGH); `445f3ab` moved it into
  `apps/web/src/app/public/account.guard.ts` so the server renders the
  placeholder and the browser asks once. FR-006's "ask the session once"
  still holds; where it is asked is now settled in the guard.
- The public frame had no `main` landmark until QA lap 1 flagged
  `landmark-one-main` on every public page; `37f035d` added it. The unit and
  end-to-end suites never ran axe on the public screens, so only the PR tester
  could see it.
- `tab-bar.adversary.spec.ts` (613 lines in `445f3ab`) is now the largest
  test of the bar, larger than the bar itself. It found one real gap
  (contenteditable under jsdom), covered since by a Playwright test.

## Where the implementation diverged from the spec

None that changes a requirement. FR-011's placeholders and FR-006's account
behaviour are built as written; the server-side placeholder on `/account`
is how FR-006 is met, not a change to it. No `Modifies` is needed in the
Spec Delta.

## Carried in

No earlier retrospective exists in this repository, so nothing was carried in.

## Action items

- [x] None owed by this feature. The `/ro/account` signed-in sweep the PR
  tester could not run ("not swept", lap 2 finding 2) waits on sign-in, which
  its own story builds; the flows already cover it signed in and signed out.
