# Tasks - 687-notion-sync-script

- [X] T001 Red: .claude/scripts/lib/notion.spec.mjs covers FR-001 (headers, version, timeout, 429 Retry-After), FR-002 (env, repo .env, main checkout .env), FR-014 (the token never in an error).
- [X] T002 Red: .claude/scripts/notion-sync.spec.mjs covers FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012 and FR-013 with stubbed fetch and gh: one spec per event asserting the exact requests, the no-token exit, a PENDING line and its retry, the `log` line equal to the event's, `check` read-only, and the token absent from every output.
- [X] T003 Red: .claude/scripts/notion-sync-wiring.spec.mjs covers FR-015 (skill script-first, connector fallback, under 14,725 bytes) and FR-016 (`.env.example` ends with NOTION_TOKEN).
- [X] T004 Green: .claude/scripts/lib/notion.mjs, the client.
- [X] T005 Green: .claude/scripts/notion-sync.mjs, the events (FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014), reusing notion-status, notion-ready, debt-tasks and run-state as modules (notion-status gains `recordPrior`, which its CLI now uses).
- [X] T006 Green: rewrite .claude/skills/speckit-notion-sync/SKILL.md script-first; `.env.example` gains NOTION_TOKEN at the end.
- [ ] T007 Harden: npm run test:harness, doctor, artifact-lint, diff-audit; review.
