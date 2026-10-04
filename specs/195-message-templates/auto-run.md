# /speckit-auto run — 195-message-templates

**Description**: ST-195 Set up message templates in Romanian and English (Notion story https://app.notion.com/p/3ee607bff0d2813dbda8c0e39bb8c756, epic EP-1 Foundations). Build the template system of the notifications worker per the story's Build brief.

**Start commit**: 66606f1ece7a3738050cf1f4baadede56f25c16f (branch 195-message-templates, the empty start commit on origin/main c02b174)

**PR**: #67 (draft)

## Preflight
- Story picked after a 3-minute wait: highest-priority EP-1 item ticked Ready to work, To do, no open Blocked by (ST-194, ST-20, ST-19 all Merged), no branch, PR or worktree. ST-128 was already Planning (sibling), ST-130 in QA. Claimed with speckit-notion-sync start.
- Worktree had no node_modules: `scripts/heavy.sh npm ci` (exit 0).
- `scripts/heavy.sh sh -c 'npm run typecheck && npm run lint && npm run test:unit'` — green ("Successfully ran target test for 11 projects"). Integration suite not run at preflight (needs Docker services); it runs in CI.
- Constitution v1.6.1 read; no placeholders.

## 0. Size
- Level 2 (feature): the intent is defined by the Build brief, but the design has choices (template format, check mechanism, e-mail HTML). Recorded in .specify/feature.json.

## 2. Specify
- spec.md written from the Build brief; 0 NEEDS CLARIFICATION. Autonomous defaults (spec Assumptions):
  - TS modules + code layout instead of MJML/JSON — Principle I, no new dependency.
  - Template check = Jest spec in the unit suite (CI Unit tests job), like libs/i18n/src/check.ts.
  - Push/SMS/WhatsApp rules proven on fixture templates; no type in scope has those texts.
  - Bell text rendered on read; no bell screen yet.
  - Playwright e2e not possible (no bell screen, no inbox); covered by the processor integration test against the Brevo mock — deviation.
  - Render failure fails the row without the fallback hook.
- Quality checklist: all items pass on pass 1.
- after_specify hooks: notion-sync start (already applied at claim: unchanged); design-check wrote design.md (no screens).

## 3. Org context
- org-researcher wrote context.md: 17 findings (8 decisions, 6 constraints, 2 open, 4 contradictions). Feature page only partly read (59k chars). Contradictions carried into clarify: phone rule stricter than source; push missing from the diacritics scenario; grouped template needs plural forms; generic fallback for a type with no template is unsourced.

## 4. Clarify
- spec-challenger: 5 findings; all five asked and answered with its recommendation:
  1. Missing template → generic text; check covers existing templates only (deviation: unsourced in Notion).
  2. Phone: bar every phone value (deliberate tightening, for the owner).
  3. Footer reason: per-template text, both languages.
  4. Grouped: generic + QUOTE_RECEIVED; Romanian "de" for last two digits 00 or 20–99.
  5. Renderer takes the language from its caller.
- Push in the diacritics scenario: covered by fixture push templates (no push type in scope).

## 5. Plan
- plan.md, research.md (R1–R8), data-model.md, contracts/templates.md, quickstart.md. Decisions: TS template modules + one layout (no MJML); `@motor-fix/i18n/formats` path to reuse the shared formatters; check = unit spec; `app` link from PUBLIC_WEB_URL read by the worker (owner must set it on the worker in Railway); messages.ts replaced. Constitution check passes; two Complexity Tracking rows (push/SMS/WhatsApp shapes, bellText without a production caller).

## 6. Checklist
- checklists/templates.md: 17 items, all resolved (gaps CHK003/004/013 were already fixed by clarify and plan R8). 0 unchecked.

## 7. Tasks
- tasks.md: T001–T011, FR → test table.

## 8. Analyze
- artifact-lint: 4 errors on first run (Spec Delta Modifies malformed / base missing) → fixed: Modifies `194-FR-007` → `FR-005`, `194-FR-018` → `FR-010`, FR-005/FR-010 rewritten as supersets of the replaced 194 requirements. Re-run: 0 errors, 0 warnings (Jev lane unavailable: no TYPESAFE_API_KEY). Cross-check by hand: every FR has a task and a test file; no CRITICAL finding.

## 9. Tests (red first)
- New: templates.spec.ts, template-check.spec.ts; changed: brevo.spec.ts / brevo.adversary.spec.ts (HTML part), email-config.spec.ts (webUrl), notifications.processor.integration.spec.ts (exact ro/en subjects, HTML part, template_failed, missing web URL, "2 oferte noi"), notifications.testing.ts (PUBLIC_WEB_URL).
- `scripts/heavy.sh npx jest … templates.spec templates-check.spec brevo.spec email-config.spec` → "Test Suites: 4 failed, 4 total" (missing modules, missing htmlContent, missing webUrl). Integration spec red by construction (needs services; runs in CI).
