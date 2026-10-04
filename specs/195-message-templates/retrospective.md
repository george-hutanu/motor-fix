---
feature: 195-message-templates
date: 2026-10-05
verdict: accepted-with-open-items
---

# Retrospective: 195-message-templates

## Verdict

The feature is accepted with open items. All 11 functional requirements are met and covered by specs tagged `@traces 195-FR-*`:

- `templates.spec.ts`
- `template-check.spec.ts`
- `brevo.spec.ts`
- `notifications.processor.integration.spec.ts`

They are in `libs/domain/src/notifications/`, together with the two adversary specs. PR #67 merged as `fc3b500`, with green CI and `agent-review` passing on `251e04b`. Both QA laps passed with no blocker or high finding.

Two things are still owed:

- The owner sets `PUBLIC_WEB_URL` on the Railway worker before `EMAIL_SENDING=on`.
- Two deferred findings remain open. Each one is filed in Notion.

## Evidence

From `node .claude/scripts/retro-evidence.mjs --since 66606f1`:

- **Tasks:** 12 done, 0 open.
- **Requirements:** 11 declared. The trace matrix also lists `FR-018`, which it read from the Spec Delta's `194-FR-018`.
- **Spec Delta:** `notifications` gained 9 requirements and changed 2 (194-FR-007 → 195-FR-005, 194-FR-018 → 195-FR-010).
- **Deferred:** 2 open, each with its Notion task URL.

## What went well

- The test-adversary found that values inherited from `Object.prototype` (for example `constructor`) counted as supplied, and that `bellText` could throw. Both were fixed before review.
- The spec-reviewer found that a row's own `app` value could replace the configured web address. That was fixed, with an integration spec.

## What did not

- CI lap 1 failed because of the `ui-cockpit` colour-literal guard. The e-mail palette was hex in `libs/domain`, and the local run had not included `libs/ui-cockpit`. The palette now lives in the theme library (`@motor-fix/ui-cockpit/email`).
- The worktree had no `DATABASE_URL`, so the pre-commit hook needed it set by hand for `seed.integration.spec.ts`.

## Action items

- [ ] The owner sets `PUBLIC_WEB_URL` on the Railway worker service (staging and production) before turning on `EMAIL_SENDING`.
- [ ] Before a story that touches more than one lib is marked ready, run `npm run test` (the whole workspace), not just the project's own Jest.
