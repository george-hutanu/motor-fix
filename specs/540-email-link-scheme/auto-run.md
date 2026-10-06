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
