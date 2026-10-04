# speckit-auto run — 433-pr-template

- Description: ST-433 Define one standard pull request template and enforce it on every PR (https://app.notion.com/p/3ef607bff0d28182a864e99cd80cd6a8)
- Start commit: 8cb1882 (origin/main), branch 433-pr-template, agent worktree
- Level: 1 (one-session) — phases 2, 7, 9, 10, 12, 14, 16, plus the design check and the PR lifecycle

## Decisions

- Story: none existed for a PR template (searched MotorFix stories created since 2026-10-02 and titles containing "template" / "pull request"); filed ST-433 as a Task under EP-1, in ST-431's shape (System role, Build brief, scenarios).
- Size: level 1. The request states the intent fully (template sections, own workflow, tested script, `--body-file` everywhere); one coherent unit.
- Preflight full suite (`npm run typecheck && lint && jest`) skipped: the owner's resource rules allow only targeted local checks on this shared laptop; origin/main 8cb1882 is the merged, CI-green head. The PR's CI runs the full affected suites.
- Template hints live in HTML comments (invisible on GitHub) and may stay; the visible placeholder marker is `_(fill in: …)_` and must go. Notion story scenario 3 updated to match.
- Draft PRs need only the section headings (Constitution VII opens the draft at the first commit, before testing); ready PRs get the full check, re-run on `ready_for_review`.
- Required sections and labelled lines are read from the template file, not from a second list in code.
- Bot-authored PRs (Dependabot) are skipped by the workflow.
- The PR title must be a Conventional Commit with a scope, matching the commit-message policy.
- The checker is TypeScript under `scripts/` run with Node 24 type stripping (as `railway-deploy.ts` in release.yml), so the workflow needs no `npm ci`.
- Agent review: a `Pending` line between markers that task 3's reviewer can replace; this change does not build the reviewer.
- Section choice: /speckit-roundtable not run; the request named every required section, so the open choices were wording and shape (above). One heading per required item, no optional sections.
