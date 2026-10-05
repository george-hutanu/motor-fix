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

## 10. Implement

- Notion: ST-698 and its Foundations timeline row Planning → Implementing; PR #142 label `in development`. The timeline row was found by id from the start run because Notion's Query Data Source usage limit was reached (`[NOTION-SYNC NOTE: query limit — row updated by its known id]`).
- `packet.mjs` written; `packet.spec.mjs` 15/15 green. pr-tester.md: §1 no longer reads the whole diff, new §3c builds the packet, §4 starts from `packet.md` and opens only the screenshots it names; opus, the full constitution review, the verdict rules and post.mjs unchanged. The skill's Test step names the packet.
- A wiring assertion was made whitespace-tolerant (the prose wraps a line); same claim, no weakening.
- Verify: `npm run test:harness` 57 files / 1251 tests passed; `harness-eval.mjs --check` 80/80; `doctor.mjs` 16 ok; `git diff origin/main` on merge-gate.mjs, merge-gate.json and carry.mjs is empty.
- Replay (T007), PR #137 run 37326786521. The first packet named 18 entries: 17 screenshots differed by run-time noise, plus `harness-eval.log`. New tests (red 2/17, then green) and a fix: only images count, and a change with no web file names only the cited screenshots. Measured weighted per run: old 203,803 (a2e3ea570a207207c); new 252,396 (a73a568a871f4db70), then 249,500 after the fix (ab937b48d68830784). Verdict `success` in every replay, the same as the recorded lap. No token drop on this PR; spec.md has the Measurement section, and the web-PR re-lap measurement is deferred.

## 11. Converge
- Every task is ticked and every FR maps to packet.spec.mjs or packet-wiring.spec.mjs. The repo rule keeps FR ids out of tests, so trace-matrix tags are not used (as in the other harness features). No new work was found.

## 12. Harden
- artifact-lint is clean. diff-audit errors are only in libs/domain files outside this diff. Mutation testing was skipped because .claude/ is not an Nx project. test-adversary and code-reviewer were dispatched.
- npm run test:harness: 57 files, 1253 tests passed. harness-eval --check: 80/80. doctor: 16 ok. merge-gate.mjs, carry.mjs and evals/ show no diff against origin/main.

## 13. Ticket refresh
- The story has no new comments, so the refresh is empty and passes.

## 15. Agent context
- No change. CLAUDE.local.md is not checked in, and this feature adds no stack or command to it.

## 16. Retrospective evidence
- retro-evidence covers 22 commits since 50cdaaa. One fix lap came from the replay measurement: a harness-only PR still had run-time screenshot noise. The Jev lane was unavailable (no key). The verdict stays with the owner.

## 14. Review (lap 1)
- test-adversary wrote 56 tests and 8 failed. Fixes: a bounded FR range, flat titles so no heading can be forged, symlinks skipped, a non-numeric `--pr` rejected. Three tests assumed that with no baseline every screenshot is named; they were aligned to the amended no-web rule.
- spec-reviewer BLOCK. HIGH: FR-005 and US2 did not state the no-web rule, so both were amended. HIGH, a decision: SC-001 is not met (no drop on #137). Decision (a): merge, re-measure on a web PR's re-lap and cut the packet if it stays flat. SC-001 is reworded to match the brief's acceptance and the clarification (measured and reported, no threshold), and the decision is open for the owner in handoff.md. LOW items: T001 ticked; the `--run`-less `before` rule deferred.
- code-reviewer BLOCK. Rows 1, 4, 5 and 8 were fixed by the adversary fixes. Row 2 decided (b): the agent's wording now says "unless no web file". Row 3: the same decision as SC-001, (a). Row 6: `findingKey` is exported from findings.mjs and shared. Row 7: `packetMarkdown` is no longer exported. Row 9 (a): another PR's run never gives the previous lap (a test, red then green). Row 10: the constants are named and documented.
- Lap 2: spec-reviewer APPROVE, code-reviewer APPROVE. The LOW patches were applied: summary and notes flattened, png only, FR-003 says the same PR only, and FR-007 places the packet read in the review.

## 17. Archive
- spec.md status is Archived (2026-10-05). The Spec Delta merged into platform (+9). Two deferred items were filed as Notion To do tasks. The retro verdict stays with the owner, and the evidence is in section 16.

## Final report
- PR #142 is ready, labelled QA, and the Notion story and timeline row are at QA. QA run 37365934277 was dispatched with --no-wait at 57850da. The head 5183516 differs by the docs-only qa line.
- Measured: the old tester used 203,803 weighted tokens and the new one 249,500 (PR #137 replay). The verdict was success in every replay, the same as the recorded agent-review. No token drop, and that is open for the owner.
- Checks: test:harness 58 files / 1310 tests, harness-eval 80/80, doctor 16 ok, merge gate, evals and carry unchanged. Review lap 2: both reviewers APPROVE.
- NEXT: tail #142 after QA run 37365934277.

## Rework (owner held the merge at +22%)
- Cause, from the two replay transcripts: 16 turns against 12; the diff read twice, separate fetch and cat-file turns, readiness grepped twice, post.mjs read for the findings shape. The packet sat on top of the tester's own reading.
- Change: packet.mjs carries readiness from run.log and writes review.diff (tests first: 4 red, then green); pr-tester.md batches the read, packet and review, reads review.diff and the full constitution in one turn, and gives the findings shape inline; the skill says so.
- Re-measured, PR #137 replay: 181,606 weighted (6 turns) against 203,803 (12 turns); 533,189 tokens against 1,004,144; verdict success both.
- Merged origin/main (ST-697 #144, ST-688 #140, ST-704's capability lines kept beside ST-698's).

