# Auto run — 436-docs-only-ci

- Description: CI skips unnecessary jobs on documentation-only PRs; create the Notion task first.
- Start commit: e68eb58 (origin/main), branch `436-docs-only-ci`, own worktree.
- Notion: ST-436 https://app.notion.com/p/3ef607bff0d281aabbd3f7430ecaac0c

## Decisions

- Tree: only `.claude/.spec-drift-state.json` modified, written by the spec-drift gate itself (not user work); carried, not a Hard Stop.
- Story: none existed; created ST-436 under EP-1 Foundations, filed like ST-435 (Task, System, Medium, 2 points).
- Size: level 1. The story states done, out of scope and proof; no product call open. Phases: specify (written from the story), tasks, tests, implement, harden, review, retro evidence.
- Preflight full suite not run locally (laptop RAM rules: targeted checks only); main green at its last merge (#18), this PR's CI is the full-suite proof.
- Detector: a tested Node script, no third-party path-filter action (same pattern as pr-body-check.ts).
- Documentation = `docs/**` or `*.md` outside `.claude/`, `.specify/`, `.github/` (skills and the PR template are inputs to the harness tests and the template check).
- Renames: `git diff --no-renames` lists both sides, so code→md is not docs-only.
- Non-PR runs: the detector step is skipped, the output is empty, `!= 'true'` runs every job.

## Tests (red first)

- `scripts/docs-only.spec.ts` against a throwing stub: 24 failed of 24. After the implementation: 24 passed.
- The first commit attempt failed in the pre-commit hook: the hook exports `GIT_DIR`/`GIT_INDEX_FILE`, the spec's temp-repo git calls inherited them, and they rewrote the real repository (index replaced, `user.name/email` set to `test`, `core.bare=true`). No commit or ref was written. Repaired: `core.bare false`, `sh .husky/identity.sh apply` (check passes), `git reset -q` (index only). Spec now strips every `GIT_*` variable and passes identity with `-c`; proven under a hook-like env against a decoy bare repo in the scratchpad (24 passed, decoy untouched).

## Review

- spec-reviewer: APPROVE, 3 LOW. Fixed: prose said only the title check runs (Changes runs too). Deferred: the skip path is unproven by a code PR (deferred.md). Kept: the `docs/` rule (the story asks for it).
- code-reviewer: APPROVE, 3 LOW. Fixed: `core.quotePath=off` so non-ASCII Markdown paths classify (new test, red with quoting on, green with it off); the output fixture now lives inside the temp repo. Kept: `docs/` (same reason).
- artifact-lint: 1 ERROR fixed (Spec Delta `Modifies` named a 435 requirement never archived into platform.md); now clean. diff-audit: findings only on `libs/ui-cockpit` and `package.json` from outside this range.
- Mutation: not run locally (owner rule: never on the laptop); `scripts` floor is `break: 0` and the nightly run covers it.

## Hand-off

- PR #25: 15 checks green (every job ran, as a code PR should), merged 6c69405.
- Proof PR (this one): Markdown under `specs/` only, so CI should run only PR title, Changes and CI OK — closes the deferred skip-path item.
