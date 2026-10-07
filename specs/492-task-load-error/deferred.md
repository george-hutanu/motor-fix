# Deferred findings: 492-task-load-error

Findings a review verified but deliberately did not act on in this feature.

- [ ] `libs/ui-cockpit/src/lib/helm/table.ts` — **low** — pre-existing: `diff-audit.mjs` reports `HlmTableContainer`, `HlmTable`, `HlmTHead`, `HlmTBody`, `HlmTr`, `HlmTh`, `HlmTd` as exported and imported nowhere (they are reached only through `HlmTableImports`), and `table.adversary.spec.ts` importing `./table` without the `.js` extension; not this change's code (code-reviewer, 2026-10-07) — Notion: https://app.notion.com/p/Tech-debt-ST-492-pre-existing-diff-audit-mjs-reports-HlmTableContainer-HlmTable-HlmTHead-HlmT-3f1607bff0d281018d3aff7d3e7a9534
