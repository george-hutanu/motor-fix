# Auto run: 540-email-link-scheme

- Description: ST-540, tech debt from ST-195: refuse an e-mail button/stop href that is not https: (http: only on localhost/127.0.0.1).
- Start: b27b5e6b on origin/main, worktree .worktrees/540-email-link-scheme, PR #168 draft.
- Preflight: typecheck, lint, test green (exit 0).

## Phases

- 0 size: level 2 (notion: boards rollup 1, brief not found).
- 1 constitution: v1.8.1 card read.
- 2 specify: task-runner (fable) STATUS success; 4 FRs; Notion start To do → Planning.
- 3 context: org-researcher STATUS success; 4 findings, 0 contradictions.
- 4 clarify: spec-challenger 5 findings, all answered with the recommendation (clarify session in spec.md), except Q2: check in render()'s email case, not emailHtml, because the refusal must be a TemplateError with template and channel (templates.ts:139) and emailHtml's only caller is render() (templates.ts:180). level check: 2 unchanged.
- 5 plan: plan.md written (Technical Context from package.json, tsconfig.base.json, libs/domain/jest.config.cts; constitution gates all pass); no research.md, data-model.md, contracts/ or quickstart.md (nothing unresolved, no entity, no interface; validation steps in plan.md). before_plan design check skipped (design.md current, no screens); after_plan agent-context update skipped (CLAUDE.local.md is private and not committed).
- 6 checklist: checklists/email-link.md, 19 items, 0 unchecked; 3 gaps fixed in spec.md (empty string and whitespace in FR-001, credentials/host out of scope in Edge Cases), CHK019 struck as N/A.
- 7 tasks: tasks.md, 4 tasks (T001-T002 specs red first, T003 safeHref in templates.ts, T004 validation), 1 story, no parallel work; after_tasks analyze left to caller.
- 8 analyze: inline; artifact-lint 0/0; spec/plan/tasks consistent (FR-001..004 each covered by T001-T003); no remediation.
- 9 tests: link table red (10 refusals failing, accepts green) before T003.
- 10 implement: safeHref in templates.ts render() email case; notifications unit specs 667 green.
- 14 review: spec-reviewer APPROVE, code-reviewer APPROVE; shared LOW (no padded-href row) fixed.
- 16 retro evidence: not run separately (verdict stays the owner's).
- 17 archive: notifications +4 (540-FR-001..004); spec Archived (2026-10-06).
