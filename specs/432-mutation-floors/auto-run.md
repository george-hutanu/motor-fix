# speckit-auto run — 432-mutation-floors

- Description: ST-432 — measure every project's mutation score, kill the surviving mutants and raise the floors.
- Start: branch `432-mutation-floors` from origin/main 7389ea3; start commit 206d3cc; draft PR #116.
- Preflight: tree clean; typecheck + lint + test green (scripts/heavy.sh).

## 0. Size
- Level 2 (feature): the intent needs settling (which survivors are in scope, how floors are derived).

## 1. Constitution
- v1.8.1 read; no placeholders.

## 2. Specify
- spec.md written; checklist all pass.
- Evidence: Mutation run 37215034382 (main, 2026-10-04). Diagnosis of the five failing Angular projects: Stryker's jest runner reads the config without its preset, so `testEnvironment` falls back to node (document/localStorage undefined); `web`'s four `@jest-environment node` specs bypass Stryker's environment (missing coverage); `overlays`' `styles: ERROR_TEXT` reads a mutated constant, which Angular's JIT transform cannot analyse (error 1010).
- Autonomous: survivor scope narrowed to contracts/mcp/api; the rest filed as follow-ups (spec Clarifications).
- design.md written (no screens).

## 3. Context
- org-researcher wrote context.md: no comment moves scope; Notion lists worker (no specs) and not overlays; AC 2 covers all projects (narrowed here, recorded as an owner-facing decision).

## 4. Clarify (spec-challenger, 5 answered with its recommendations)
- Full non-incremental run sets floors → new FR-012 dispatch input.
- Limit T = full-run job wall time + 30%, rounded up to 10, capped at 360.
- Every silence listed in the PR (SC-005), reviewed.
- FR-003 names error 1010; silence only compile-time-metadata constants.
- Kill-until-floor-passes only for contracts/mcp/api.

## 5. Plan
- plan.md: explicit `testEnvironment` per Angular config; Stryker's node environment in web's server specs; one silence on `ERROR_TEXT`; `full` dispatch input; minutes column in the job summary.

## 6. Checklist
- requirements.md: 0 unchecked.

## 7–8. Tasks, analyze
- tasks.md T001–T022; artifact-lint 0/0 after adding the Spec Delta (platform, Adds FR-001–FR-012) and moving FR-012 after FR-011; capabilities validate clean.
- Decision: entry points (`apps/api/src/main.ts`, `apps/mcp/src/main.ts`) are tested with mocked dependencies, not excluded from mutation, since what is mutated stays unchanged (Build brief).
- Decision: mcp's `req.url ?? '/'` default was an equivalent mutant (both give 404); rewritten as `req.url?.split(...)`, which removes it without a silence, behaviour unchanged.

## 9. Tests (red)
- scripts/mutation-setup.spec.ts: 9 of 18 failing (5 configs without testEnvironment, docblocks, unsilenced ERROR_TEXT, no full input, TODO limit); scripts/mutation.spec.ts summaryRows: did not compile (minutes argument).
- Survivor-killing tests (contracts fieldProblems + audit DTO, api ProblemFilter log/join + OpenAPI info + main, mcp main + no-path request) pass on the current code by nature: they pin behaviour the mutants change.

## 10. Implement
- All targeted suites green: scripts 38, contracts 136, mcp 24, api unit 16, web server 50, overlays 177.
- Provisional limit 140 (run 37215034382: 104 min × 1.3); reset from the full run.

## Resume (2026-10-05, after the watcher found the worktree stale)
- Uncommitted implement work (22 code files + records) kept; tasks T001–T017 marked done; T006/T016 reworded to the phase 7–8 entry-point decision.
- T001 baseline, run 37215034382 (main, incremental, 104 min job): contracts 51.25 (floor 95, failed); domain 71.51; api 70.59; mcp 80.00; scripts 66.26; i18n, overlays, ui-cockpit, web, media failed before scoring (environment / coverage / error 1010); worker skipped (no specs).

## Resume 2 (2026-10-05, second watcher restart)
- Head 642127f full runs (--full): contracts 100.00 (run 37317816085, floor 95), api 100.00 (37317821365), mcp 100.00 (37307366441, on b254daf); T019 met: no survivors.
- The all-project full run 37307358856 was cancelled; dispatched full runs for domain, scripts, i18n, overlays, ui-cockpit, web, media, one per project in parallel (T018 rest); floors and limit follow from them.

## Resume 3 (2026-10-06, after the merge of origin/main as bb951cb)
- Full runs on 642127f: media 90.63 (37360193873, 23 s), i18n 90.96 (37360174934, 3 min 36 s), web 84.28 (37360189195, 141 min 37 s; job 143 min). No score: overlays (37360179393) and ui-cockpit (37360184588) on error 1010; scripts (37360170703) failed its first test run; domain (37360166653) cancelled at the 360-minute ceiling.
- Cause of 1010: Stryker mutated the option objects of `input()` (`alias`), which Angular must read as literals; its `angular` ignorer is off unless named. Fix: `ignorers: ['angular']` in the shared options (test first: scripts/mutation.spec.ts).
- Cause of scripts: `git ls-files` lists nothing in Stryker's git-ignored sandbox; test-services.spec.ts now sets `GIT_DIR`/`GIT_WORK_TREE`. Reproduced red and then green in a copy under `.stryker-tmp/` (plain Jest, no mutation), scripts suite 234/234 there and in the tree.
- domain: no full score fits one job; keeps floor 0, follow-up in deferred.md (spec Session 2026-10-06).
- Full runs on d4fb40a: scripts 51.39 (37417183265, job 4 min), overlays 81.85 (37417177305, job 7 min), ui-cockpit 71.38 (37417179970, job 23 min). Every project with specs but domain now scores (T018).
- T019: contracts, api, mcp at 100 (Resume 2) — no survivors left.
- T020 floors = max(current, floor(score) - 5): contracts 95, api 95, mcp 95, web 79, i18n 85, media 85, overlays 76, ui-cockpit 66, scripts 46; domain 0 and worker 0 (no score).
- T021: limit stays 360, the cap: domain alone overflows it; the derivation comment names runs 37360166653 and 37360189195.
- T022: one follow-up per project in deferred.md (domain's carries the per-runner database).
- Phase 13 (refresh): the org-researcher subagent had no Notion tools; the run re-read ST-432 itself: no changes (context.md Refresh 2026-10-06).
- Phase 11 converge: converged, no tasks appended (domain's missing full score is the recorded overflow follow-up; FR-010/SC-005 are in the PR body at hand-off).
- Phase 12 harden: code-reviewer APPROVE, its four findings applied (mutation-setup TODO check dropped, main.spec name, app.module.spec types, problem.filter mocks restored in afterEach). test-adversary added scripts/mutation-floors.spec.ts; its duplicates of mutation-setup.spec (workflow input, schedule, restore, concurrency) and the exact-floor pins (the ratchet already guards falls) were trimmed. scripts 268/268, api specs green, lint and typecheck green, artifact-lint clean; diff-audit's 3 import-extension errors are false positives (bundler resolution), deferred as a harness item.
- Phase 14 review (origin/main...HEAD): spec-reviewer BLOCK on one HIGH (T007's "no lower than recorded" floor check was dead data), code-reviewer APPROVE with 4 MEDIUM/1 LOW. Fixed: the floors table now asserts break >= recorded and <= 100; the duplicate limit, ignorer, header and "hostile name" tests dropped. Unfixed LOW: mcp server.spec `end` assertion (kept, it pins the response is closed); FR-005 third route (rewrite) deferred as spec wording.
- Phase 14 re-review: spec-reviewer APPROVE (HIGH resolved); its one LOW (an FR id in the floors comment) fixed.
- Phase 15 agent context: not written. The managed block's one line in CLAUDE.local.md (tracked here) would grow by two bytes, past the context ratchet; it stays on 194-email-sending.
- Phase 16: retro-evidence (--since 206d3cc --jev) and instincts triggered gathered for the Final Report; Jev lane unavailable (no key).
- Phase 17 archive steps 1–3: capabilities validate clean; platform +12 added, ~0, -0 applied; spec.md status Archived (2026-10-06). /speckit-retro not run (speckit-auto phase 16: the verdict stays the owner's).

## Final Report

- Branch `432-mutation-floors`, feature `specs/432-mutation-floors`, range `206d3cc..bb71eaf` (259 commits counted, most of them from the merges of origin/main; the branch's own work is `origin/main...HEAD`). PR #116, now ready, label QA; story ST-432 is in QA.
- Phases: 0–10 were done in earlier runs (Resume 1–2). 11 converge: converged. 12 harden: code-reviewer APPROVE, test-adversary spec trimmed to what is not duplicated. 13 refresh: no new evidence. 14 review: spec-reviewer BLOCK on 1 HIGH, which was fixed; the re-review was APPROVE. code-reviewer APPROVE. 15 agent context: not written, because it would grow a tracked file. 16 evidence was gathered. 17 archive steps 1–3: platform +12, status line set to Archived.
- Autonomous decisions: see the Clarifications in spec.md and Resume 1–3 above. Domain keeps floor 0 and its per-runner database is filed as a follow-up. The survivor work is narrowed to contracts, mcp and api; the other projects are filed one per project. The workflow limit stays at 360, GitHub's cap.
- Verification:
  - `npx jest -c scripts/jest.config.cts`: "Tests: 252 passed, 252 total".
  - The pre-commit `nx affected -t typecheck test`: "Successfully ran targets typecheck, test for 12 projects".
  - `npm run lint`: "No fixes applied".
  - artifact-lint: 0 errors.
  - diff-audit:
    - 3 import-extension errors, which are false positives (bundler resolution), deferred.
    - 2 suppression warnings: the one ERROR_TEXT silence and the spec's own regex.
  - Every score comes from GitHub (run links are in the PR body).
- FR → test: table in tasks.md (FR-001..FR-012 each mapped to tasks T002–T022).
- Review leftovers:
  - LOW: the `end` assertion in the mcp server.spec is kept.
  - FR-005's third route (a behaviour-preserving rewrite) is deferred as a spec-wording item.
- Follow-ups: the 9 deferred.md bullets are filed as Notion To do tasks, each with its URL in the file.
- Open decision for the owner: ST-432's acceptance criteria ask for every survivor killed across all ten projects and a per-runner database when a run is too slow. The spec narrowed that, as recorded above.
- Hand-off: QA run 37420517445 (lap 1, head bb71eaf), dispatched with --no-wait. NEXT: tail #116 after QA run 37420517445.

### Retrospective evidence (unjudged)

Suggested verdict: none. The Jev lane was unavailable (no TYPESAFE_API_KEY), so no suggestion was made, and that is not an endorsement.

```
Retrospective evidence — 432-mutation-floors (level 2, feature)

Artifacts     spec.md, plan.md, tasks.md, deferred.md
Tasks         22 done, 0 open
Requirements  12 declared, 0 retired
Commits       255 (2026-10-05 → 2026-10-06)
Diff          475 files, +31688 −1664 over be4813dcb3ade4800a2b90e9afe30af8c9ad20b5..HEAD

Spec Delta
  platform: +12 ~0 -0

Deferred      0 open of 0

Carryover     10 open item(s) from earlier retrospectives
  050-cockpit-theme: The owner approves, or changes, the light theme's starting values on
  130-sign-in-gate: Add the expired-token case to the public-route sweep in `apps/api/src/public-routes.integration.spec.ts` (unassigned).
  157-dialog-drawer: Back closes the open task and keeps the page (Build brief scenario 8):
  157-dialog-drawer: A task whose code fails to load shows an error message and a retry,
  159-form-saving: Make the kit's `hlmInput` follow the shared reveal rule, so an empty required
  159-form-saving: Add the "sign up with an e-mail that is taken" end-to-end flow to the
  194-email-sending: Turn on `EMAIL_SENDING` on staging (worker and api) now that ST-194 has
  194-email-sending: Owner decides whether the worker crashes or keeps retrying when Brevo
  195-message-templates: The owner sets `PUBLIC_WEB_URL` on the Railway worker service (staging and production) before turning on `EMAIL_SENDING`
  195-message-templates: Before a story that touches more than one lib is marked ready, run `npm run test` (the whole workspace), not just the pr

Commits
  419d73e 2026-10-05 chore(auth): ST-568 start answering a password-reset request before issuing the link
  09f6265 2026-10-05 fix(auth): ST-568 answer a password-reset request before issuing the link
  93b5472 2026-10-05 fix(auth): ST-568 keep the address out of a failed reset link's log
  32b973f 2026-10-05 fix(auth): ST-568 wait for links asked for during shutdown
  e436bed 2026-10-05 Merge remote-tracking branch 'origin/main' into 568-reset-answer-first
  ef1a3f8 2026-10-05 docs(auth): ST-568 log the move to QA
  e437c0e 2026-10-05 fix(auth): ST-568 name a missing PUBLIC_WEB_URL in the reset log
  7d89074 2026-10-05 Merge remote-tracking branch 'origin/main' into 568-reset-answer-first
  b24c10a 2026-10-05 docs(web): ST-454 specify the home page landmarks
  a949f66 2026-10-05 fix(web): ST-454 give the home page one main landmark and a header for the sign-in bar
  2aa27d2 2026-10-05 Merge pull request #107 from george-hutanu/568-reset-answer-first
  94b42e1 2026-10-05 test(web): ST-454 cover one main on other public and not-found pages
  841e92f 2026-10-05 chore(specs): ST-641 start logging the ST-612, ST-629 and ST-568 finishes
  b9029ce 2026-10-05 docs(specs): ST-641 log the ST-612, ST-629 and ST-568 finishes and QA reports
  cb6e99a 2026-10-05 chore(ci): ST-440 start re-checking a corrected PR title on edit
  8faa0ac 2026-10-05 refactor(web): ST-454 share the server test set-up and explain the guard order
  19d3a63 2026-10-05 ci(ci): ST-440 check the PR title in its own workflow, re-run on edit
  4c6f8b2 2026-10-05 test(ci): ST-440 attack the PR title check and escape a line break in its error
  130538a 2026-10-05 chore(ci): ST-440 file the deferred rule mismatch as a Notion task
  d95e43b 2026-10-05 Merge pull request #117 from george-hutanu/chore-finish-logs-3
  0f21b1e 2026-10-05 chore(ci): ST-440 merge origin/main
  b6a5a0a 2026-10-05 chore(harness): start one reply shape for every agent
  b45b4c7 2026-10-05 chore(harness): start carrying the agent review over a docs-only head
  a5bf1af 2026-10-05 chore(harness): one reply envelope for every agent and summary-only reads
  8751061 2026-10-05 chore(harness): align the context dispatch with the researcher's reply cap
  179c79a 2026-10-05 feat(harness): carry the agent review over a docs-only head, verified by the merge gate
  0bbe5a2 2026-10-05 docs(harness): document the docs-only review carry in the lifecycle
  600dcf2 2026-10-05 Merge pull request #120 from george-hutanu/chore-agent-replies
  5f52561 2026-10-05 chore(harness): start the tail hand-off and in-PR finish logs
  78145c0 2026-10-05 fix(harness): bound the carry's gh reads and refuse a carry from outside the PR
  b542921 2026-10-05 feat(harness): dispatch a tail agent for a handed-off ready PR and check finish logs from stdin
  57097bc 2026-10-05 Merge remote-tracking branch 'origin/main' into feat-harness-agent-review-carry
  02f5554 2026-10-05 chore(harness): hand a ready PR to a tail agent and keep finish logs in the story PR
  5f42540 2026-10-05 fix(harness): let a story agent end at its hand-off and dispatch its own tail when run by the owner
  a73ce4c 2026-10-05 test(harness): keep the owner-run tail dispatch wired
  925f95c 2026-10-05 fix(harness): still ask a handed-off PR that passed QA to merge
  53ddff0 2026-10-05 Merge pull request #122 from george-hutanu/chore-tail-handoff
  0bb4578 2026-10-05 Merge remote-tracking branch 'origin/main' into 440-pr-title-edited
  5380d22 2026-10-05 docs(specs): ST-454 record the filed debt and the QA move
  a110dec 2026-10-05 Merge remote-tracking branch 'origin/main' into 454-home-main-landmark
  1d54994 2026-10-05 feat(mutation): ST-432 score every project under Stryker and take full runs on demand
  95a57ed 2026-10-05 fix(web): ST-454 keep the tab bar off the server render of /
  ff095cb 2026-10-05 test(mutation): ST-432 pin the behaviour the contracts, api and mcp survivors changed
  b254daf 2026-10-05 Merge remote-tracking branch 'origin/main' into 432-mutation-floors
  3fe21aa 2026-10-05 Merge remote-tracking branch 'origin/main' into feat-harness-agent-review-carry
  4988b8a 2026-10-05 docs(specs): start landing the ST-255 and ST-615 records
  63a2bc7 2026-10-05 docs(specs): land the ST-255 resync records and the ST-615 finish log
  fac594e 2026-10-05 chore(web): ST-614 start checking the visitor's language through a reload at 320 px
  b75ade3 2026-10-05 chore(harness): ST-450 start closing the PR tester's environment gaps
  27d538c 2026-10-05 Merge pull request #121 from george-hutanu/feat-harness-agent-review-carry
  10aa128 2026-10-05 chore(harness): ST-600 start make the merge gate run when started through a symlinked path
  57fb8eb 2026-10-05 Merge remote-tracking branch 'origin/main' into chore-land-255-518-records
  34b9656 2026-10-05 docs(specs): mark the ST-255 spec archived
  591fcc3 2026-10-05 Merge pull request #123 from george-hutanu/chore-land-255-518-records
  a5065df 2026-10-05 fix(web): ST-614 keep a language tapped before the page loads
  89e19a0 2026-10-05 fix(harness): let hooks started through a symlinked path find themselves as entry point
  35a08de 2026-10-05 Merge remote-tracking branch 'origin/main' into 614-visitor-lang-reload
  35f0f6c 2026-10-05 chore(notifications): ST-555 start keeping account links out of stored params
  6e56c33 2026-10-05 chore(specs): archive 600-merge-gate-symlink into the platform capability
  c332d9f 2026-10-05 chore(specs): ST-600 log the move to QA
  0c90108 2026-10-05 chore(specs): ST-600 log the hand-off
  0fa8ef6 2026-10-05 fix(web): ST-614 keep an early tap when storage is blocked
  76f1597 2026-10-05 feat(harness): give the PR tester local object storage, signed-in endpoint calls and a status on every lap
  1f53ba2 2026-10-05 Merge remote-tracking branch 'origin/main' into 450-pr-tester-env-gaps
  5331a36 2026-10-05 Merge remote-tracking branch 'origin/main' into 600-merge-gate-symlink
  d2ba484 2026-10-05 chore(specs): ST-614 archive 614-visitor-lang-reload into the i18n capability
  da5e0fc 2026-10-05 chore(specs): ST-614 log the move to QA
  add007f 2026-10-05 fix(notifications): keep the account link out of stored params once the e-mail leaves
  f5a8232 2026-10-05 test(web-e2e): leave the mailbox flows out of a deployed run by tag
  971f850 2026-10-05 test(notifications): add adversarial account-link tests and mark rows and drop links in one transaction
  b43b400 2026-10-05 fix(harness): harden the PR tester's cleanup, endpoint calls and sign-in against hostile input
  01c0482 2026-10-05 chore(specs): archive 450-pr-tester-env-gaps into the platform capability
  dc73422 2026-10-05 chore(specs): log ST-450 moving to QA
  abf1703 2026-10-05 chore(specs): archive 555-account-link-params into the notifications capability
  dda1157 2026-10-05 chore(specs): log ST-555 moving to QA
  7d40e47 2026-10-05 docs(specs): ST-614 file the QA lap 2 finding as tech debt
  79f0828 2026-10-05 Merge pull request #126 from george-hutanu/600-merge-gate-symlink
  cae99e7 2026-10-05 Merge remote-tracking branch 'origin/main' into 450-pr-tester-env-gaps
  b1a7b6f 2026-10-05 Merge pull request #125 from george-hutanu/450-pr-tester-env-gaps
  d5afba7 2026-10-05 Merge pull request #124 from george-hutanu/614-visitor-lang-reload
  59efcd1 2026-10-05 fix(web-e2e): start the test mailbox as an Nx target and give the e2e servers its settings from CI
  0093273 2026-10-05 chore(notifications): ST-571 start moving the news fan-out to a worker job
  f03e699 2026-10-05 chore(ui-cockpit): ST-582 start fix the live toast's axe findings
  98b1cf0 2026-10-05 refactor(notifications): ST-571 move the news fan-out to a worker job
  5353159 2026-10-05 Merge pull request #127 from george-hutanu/555-account-link-params
  836cb16 2026-10-05 test(notifications): ST-571 harden the news worker's last-attempt release
  b7ec772 2026-10-05 chore(notifications): ST-646 start sending a queued notification once
  582e954 2026-10-05 fix(ui-cockpit): ST-582 give the toast stack roles axe accepts and keep each toast live
  c14d9be 2026-10-05 chore(harness): ST-623 start precompact flush archived skip
  f55552a 2026-10-05 fix(harness): ST-623 skip archived features and keep porcelain columns in the pre-compact flush
  8ec2654 2026-10-05 fix(notifications): ST-646 claim a notification row before sending it
  306ec57 2026-10-05 chore(specs): archive 623-precompact-flush into the platform capability
  0cf3462 2026-10-05 chore(specs): ST-623 log the labels
  642127f 2026-10-05 test(mutation): ST-432 kill the survivors the full contracts and api runs found
  b245cff 2026-10-05 test(ui-cockpit): ST-582 cover action-button and dismissed toasts in the toaster spec
  1bd94cd 2026-10-05 chore(specs): ST-582 archive 582-live-toast-axe into the live-updates capability
  e0f1e07 2026-10-05 chore(specs): ST-582 log the move to QA
  9210e13 2026-10-05 Merge remote-tracking branch 'origin/main' into 582-live-toast-axe
  b33cd96 2026-10-05 test(notifications): ST-646 attack the send claim from outside and pin its lease boundary
  ab7e5f0 2026-10-05 chore(specs): ST-646 archive 646-notification-send-claim into the notifications capability
  9ef3642 2026-10-05 docs(specs): ST-440 link the deferred QA findings to their Notion tasks
  d328655 2026-10-05 chore(specs): ST-646 log the move to QA
  a836e64 2026-10-05 Merge remote-tracking branch 'origin/main' into 440-pr-title-edited
  4628b41 2026-10-05 Merge pull request #115 from george-hutanu/454-home-main-landmark
  3bd32b0 2026-10-05 fix(harness): keep the size level through specify and classify clear cases locally
  b8f8f0e 2026-10-05 chore(specs): ST-623 file the deferred findings
  0a54ee5 2026-10-05 chore(release): ST-663 start the staging end-to-end fix
  33d00f6 2026-10-05 chore(specs): ST-646 file the deferred debt in Notion
  63c5a7d 2026-10-05 Merge pull request #132 from george-hutanu/623-precompact-flush
  f209139 2026-10-05 Merge pull request #118 from george-hutanu/440-pr-title-edited
  01d0335 2026-10-05 fix(release): ST-663 seed staging before its end-to-end run and load cockpit texts before hydration
  10bdb8f 2026-10-05 Merge pull request #130 from george-hutanu/646-notification-send-claim
  9724b31 2026-10-05 Merge remote-tracking branch 'origin/main' into 571-news-fan-out-worker
  5985c21 2026-10-05 refactor(notifications): ST-571 save the news run in the outbox with the month's claim
  d52826f 2026-10-05 chore(specs): ST-582 file the QA lap 1 deferred findings
  9e15546 2026-10-05 fix(harness): ST-662 bind a size level to one feature, expire a waiting one and narrow what counts as trivial
  3a29baf 2026-10-05 Merge remote-tracking branch 'origin/main' into chore/size-level-persist
  455b75b 2026-10-05 chore(specs): ST-663 record the bug verification
  c86559b 2026-10-05 chore(release): ST-663 merge origin/main
  1f23726 2026-10-05 refactor(notifications): ST-571 give the news month back inside the run and test the relayed retries
  cd98a37 2026-10-05 chore(specs): ST-663 log the move to QA
  7f386a4 2026-10-05 chore(harness): ST-659 start make the merge gate fail closed when verifying a carried review runs long
  b65963a 2026-10-05 refactor(notifications): ST-571 log a news month that could not be given back
  39b1165 2026-10-05 Merge pull request #134 from george-hutanu/chore/size-level-persist
  df183a1 2026-10-05 chore(specs): archive 571-news-fan-out-worker into the notifications capability
  81f3537 2026-10-05 Merge pull request #129 from george-hutanu/582-live-toast-axe
  7dd4f15 2026-10-05 chore(specs): ST-571 log the move to QA
  42eb78a 2026-10-05 chore(specs): ST-663 file the deferred findings as tasks
  37d827f 2026-10-05 docs(specs): ST-659 specify the merge gate's deadline and fail-closed reads
  a25e475 2026-10-05 test(harness): ST-659 cover the merge gate's deadline, concurrent carry reads and the wrapper limit
  eab31fe 2026-10-05 chore(harness): ST-673 start dedicated story and tail agent definitions
  fd8ff18 2026-10-05 Merge remote-tracking branch 'origin/main' into 571-news-fan-out-worker
  7743054 2026-10-05 fix(harness): ST-659 make the merge gate refuse a check it cannot finish within its deadline
  7709824 2026-10-05 fix(harness): ST-659 apply the review to the merge gate deadline
  39ace2a 2026-10-05 chore(specs): ST-659 log the move to QA
  ae8db89 2026-10-05 Merge remote-tracking branch 'origin/main' into 659-merge-gate-carry-deadline
  edadab6 2026-10-05 test(harness): ST-673 specs for the task-runner agent and the constitution card
  2cf5089 2026-10-05 feat(harness): ST-673 run story, tail and watch agents as task-runner with the constitution card
  24e4467 2026-10-05 chore(harness): ST-687 start notion sync as a script
  7e3462d 2026-10-05 Merge pull request #128 from george-hutanu/571-news-fan-out-worker
  61eb270 2026-10-05 Merge pull request #135 from george-hutanu/663-release-staging-e2e
  b255ff1 2026-10-05 Merge remote-tracking branch 'origin/main' into 659-merge-gate-carry-deadline
  0db0c55 2026-10-05 fix(harness): ST-673 keep Artifact and WebStorm for task-runner and catch wrapped re-reads
  8eb3bad 2026-10-05 test(harness): ST-673 pin task-runner context wording and widen the re-read check
  7f7b77f 2026-10-05 chore(specs): archive 673-story-tail-agents into the platform capability
  479d592 2026-10-05 Merge remote-tracking branch 'origin/main' into 673-story-tail-agents
  0492ec2 2026-10-05 chore(specs): ST-673 log the move to QA
  0f94315 2026-10-05 chore(specs): ST-673 log the hand-off
  bf86dc2 2026-10-05 chore(harness): ST-688 start no agent holds its context across the CI and QA wait
  43a6b74 2026-10-05 docs(specs): ST-688 specify the dispatch-end-resume QA loop
  d062856 2026-10-05 docs(specs): ST-688 clarify the QA wait hand-off
  217b992 2026-10-05 docs(specs): ST-688 plan and tasks for the QA wait hand-off
  50cdaaa 2026-10-05 Merge pull request #138 from george-hutanu/673-story-tail-agents
  2563499 2026-10-05 feat(harness): ST-687 notion-sync script runs each lifecycle event in one call
  9849c4a 2026-10-05 docs(harness): ST-687 lead the notion sync skill with the script and add NOTION_TOKEN
  e01e52d 2026-10-05 Merge remote-tracking branch 'origin/main' into 688-qa-wait-handoff
  0efbf7e 2026-10-05 Merge remote-tracking branch 'origin/main' into 659-merge-gate-carry-deadline
  1ae354f 2026-10-05 feat(harness): ST-688 dispatch the QA run without waiting and let the watcher wait for it
  75f20bd 2026-10-05 docs(harness): ST-688 describe the dispatch, end and resume loop of the QA wait
  59c8822 2026-10-05 fix(harness): ST-687 replay notion writes safely and bound every Notion call
  d4f9d42 2026-10-05 docs(specs): ST-687 record the notion sync script spec, tasks and run
  2fc43ac 2026-10-05 chore(specs): ST-688 log the implement sync
  3a4fd11 2026-10-05 fix(harness): ST-687 stop notion replays piling up and refuse what would fail after a write
  5e0cc74 2026-10-05 fix(harness): ST-688 bound the wait on an unreadable QA run and let a passed head merge
  923c381 2026-10-05 fix(harness): ST-687 end a notion replay that can never succeed and refuse a debt task without a url
  1cd42bb 2026-10-05 Merge remote-tracking branch 'origin/main' into 687-notion-sync-script
  85cebd6 2026-10-05 chore(specs): archive 688-qa-wait-handoff into the platform capability
  7ee9e1a 2026-10-05 docs(specs): ST-687 file the deferred replay finding and close the harden task
  6c366ff 2026-10-05 chore(specs): ST-688 log the move to QA
  794e9fc 2026-10-05 docs(specs): ST-687 log the move to QA
  e1822ab 2026-10-05 docs(specs): ST-687 file the QA lap 4 deferred findings
  c9d16a5 2026-10-05 docs(specs): ST-688 file the QA lap 1 deferred findings
  63e9733 2026-10-05 chore(harness): ST-696 start lifecycle steps as one script call each
  8fdffc0 2026-10-05 chore(harness): ST-698 start the PR tester packet
  3fd71bb 2026-10-05 docs(specs): ST-703 specify the idle watch gate
  2dc2d2e 2026-10-05 chore(harness): ST-697 start the phase model pins fire under /speckit-auto
  91e6465 2026-10-05 docs(specs): ST-697 specify the phase model pins under /speckit-auto
  3486742 2026-10-05 Merge pull request #140 from george-hutanu/688-qa-wait-handoff
  20ede01 2026-10-05 docs(specs): ST-698 specify, clarify, plan and task the PR tester packet
  9fd48c1 2026-10-05 Merge remote-tracking branch 'origin/688-qa-wait-handoff' into 698-tester-packet
  48d02c7 2026-10-05 Merge remote-tracking branch 'origin/main' into 698-tester-packet
  46f8c83 2026-10-05 feat(harness): ST-696 run open, ready and merge as one lifecycle.mjs call each
  af1629f 2026-10-05 Merge remote-tracking branch 'origin/main' into 696-lifecycle-script
  14cc133 2026-10-05 chore(specs): ST-697 clarify the phase dispatch
  4a94fe5 2026-10-05 Merge remote-tracking branch 'origin/main' into 703-idle-watch-gate
  4150c82 2026-10-05 feat(harness): ST-696 name one lifecycle.mjs call per step in speckit-auto and speckit-git-commit
  4b644d2 2026-10-05 test(harness): ST-698 specify the pr-tester packet and its wiring
  dd8b27a 2026-10-05 chore(specs): ST-697 plan the phase dispatch
  f9deb4e 2026-10-05 docs(specs): ST-703 plan, tasks and context for the idle watch gate
  5f8b48a 2026-10-05 feat(harness): ST-698 start the pr-tester from a packet of what changed since the last tested run
  b3b7feb 2026-10-05 fix(harness): ST-696 stop on a missing gh token, remove temp files and quote the lifecycle reruns
  c94ad03 2026-10-05 chore(specs): ST-696 name the debt step and the token stop in the spec
  6700738 2026-10-05 chore(specs): ST-697 checklist for the phase-agent dispatch
  62c4e32 2026-10-05 chore(specs): ST-697 checklist strike note
  536a417 2026-10-05 chore(specs): ST-697 tasks for the phase model pins
  b9b088a 2026-10-05 chore(specs): ST-697 analyze fixes the spec delta
  152a7f0 2026-10-05 Merge remote-tracking branch 'origin/main' into 704-auto-phase-model-pins
  862a153 2026-10-05 feat(harness): ST-703 watch gate and background wait so an idle tick costs no model turn
  7871519 2026-10-05 fix(harness): ST-696 keep a failed finish comment, take the ready ST from the PR title and clean the spec fixtures
  a3f6079 2026-10-05 fix(harness): ST-696 remove the kept finish comment folder once it is posted
  5665497 2026-10-05 chore(specs): ST-696 record the review laps and the wait for 139
  8461eed 2026-10-05 fix(harness): ST-703 read the wait record from a dependency-free lib so the reminder never fails on import
  ee11423 2026-10-05 test(harness): ST-698 a change with no web file names only the cited screenshots
  4bde67c 2026-10-05 fix(harness): ST-698 name only cited screenshots when no web file changed
  4c1b4ce 2026-10-05 feat(harness): ST-697 dispatch pinned phases of speckit-auto as their own agents
  44aa656 2026-10-05 chore(specs): ST-697 measure the run before and after the phase agents
  aa54ebf 2026-10-05 refactor(harness): ST-704 start splitting speckit-auto into a lean run order and phase references
  d7fe534 2026-10-05 fix(harness): ST-703 exclusive wait record, bounded record reads and a spec for a failing poll
  2fdb584 2026-10-05 docs(specs): ST-698 record the before and after tester tokens on a replayed PR
  5a5026c 2026-10-05 refactor(harness): ST-697 name the dispatched phases and guard their pins
  041a4b9 2026-10-05 fix(harness): ST-703 take the wait record exclusively before removing a stale one
  ff4fe48 2026-10-05 test(harness): ST-698 attack the packet from outside its spec
  a4214a0 2026-10-05 chore(specs): ST-703 archive 703-idle-watch-gate into the platform capability
  ee137af 2026-10-05 fix(harness): ST-698 keep packet lines flat, bound FR ranges, skip links and reject a bad PR number
  a66068c 2026-10-05 docs(specs): ST-698 carry the no-web screenshot rule into the spec and defer the review's low findings
  59885c8 2026-10-05 chore(specs): ST-703 log the move to QA
  7ac9caa 2026-10-05 chore(specs): archive 704-auto-phase-model-pins into the platform capability
  64b76fe 2026-10-05 test(harness): ST-698 another PR's run is never this PR's previous lap
  c822d8e 2026-10-05 fix(harness): ST-698 share the finding key, keep another PR's findings out of the previous lap
  ced8fdc 2026-10-05 docs(specs): ST-704 spec, plan and section map for the speckit-auto split
  7a87e75 2026-10-05 docs(specs): ST-698 log the first review lap
  179fcad 2026-10-05 fix(harness): ST-704 correct stale app names, tracked specs and CI-only mutation in speckit-auto
  7cc01aa 2026-10-05 chore(specs): ST-697 log the move to QA
  4909ace 2026-10-05 test(harness): ST-704 rule inventory for the speckit-auto layout
  f89fa99 2026-10-05 refactor(harness): ST-698 flatten the run summary and notes, count only png screenshots
  57850da 2026-10-05 chore: archive 698-tester-packet into the platform capability
  5183516 2026-10-05 chore(specs): ST-698 log the move to QA
  73061db 2026-10-05 docs(specs): ST-698 log the hand-off
  c9f1e31 2026-10-05 Merge pull request #144 from george-hutanu/704-auto-phase-model-pins
  9b702f7 2026-10-05 Merge pull request #139 from george-hutanu/687-notion-sync-script
  480d809 2026-10-05 Merge remote-tracking branch 'origin/main' into 696-lifecycle-script
  496eec7 2026-10-05 Merge remote-tracking branch 'origin/main' into 659-merge-gate-carry-deadline
  e7c74a0 2026-10-05 chore(specs): ST-703 merge origin/main
  ab877ff 2026-10-05 Merge remote-tracking branch 'origin/main' into 698-tester-packet
  7f01ea6 2026-10-05 Merge pull request #137 from george-hutanu/659-merge-gate-carry-deadline
  d83c447 2026-10-05 chore(specs): ST-696 feature records
  4492f18 2026-10-05 Merge pull request #143 from george-hutanu/703-idle-watch-gate
  2c54ecf 2026-10-05 chore(specs): ST-696 feature records
  1f5c450 2026-10-05 perf(harness): ST-698 let the packet replace the tester's own reading of the diff, report and spec
  86a84c2 2026-10-05 Merge remote-tracking branch 'origin/main' into 698-tester-packet
  e5c1b53 2026-10-05 Merge pull request #142 from george-hutanu/698-tester-packet
  15c28b1 2026-10-05 chore(harness): ST-696 merge origin/main into 696-lifecycle-script
  82d0c8a 2026-10-05 Merge pull request #141 from george-hutanu/696-lifecycle-script
  bce892a 2026-10-06 Merge remote-tracking branch 'origin/main' into 705-auto-skill-split
  4a90167 2026-10-06 refactor(harness): ST-704 split speckit-auto into a lean run order and phase reference files
  cabfcae 2026-10-06 docs(specs): ST-704 measure the split, record deferred items and tick the tasks
  b7e34cc 2026-10-06 fix(harness): ST-704 apply review findings to the speckit-auto split
  a8a61a9 2026-10-06 chore(specs): archive 705-auto-skill-split into the platform capability
  011112e 2026-10-06 chore(specs): ST-704 feature records
  6587c80 2026-10-06 Merge pull request #145 from george-hutanu/705-auto-skill-split
  bb951cb 2026-10-06 Merge remote-tracking branch 'origin/main' into 432-mutation-floors
  d4fb40a 2026-10-06 fix(mutation): ST-432 score overlays, ui-cockpit and scripts under Stryker
  917ebdd 2026-10-06 feat(mutation): ST-432 raise every measured floor and file the remaining survivors
  1c58d0e 2026-10-06 test(mutation): ST-432 harden floors, options and api specs
  4e6c081 2026-10-06 test(mutation): ST-432 pin recorded floors and drop duplicate tests

· jev lane unavailable (no TYPESAFE_API_KEY (or JEV) in env or .env) — mechanical findings only
```

```
  · jev lane unavailable (no TYPESAFE_API_KEY (or JEV) in env or .env) — mechanical findings only
```
