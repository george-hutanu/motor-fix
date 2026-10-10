---
capability: tracker
updated: 2026-10-10
features:
  - 1036-github-tracker-lifecycle
---

# Capability: Tracker

How tasks, epics and their stages are tracked next to the code: a user-owned GitHub Project of george-hutanu linked to the private george-hutanu/motor-fix-specs (where every issue, label and milestone lives) and to motor-fix (pull requests only), with the fields the Notion tracker had (Status, Priority, Work type, Epic, the lifecycle dates, Story points, Sprint; readiness is the query Status To do and not blocked, `status:"To do" -is:blocked`, not a field), its views, issue forms per type, labels and milestones, epics as parent issues with their stories as sub-issues, Blocked by as issue dependencies, and the one-way import that brought every Notion story and epic over whole (every property, the page body, comments and files, with no link back to Notion). The requirements arrive with ST-1017 (`1017-github-project-tracker`, slice 1) at its archive; the adapter that writes every lifecycle event there and the switch-off of the Notion writes are its later slices.

## Requirements

### 1036-FR-001 — `node .claude/scripts/tracker-sync.mjs <event>` MUST find the story's issue in george-hutanu/motor-fix-specs by the `ST-<n>` at the start of its title, and for `start`, `implement`, `qa`, `review`, `blocked`, `unblock` and `finish` set the item's Project Status by the existing ladder (`notion-status.mjs` `decide`: To do → Planning → Implementing → QA → Done, Blocked off it, Done never moves).

_From 1036-github-tracker-lifecycle._

### 1036-FR-002 — `start`, `qa` and `finish` MUST set the Started, QA from and Merged at date fields; `finish` MUST close the issue as completed.

_From 1036-github-tracker-lifecycle._

### 1036-FR-003 — Every status event MUST leave the PR with exactly the one stage label `decide` names, as today.

_From 1036-github-tracker-lifecycle._

### 1036-FR-004 — `blocked <reason>` MUST post the reason on the issue and the PR once per reason; `unblock` returns to the recorded prior status.

_From 1036-github-tracker-lifecycle._

### 1036-FR-005 — `pr <n>` MUST write the PR's URL to the item's PR field (a different existing one is kept and a "Follow-up PR" comment posted), add the `Closes george-hutanu/motor-fix-specs#<issue>` line to the PR body once, and add the epic's label to the PR.

_From 1036-github-tracker-lifecycle._

### 1036-FR-006 — `start` MUST move the epic's issue (title `EP-<n> …`, label `epic`) from To do to Implementing; `finish` MUST set it Done and close it when no other open issue labelled `EP-<n>` (features and groups aside) is short of Done.

_From 1036-github-tracker-lifecycle._

### 1036-FR-007 — `finish --body-file <f>` MUST post the comment on the issue once; `--no-comment` logs that there was nothing to record.

_From 1036-github-tracker-lifecycle._

### 1036-FR-008 — The ready refresh (end of `start` and `finish`, and `ready`) MUST judge each open issue labelled with the story's epic (the epic, feature and group issues aside): ready when Status is To do and every "blocked by" dependency and every sub-issue is closed or at Status Done. The `ready to work` label MUST be removed from every issue that is not ready, and added only to candidates the hold review confirms (`ready --tick`).

_From 1036-github-tracker-lifecycle._

### 1036-FR-009 — `debt` MUST file each unfiled `deferred.md` bullet as a To do issue (FR in User Story 4) and mark the bullet with the issue URL.

_From 1036-github-tracker-lifecycle._

### 1036-FR-010 — `file --type <story|task|bug|tech debt|decision> --title <t> [--epic EP-<n>] [--priority <p>] --body-file <f>` MUST create the issue with its form's type label and add it to Project #11 at Status To do.

_From 1036-github-tracker-lifecycle._

### 1036-FR-011 — Each event MUST append its lines to `specs/<feature>/tracker-sync.md` (`- <date> · <event> · <item> · <text>`), log a GitHub failure as PENDING with its argv and replay PENDING lines first on the next run, and print one JSON line.

_From 1036-github-tracker-lifecycle._

### 1036-FR-012 — The token MUST be `GH_PROJECT_TOKEN`, then `GH_TOKEN`, then `gh auth token -u george-hutanu`; no tracker script reads the `~/.config/gh-motorfix` login. A token without the project scope MUST give one line naming the fix and never a crash.

_From 1036-github-tracker-lifecycle._

### 1036-FR-013 — A feature whose folder holds `notion-sync.md` and no `tracker-sync.md` is Notion-tracked; every other feature is GitHub-tracked. `lifecycle.mjs` and `pr-lifecycle-gate.mjs` MUST follow that choice.

_From 1036-github-tracker-lifecycle._

### 1036-FR-014 — `lifecycle.mjs open` MUST put the issue's URL in the draft body's story line; `ready` MUST write the issue to `handoff.md`.

_From 1036-github-tracker-lifecycle._

### 1036-FR-015 — `notion-ready.mjs check` MUST accept a `tracker-sync.md` log (its `TRACKER-SYNC PENDING: ready` line included).

_From 1036-github-tracker-lifecycle._

## Retired
