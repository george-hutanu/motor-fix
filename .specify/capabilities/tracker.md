---
capability: tracker
updated: 2026-10-21
features:
  - 1036-github-tracker-lifecycle
  - 1037-remove-notion
  - 1135-drop-legacy-pr-body
  - 1169-prefetch-intent
  - 1132-hold-reason-commas
  - 1323-rest-not-graphql
  - 1324-retire-debt-and-ready
  - 1360-tracker-unblock-dependent
---

# Capability: Tracker

How tasks, epics and their stages are tracked next to the code: a user-owned GitHub Project of george-hutanu linked to the private george-hutanu/motor-fix-specs (where every issue, label and milestone lives) and to motor-fix (pull requests only), with the fields the old tracker had (Status, Priority, Work type, Epic, the lifecycle dates, Story points, Sprint; readiness is the query Status To do and not blocked, `status:"To do" -is:blocked`, not a field), its views, issue forms per type, labels and milestones, epics as parent issues with their stories as sub-issues, Blocked by as issue dependencies, and the one-way import that brought every old-tracker story and epic over whole (every property, the page body, comments and files, with no link back to the old tracker). The requirements arrive with ST-1017 (`1017-github-project-tracker`, slice 1) at its archive; the adapter that writes every lifecycle event there and the switch-off of the old tracker's writes are its later slices.

## Requirements

### 1036-FR-001 — `node .claude/scripts/tracker-sync.mjs <event>` MUST find the story's issue in george-hutanu/motor-fix-specs by the `ST-<n>` at the start of its title, and for `start`, `implement`, `qa`, `review`, `blocked`, `unblock` and `finish` set the item's Project Status by the existing ladder (`tracker/status.mjs` `decide`: To do → Planning → Implementing → QA → Done, Blocked off it, Done never moves).

_From 1036-github-tracker-lifecycle._

### 1036-FR-002 — `start`, `qa` and `finish` MUST set the Started, QA from and Merged at date fields; `finish` MUST close the issue as completed.

_From 1036-github-tracker-lifecycle._

### 1036-FR-003 — Every status event MUST leave the PR with exactly the one stage label `decide` names, as today.

_From 1036-github-tracker-lifecycle._

### 1360-FR-003 — `blocked <reason>` MUST post the reason on the issue and the PR once per reason, the issue comment carrying `<!-- tracker-sync prior: <status> -->` with the status it left, so a later `unblock` from any worktree can read it; `unblock` returns to the recorded prior status (1360-FR-001 for another story, 1360-FR-005 for the own one).

_From 1360-tracker-unblock-dependent._

### 1036-FR-005 — `pr <n>` MUST write the PR's URL to the item's PR field (a different existing one is kept and a "Follow-up PR" comment posted), add the `Closes george-hutanu/motor-fix-specs#<issue>` line to the PR body once, and add the epic's label to the PR.

_From 1036-github-tracker-lifecycle._

### 1036-FR-006 — `start` MUST move the epic's issue (title `EP-<n> …`, label `epic`) from To do to Implementing; `finish` MUST set it Done and close it when no other open issue labelled `EP-<n>` (features and groups aside) is short of Done.

_From 1036-github-tracker-lifecycle._

### 1036-FR-007 — `finish --body-file <f>` MUST post the comment on the issue once; `--no-comment` logs that there was nothing to record.

_From 1036-github-tracker-lifecycle._

### 1036-FR-010 — `file --type <story|task|bug|tech debt|decision> --title <t> [--epic EP-<n>] [--priority <p>] --body-file <f>` MUST create the issue with its form's type label and add it to Project #11 at Status To do.

_From 1036-github-tracker-lifecycle._

### 1036-FR-011 — Each event MUST append its lines to `specs/<feature>/tracker-sync.md` (`- <date> · <event> · <item> · <text>`), log a GitHub failure as PENDING with its argv and replay PENDING lines first on the next run, and print one JSON line.

_From 1036-github-tracker-lifecycle._

### 1036-FR-012 — The token MUST be `GH_PROJECT_TOKEN`, then `GH_TOKEN`, then `gh auth token -u george-hutanu`; no tracker script reads the `~/.config/gh-motorfix` login. A token without the project scope MUST give one line naming the fix and never a crash.

_From 1036-github-tracker-lifecycle._

### 1037-FR-003 — Every feature MUST be GitHub-tracked: `lifecycle.mjs` runs `tracker-sync.mjs` for every feature and accepts only `--tracker-done`; the stop gate's PR-link check reads only `tracker-sync.md`.

_From 1037-remove-notion._

### 1036-FR-014 — `lifecycle.mjs open` MUST put the issue's URL in the draft body's story line; `ready` MUST write the issue to `handoff.md`.

_From 1036-github-tracker-lifecycle._

### 1324-FR-013 — The status ladder (`decide`, `recordPrior`) MUST live in `.claude/scripts/tracker/status.mjs`, behaving as before, the run-state key `prior_status`; the priority order `next` uses MUST live in `.claude/scripts/tracker/next.mjs`.

_From 1324-retire-debt-and-ready._

### 1037-FR-010 — `scripts/banned-words.ts` MUST fail when a tracked file's path or text contains a banned word (case-insensitive) and the file is not in `scripts/banned-words.json`, when a listed file holds more mentions than its count, when a listed file holds fewer (stale), and, with `--base <ref>`, when the list has an entry or a higher count than the base's list; CI's Changes job MUST run it on every pull request.

_From 1037-remove-notion._

### 1135-FR-001 — `scripts/pr-body-check.ts` MUST judge a PR body against the template's current names only: the `## Story` heading and the `Tracker in sync` box are no longer read from their pre-ST-1036 spellings (the heading and box rename step is removed), so a body in the legacy form fails by the ordinary missing-section or missing-box message.

_From 1135-drop-legacy-pr-body._

### 1135-FR-002 — A ready PR's `## Story` section MUST pass only with a `https://github.com/george-hutanu/motor-fix-specs/issues/<n>` link or `N/A` followed by a reason; an old-tracker link (any host of the retired tracker) MUST fail with the existing "no link to the story" message, and so MUST a specs-repo link that does not start a word (one buried in another URL). The header comment MUST describe this rule and no longer mention the pre-rename acceptance or #337.

_From 1135-drop-legacy-pr-body._

### 1169-FR-013 — The run MUST post one comment each on ST-267 (#49), ST-426 (#210), ST-222 (#35) and ST-349 (#73) in `george-hutanu/motor-fix-specs` stating the acceptance criterion from the issue's part 3, 4 or 5 and linking #1169, never twice (a comment already there is left), and log the four in `specs/1169-prefetch-intent/tracker-sync.md`.

_From 1169-prefetch-intent._

### 1132-FR-003 — `file` MUST title a new issue `ST-<issue number> <title>` unless the title already starts with an `ST-<n>` or `EP-<n>` id.

_From 1132-hold-reason-commas._

### 1132-FR-004 — `file` MUST stay idempotent: a rerun finds an open issue it already filed and retitled, by `ST-<its number> <title>`, and files nothing new.

_From 1132-hold-reason-commas._

### 1323-FR-004 — A GraphQL call of the tracker client (Project field writes and reads) answered with a rate limit or "submitted too quickly" MUST be tried again after 60 s, doubling each time, at most 5 tries in all, before it fails.

_From 1323-rest-not-graphql._

### 1323-FR-006 — `tracker-sync.mjs next [--epic EP-<n>]` MUST find the open issues without `needs-confirmation` (of the named epic only, when one is named) by REST issue search, read only their Project Status, Priority and blockers, keep those in To do with no open blocker, and print them ordered by Priority (Urgent, Highest, High, Medium, Low, none) then issue number, never reading the whole Project. (Changed 2026-10-16 on the owner's rule: the `ready to work` label is retired and the epic no longer orders the pick.)

_From 1323-rest-not-graphql._

### 1324-FR-005 — `tracker-sync.mjs debt` MUST refuse with "tech-debt tickets are retired; fix it in this task" on stderr, exit 1 before any GitHub call, file nothing and log nothing; a spec MUST cover it.

_From 1324-retire-debt-and-ready._

### 1324-FR-008 — The ready refresh MUST be removed: `tracker/ready.mjs`, its specs and its skill section deleted; `start` and `finish` run no refresh; the `ready` event refuses with "the ready refresh is retired; pick the next task with tracker-sync.mjs next" on stderr and exits 1 before any GitHub call; `rank` lives in `tracker/next.mjs`; the label constant goes and bootstrap stops creating the label (issues that carry it keep it).

_From 1324-retire-debt-and-ready._

### 1360-FR-001 — `unblock --story ST-<n>` for another story MUST return it to the status it held before it was blocked (its Blocked comment's marker, then the tracker logs), or To do when that is unknown, and remove its `blocked` state.

_From 1360-tracker-unblock-dependent._

### 1360-FR-002 — An event for another story MUST NOT read or write the current worktree's `prior_status`, and MUST NOT edit the labels of, or comment on, the current branch's PR unless `--pr` names one.

_From 1360-tracker-unblock-dependent._

### 1360-FR-004 — Every `gh` call tracker-sync makes MUST carry a george-hutanu token: the session's `GH_TOKEN`, else `gh auth token -u george-hutanu`; when neither exists, the call is refused (a write is logged PENDING) and never runs as gh's active account. A cloud session keeps its proxy's `GH_TOKEN`.

_From 1360-tracker-unblock-dependent._

### 1360-FR-005 — The feature's own story behaves as before: `unblock` returns to its run-state prior.

_From 1360-tracker-unblock-dependent._

## Retired

- `1036-FR-013` — superseded by `1037-FR-003` (2026-10-10)
- `1036-FR-015` — superseded by `1037-FR-002` (2026-10-10)
- `1036-FR-008` — removed by 1324-retire-debt-and-ready (2026-10-16)
- `1036-FR-009` — removed by 1324-retire-debt-and-ready (2026-10-16)
- `1037-FR-007` — removed by 1324-retire-debt-and-ready (2026-10-16)
- `1132-FR-001` — removed by 1324-retire-debt-and-ready (2026-10-16)
- `1132-FR-002` — removed by 1324-retire-debt-and-ready (2026-10-16)
- `1132-FR-005` — removed by 1324-retire-debt-and-ready (2026-10-16)
- `1037-FR-002` — superseded by `1324-FR-013` (2026-10-16)
- `1036-FR-004` — superseded by `1360-FR-003` (2026-10-21)
