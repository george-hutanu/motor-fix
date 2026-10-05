# Auto run — 688-qa-wait-handoff

- Description: ST-688 No agent holds its context across the CI and QA wait (Notion 3f0607bf-f0d2-8183-be81-dbf78b072125, EP-1, Tech debt).
- Start commit: 61eb270 (main), branch 688-qa-wait-handoff, worktree .worktrees/size-level-persist.
- Preflight: typecheck, lint, harness green; integration suite green against the worktree's own services.

## size
- level 2 (feature): full chain.

## constitution
- v1.8.1, no placeholders; read only.

## specify
- spec.md written; no clarification markers. Autonomous defaults in Assumptions (flows written by the dispatcher, docs-only CI wait, unreadable run = waiting, no constitution amendment, #138 paragraphs left alone).
- Notion start: Planning; draft PR #140 opened and linked.
- design.md: no screens.

## context
- org-researcher had no Notion tools ([UNAVAILABLE: notion]); main session read the story page and wrote context.md. Overlap with PR #138 noted: leave its tail-dispatch paragraphs alone.

## clarify
- spec-challenger: 8 findings; all answered with its recommendation except #1 (owner-run session holds the wait, the agent still ends at hand-off), #5 (blocks `verification-failed`, an existing condition, rather than a new one) and #6 (judged by reading the flows file, no new report field). Recorded under Clarifications.

## plan
- plan.md: new pr-test/qa-run.mjs (shared line writer/parser), dispatch --no-wait/--run, watch waiting verdict via runOf dep; gates untouched.

## checklist
- checklists/requirements.md: 16/16 checked.

## tasks
- tasks.md: 16 tasks, tests before each script and prose change.

## analyze
- artifact-lint --check: 0 errors after adding the Spec Delta (platform, Adds FR-001-FR-012); capabilities validate clean. Every FR maps to a task; no CRITICAL.

## Tests (red-first)

- qa-run.spec.mjs: suite red (module missing). watch.spec.mjs: 6 new red. dispatch.spec.mjs: 10 red (parseArgs, --no-wait, --run). tail-handoff-wiring + qa-in-ci: 6 red (prose).
- Coordinator: PR #138 merged to main (50cdaaa); merged origin/main into the branch before implementing (e01e52d), no conflicts.

## Implement

- qa-run.mjs (line format and parser), dispatch.mjs `--no-wait` / `--run <id>` (polls before it sleeps; `PR_QA_POLL_MS` for the specs), watch.mjs `waiting` verdict with `runOf`.
- The symlink fixture in watch.spec.mjs copies the watcher's imports by name: qa-run.mjs added there.
- Prose: speckit-auto Hand-off steps 4-6, new "The wait" section, The tail steps 1-3 (the #138 dispatch paragraph untouched); pr-tester `RUN` input, §2 flows in `.specify/.cache/qa-flows-<PR>.mjs` with the "flow not run" check, §3 `--run`; speckit-pr-test step 4/6; speckit-watch `waiting`; AGENTS.md steps 4-6.
- The wiring check for the agent uses `<PR>`, the agent file's own placeholder, not `<n>`.
- T016: test:harness 1226/1226, harness-eval --check 80/80, doctor 16 ok, gate files byte-identical to origin/main.

## Review
- spec-reviewer APPROVE; code-reviewer BLOCK on one HIGH (an unreadable QA run kept a handed-off PR waiting with no bound). Fixed tests first: it now waits only until the quiet threshold, then gets the tail; a head with agent-review success gets merge. Also patched: --routes on the hand-off and fix-lap dispatch, AGENTS.md step 6 wording, --no-wait with --run exits 64, the --run usage test asserts 64, fake-gh temp dirs removed, PR_QA_POLL_MS commented.
- Left as is (LOW): parseQaRun returns lap, which only its spec reads; runOf is asked while CI is still pending (one gh call per pass, and it names the run state in the reason).
- diff-audit errors in libs/domain came with the origin/main merge, not this diff.
