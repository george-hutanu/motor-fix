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
