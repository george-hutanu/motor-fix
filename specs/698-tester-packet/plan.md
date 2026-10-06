# Implementation Plan: The PR tester starts from a packet and reviews only what changed

**Branch**: `698-tester-packet` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

## Summary

One new script, `.claude/scripts/pr-test/packet.mjs`, writes `packet.md` into
the lap's `--out` folder after `dispatch.mjs` has downloaded the run's
artifact. It gathers in one call what the tester assembled over a dozen turns
(PR header and files, FRs touched, the report's verdict and findings) and adds
a delta against a baseline run (previous lap's findings marked new, persisting
or resolved; screenshots compared by SHA-256). `pr-tester.md` and the
`speckit-pr-test` skill tell the tester to build and read it first and open
only the screenshots it names. Built on PR #140 (ST-688), merged in first.

## Technical Context

- **Language**: Node.js ESM (`.mjs`), the harness's own scripts; Node 24 (`package.json` engines / `.nvmrc`), no TypeScript in `.claude/`.
- **Dependencies**: none new. `node:crypto` (SHA-256), `node:fs`, `node:path`; `gh` through `realGh` from `post.mjs` (never throws, returns `{code, stdout, stderr}`), injected for tests.
- **Testing**: vitest through `npm run test:harness` (`.claude/vitest.config.ts`), colocated `packet.spec.mjs`; a stub `gh` function, temp folders for artifact fixtures.
- **GitHub reads**: `gh pr view <n> --json number,title,headRefName,headRefOid,baseRefName,files`; `gh run list --workflow pr-qa.yml --json databaseId,displayTitle,conclusion,createdAt --limit 100` (the tested PR, head and lap are parsed from the run name `PR QA #<pr> at <sha> lap <lap> <nonce>`); `gh api repos/<repo>/compare/<base>...<sha>` (`status` `behind` or `identical` means the tested commit is on the base branch); `gh api -H 'Accept: application/vnd.github.raw' repos/<repo>/contents/<path>?ref=<head>` for `tasks.md`, `spec.md` and `pr-review/lap<n>/report.json`; `gh run download <id> -n pr-qa-<pr> -D <tmp>` for the baseline artifact.
- **Constraints**: the packet never fails the lap: only a missing `report.json` exits 2; each `gh` failure marks its section unavailable. The merge gate, its evals and `carry.mjs` are not touched (FR-009).
- **Scale**: one PR per call; at most 100 runs listed, 100 files shown.

## Constitution Check

- I No bloat: one script, pure helpers exported only where a spec tests them; reuses `realGh`, `mergeFindings`' key, `artifactName`; no image library (byte hash).
- II Tests first: `packet.spec.mjs` and a wiring spec are written and fail before the script and the prose change.
- VII Lifecycle: draft PR #142 open; ready only after #140 is merged and `origin/main` merged in.
- No FR or task ids in source or test titles.

## Project Structure

```text
specs/698-tester-packet/   spec.md plan.md tasks.md design.md context.md auto-run.md notion-sync.md
.claude/scripts/pr-test/
  packet.mjs               new: CLI + exported helpers
  packet.spec.mjs          new: unit specs with a stub gh and temp artifact folders
  packet-wiring.spec.mjs   new: pr-tester.md and the skill name the packet step; merge gate, evals and carry unchanged vs main
.claude/agents/pr-tester.md               edited: build and read the packet first
.claude/skills/speckit-pr-test/SKILL.md    edited: the packet step in Test
```

CLI: `node .claude/scripts/pr-test/packet.mjs --pr <n> --out <dir> [--repo o/r] [--run <id>] [--baseline <run-id|dir>]`.
`--run` is the run under review (excluded from baseline candidates and the
clock for "created before"); without it, the report's `sha` and `lap` exclude
the same head.

Helpers (exported for the spec): `fileLines(files, cap)`, `frIds(line)`,
`frsTouched({ tasks, spec, paths })`, `parseRunName(title)`,
`chooseBaseline({ runs, pr, head, before, onBase })`, `findingDelta(prev, cur)`,
`shotDelta({ current, baseline, cited })`, `packetMarkdown(parts)`,
`buildPacket({ out, pr, repo, run, baseline, gh, download })`.

## Measurement plan (SC-001, SC-002)

Before: the real lap-2 pr-tester transcript of PR #137 (run 37326786521,
`agent-a12fd20b9713ddf41`, 21 turns, 823,365 tokens, 182,219 weighted). After:
a pr-tester dispatched with the new instructions, `DRY_RUN=1 RUN=37326786521
LAP=2` on #137, measured from its transcript with the same `runs.mjs` weights.
If the artifact has expired, the newest finished run of an open PR is used for
both, the old side run from `main`'s `pr-tester.md` in dry-run. Both verdicts
must equal #137's `agent-review` (success).

## Complexity Tracking

None.
