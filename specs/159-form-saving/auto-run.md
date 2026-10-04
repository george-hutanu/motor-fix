# Auto run — 159-form-saving

- Description: ST-159 Build shared saving, validation and errors for small actions (https://app.notion.com/p/3ee607bff0d28158a0bee4952af0d856)
- Start commit: a27b286 (origin/main), branch 159-form-saving

## Preflight
- Clean tree; `npm ci` in the worktree; `typecheck && lint && test:unit` green (heavy.sh). Constitution v1.6.0 read.

## Size
- Level 2 (feature): design choices on the field-error shape, API passthrough and idempotency key.

## Specify
- Spec written; 5 decisions under Clarifications: offline/expired session out (invocation, timeline row); `errors: [{field, code}]` (autonomous default); validation timing per the brief; idempotency key handed to the send function; catalogue sample as the e2e flow (sign-up not built yet).

## Context
- org-researcher: story ok, feature ok, epic ok, architecture ok, decisions partial. 7 contradictions → carried into clarify.

## Clarify
- spec-challenger: 8 findings. Answered (5 + 2 from context): code message shows with field errors too (brief sc. 5); status table moves to contracts (Principle V); key reuse by serialised equality; one message per field in a fixed order; malformed list dropped whole; offline text at status 0 while offline (brief sc. 6; connection handling later per invocation); maintenance text proposed.

## Plan / Checklist / Tasks / Analyze
- plan.md written (versions from package.json). requirements checklist 16/16. tasks.md T001–T012. artifact-lint: 0 errors, 0 warnings (Jev lane unavailable). Every FR maps to a test task.

## Tests (red first)
- New/extended specs: contracts problem.spec.ts (suite failed to compile: no ./problem), api problem.filter.spec.ts (2 failed), overlays form.spec.ts (33 failed), ui-cockpit sample-page.spec.ts (2 failed), web-e2e task-form.spec.ts.

## Implement
- contracts problem.ts (shape, field-error guard, status table); ProblemFilter passes `errors`, reads the shared table, no "[object Object]" detail; overlays form.ts + form-parts.ts; shell/cockpit texts; catalogue sample form task.
- Decisions: `messages` option (i18n prefix) so features own their codes' texts (ST-82); `@motor-fix/contracts/problem` path alias so the Angular lib does not pull env.ts (node types); `--mf-red-ink` token (light #b3261e) because `--mf-red` on the raised light panel is 3.85:1 (axe).
- Unit: contracts 62, overlays 84, ui-cockpit 377, api 47 passed. E2E task-form + overlays: 32 passed.
