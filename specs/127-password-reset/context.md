# Context — 127-password-reset

Gathered: 2026-10-05 · Source: Notion only (MotorFix — Product documentation), read for the claim in this run rather than through the org-researcher subagent.

## Story
- ST-127 "Reset a forgotten password" (https://app.notion.com/p/3ee607bff0d2810a99fffb2a805dc619), High, 3 points, Role Visitor, labels front end + backend; last edited 2026-10-04 21:49. Build brief current as of 2026-10-03; it wins over the criteria above it.
- Feature page: https://app.notion.com/p/3ee607bff0d28194880afef05a6b30fc. Epic EP-1 Foundations: https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707.

## Timeline (Foundations build timeline)
- Row ST-127, W5, lane A · UI kit, not critical path: "Auth story built by the UI-kit agent once its own lane is done, to relieve the auth lane."
- Blocked by ST-82 (Merged), ST-194 (Merged), ST-195 (Merged).
- ST-195's row: "Gates ST-81, ST-127, ST-392 and ST-393".

## Constraints
- Token: 32 random bytes, single use, hashed (ACCOUNT_TOKEN, purpose `password_reset`) *(proposed)*; a new request voids older links.
- Link `/{lang}/reset-password/:token` *(proposed)*; the page opens the dialog over Home.
- Password rules as ST-80 (8 to 128, not common).
- Error codes *(proposed)*: `token_invalid`, `token_expired`, `weak_password`.
- E-mail provider down: same neutral message; the queue retries.
- Audit: "password reset" on the account, without any value.
- Notifies: `ACCOUNT_EMAIL` `password_reset` and `password_changed` *(proposed)*, cannot be turned off.
- Live: the account's other open tabs sign out (`session_revoked` of ST-128 — built as `session.revoked`).

## Contradictions
- The Notes say the unknown-e-mail case "is not designed"; the Build brief (newer) answers it: the same neutral message (scenario 2). The brief wins.
- The Build brief names the live message `session_revoked`; ST-128 built it as `session.revoked` (`libs/domain/src/auth/sign-in.service.ts`). The built name is used.

## Related work in flight
- ST-81 "Confirm my e-mail address" (PR #71, Implementing) adds `account_token` with purpose `email_confirm` and the token helpers; this story extends it.

## Proposed Clarifications
- How the link page knows a link expired before a password is typed (a check call).
- What "the role used last opens" means for a dialog over Home.
- The audit entry's shape.
