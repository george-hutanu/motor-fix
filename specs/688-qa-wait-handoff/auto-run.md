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
