---
name: speckit-git-commit
description: Auto-commit changes after a Spec Kit command completes
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: github-spec-kit
  source: extension:git
user-invocable: true
disable-model-invocation: false
model: haiku
---

# Git Commit Skill

# Auto-Commit Changes

Automatically stage and commit all changes after a Spec Kit command completes.

## Behavior

This command is invoked as a hook after (or before) core commands. It:

1. Determines the event name from the hook context (e.g., if invoked as an `after_specify` hook, the event is `after_specify`; if `before_plan`, the event is `before_plan`)
2. Checks `.specify/extensions/git/git-config.yml` for the `auto_commit` section
3. Looks up the specific event key to see if auto-commit is enabled
4. Falls back to `auto_commit.default` if no event-specific key exists
5. Determines the commit message based on `commit_style` (see below)
6. If enabled and there are uncommitted changes, runs `git add .` + `git commit`

## Commit Message Styles

Controlled by the `commit_style` key in `.specify/extensions/git/git-config.yml`:

- **`fixed`** (default): use the per-command `message` if configured, otherwise a generic `[Spec Kit] Auto-commit <phase> <command>` message.
- **`conventional`**: inspect the actual changes (`git diff` / `git status`) since the last commit and generate a single-line [Conventional Commit](https://www.conventionalcommits.org/) message (`type(scope): subject`, e.g. `feat: add OAuth specification` or `docs: update implementation plan`) that accurately summarizes the change. Write this message to a temporary file and pass the file's path to the script (see Execution below). The configured `message` values are ignored in this mode.

## Execution

Determine the event name from the hook that triggered this command, then run the script:

- **Bash**: `.specify/extensions/git/scripts/bash/auto-commit.sh <event_name> [--message-file <path>]`
- **PowerShell**: `.specify/extensions/git/scripts/powershell/auto-commit.ps1 <event_name> [-MessageFile <path>]`

Replace `<event_name>` with the actual hook event (e.g., `after_specify`, `before_plan`, `after_implement`). Only pass a generated message when `commit_style: conventional` is configured — first check `.specify/extensions/git/git-config.yml` for the value of `commit_style`:

- If `conventional`: inspect the diff and generate a Conventional Commit message. **Do not interpolate the generated message directly into a shell command string** — its content is derived from repository changes and may contain characters (quotes, `$(...)`, backticks) that a shell would execute or that would break command quoting. Instead, write the message to a temporary file using your file-editing tool (not a shell `echo`/`printf`), then pass that file's path via `--message-file <path>` (Bash) or `-MessageFile <path>` (PowerShell).
- If `fixed` or absent: run the script with just `<event_name>`; it uses the configured/static message.

## Configuration

In `.specify/extensions/git/git-config.yml`:

```yaml
# "fixed" (default) uses the messages below; "conventional" asks the agent
# to generate a Conventional Commit message from the diff instead.
commit_style: fixed

auto_commit:
  default: false          # Global toggle — set true to enable for all commands
  after_specify:
    enabled: true          # Override per-command
    message: "[Spec Kit] Add specification"
  after_plan:
    enabled: false
    message: "[Spec Kit] Add implementation plan"
```

## Graceful Degradation

- If Git is not available or the current directory is not a repository: skips with a warning
- If no config file exists: skips (disabled by default)
- If no changes to commit: skips with a message
- If `commit_style: conventional` is set and no generated message was supplied: fails with a clear error instead of silently falling back to the fixed message format

## Project Rules: Commits & Pushing (NON-NEGOTIABLE)

<!-- project-local addition — re-apply after `specify integration upgrade` -->

- Every commit message MUST be semantic (Conventional Commits) and short —
  one line, e.g. `feat(scanner): add regexp pattern engine`.
- NO metadata of any kind: no `Co-Authored-By` trailers, no
  "Generated with" lines, no Claude/AI mentions.
- Push after every commit, to the feature's own branch only. NEVER `--force`,
  NEVER push `main`. The merge happens once, at the task's hand-off, on green
  CI (AGENTS.md lifecycle step 5) — never mid-task.
- **The first commit on a branch with no PR yet** opens it, in this order (the
  task lifecycle in AGENTS.md). Under spec-kit this happens at the task's
  start (`after_specify`), before planning commits anything: the first commit
  is then an empty `git commit --allow-empty -m "chore(<scope>): ST-<n> start
  <story title>"`, so the draft — and its `planning` label — exist from the
  beginning:
  1. `speckit-notion-sync start`, so the story is Planning before the PR
     exists (idempotent; a no-op when it already is).
  2. Push with the upstream set, then open the PR as a **draft**, its body
     made from `.github/pull_request_template.md` (every PR MUST use it):

     ```bash
     git push -u origin <branch>
     cp .github/pull_request_template.md "${TMPDIR:-/tmp}/<branch>-pr-body.md"
     # fill in what is known now: Why, Notion story, Spec folder; keep every heading
     GH_TOKEN=$(gh auth token -u george-hutanu) gh pr create --draft --base main \
       --head <branch> --title "<type>(<scope>): ST-<n> <story title>" \
       --label planning --label "<type label>" --label "scope: <scope>" \
       --body-file "${TMPDIR:-/tmp}/<branch>-pr-body.md"
     ```

     The title is a Conventional Commit carrying the story's ST number. Never
     `--body` or `--fill`: the `PR template` check fails a PR whose body drops
     a section. A draft only needs the headings; the rest is filled in before
     it is marked ready. The label is `planning` before `/speckit-implement`
     starts and `in development` from then on; the type and scope labels
     come from the title (`speckit-notion-sync`, §2b, lists every label).
  3. `speckit-notion-sync pr <n>`: the PR's link goes onto the story's `PR`
     property. Every story links its own PR (Constitution VII).
- Every later commit: `git push`. Marking the PR ready is not this skill's
  job; it is the last step of the work (`speckit-auto` hand-off, or
  `speckit-review` when it finds nothing blocking).

## Done When

- [ ] Message is a one-line Conventional Commit with a scope, no body, no trailers
- [ ] Only the intended files staged — no `git add -A` sweeping unrelated work
- [ ] Pushed to the feature's own branch, not forced, not `main`
- [ ] On the branch's first commit: story Planning in Notion first, then a draft PR from the template (`--body-file`) linking it, and that PR's link on the story in Notion

