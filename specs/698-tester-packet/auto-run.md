# speckit-auto run — 698-tester-packet

- Description: ST-698 The PR tester starts from a packet and reviews only what changed (see spec.md Input).
- Start: branch main at 50cdaaa (worktree lever-7-tester-packet), branch 698-tester-packet.
- Preflight: tree clean, `npm ci`, typecheck + lint + test green.

## 0. Size
- level 2 (feature): harness scripts plus agent/skill prose, with a design choice (baseline selection, screenshot comparison).

## 1. Constitution
- v1.8.1 read, no placeholders. Principles I (no bloat), II (tests first) and VII (PR lifecycle) carried.

## 2. Specify
- Baseline measured from pr-tester transcripts (spec.md Baseline): 95 runs, median 658,414 tokens / 164,474 weighted per run; since CI QA 32 runs, median 688,277 / 182,219.
- Autonomous defaults: replay target PR #137 in dry-run; SHA-256 screenshot compare; packet not committed; builds on PR #140.
- after_specify: story Planning, timeline row created (Planning), EP-1 already In progress, ready no change; draft PR #142 (planning, tooling, scope: harness, EP-1), linked in Notion; design.md: no screens.

## 3. Org context
- org-researcher had no Notion tool in this session ([UNAVAILABLE: notion]); context.md carries the story as read by the run for the start sync. Not a stop.

## 4. Clarify
- spec-challenger: 5 findings, all answered with their recommendation (spec.md Clarifications), except Q1's source: the committed `pr-review/lap<n>/report.json` at the PR head holds the tester's findings with `kind`, so the review body need not be parsed.
- Q2 finished run = success/failure, before the run under review, artifact with report.json. Q3 `gh pr view --json files`, cap 100. Q4 path substring, ranges expanded, contents API at head. Q5 measured numbers, both transcript ids, no threshold.

## 5. Plan
- plan.md: one script `packet.mjs` (gh through `realGh`, injected), a wiring spec, prose edits; no new dependency. Run tested PR/head/lap parsed from the run name.

## 6. Checklist
- requirements.md: all items checked.

## 7–8. Tasks, analyze
- tasks.md T001–T007; every FR mapped. artifact-lint: Spec Delta was missing (platform, Adds FR-001–FR-009), added; now clean.

## 9. Tests

- `packet.spec.mjs` (FR-001–FR-006, fake `gh`, temp artifact folders) and `packet-wiring.spec.mjs` (FR-007–FR-009) written first.
- Red: `vitest run` on both → Test Files 2 failed; `packet.spec.mjs` fails at import (no `packet.mjs`), wiring 5 failed | 2 passed (the two passing are guards: opus/constitution/post kept, merge gate and carry never read the packet).
- FR-009 (autonomous): tested as independence (neither file mentions the packet); byte-equality with `origin/main` is a `git diff` check in T006, not a test that would break on the next legitimate change to the gate.
- Coordinator note: #140 merged as 3486742; the branch already contains `origin/main` at 3486742.
