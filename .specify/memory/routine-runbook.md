# Unattended routine runbook

Read top to bottom once per run. Paths are relative to the worktree root
unless marked MAIN (the main clone: the directory that contains `.git`; its
mount path varies). `.specify/memory/constitution.md` governs every step; its
Agent Execution Rules apply verbatim.

## 0. Invariants

- git never contacts a remote: no fetch, pull, push, ls-remote, `git remote`.
  `origin/<branch>` refs are whatever the last human fetch left behind; say so
  in the report when the base looks stale.
- Never touch the main checkout: no checkout, switch, stash, reset, clean in
  MAIN. All work happens inside `MAIN/.worktrees/<branch>/`.
- Never `npm install`, `npm ci`, `npm update`, or `npx <not installed>`:
  node_modules are shared from MAIN and were built on macOS. Node 22 is fine
  (`.nvmrc` says 26; `.npmrc` `engine-strict` only affects installs).
- Never ask questions, never post anywhere. Doubts become Assumptions bullets
  in the spec and lines in the report.
- Commit locally only, one line, Conventional Commits, no trailers (§7).
- Delete nothing under `.worktrees/`, `specs/`, `.specify/`, `.claude/`.

## 1. Set up the worktree

    MAIN/.specify/scripts/bash/routine-worktree.sh auto/<KEY>-<slug> origin/<base> [specs/NNN-<slug>]

- `<KEY>`: Jira key (`BKP-1270`) or PR number. `<slug>`: 2–4 lowercase words.
- `<base>`: the PR's branch for review fixes and CI patches, otherwise `main`.
- Third argument only when resuming a feature whose spec directory exists.
- Output is one JSON line `{"worktree","branch","base","feature_dir","reused"}`.
  `cd` into `worktree`. Rerunning is safe: it reuses the branch, refreshes the
  `.specify/` copy, keeps `feature.json`.
- Inside the worktree: `specs/`, `.claude/`, `.specify/memory`,
  `.specify/templates` are symlinks into MAIN (shared); `.specify/feature.json`
  is per-worktree; `.specify/extensions.yml` has `speckit.git.feature` and
  `speckit.git.initialize` disabled on purpose. Do not re-enable them.
- Run scripts as `.specify/scripts/bash/<name>.sh` with `--json`. SKILL.md
  files mention `python3 .specify/scripts/python/<name>.py`; same flags,
  either works.

## 2. Pick the path

| Item | Path |
|------|------|
| Jira implementation ticket (new behaviour, endpoint, plugin, lib change) | Full spec flow (§3) |
| PR review-comment fix, CI/lint/typecheck patch, contained bug fix | Light path (§4) |

Ambiguous: light path when the change fits in at most two files and adds no
behaviour; otherwise full flow.

## 3. Full spec flow

Run the phases in order and commit after each (§7). Read the named SKILL.md in
full before its phase and follow it except where this file overrides it.

Hooks in `.specify/extensions.yml`, every phase:

| Hook command | Action |
|--------------|--------|
| `speckit.git.feature`, `speckit.git.initialize` | skip: the routine owns branching (disabled in the worktree copy) |
| `speckit.git.remote` | skip: never inspect or use remotes |
| `speckit.git.commit` | commit now per §7; the script itself is a no-op here because `auto_commit` is off in `.specify/extensions/git/git-config.yml` |
| `speckit.agent-context.update` | skip: the plan pointer is printed at session start |
| `speckit.analyze` (after_tasks, mandatory) | run (§3.4) |

### 3.1 specify — `.claude/skills/speckit-specify/SKILL.md`

    .specify/scripts/bash/create-new-feature.sh --json --short-name <slug> "<ticket key, title and description>"
    export SPECIFY_FEATURE_DIRECTORY=specs/<BRANCH_NAME from that JSON>
    MAIN/.specify/scripts/bash/routine-worktree.sh auto/<KEY>-<slug> origin/<base> "$SPECIFY_FEATURE_DIRECTORY"

- `BRANCH_NAME` in that JSON is the spec directory name (`NNN-slug`), not a
  git branch. Never create a branch from it.
- The third command pins `feature.json`; still keep the env var exported for
  every later command. Never rely on the git branch name.
- Follow SKILL.md from step 4 (directory and template already created). Sources
  are the ticket text and this repo, nothing else. At most three
  `[NEEDS CLARIFICATION]` markers; resolve them in §3.2, never by asking.
- Run one specify at a time: numbering scans the shared `specs/`.

### 3.2 clarify — `.claude/skills/speckit-clarify/SKILL.md`

    .specify/scripts/bash/check-prerequisites.sh --json --paths-only

No human answers exist. For each question the skill would ask (max 5):

1. Choose the option the constitution and the surrounding code most directly
   support: Principle I first (smallest change, no new dependency, no
   speculative scope), then the existing pattern in the touched workspace.
   Cite the evidence (`path:line` or quoted spec text).
2. Record `- Q: <question> → A: <answer> (assumed; evidence: <cite>)` under
   `## Clarifications` / `### Session <YYYY-MM-DD>` and the same decision as a
   bullet under `## Assumptions`.
3. Apply it to the spec section the skill names for that category.

Never invent a requirement to settle a question. When no reading is supported
by evidence, leave the `[NEEDS CLARIFICATION]` marker, list it under "open
questions" in the report, finish §3.3 (plan) so the human sees the design, and
stop before §3.4.

### 3.3 plan — `.claude/skills/speckit-plan/SKILL.md`

    .specify/scripts/bash/setup-plan.sh --json

Technical Context values come from `package.json`, `package-lock.json`,
`tsconfig*.json`, `turbo.json`, `vitest.config.ts`: read and cite them. Every
Constitution Check gate passes or is justified in Complexity Tracking; an
unjustified gate stops the feature (report it).

### 3.4 tasks — `.claude/skills/speckit-tasks/SKILL.md`

    .specify/scripts/bash/setup-tasks.sh --json

Then the mandatory hook, `.claude/skills/speckit-analyze/SKILL.md`, with
`check-prerequisites.sh --json --require-tasks --include-tasks`. Fix CRITICAL
and HIGH findings in spec/plan/tasks before implementing; it is read-only, so
edits are yours.

### 3.5 implement — `.claude/skills/speckit-implement/SKILL.md`

    .specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks

- Checklist gate (step 2): never ask. Proceed only when every unchecked item is
  wording or documentation; otherwise stop and report the unchecked items.
- Step 4: `.gitignore` exists; create no other ignore files.
- Verify each touched workspace with `npm run typecheck -w <ws>` and
  `npm run test -w <ws>`. When §5 reports that workspace's tests as skipped,
  mark the task `[X]` on typecheck alone and list it under "unverified".
- Commit per logical slice (§7), tests together with the code they cover.
- `.claude/skills/speckit-tests/SKILL.md` (red-first tests between tasks and
  implement) only when the spec's acceptance scenarios name test behaviour.

### 3.6 verify (§5), final commit (§7), report (§8)

## 4. Light path (no spec)

1. Worktree off `origin/<pr-branch>` (§1, no third argument). Read the comment
   or CI log, locate the code, make the smallest change that resolves it.
2. Constitution check before committing, Principle I first: no new
   abstraction, dependency, config knob, or dead code; contract schemas at both
   ends (II); `.js` import extensions in nodenext workspaces (III); no per-app
   tool configs (IV); tests colocated and explicit-field DI in server (V).
3. `npm run typecheck -w <ws>` and `npm run test -w <ws>` for touched
   workspaces, then §5, §7, §8. No `specs/` entry, no `feature.json`.

## 5. Verify

    .specify/scripts/bash/routine-verify.sh

Last stdout line is JSON `{root,node,platform,passed,failed,skipped,checks}`;
exit 1 only when a check that ran failed. Skips are expected on the Linux VM:
every native binding is macOS-only there (Biome; the regex-engine `.node`;
`@swc/core` for server tests; Vite's rolldown and lightningcss, which every
vitest run needs; `@next/swc`; sharp). Paste the JSON line verbatim into the
report and list each `"status":"skip"` check under "unverified". Never call a
`fail` acceptable; fix it or report it as failing.

## 6. What the routine never does

Push, fetch, open PRs, comment on Jira/GitHub/Slack, edit `CLAUDE.md` or
`AGENTS.md`, run `turbo`/`biome`/`napi`/`cargo` directly, or touch files
outside its worktree except `specs/` and `.specify/feature.json`.

## 7. Commit format (speckit-git-commit convention)

    git add -A && git commit -q -m "<type>(<scope>): <subject>"

From the worktree root. One line, imperative, at most 72 characters, no body,
no trailers, no `Co-Authored-By`, no AI or tool mention. Types: `feat`, `fix`,
`docs`, `test`, `refactor`, `chore`. Scope is the workspace (`scanner`,
`server`, `contracts`, ...). `specs/` is a git-excluded symlink into MAIN, so
spec artifacts are never part of a commit; the report carries their paths.

## 8. Report (end of every run, plain text)

    branch: auto/<KEY>-<slug>
    base: <sha> (origin/<base>)
    worktree: .worktrees/auto-<KEY>-<slug>
    commits: <git log --oneline <base>..HEAD>
    files: <git diff --stat <base>..HEAD>
    spec: specs/NNN-<slug> — spec.md / plan.md / tasks.md state (full flow only)
    verify: <JSON line from routine-verify.sh>
    unverified: <skipped checks; anything marked [X] on typecheck alone>
    assumptions: <every Assumptions bullet added this run, with evidence>
    open questions: <[NEEDS CLARIFICATION] left; decisions only a human can make>
    follow-ups: <pre-existing issues seen and deliberately not fixed>
