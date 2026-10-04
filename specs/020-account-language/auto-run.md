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

## Context
- org-researcher digest written to context.md (story ok, feature ok, epic partial, architecture partial). Contradictions carried into clarify: retry at sign-in vs account wins; validation code unsourced in Notion; signed-in `/en/` open.

## Clarify (spec-challenger first, then 5 answers, each the recommended one)
- Q1 "already in use" → the account's saved language (makes the retry reachable).
- Q2 serialize saves → one at a time, latest last, late answers dropped.
- Q3 "signed in" → `Session.current()` holds an account; the switch never loads one.
- Q4 field named by a validation error → the offending one, via the existing pipe's detail.
- Q5 audit shape → `recordChanges` update of field `language`, no label.

## Plan / checklist / tasks / analyze
- plan.md: no schema change (column + default exist), no event (brief "Emits: none"); `LanguageChoice.taps` is the seam from lib to app.
- checklists/api.md: 14/14 checked. tasks.md: 12 tasks. artifact-lint 0/0 after adding the Spec Delta (accounts FR-001..005, i18n FR-006..009); capabilities validate clean.

## Tests (red first)
- me-language.api.integration.spec.ts: 21 failed, 1 passed (the fresh-account default already held).
- switch.spec.ts: 4 failed, 15 passed. session.language.spec.ts: 7 failed, 2 passed.
- The e2e spec was not proven red before the code (it needs a served build); it ran green after.

## Implement
- Two existing ST-79 boundary tests changed on purpose: "exposes no route that writes" now expects exactly `MeController.update`; the adversary "does not serve patch on the me route" became "grants no role through the language change".
- Touched specs green: domain 164, i18n 46, web 39, api 12. e2e on a production build at :4320 (`BASE_URL`): account-language 5, language 3, dashboards 7 → 15 passed.
- Commits: 56a657c feat(auth), e09f205 feat(web), both through the full pre-commit (typecheck, lint, test).

## Harden
- diff-audit (vs 18c9e3d, its own baseline) flags only generated `libs/data-access` files (eslint-disable header, `.js` import rule that the repo's bundler resolution does not use) and pre-existing code; nothing hand-written by this feature. Mutation runs skipped: no local mutation tests on this machine (task rule).
- test-adversary: 67 tests in 3 files; 7 failed. Fixed (tests kept): ten concurrent identical PATCHes wrote two audit entries → compare-and-set `updateMany` on the old value. Dropped as not defects, with reasons: a token naming a role not held answers 200 (existing ST-79 rule: the last role opens); `__proto__` key and form-encoded body accepted (harmless, Express/pipe behaviour); a tap reported before the texts load (emitting after `choose` resolves would reorder fast taps); a throwing `taps` subscriber (the only subscriber is the session); a queued tap after a failed save waits for the next tap (FR-009 as clarified).

## Review
- spec-reviewer: APPROVE; MEDIUM unused `auth/refresh` stub in the e2e → removed; LOW Romanian sizes not measured → `fits()` in both languages. Fixed in 2307440.
- code-reviewer: BLOCK (HIGH unbounded save loop when the answer echoes the old language; MEDIUM audit race; MEDIUM non-failing assertion) → fixed tests first in 8552daa (red proven: 1 domain, 1 web) → re-review APPROVE, two LOW deferred (deferred.md).
- Repair laps: 1 of 5.

## Ticket refresh
- Story re-read 2026-10-04T15:11Z by spec-reviewer with discussions and comments: none. No new evidence.

## Agent context
- Not run: `CLAUDE.local.md` is untracked and its ratchet forbids growth; its "Active plan" line is local to the owner's checkout.

## Retrospective evidence (unjudged)
- `retro-evidence.mjs --since b76ea92 --jev`: 5 commits, 31 files +1960 −20, 9 FRs, Spec Delta accounts +5, i18n +4; 3 deferred open; Jev lane unavailable (no key), so no suggested verdict.

## Polish
- T012: typecheck 13/13, Biome clean (pre-existing warnings only), touched Jest suites domain 197, i18n 63, web 51, api 12; e2e 22 passed on a production build at :4320.
