# Auto run — 474-pr-stage-label

- Description (user): "yes, with a new task in notion and speckit-auto to run the task" — "yes" approves the fix proposed earlier in the session for PR #33 carrying both `in review` and `QA`; expanded into the full description passed to every phase.
- Mode: `worktree` (the main checkout had 7 staged harness files on `stack-spartan-ui`, 216 commits behind `origin/main`); worktree `.claude/worktrees/pr-stage-label`, based on `origin/main` 418b111.
- Phase skills read from this worktree's `.claude/skills/`, not invoked through the Skill tool: the Skill tool loads them from the main checkout, whose copies predate PR #30 (no hand-off, "never push") — the same stale-rules failure this task fixes.
- Start commit: 418b111

## Preflight

- `node_modules` cloned (APFS copy-on-write) from `.claude/worktrees/skill-model-pins`: `package-lock.json` identical to this commit's.
- Through `scripts/heavy.sh`: `npm run typecheck` 12/12 green; `npm run lint` clean (281 files); `npm run test` 159/160 — `apps/web/src/app/addresses.adversary.spec.ts` › "marks the cockpit sample noindex…" exceeded its 5 s timeout (file took 15 s under load). Re-run alone: `Tests: 25 passed, 25 total` → a load timeout, not a red start.
- Constitution v1.6.0 read: version present, no placeholders. Principles I, V and VII carried.
- `spec-drift --status`: no active feature before this run.

## 0. Size

- Level 1 (one-session): the intent is fully set by the approved fix (what done means, what is out of scope); phases 2, 7, 9, 10, 12, 14, 16 plus hand-off. (evidence: the description names the files, the rule and the cases)

## 2. Specify

- Notion story created: ST-474, Task / System / Medium / 2 points, epic EP-1 Foundations. Branch `474-pr-stage-label` (story-numbered, as 431–467).
- Autonomous answers (spec Clarifications): the gate keeps the furthest fitting stage label (`.claude/scripts/notion-status.mjs:19`, the ladder); a PR with no story asks the same decision with the status its work is at (Principle V); the gate does not read Notion (`.claude/hooks/pr-lifecycle-gate.mjs:19`).
- Quality checklist: all items pass.
- Hooks: notion-sync start (To do → Planning); design-check → design.md (no screens); git-commit → yes, as the branch's first commit, which opens the draft PR.
- Spec committed as the first commit (`f610f40`) instead of an empty one: it is real content and spends one pre-commit run, not two. Draft PR #38 opened from the template, labelled `planning`, `bug`, `scope: harness`, `EP-1`; Notion PR property set.

## 7. Tasks

- 7 tasks (3 test, 3 implementation, 1 proof). Level 1 skips analyze; `artifact-lint` run instead: 2 errors (`fr-untasked` FR-002, FR-003 — the linter does not expand `FR-001–FR-004`) → ids spelled out; then 0 errors.

## 9. Tests

- `.claude/scripts/notion-status.spec.mjs` (stage and labels for every event, the PR #33 catch-up, Blocked, Done) and `.claude/hooks/pr-lifecycle-gate.spec.mjs` (two stage labels, a misfit, the named swaps); two eval cases in `.claude/evals/cases/pr-lifecycle.json`.
- Red before any code: `Tests 14 failed | 36 passed (50)`; evals `61/63 gate behaviours hold` (both new cases failing).
- Two existing assertions tightened to the exact `gh pr edit` the gate now names: a ready PR with no stage label is told `--add-label "in review"` alone (nothing to remove), and the planning / in development swaps name the label they remove.

## 10. Implement

- before_implement: notion-sync implement (Planning → Implementing); PR label `planning` → `in development`.
- `notion-status.mjs`: `stage` and `labels` on every decision (one stage label added, the other three and `blocked` removed; Blocked keeps the stage it left plus `blocked`; Blocked with no record only adds `blocked`). `pr-lifecycle-gate.mjs`: one `stageFix` check for no, several or misfitting stage labels. Skill text: `speckit-notion-sync` §2/§2b state the one-label rule and apply `labels` on every event; `speckit-auto` hand-off, `speckit-pr-test` step 1 and AGENTS.md step 4 point at it.
- Eval `stderr` is a regex: the `)` in the PR #33 case needed escaping (the red run never reached it: exit 0 failed first).
- Proof: `npm run test:harness` 500/500 (after `doctor.mjs --bless-hooks` for `stop:pr-lifecycle`, diff read first: cac729172242 → 37b4f41d5903); `doctor.mjs` 16 ok; `harness-eval.mjs --check` 63/63; artifact-lint 0/0; diff-audit 0/0.
- Environment note: `red-first-leaves-main-alone` failed (62/63) while tasks were open after `git fetch origin main:main`: it runs the gate against the real checkout, which here has an active feature with open tasks and no `*.spec.ts` (harness specs are `.mjs`). Before the fetch, the stale local `main` made the merge-base pull in hundreds of `*.spec.ts`. With every task checked it passes; on CI no `feature.json` exists.

## 12. Harden

- Level 1 path (no `apps`/`libs`/`e2e` lines): audits, test-adversary, then the durability read in phase 14 in place of a separate `/simplify` (the code diff is ~60 lines). No mutation run: no Nx project touched, and never local (owner's RAM rule). `npm run lint` clean, `npm run typecheck` 12/12. WebStorm inspections: IDE not running.
- test-adversary wrote 39 tests, 36 green. Failing: (1) `toString`/`constructor`/`__proto__` accepted as events — `event in TARGET` matched inherited names, a pre-existing defect in the file this change owns → fixed with `Object.hasOwn`; (2, 3) a PR state with `labels` missing or null passes the label checks — the gate's deliberate fail-open (`gh` always returns `labels`; 4 existing eval cases declare PRs without them and expect other refusals) → a spec gap, closed by an Edge Case line, and the two tests now assert the fail-open.
- Pruned to what the author specs do not prove (Principle I): kept the exhaustive single-event property (every status × event × prior × 32 label sets), the four-event sequence walk, "names no other label", "never adds and removes one label", legacy In progress equivalence, inherited names; at the gate every stage-label subset (draft and ready, the named fix applied and a second pass clean), lookalike labels, fail-open, refusal order. 39 → 14 tests, 363 → 179 lines. Repair lap 1 of 5.

## 14. Review

- spec-reviewer APPROVE: MEDIUM patch — AGENTS.md step 6 still quoted the QA move (fixed; T006 named only step 4); LOW defer — Constitution VII steps 3 and 5 word the label as a swap, an amendment rather than this diff → `deferred.md`.
- code-reviewer APPROVE: MEDIUM decision — `stage` has no reader → kept (the approved fix asked for it) and given one: §2b logs `labels · PR #<n> · <stage>`; LOW patch — `STAGES` restated the two label sets → derived from them (gate re-blessed 37b4f41d5903 → 1a4d7ef2119d); LOW patch — the skill showed `labels` only JSON-escaped → the decoded command shown once. Repair lap 2 of 5.
- After the fixes: `npm run test:harness` 513/513; `harness-eval.mjs --check` 63/63; `doctor.mjs` 16 ok; artifact-lint 0/0; diff-audit 0/0.

## 15. Agent context

- AGENTS.md lifecycle steps 4 and 6 changed as part of the requirement (they quoted label moves); no managed-block change.
