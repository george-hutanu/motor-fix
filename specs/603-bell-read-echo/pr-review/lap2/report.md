**Agent review: failure** — PR #109 at `d6aea31`, lap 2

Blocking: 1 (blocker 0, high 1) · medium 1 · low 2. Booted: postgres, redis, minio, api, web, worker.
- Ran on GitHub Actions (https://github.com/george-hutanu/motor-fix/actions/runs/37292259016): PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow.
- No changed GET endpoint without path parameters.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | PR description is the unfilled template; the required "PR template" (body) check fails on d6aea31 |  | Constitution VII (3, 6) and AGENTS.md lifecycle step 4: a ready PR has every template section filled, and no PR merges with a failing check. specs/603-bell-read-echo/auto-run.md says "PR body filled (pr-body-check passes); marked ready", which is not true of the PR as it stands. |
| 2 | medium | deferred.md items are not filed in Notion: neither bullet carries its task's URL |  | AGENTS.md: technical debt a review defers is filed as a To do task (speckit-notion-sync debt) before the merge, each bullet carrying its task's URL. |
| 3 | low | "Count is 0, mark every row read" applies to rows that arrived after the count was taken |  | A new ordering race of the same family as the deferred bell.ts:156 item; narrow window, corrected by the next first-page reload. Could restrict the mark-all to rows whose `at` is not later than the event's `at`. |
| 4 | low | Spec Delta says "Modifies: none" while FR-001 modifies 199-FR-010 |  | /speckit-archive merges the Delta into .specify/capabilities/notifications.md; listing 199-FR-010 under Modifies keeps the capability spec from holding both the old reset rule and the new merge rule. |

### Reproduction
1. gh pr view 109 --json body: every section still reads "_(fill in: ...)_" and no checklist box is ticked → gh pr checks 109: body fail (https://github.com/george-hutanu/motor-fix/actions/runs/37291504099) → the description was overwritten with the bare template at 2026-10-05T09:38:51Z (userContentEdits); it held filled Why/Notion story/Spec folder sections at 09:30:08Z → fill every section, run node scripts/pr-body-check.ts --body-file <body> --title "<title>", then gh pr edit 109 --body-file <body>
2. read specs/603-bell-read-echo/deferred.md → both bullets (bell.ts:103 badge one fewer after own echo; bell.ts:156 out-of-order first-page merges) end without a Notion task URL
3. `if ((await this.refreshCount()) === 0) this.markRead(() => true, at);` → a notification.created during that await merges a new unread first row (arrived(), bell.ts:141) when its page answers before the count does → the count answered 0 from before the insert, so markRead(() => true) marks the new row read in the view until the next reload
4. FR-001 ends "(modifies 199-FR-010)" → Spec Delta lists FR-001 under Adds and "Modifies: none"

Screenshots: 32, one per route × viewport × scheme × language.
