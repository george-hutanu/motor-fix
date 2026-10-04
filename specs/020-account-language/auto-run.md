# Auto run — 020-account-language

- Description: Notion story ST-20 "Keep my language on my account for messages" — saved account language, PATCH /api/v1/me, web switch saves while signed in.
- Start commit: b76ea92 (origin/main), branch 020-account-language, worktree agent-a67de91c8f7c7fba6.
- Preflight: typecheck 0, lint 0, `nx run-many -t test` 0 (DATABASE_URL=motorfix_st020, local PostgreSQL and Redis).

## Size
- Level 2 (feature): API and web, a design choice in how the web save hooks into the switch.

## Constitution
- v1.6.0 read; no placeholders. Principle I first.

## Specify
- Spec written from the story's Build brief (wins over the criteria above it). No [NEEDS CLARIFICATION]; autonomous defaults listed in spec Assumptions:
  - messages and the reset e-mail do not exist yet → out of scope (brief Out of scope + templates story).
  - new account takes interface language → already supported by createAccount (accounts.service.ts:40).
  - retry at sign-in conflicts with "account wins at sign-in" → account wins; retry only at next change.
  - no event (brief "Emits: none").
- Draft PR #51 opened at the first commit (docs), labels planning, feature, scope: auth, EP-1, ui.
