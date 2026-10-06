# Deferred findings: 610-dependabot-exemption

- [ ] `.claude/scripts/trace-matrix.mjs:52` — **low** — coverage: the matrix collects `@traces` tags only under `TEST_ROOTS = ["apps","libs","e2e"]`, so a harness feature's tests in `.claude/hooks/*.spec.mjs` never count toward its FR coverage; add `.claude` so harness FRs are traced like product ones; pre-existing, not this change (spec-reviewer, 2026-10-06) — Notion: https://app.notion.com/p/3f1607bff0d281169cc9d997b6da280e
