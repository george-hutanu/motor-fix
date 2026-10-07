# Auto run — 569-auth-events-through-event-port

ST-569 Record password-reset and session events through the event port — https://app.notion.com/p/3f0607bff0d28111a434e75fcd9c94d3 (Task, Foundations epic; tech debt deferred by the reviews of ST-127, PR #72). A completed password reset (`PasswordResetService.complete`) records no domain event through EVENT_PORT inside its transaction, as `SignInService.signOutEverywhere` does; its password_changed e-mail and session.revoked live message go out after the commit. Sign-in's own session.revoked publish follows the same pattern; decide once for the auth flows.

Start: origin/main bd60afa6 (worktree `.worktrees/569-auth-events-through-event-port`, branch `569-auth-events-through-event-port`, draft PR #187).

## Preflight

- Full suite green except `apps/web` `waiting.spec.ts`, which cannot resolve `fake-indexeddb`: the shared node_modules of the main checkout predates that dependency (environment, not code; CI runs `npm ci`).
- size: level 2, recorded for `next` and pointed at this feature by `level.mjs point`.

## Phase 2 — Specify

- before_specify git hook skipped: the branch and its draft PR #187 already exist; `.specify/feature.json` points at `specs/569-auth-events-through-event-port`.
- Notion task read (no comments, no Design boards); deferred item `specs/127-password-reset/deferred.md:6`.
- spec: 4 FRs, 2 user stories, Spec Delta on `accounts` (adds 4) and `live-updates` (modifies 257-FR-011).
- Clarifications answered autonomously, each under Clarifications with evidence:
  1. The completed reset records one `account.password_reset` (new EVENT_KINDS entry) through EVENT_PORT inside the reset's transaction; audience and subject the account; payload `{ accountId }` only; a refused reset records none. Evidence: Constitution VI; `signOutEverywhere` records `account.signed_out_everywhere` the same way.
  2. `session.revoked` stays a direct live publish after the commit for both flows, through one shared helper on SignInService. Evidence: `libs/contracts/src/events.ts` header lists it among the kinds published straight to Redis; refresh tokens are already deleted in the transaction, so a missed nudge signs the tab out at its next renewal.
  3. The password_changed e-mail stays on the notifications queue after the commit, failure logged. Evidence: ST-127 Build brief "Events and notifications": "Emits: none; both e-mails go straight to the notifications queue"; the event supersedes only "Emits: none". Outbox consumer out of scope.
  4. No screen, API contract or web change; existing behaviour unchanged.
- Requirements are testable by Jest integration specs on real PostgreSQL (outbox row present after a reset, absent after a refused one).
- after_specify hooks: notion-sync start + pr 187, design check (no screens), level check, commit.

## Phase 0 — Size
level 2 (classifier 0.80: touches session; boards 1; brief not found).

## Phase 1 — Constitution
v1.8.2, no placeholders. Principles I and VI carried.

## Phase 3 — Org context
org-researcher: partial (Foundations epic and Backend architecture pages too large; seen through highlights). context.md written; no contradictions with the spec's decisions. Follow-ups for the finish comment: add `account.password_reset` to the Backend architecture events list, and ST-127's "Emits: none" now reads one event.

## Phase 4 — Clarify
spec-challenger: 7 findings; 5 answered in spec Clarifications (shared method on SignInService; FR-003 modifies 128-FR-004; e-mail/nudge order unspecified; event-port failure is a 500; SC-002 covers the two flows touched), 2 applied as edits (SC-003 allows added assertions; US2 test asserts the stub after the call resolves).

## Phase 5 — Plan
model fable. STATUS: success — plan.md, research.md, data-model.md, quickstart.md written; no contracts/ (FR-004: no interface change).
- before_plan design check: design.md current (no screens); after_plan commit: this commit.
- Technical Context from package.json (TypeScript 6.0.3, NestJS 12.1.2, Prisma 7.10.0, ioredis 6.0.0, Jest 30.5.2), tsconfig.base.json, libs/domain/jest.config.cts, jest.preset.cjs.
- Decisions (research.md R1–R4): the event is `events.record(tx, …)` after `audit.record` inside the reset's transaction, `EVENT_PORT` injected (AuthModule is global and exports it, so PasswordResetModule needs no provider); one public `SignInService` method holds the `session.revoked` publish + catch + warn for both flows, the reset drops `SESSION_EVENTS`, `publishLive`, `audienceOf`, `randomUUID` (`SESSION_EVENTS` stays exported: the reset spec spies on it); `EVENT_KINDS` feeds nothing generated (not in openapi.json; only events.spec.ts and the `EventKind` type read it; the web matches only `session.revoked`; the live hub has no per-kind rule to join); tests reuse the sign-out-everywhere spec's `EVENT_PORT` override pattern, the adversary spec is untouched.
- Constitution check: all gates pass before and after design; Complexity Tracking empty.

## Phase 6 — Checklist
model sonnet. STATUS: success — `checklists/auth-events.md` written, 19 items (event recording, rollback, live nudge, scope), 19 checked, 0 unchecked, 0 struck.
- One spec gap fixed: CHK006 (the task's "Sign-in's own publish" is `SignInService.signOutEverywhere`, not a third flow), added as a Clarifications line.
- CHK010 judged satisfied: FR-002's "answer stays" covers refusals; US1 AS4 states the 500 for a port failure, so the two do not conflict.
