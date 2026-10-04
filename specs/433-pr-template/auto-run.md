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
- Commits: the owner asked for `git commit` (husky's full typecheck+lint+test) to run through heavy.sh, but the worktree isolation guard refuses any launcher (heavy.sh, lockf) around a git command. Ran plain `git commit` with heavy.sh's low-parallelism env (`NX_DAEMON=false NX_PARALLEL=1 JEST_WORKERS=2`, 3 GB heap) after checking 76% memory free.
- Phase 9 red: `npx jest -c scripts/jest.config.cts scripts/pr-body-check.spec.ts` failed (module missing) before `scripts/pr-body-check.ts` existed; the gate spec `pr-lifecycle-gate.spec.mjs` failed 1/9 before the message changed.
- Phase 10: 19/19 checker tests green, scripts project 41/41, `tsc -p scripts` clean, biome clean (one cognitive-complexity error fixed by splitting the section check).
- Harness: doctor flagged `stop:pr-lifecycle` (message text only, diff read), `--bless-hooks` 44884d03b4d1 → b1f1c68f26a6. `npm run test:harness`: 364 passed, 2 timed out in `artifact-lint.spec.mjs` (diff-audit lane at 5 s under load average ~9-13; the audit diffs against this machine's stale local `main` 202c88e, 124 files, none of them this change). Left to CI, which runs test:harness on a clean runner.
- Phase 12 harden: mutation pass skipped (owner's rule: no Stryker, no mutation-runner). `artifact-lint --check` clean. `diff-audit` not meaningful locally (stale local `main` base, see above).
- Section choice: /speckit-roundtable not run; the request named every required section, so the open choices were wording and shape (above). One heading per required item, no optional sections.

## Review (phase 14)

- The first reviewer pair ran in the background and had not reported when the session went idle; re-run in the foreground. spec-reviewer and code-reviewer: both APPROVE, no CRITICAL/HIGH.
- Fixed, test first (4 red → green): a deleted checklist box fails (boxes matched by the words before their colon); an unticked box that says N/A no longer passes (FR-004 read literally); `## ` lines and placeholders inside code fences are ignored; headings with closing hashes or up to 3 spaces of indent are read; repeated headings match case-insensitively; only the visible `_(fill in: …)_` marker counts as a placeholder; a test for an empty labelled line; neutral fixtures (no story key in source); `PrInput` is an unexported `type`; the rule list lives only in the script header. 26/26 checker tests, scripts project 48/48.
- Deferred: the two `artifact-lint.spec.mjs` diff-audit timeouts (deferred.md).
