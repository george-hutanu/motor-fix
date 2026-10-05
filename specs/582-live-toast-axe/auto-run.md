# speckit-auto run — 582-live-toast-axe

- Description: ST-582 fix the dashboard live toast's axe findings (list serious, aria-allowed-role minor) at all viewports/schemes/languages, keeping its live announcement working.
- Start commit: d5afba7 (origin/main) · branch 582-live-toast-axe · PR #129 (draft)
- Level: 1 (one-session) — phases 2, 7, 9, 10, 12, 14, 16, plus archive and hand-off.

## Phase log
- size: level 1 — the finding defines done (axe clean, announcement kept); no design choices beyond the role fix.
- constitution: v1.8.1 read, no placeholders.
- start sync: ST-582 Planning; draft PR #129 from the template, linked on the task; timeline row created (Planning); ready −ST-582.
- design: design.md — mock unavailable to this account; no screens, no visual change.
- specify: spec.md, 4 FRs; fix approach chosen by running axe-core 4.13.0 on 11 candidate markups in jsdom (only "ol role=list > wrapper role=none > li with aria-live, no role" is clean).
- tasks: tasks.md by hand (level 1), 5 tasks.
- tests (red): toaster.spec.ts 4 failed / 1 passed; toast.spec.ts 12 failed — every one `aria-allowed-role (minor)`, `list (serious)`.
- implement: notion implement (ST-582 + timeline row → Implementing, label in development). toaster.ts MutationObserver role fix; toaster.spec.ts 5/5, toast.spec.ts 12/12 green.
- harden: artifact-lint 3 fr-duplicate ERRORs (Spec Delta restated FR text) → delta rewritten as `Adds: FR-001–FR-004`, lint clean, capabilities validate clean. diff-audit `import-extension` on `./toaster`: known stale rule (moduleResolution bundler; already filed from 130/390), code-reviewer refuted it. test-adversary: 5 cases, all green, no defect; the two distinct ones (action button; dismiss then add) folded into toaster.spec.ts (7/7), the duplicate file dropped. Mutation: not run locally (AGENTS.md: CI only, nightly mutation.yml).
- review: code-reviewer APPROVE (MEDIUM duplicate adversary harness, LOW title → both fixed by the fold); spec-reviewer APPROVE (same two, plus LOW decision on the delta form: kept ids — the archive copies the FR text from Requirements). No CRITICAL/HIGH; nothing deferred.
