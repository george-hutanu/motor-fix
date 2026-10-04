**Agent review: success** — PR #21 at `12d0bb5`, lap 1

Blocking: 0 (blocker 0, high 0) · medium 5 · low 4. Booted: postgres, redis, api, web.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | medium | api readiness: storage down |  |  |
| 2 | medium (pre-existing) | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 3 | medium (pre-existing) | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 4 | medium | / shows the same text in Romanian and English |  | MotorFix ROEN  dev  PostgreSQL: ok · Redis: ok |
| 5 | medium | post.mjs --add is not idempotent: a re-run duplicates the agent's findings |  | .claude/scripts/pr-test/post.mjs:125 |
| 6 | low | Any HTTP 422 on the review call is treated as the own-PR refusal |  | .claude/scripts/pr-test/post.mjs:49 |
| 7 | low | Merge gate does not see the GraphQL merge mutation |  | .claude/hooks/merge-gate.mjs:34 |
| 8 | low | tasks.md T026 unchecked although its evidence is committed |  | specs/434-agent-pr-review/tasks.md:58 |
| 9 | low | Teardown removes the run directory twice |  | run.log |

### Reproduction
1. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
2. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
3. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
4. open / in ro → open / in en → compare body text
5. .claude/scripts/pr-test/post.mjs:125 `writeFileSync(file, JSON.stringify(report, null, 2));` writes the merged findings back into report.json → A failed status call exits 1 (FR-010), so the caller retries the same `post.mjs --report <out>/report.json --add <out>/agent-findings.json` → The retry folds agent-findings.json in a second time: every agent finding appears twice in the review, the summary count and the PR description
6. .claude/scripts/pr-test/post.mjs:49 `const ownPrRefusal = (stderr) => /own pull request\|HTTP 422/i.test(stderr);` → A 422 for another reason (for example a commit_id no longer on the PR after a push) silently falls back to a COMMENT review instead of surfacing the error
7. .claude/hooks/merge-gate.mjs:34 only matches `gh pr merge` and REST `repos/<o>/<r>/pulls/<n>/merge` → `gh api graphql` with a mergePullRequest mutation merges without an agent-review success; FR-011 names only the gh and REST paths, so this is hardening, not a requirement miss
8. specs/434-agent-pr-review/tasks.md:58 `- [ ] T026 Dry-run the tester on PR #14 ...` → specs/434-agent-pr-review/pr-review/pr-14-dry-run/ (report.json, report.md, 4 screenshots) is in this diff; T025 and T027 are also open. Tick them as the proof lands
9. run.log ends with `teardown: remove .../mf-prtest-21-ZFV3BT` twice; .claude/scripts/pr-test/run.mjs:129 registers the removal and another path registers the same one → Harmless (force: true) but the teardown log no longer maps one line to one resource

Screenshots: 24, one per route × viewport × scheme × language.
