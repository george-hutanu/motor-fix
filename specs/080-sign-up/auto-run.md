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

## 6. Checklist
- checklists/requirements.md: all items pass, none struck.

## 7–8. Tasks, analyze
- tasks.md: 13 tasks, FR → test table. `artifact-lint.mjs` → 0 errors, 0 warnings (Jev lane unavailable: no key). No CRITICAL findings; nothing to remediate.

## 9. Tests (red first)
- Red before code: `sign-up.api.integration.spec.ts` 49 of 49 failing (no route); `common-passwords.spec.ts` unresolved module; web `sign-up.spec.ts` unresolved module, `sign-in.spec.ts`, `sign-in-dialog.spec.ts`, `session.signup.spec.ts` — 10 failing, 52 passing.

## 10. Implement
- Notion implement: ST-80 Planning → Implementing; timeline row → Implementing; label in development.
- Commits: 89fb27d feat(auth) API; 0ff0e58 feat(web) dialog; cb6c54e test(web-e2e).
- One deviation found by the tests: a text/plain body is never parsed, so it is a 400, not a 415 — as sign-in already answers; FR-005 reworded to say so.
- ST-79's "no route writes anything but a session" guard now lists `auth/sign-up` (a write that cannot choose a role).
- Verification: `npx jest libs/domain/src/auth` → 487 passed; web sign-in + session → 121 passed; typecheck 6 projects OK; biome clean (3 pre-existing warnings); e2e on local servers (api :3080, web :4280, seeded motorfix_st080): sign-up.spec 25 passed; sign-in, tab-bar, overlays, task-form, dashboards, phone → 111 passed.

## 11. Converge
- Every task [X]; every FR has a test in the FR → test table; no unbuilt work appended.

## 12. Harden
- diff-audit (local `main` is stale, 18c9e3d): no finding on a hand-written file of this branch; generated `libs/data-access` and the pre-existing `libs/contracts/src/index.ts` import rule only. Mutation: not run locally (owner rule: no local mutation tests).

## 14. Review (lap 1)
- spec-reviewer: APPROVE — 1 MEDIUM (deviation "on the story" had no story comment → comment posted), 4 LOW (logger context, comment wrap, static import, Status Draft) → all patched.
- code-reviewer: BLOCK — HIGH: session failure after commit untested → test added (500, no cookie, account kept, 409 next, sign-in works). MEDIUM: EXPIRE NX reply error ignored → every reply checked. MEDIUM defer: proxy trust on staging (already ST-82's task). LOW: SignUp interface → SignUpDto; loop exit comment; static import; decision: keep limit constants (owner confirmed 10/hour); defer: HMAC keys.
- Security verdicts (code-reviewer): enumeration PASS (email_taken allowed by brief, identical bodies, counted before any check); password rules PASS; rate limits PASS with the two fixes; logs PASS; CSRF PASS.
- test-adversary: 2 files, 142 tests, 11 failing → fixed: IPv4-mapped and IPv6 spellings share one key (/64 for IPv6); JSON-only guard before validation (form posts 415 whatever they hold; prototype keys 400); client lengths in code points; switch disabled while sending. Sign-in's text-body tests moved from 400 to 415.
- Owner decision relayed by the coordinator: 10 attempts an hour per address, recorded in spec Clarifications, notion-sync.md and the brief (proposed → Decided 2026-10-04).
- Verification: `npx jest libs/domain/src/auth apps/web/src/app/sign-in` → 716 passed; `npx jest apps/api` → 59 passed.
- code-reviewer re-review (f40315e): APPROVE, HIGH closed; new MEDIUM: a zone-id address made `clientOf` throw outside the try → zone stripped, key built inside the try, `attempts.spec.ts` (8) red then green. Merge of origin/main (ST-20 #51) as 26af690: auth route guard lists both writes; data-access regenerated.
