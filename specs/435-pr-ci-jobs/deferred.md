# Deferred — 435-pr-ci-jobs

- LOW (code-reviewer): `scripts/test-suites.spec.ts` proves the disjoint/union split only for `apps/api` and `libs/domain`; derive the project list from the integration specs found when a third project gains one. — Notion: https://app.notion.com/p/3ef607bff0d2818ca67ec1f82b56af72
- LOW (spec-reviewer): the FR-008 guard matches `process.env['DATABASE_URL']` (bracket form, the repo's style); a spec using `process.env.DATABASE_URL` would slip past it. — Notion: https://app.notion.com/p/3ef607bff0d281d4ae1cfc044190183f
- MEDIUM decision (code-reviewer): `pull_request` keeps its default types, so a fixed PR title is re-checked on the next push (the error says so) rather than on `edited`, which would re-run every job on each body edit. — Notion: https://app.notion.com/p/3ef607bff0d28193b077c3fb8ac51fb9
- MEDIUM (code-reviewer, option B): `release.yml` `images` steps have no `cache-from`; the PR docker job now skips on main instead (option A). — Notion: https://app.notion.com/p/3ef607bff0d281fe8f98dbc4a1243909
