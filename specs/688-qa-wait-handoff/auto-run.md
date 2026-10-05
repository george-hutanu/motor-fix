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
