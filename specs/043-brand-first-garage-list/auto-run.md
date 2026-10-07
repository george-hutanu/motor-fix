# Auto run: ST-43 List garages that take my brand before those that refuse

- Description: `ST-43 "List garages that take my brand before those that refuse" (EP-2)` — the public garage list for one brand in two groups, takers first, with the two counts over everything found; ST-39's brand catalogue and `GarageBrandsService` are the base.
- Story: https://app.notion.com/p/3ee607bff0d281e68b80d309875dec93 (page `3ee607bf-f0d2-81e6-8b80-d309875dec93`)
- Start commit: `2a8f9b75` (origin/main)
- Branch: `043-brand-first-garage-list` · Worktree: `/Users/georgehutanu/projects/motor-fix/.worktrees/043-brand-first-garage-list`
- Level: 2 (feature) — classifier 0.80, boards 1 · Preflight: run by the caller
- Mode: autonomous; every gate answered here, each answer an Assumptions line marked `(autonomous default)`.

## Phase 2 — Specify

Autonomous answers (one line each, all in spec.md › Assumptions):

- Scope: brand only, no area or distance filter (MF-10's); approved garages only, public route.
- Groups: works_on first; refusers and garages that never marked the brand share the second group, each garage carrying its own answer (`works_on`, `does_not_take`, `unstated`).
- Counts: two numbers over everything found, re-read on every page; `total` is their sum.
- Paging: 20 a page, `{ items, nextCursor, total, counts }`; an opaque cursor carrying group and position so pages never mix groups.
- In-group order: rating desc, review count desc, name asc; unrated last (ST-328's default, taken as given).
- Rating and review count: read-only figures on the garage, written by no code of this story. **Open decision for the owner:** add them as read-only columns now, or leave them to ST-328 and order by name only until then.
- Module: a new `search` module in the domain lib (the brief's wording).
- Writes: none — no audit event, no live-update channel, no search log.
- Retired brand: answers like any other brand id ST-39 still knows; unknown id → not found; malformed id or foreign cursor → bad request.
- Tests: API Jest (unit + integration) only; no Playwright, no screen in this story.
- Success criteria numbers (SC-001..005): from the Build brief where it gives one, else an assumption.

Hook outcomes:

- `speckit.git.feature` (before_specify): skipped — branch existed.
- `level.mjs point specs/043-brand-first-garage-list`: level 2, carried from `/speckit-size`.
- Spec written: 3 user stories, FR-001..FR-011, SC-001..SC-005, Spec Delta → new capability `garage-search` (stub created at `.specify/capabilities/garage-search.md`). Checklist 16/16. `artifact-lint --check`: 0 errors. `capabilities validate`: merges cleanly.
- `speckit.notion.sync start`: ST-43 To do → Planning; timeline row → Planning; EP-2 In progress (unchanged).
- `speckit.design.check`: mock `https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr` unreadable (artifact not found / not shared, as for ST-39); design.md written from the Build brief's Screens with the `[UNAVAILABLE]` header. No screen in this story.
- `speckit.git.commit`: `d2dded2b docs(specs): ST-43 specify brand-first garage list`, pushed; draft PR #198 opened from the template with labels `planning`, `feature`, `scope: search`, `EP-2`; `notion-sync pr 198` wrote the link.
- Ready review (notion-ready EP-2): ticked ST-800, ST-796, ST-788 (ST-39/ST-207 tech debt with no dependency); held ST-245 (owner's list review), ST-202 (lawyer), ST-789 (owner's decision), ST-801 (ST-116), ST-787, ST-795 (ST-397), ST-799, ST-792 (wait on later screens); ST-114 is already in Planning elsewhere.
- `speckit.agent-context.update` (optional): skipped.
- `level.mjs check`: level 2, unchanged for specs/043-brand-first-garage-list.
