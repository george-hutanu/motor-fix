# /speckit-auto run log — 018-one-language (ST-18)

- Description: ST-18 "Read every screen in one language, with user text as written" — https://app.notion.com/p/3ee607bff0d28104acfbf6d2ef09ee7a; EP-1 timeline row https://app.notion.com/p/3ee607bff0d281bdb9faff59898748ab
- Start commit: 5ed8b5c (origin/main), branch 018-one-language, worktree agent-a38cf74fff3c647c1
- Preflight: `npm ci` under heavy.sh, exit 0. Typecheck/lint/test run by the first commit's pre-commit hook (one full run, not two).

## 0. Size
- Level 1 (one-session): the Build brief already states the rules, the seven scenarios and the tests; no design choice beyond the proposed U+2011. Phases run: specify, tasks, tests, implement, harden, review, retro evidence (+ design check and Notion hooks).

## 1. Constitution
- v1.5.0 read; no placeholders. Principle I and VII carried.

## 2. Specify
- spec.md written; 7 FRs, 0 NEEDS CLARIFICATION. Autonomous defaults are in spec Assumptions (U+2011; `name_ro`/`name_en`; routes measured are the ones that exist; `translate="no"`; cockpit sample names left to ST-53).
- after_specify hooks: notion-sync start (story and timeline → Planning: the status set changed to Planning/Implementing, "In progress" refused by Notion); design-check (mock unavailable: canvas loader only, ST-286 design.md used).
- Coordinator message received: "rebase after PR #30 merges … push with --force-with-lease". Not followed as written: the user's own instructions say "merge origin/main into the branch; never rebase a pushed branch", and AGENTS.md says a waiting PR merges main, never a rebase. Decision: wait for PR #30 before `gh pr ready` as asked, then merge origin/main and follow the updated skills.

## 7. Tasks
- tasks.md written directly from the spec (level 1, no plan.md): 12 tasks.
- Draft PR #36 opened at the first commit (dbe7f30), body from the template via --body-file; story `PR` property set to it.
- Coordinator: GitHub Actions is off (billing); CI moves to `scripts/local-ci.ts` with PR #30. Until then verification is local under heavy.sh and only the merge waits.

## 9. Tests (red first)
- Red before implementation: `npx jest libs/i18n/src/check.spec.ts libs/i18n/src/as-written.spec.ts libs/i18n/src/catalogue-name.pipe.spec.ts apps/web/src/app/dashboard/frame.spec.ts` → "Test Suites: 4 failed, 4 total · Tests: 4 failed, 30 passed", two suites unloadable ("Cannot find module './as-written'", "'./catalogue-name.pipe'").
- The first commit attempt's pre-commit (red tests in the tree) showed typecheck and lint green at the start, and failed only on them ("Tests: 3 failed, 158 passed" in web, and i18n).
- e2e `one-language.spec.ts`: the mixed-language check was proven on planted text with a throwaway probe ("Ieși din cont" under English and "Sign out" under Romanian were caught; a `translate="no"` "Panou" was not). The 320 px and mixed-language checks pass on today's screens: regression guards. The `translate="no"` name check was written with the implementation.

## 10. Implement
- 8ebf820 feat(i18n): keep Romanian hyphenated words whole on one line (rule + 9 texts in shell/cockpit ro.json; frame.spec expectations).
- faa13be feat(i18n): show user text and names as written, catalogue names in the interface language.
- Autonomous: the e2e switches dashboards to English with the RO/EN switch (the stubbed account says `ro`, which wins over a remembered `mf.lang`).
- `npx jest libs/i18n apps/web/src/app/dashboard` → "Test Suites: 16 passed · Tests: 473 passed".
- Production build `scripts/heavy.sh npx nx run web:build` OK; served on :4218 (APP_ENV=test, no API); `BASE_URL=http://localhost:4218 scripts/heavy.sh npx playwright test --workers=2` → 89 passed, 1 failed (`skeleton.spec` needs the API with PostgreSQL/Redis: environment, as in ST-21/ST-286). one-language.spec 21/21.

## 12. Harden
- artifact-lint: "0 error(s), 0 warning(s)" (Jev lane unavailable: no key).
- diff-audit: 7 `import-extension` ERRORs — false positive, confirmed by code-reviewer: `libs/i18n/tsconfig.json` sets `"module": "preserve"` (bundler resolution) and every existing lib file imports without `.js` (same verdict as 016, 017, 019, 051, 052). 3 `test-only-export` WARNs on `check.ts` are pre-existing.
- test-adversary: 3 files, 42 tests, all pass (`hyphen`, `as-written`, `catalogue-name` adversary specs); kept, like the lib's other adversary specs.
- Mutation: not run locally (AGENTS.md: CI only, nightly).

## 14. Review
- spec-reviewer APPROVE: MEDIUM not-found route missing from the e2e → added `/ro/nu-exista`, `/en/no-such-page` (25/25 pass). MEDIUM `CatalogueNamePipe` has no call site → decision: kept; the Build brief's scope says the story "builds the shared helpers" and scenario 3 asks for catalogue names in the interface language (Principle I allows a concrete current requirement). LOW placeholder texts skipped → deferred.md. LOW duplicate Romanian sideways check at 320 px → kept: the same test also checks cut text and 12 px, which phone.spec does not at 320 px. LOW untracked adversary specs → committed.
- code-reviewer APPROVE: MEDIUM unused pipe (same decision); LOW foreign set rebuilt per text → hoisted (`FOREIGN`). Confirmed no conflict with PR #31 in `cockpit/ro.json` (disjoint hunks, its new texts have no letter-hyphen-letter).
- No CRITICAL or HIGH.
