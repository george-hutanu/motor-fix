---
feature: 050-cockpit-theme
date: 2026-10-04
verdict: accepted-with-open-items
---

# Retrospective: 050-cockpit-theme

## Verdict

Accepted with one open item. The feature was judged against the spec's five
success criteria and its sixteen requirements. SC-001 (WCAG AA pairs) is checked by
`libs/ui-cockpit/src/styles/cockpit.css.spec.ts`. SC-002 (12 px floor at 375 px),
SC-004 (scheme switch keeps the typed value, no reload) and SC-005 (focus ring)
are checked by `apps/web-e2e/src/cockpit.spec.ts`. SC-003 (no colour literal
outside the theme library) is the colour-literal check in the ui-cockpit suite.
PR #6 merged on green CI (`b422966`). On today's `main` the ui-cockpit project
still passes: `nx run ui-cockpit:test` gives 23 suites and 380 tests green. That
count now includes the later UI-kit stories built on this theme. The open item
is the owner's approval of the light theme's starting values, which the spec
leaves outside the run (Clarifications, first entry).

## Evidence

`node .claude/scripts/retro-evidence.mjs specs/050-cockpit-theme`:

- Tasks: 24 done, 0 open. Requirements: 16 declared, 0 retired.
- Commits: 8 feature commits from `55b8b48` to `2201761`. The merge `b422966` brings
  58 files, +4273 −3 into `main`. The script's "795 files" counts from an
  older base and includes what later merged to `main`, not this feature.
- Spec Delta: `cockpit-theme` +16 ~0 −0. Deferred: none. Carryover: none.
- Review: `code-reviewer` round 1 BLOCK (10 findings) and round 2 BLOCK (1 HIGH),
  all fixed (`auto-run.md`, Phases 12 and 14). This was done before the PR tester
  existed, so there is no `pr-review/` record for PR #6.

## What accumulated across the feature

- The component layer was built twice. The first three slices themed PrimeNG
  (`21e4077`, `6bd45cb`). The owner's decision of 2026-10-04 (constitution v1.3.0,
  Principle III) replaced it with Spartan helm components in `18ff099`. Tokens,
  typefaces, contrast and the panel survived unchanged. The preset, the licence
  key wiring and their tests were discarded (`auto-run.md`, Correct course).
- The helm parts stay exported only so the `*Imports` arrays can reach them.
  Unexporting them broke Angular with NG3004 (`auto-run.md`, Phase 12). This is
  why diff-audit reports dead exports in `libs/ui-cockpit` for every later
  UI-kit story too.
- The switch's styling leaked: `brn-switch` copies its `class` onto its host,
  so the track covered the page. Only screenshots showed it. An e2e test
  "draws no control over the content around it" now guards it (`auto-run.md`,
  Phase 10).

## Where the implementation diverged from the spec

FR-006, FR-007 and FR-008 were corrected mid-flight from PrimeNG to Spartan UI.
This is recorded in `spec.md` › Spec Delta › Correction. None of them had been
merged into a capability yet, so they stay `Adds`, and the capability states the
corrected wording. The panel input was renamed `title` → `heading` (`auto-run.md`,
Phase 14), and the contract was amended to match. No further `Modifies` is needed.

## Carried in

No earlier retrospective existed when this feature was built, so nothing was
carried in. The open items in later retrospectives (`157-dialog-drawer`)
belong to those features.

## Action items

- [ ] The owner approves, or changes, the light theme's starting values on
      `/cockpit` before launch (owner). The Foundations timeline row for ST-50
      notes the same. The stored screenshot baseline that waits on this is
      tracked as ST-451 in Notion.
