# Deferred findings: 516-production-release-queue

Findings a review verified but deliberately did not act on in this feature.

- [ ] `fix-release-production-queue` — **low** — the branch is not in the `NNN-slug` form the gates resolve a feature from; they found it through `.specify/feature.json`, which is local, so a fresh session on this branch would not see feature 516 as active. Ticketless follow-ups need a naming rule (spec-reviewer, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d281da9ea5edf6c8b4fe64
- [ ] `.claude/scripts/trace-matrix.mjs` — **low** — pre-existing: the matrix counts the `421-FR-*` ids a Spec Delta names under Modifies as the modifying feature's own requirements, so a level-1 delta inflates its denominator; it should read only the feature's own `FR-` ids (spec-reviewer, 2026-10-04) — Notion: https://app.notion.com/p/3ef607bff0d28147b631f4e68725525f
