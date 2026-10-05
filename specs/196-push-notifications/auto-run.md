# Auto run — 196-push-notifications

- Description: ST-196 Set up push notifications (https://app.notion.com/p/3ee607bff0d28156a023d73a7262de80) — Web Push as a channel of the notifications service from the installable web app.
- Start: branch 196-push-notifications from origin/main 2aa27d24d7c3b544d3decd82a2fc9d955c13f6b0, worktree .worktrees/196-push-notifications
- Draft PR: #119

## 0. Size
- Level 2 (feature): new channel, new endpoints, a table, a worker adapter, a service-worker hook and a settings panel; design has choices. (autonomous)

## 1. Constitution
- Read v1.8.1; versioned, no placeholders.

## Preflight
- `npm ci`, then typecheck + lint + test through scripts/heavy.sh: green.

## 2. Specify
- spec.md written with FR-001..FR-018, checklist all passing.
- (autonomous) Web Push goes direct with VAPID keys, not through Brevo: the Build brief leaves it open for the build team (within A18) with this as the fallback: Brevo cannot send standard Web Push to our own service worker subscription.
- (autonomous) Push panel sits on Setări for driver and admin, and on the garage home view (garage has no settings view yet).

## after_specify hooks
- notion-sync start: story Planning, timeline row Planning, EP-1 unchanged, draft PR #119 linked; notion-ready running.
- design-check: design.md written (push panel not designed; placement as in spec FR-006).

## 3. Context
- context.md written (org-researcher). Query Data Source quota hit; sibling statuses unread.
- 5 contradictions carried to clarify: VAPID vs Brevo, self-service test, sign-out everywhere, keys-missing state, garage placement.

## 4. Clarify
spec-challenger: 5 questions + 4 notes. Answers (its recommendations; applied to spec Clarifications, FR-007, FR-018..021, edge case, SC-001, Spec Delta):
1. Fallback graph → a non-fallback row falls back once (push→e-mail, e-mail→push with a device); a fallback row never again (FR-019). Ground: EMAIL_FALLBACK seam left by ST-194; Principle I.
2. Staff push → on once a device is saved (opt-out per type). Ground: no preference UI in scope.
3. Mixed device results → `sent` if any device took it; retry only when none did and a refusal was retryable (FR-020).
4. iPhone hint wins over "no push" when not standalone; installed without push → unsupported (FR-021).
5. Push→e-mail fallback ignores the mute coming from choosing push (type.channels), like SMS/WhatsApp.
Notes folded: SC-001 measured in the integration test; shared-laptop save re-creates the device; no keys → routing sees no device. Kept the self-service push test (autonomous default, flagged for the owner).

## 10-14. Implement, converge, harden, review
- Slices: feat(notifications) server, feat(web) panel, fix(notifications) after review. Unit, integration and typecheck green; e2e `apps/web-e2e/src/push.spec.ts` left to CI (local boot needs full env). Mutation left to the nightly run.
- Review: spec-reviewer APPROVE (2 MEDIUM patched); code-reviewer BLOCK on no device cap (HIGH, decision: evict the oldest at 10) then APPROVE on re-review. Deferred: env-configurable timeouts and cap, throttle on the test route (`deferred.md`).
- Decision for the owner: push is sent directly with VAPID, not through Brevo (autonomous default, Brevo has no browser Web Push API).

## 15-16. Archive
- Spec Delta merged into `.specify/capabilities/notifications.md` (+18 ~3). Status line set to Archived.
