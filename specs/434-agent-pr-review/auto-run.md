# Auto run — 434-agent-pr-review

- Description: ST-434 https://app.notion.com/p/3ef607bff0d2812185effb0ff2095302 — Test and review every ready PR like a QA engineer before it merges. Owner additions relayed mid-run: heavy lock in pre-commit and the edit/stop gates; Notion statuses QA and Blocked.
- Start commit: 8cb1882 (origin/main), branch 434-agent-pr-review, worktree agent-ad14e799de0acca82
- Skill text: the loaded `/speckit-auto` came from the main checkout (someone else's staged edit, "never push"); this run follows the worktree's tracked version (origin/main: push every commit, hand-off merges on green) and the owner's task statement, which both say so.

## Preflight
- Tree clean on a fresh branch off origin/main. Constitution v1.4.0 read, no placeholders.
- Full typecheck/lint/test NOT run locally: owner resource rule ("Full suites run in GitHub CI"). Evidence for a green start: origin/main 8cb1882 merged PR #11 through CI. (autonomous)
- `npm ci` ran under the shared lock (exit 0).
- Notion story search: no story about an autonomous PR review/test created today (2026-10-04 stories: ST-431, ST-432, ST-433). Created ST-434 under EP-1, filed like ST-431.

## 0 Size
- Level 2 (feature): the outcome is defined (a status that gates the merge) but the design has choices (port isolation, gate seam, review fallback, the no-Docker machine).

## 1 Constitution
- Read only; v1.4.0, Principle I first. VII will be amended by this feature's own tasks (owner's request), not by `/speckit-constitution`.

## 2 Specify
- Branch created by hand (`git checkout -b 434-agent-pr-review origin/main`, upstream unset); `.specify/feature.json` written.
- Q: tablet size? A: 834×1194 (autonomous default; owner said "tablet").
- Q: routes? A: `/` and `/cockpit` by default; guarded `/app/*` need a session (app.routes.ts:9-14).
- Q: how to switch language? A: `mf.lang` local storage + browser locale (PR #14 libs/i18n/src/switch.ts:17).
- Q: branch protection? A: not changed (repository setting; owner's call).
- Notion start: ST-434 To do → In progress; EP-1 In progress unchanged; no timeline row.

## 3 Org context
- org-researcher returned UNAVAILABLE: its tool list names Notion servers not connected here. context.md written by the run from pages it read itself.
- Owner addition (relayed): QA and Blocked statuses. Added Blocked (red) and QA (orange) to Build status in all 16 timelines through a subagent; existing option ids kept; row counts not taken (Notion SQL quota exhausted).

## Environment
- No Docker on this machine (`docker`, colima, podman absent); Homebrew PostgreSQL 17 and Redis run on the shared default ports. The tester gets a compose path (used when Docker exists, e.g. on another machine) and a private-services fallback (initdb/pg_ctl + redis-server on free ports). No object store locally: readiness `storage` failure is an environment finding, not a blocker.
