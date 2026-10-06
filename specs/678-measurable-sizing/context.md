# Org context — 678-measurable-sizing

Read 2026-10-06 through the Notion connector by the run itself (the
org-researcher had no Notion tools in its dispatch). Source: the story page
ST-678, https://app.notion.com/p/3f0607bff0d2817d8a94d9a31fa161b4, last edited
2026-10-06. Epic EP-1 Foundations. No comments on the page.

## Decisions (from the story)

- A wrong level only ever errs toward more process; no level decides whether a
  change is tested (the ST-662 rule).
- Four parts, built in order, each usable alone: ledger, tripwires, level vs
  diff before the merge, sizing from Notion metadata.
- Story points are a signal only when present.
- A Notion failure never blocks: the classifier and model path stay as they are.

## Constraints

- Acceptance: ledger by level including subagent usage; each tripwire has a
  promote and a leave-alone test; no tripwire lowers a level; the pre-merge
  check refuses ready for a level 0/1 whose diff trips a wire with owed phases
  not run; `suggest` with a story id returns a level and facts, or `unsure`
  and the reason; `test:harness`, `harness-eval --check`, `doctor` pass.
- Out of scope: per-phase needs predicates, level-driven model routing, the
  retro level verdict, `docs-only.ts` as a level 0 signal, storing the level in
  the feature directory, batch-sizing an epic.

## Open / differences from the spec

- The story says the three ST-662 debt tasks "are cheapest done first, in the
  same branch or just before it"; the spec keeps them out of scope (the task
  prompt listed them as out of scope). Not taken here; recorded as a decision.
- The story places part 3 "at review time"; the spec puts it in the ready step,
  which runs after review and before the PR goes ready. Same moment in effect.
