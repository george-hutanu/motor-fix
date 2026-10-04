# Auto run — 080-sign-up

- Description: ST-80 Create an account with e-mail and password (https://app.notion.com/p/3ee607bff0d2813a9bd4d4acd406ca56)
- Start commit: 4586f6e (origin/main), branch `080-sign-up`, worktree `.claude/worktrees/agent-afdc790a96242e75b`
- Preflight: clean tree; `npm run typecheck` OK; `npm run lint` OK; `npm test` — 11 projects passed (DATABASE_URL `motorfix_st080`, REDIS_URL db 8)

## 0. Size
- Level 2 (feature): API + UI + e2e, several FRs; `level.mjs set 2`.

## 1. Constitution
- v1.3.0 read; no placeholders. Principle I drives: no new dependency, no "Am un service" control, no consent argument before ST-132, `libs/overlays` untouched.

## 2. Specify
- spec.md written from the story's Build brief (2026-10-03) and ST-494. Assumptions marked `(autonomous default)`.
- Notion start: ST-80 To do → Planning; timeline row Not started → Planning; EP-1 unchanged (In progress); ready −ST-80 −ST-20 −ST-158.
- Draft PR #53 at the first commit (bcd7bd4), labels planning, feature, scope: auth, EP-1, ui; PR link written to the story.

## 3. Org context
- context.md written by org-researcher: 8 contradictions, all recorded in spec Assumptions/Clarifications. Security page has no sign-up enumeration rule; the brief's `email_taken` is the source.

## 4. Clarify
- Five questions answered with spec-challenger's recommendations (switch loop, check order, weak before taken, language required, late answer keeps the session); five more resolved without a question. See spec Clarifications.

## 5. Plan
- plan.md: no migration; reuse `createAccount`, `hashPassword`, `openSession`, `keep()`; new `SignUpService`, `admitSignUp`, `common-passwords.ts`; web: sign-up task + switch loop.
