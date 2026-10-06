# Auto run — 705-auto-skill-split (ST-704)

- **Description**: split speckit-auto into a lean run order and phase references, and drop the stale text (harness tech debt, EP-1).
- **Base**: origin/main 3486742.
- **Start commit**: aa54ebf.
- **Branch**: 705-auto-skill-split.
- **PR**: #145 (draft).
- **Level**: 1.

## Size
- **Level 1 (one-session)**: one skill file plus its specs, done in one session.

## Decisions
- **Feature number 705**: the 704 branch is ST-697's (PR #144).
- **Inventory spec**: `layout.spec.mjs`, beside SKILL.md, the way #144 puts `phase-dispatch.spec.mjs` there.
- **Byte budget of 15000**: leaves room for #144's "Phase agents" paragraph.
- **Phase 9 red**: `layout.spec.mjs` has 6 of 7 tests failing (the stale-text test passes). `npm run test:harness`: 1 file failed, 55 passed; 6 tests failed, 1230 passed. The pre-commit hook does not run the harness specs.

## Stale text fixed
- **Line 49**: `biome.json` is now `biome.jsonc`.
- **Phase 5, import-extension rule**: names the real apps. web-e2e uses `nodenext` and needs `.js`; the others use `bundler` or `preserve`. The source cited is now the tsconfigs, not AGENTS.md.
- **Phase 9 and the checklist**: "Jira key" is now "story id".
- **Phase 12 and the checklist**: no local mutation-runner. Mutation runs only in `mutation.yml`.
- **Phases 3 (table) and 13, and the checklist**: "lane" is now "connector", and "ticket" is now "story".
- **Phase 15**: dropped the "git-excluded" sentence.
- **Phase 16**: `--since` rationale restated.
- **Commit Protocol**: artifacts are tracked and committed as `docs(specs)`; the phase 2–8 and 17 rows are corrected.

## Overlap check (2026-10-05)
- **#141** (696-lifecycle-script): OPEN, draft. It changes SKILL.md (+27/−35: Hand-off steps and tail steps 5–6).
- **#144** (704-auto-phase-model-pins, ST-697): OPEN. It changes SKILL.md (+40) and adds `phase-dispatch.spec.mjs`.
- **Result**: the move waits for both (plan.md, "Overlap"). Resume at T004.

## Follow-ups (not in this change)
- `speckit-harden` and `.claude/agents/mutation-runner.md` still describe local mutation runs.
- Phase 14 calls a missing `design.md` a Hard Stop, but the Hard Stops list says it is exhaustive.
- The comment in `.claude/vitest.config.ts` still says `.claude/` is git-excluded.

## Resume (2026-10-06)
- **T004**: #141 and #144 merged. `git merge --no-edit origin/main` was clean (bce892a). SKILL.md grew to 43867 bytes with #141's lifecycle steps and #144's "Phase agents".
- **T005**: moved the sections by line range (no rewording), then fixed the pointers: Autonomy Contract 4 names `commit-protocol.md`; phase 14 names `hand-off.md` and `tail.md`; the tail prompt reads SKILL.md, then runs `tail.md`; the Final Report points to `report.md`. SKILL.md gains a file → when-to-read table and a Detail column in the run order. Phase 17 gets a pointer subsection in `phases-close.md`.
- **Outside the skill**: `speckit-watch` (`tail` fix) and `task-runner.md` now name `tail.md`.
- **T006**: tail-handoff-wiring and lifecycle-wiring read `hand-off.md` + `tail.md`; task-runner reads all nine files; phase-dispatch slices phases 1–17 from the three phase files and stops at any heading.
- **T007**: GATES gained the lifecycle-wiring and phase-dispatch literals. `npx vitest run --config .claude/vitest.config.ts`: 66 files, 1480 tests passed. `doctor.mjs`: 16 ok, 0 failures.
- **Deferred**: two bullets filed by the coordinator (#143 waitLoop race, #141 `lifecycle.mjs:253` → ST-710); URLs in `deferred.md`.

## Measurement (`wc -c`)
| What | Bytes |
|---|---|
| SKILL.md before (origin/main 3486742) | 42492 |
| SKILL.md before the split, after #141/#144 merged | 43867 |
| SKILL.md after | 13697 |
| Loaded every turn: saving against 43867 | 30170 (69%) |
| Typical level-2 story run, each file read once (SKILL + preflight + phases-plan/build/close + commit-protocol + hand-off + report) | 39174 |
| Tail agent (SKILL.md + tail.md) | 20565 |

## Review (phase 14)
- **spec-reviewer**: APPROVE, with 2 MEDIUM and 3 LOW findings. Patched: "three subagents" → two (phases-build.md); Spec Delta now `Modifies 696-FR-009 → FR-007`, `Removes 704-FR-007`; speckit-watch and task-runner send the tail to SKILL.md, then tail.md; report.md checklist says "Phases 1–17". Deferred: the harden/mutation-runner local-mutation wording, phase 14 design.md vs the exhaustive Hard Stops list, and the vitest.config.ts comment.
- **code-reviewer**: APPROVE, with 1 MEDIUM and 2 LOW findings. MEDIUM, GATES/FORBIDDEN duplicating other specs: kept, because the spec (FR-003/FR-004, Story 2) asks for one inventory of gate phrases (autonomous default, evidence: spec.md). LOW: phase-dispatch slice regex reverted to `/^##+ /m`. LOW: tail-handoff `section()` running across files is deferred.
- **After the fixes**: harness 66 files and 1480 tests passed; `capabilities.mjs validate`: 0 errors.

## Retrospective evidence (unjudged)
- `retro-evidence.mjs --since aa54ebf~1 --jev`: the commit list includes the merged origin/main history. Jev lane unavailable (no TYPESAFE_API_KEY), so there is no suggested verdict.
- `instincts.mjs triggered --since aa54ebf~1`: none; Jev lane unavailable.
