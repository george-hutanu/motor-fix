# Plan: split speckit-auto (ST-704)

## Technical Context

- **Files**: everything sits in `.claude/skills/speckit-auto/`. Markdown is
  read by the agent, and the specs are vitest (`.claude/vitest.config.ts`,
  `npm run test:harness`).
- **Lint**: Biome ignores `.claude/`. The Harness job in CI runs the specs.
- **Measuring**: `wc -c` on each file. No estimates.

## Section → file map

Sizes are the section's bytes in the single file, at 3486742 after the
stale fixes.

| Section | Bytes | Goes to | Read when |
|---|---|---|---|
| Frontmatter, User Input, Goal | ~1.3K | SKILL.md | always |
| Autonomy Contract | 2130 | SKILL.md | always |
| Phases intro + run-order table (gains a "Detail" column naming the file) | ~2.4K | SKILL.md | always |
| 0 Size (level table) | 702 | SKILL.md | always |
| Run state | 1356 | SKILL.md | always |
| Notifying | 498 | SKILL.md | always |
| Hard Stops | 1106 | SKILL.md | always |
| Final Report: envelope, the 10-line cap, `auto-run.md` (agent-replies spec reads it here) | ~0.9K | SKILL.md | always |
| Agent Execution Rules deltas | 999 | SKILL.md | always |
| Preflight + Parallel runs | 2691 | preflight.md | before phase 1 |
| 1 Constitution … 8 Analyze | ~6.1K | phases-plan.md | phase 1 (level 1 jumps to its phases) |
| 9 Tests … 12 Harden | ~3.2K | phases-build.md | phase 9 |
| 13 Ticket refresh … 16 Retro, plus a 17 Archive pointer | ~6.1K | phases-close.md | phase 13 |
| Commit Protocol | 2637 | commit-protocol.md | before the first commit |
| Hand-off | 3269 | hand-off.md | after phase 17 |
| The wait + The tail | 6783 | tail.md | the session that waits; the tail agent |
| Final Report sections + Completion Checklist | ~2.5K | report.md | at the hand-off, before the reply |

Each moved section keeps its heading. In the reference files, `##` becomes the
top level: `## Hand-off` in hand-off.md, `## The wait` and `## The tail` in
tail.md, so the existing `section()` helpers still slice correctly.

The rest of SKILL.md:
- Its frontmatter description is rewritten to name harden, review and
  hand-off, and its body names each file.
- The tail prompt, now in tail.md, changes from "run 'The tail' in
  SKILL.md" to "read SKILL.md, then run `tail.md`".

## Specs to retarget

These specs read the moved sections, and each is retargeted to the file
that now holds them:

| Spec | Today | After |
|---|---|---|
| `.claude/scripts/tail-handoff-wiring.spec.mjs` | `## Hand-off`, `## The tail`, `## The wait` in SKILL.md | hand-off.md, tail.md |
| `.claude/scripts/task-runner.spec.mjs` | `**Parallel runs.**`, `## Preflight`, `### 1. Constitution`…`### 2.`, `## The tail`, and the whole file for `general-purpose` / re-reads | preflight.md, phases-plan.md, tail.md; the whole-file checks run over every layout file |
| `.claude/agents/agent-replies.spec.mjs` | envelope + `## Final Report` in SKILL.md | unchanged (stays in SKILL.md) |
| `lifecycle-wiring.spec.mjs` (#141) | `lifecycle.mjs ready/merge` in SKILL.md | hand-off.md, tail.md |
| `phase-dispatch.spec.mjs` (#144) | "Phase agents" in SKILL.md | SKILL.md, or wherever #144 left it once merged |

Once #141 and #144 are merged, refresh the `GATES` list in
`layout.spec.mjs` from those specs' literals.

## Measurement

- **Before**: 42492 bytes on origin/main 3486742. The stale fixes made it
  42519.
- **After**: `wc -c SKILL.md`.
- **Typical level-2 story run**: SKILL.md + preflight.md + phases-plan.md +
  phases-build.md + phases-close.md + commit-protocol.md + hand-off.md +
  report.md, each read once. Only SKILL.md stays loaded on every turn.
- **Level 1**: the same set; it skips phases but not files.
- **Tail agent**: SKILL.md + tail.md.
- **Per-turn saving**: 42492 − SKILL.md bytes.

## Overlap — wait before moving

#141 (696-lifecycle-script) rewrites Hand-off steps 1–6 and tail steps 5–6.
#144 (704-auto-phase-model-pins, ST-697) adds "Phase agents" and lines to
phases 1, 3, 4, 5, 6 and 7. Both were open and touching SKILL.md on
2026-10-05. Do the move only after both are merged, or once the one still
open no longer touches the file:

```
git fetch origin
gh pr view 141 --json state; gh pr view 144 --json state
git diff origin/main...origin/<branch> -- .claude/skills/speckit-auto/
```

Then run `git merge --no-edit origin/main` (only the stale-fix lines can
conflict), move the sections by the map above, retarget the specs,
refresh `GATES`, and turn `layout.spec.mjs` green.
