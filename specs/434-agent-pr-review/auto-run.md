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

## 4 Clarify
- spec-challenger: 8 findings. Applied (recorded under spec Clarifications): Stop gate lets a blocked run or an agent-review failure end; "web code" = apps/web, libs/ui-cockpit, libs/i18n, libs/data-access, libs/media, cap applies to browser-sweep findings only; off-origin requests low, console.error only; gate waits post-edit 60 s / Stop 300 s / pre-commit unbounded; the Agent review section is replaced each lap. Also applied as remediation: SC-003 reworded, routes from the agent with "not swept" findings, the Notion ladder written into FR-016 with only `unblock` leaving Blocked.

## 5-8 Plan, checklist, tasks, analyze
- plan.md and tasks.md written directly (level 2). Complexity Tracking: no-Docker fallback, SPECKIT_PR_STATE seam, separate merge gate.

## 9 Tests (red first)
- `npx vitest run … heavy notion-status pr-test merge-gate pr-lifecycle-gate`: 9 spec files failed (7 could not import their module), 8 tests failed, 10 passed — before any implementation.

## 10 Implement
- Commits: 1907e5b (scripts, gates, evals, heavy lock), e47aff8 (agent, skill, wiring, AGENTS, constitution v1.5.0), 5cf93e9 (tester fixes from the dry run). Draft PR #21 opened at the first commit.
- Owner relays mid-run: heavy lock became 3 slots at 20 % (scripts/heavy.sh rewritten, tests for slots, 75 passthrough, 124 give-up); wrapper lives inside .husky/pre-commit (the worktree guard refuses a wrapper around the commit command).
- Doctor: fingerprints re-blessed after reading each gate diff (merge-gate new; pr-lifecycle, stop-test-gate, post-edit-check changed). harness-eval --check 56/56.

## Dry run: PR #14 (017-language-switch, merged during this run)
- `run.mjs 14 --allow-closed --flows flows-14.mjs` then `post.mjs --add agent-findings.json --dry-run`: nothing posted. Lap 1 failed on initdb (locale), lap 2 on pg_ctl (LC_ALL); both fixed (5cf93e9). Lap 3: booted postgres, redis (private, free ports), api, web; 24 screenshots; flows 0 findings; affected tests and e2e (24 passed) green; verdict success with 5 findings (3 mechanical medium: storage readiness env limit, axe landmark-one-main, axe region; 2 agent review: no side gutter on phone/tablet (medium), selected language shown only by underline (low)). Teardown complete (run.log). Evidence: pr-review/pr-14-dry-run/.

## Merge of origin/main (before ready)
- Conflicts: AGENTS.md (kept the template step 4 and the QA steps 5–7), jest.preset.cjs (kept JEST_SUITE and JEST_MAX_WORKERS), pr-lifecycle-gate.mjs (kept --body-file message and the agent-review logic), registry.json, speckit-review hand-off (template + QA). Gate re-blessed. PR body now from .github/pull_request_template.md; pr-body-check passes.
- Scratchpad is shared with other sessions: a peer overwrote `pr-body.md`; this run's files are now prefixed `st434-`.

## 14 Review
- spec-reviewer: APPROVE, 2 MEDIUM, 3 LOW. code-reviewer: BLOCK, 3 HIGH, 4 MEDIUM, 5 LOW, 1 defer.
- Fixed (tests first, red proven: 4 failed): heavy.sh trap swallowed TERM and re-ran the command (now stops the command, frees the slot, exits 130/143/129; waits in the background so a signal is handled at once); merge-gate missed `gh -R … pr merge`, `--repo` before the number, and `/path/gh` (now parsed positionally, eval case added); run.mjs's outer process now forwards INT/TERM/HUP to heavy.sh; notion-status reads the event on either side of --current; worktree.mjs fetches to FETCH_HEAD and leaves no ref; report screenshots relative; `mf.lang` inlined; heavy messages; internal ids out of test data; plan/tasks/spec aligned with the slot model.
- Coordinator relays: 42 leaked test holders (killed by the coordinator; 6 more of this run killed here) — the spec now stops every child in afterEach and tests that TERM ends a waiter; `.husky/pre-commit` exports NX_DAEMON=false before anything; AGENTS.md says dev servers never hold a slot.
- Not taken: code-reviewer #7 (drop the `scripts/heavy.sh` existence guard and `--maxWorkers=2` in the hooks) — hooks run on any checked-out branch, older ones have no heavy.sh, and the root multi-project Jest config ignores a per-project maxWorkers. #4 (compose path unverified) and the diff-audit timeouts went to deferred.md.

## Hand-off and QA
- origin/main had not moved; PR body from the template passed pr-body-check; `gh pr ready 21`; Notion In progress → In review → QA (decided by notion-status.mjs).
- The `pr-tester` agent type was not loadable: this session read its agent list before the file existed. The tester ran as a general-purpose subagent told to read and follow `.claude/agents/pr-tester.md` (new sessions get the real type).
- Lap 1 on 12d0bb5: verdict success, 0 blocking, 5 medium (storage readiness env limit; 2 pre-existing axe moderate on /; a flow false positive; post.mjs --add rewrites the report), 4 low. Posted a COMMENT review (own-PR fallback), filled the Agent review section, `agent-review` = success on 12d0bb5. Teardown complete. Evidence: pr-review/pr-21-lap1/. Non-blocking findings deferred (deferred.md) per the owner's "defer, don't expand scope".
- Copying the evidence is a new commit, so the head moves and the tester runs again (lap 2) before the merge — the gate working as designed.

## Owner addition: deferred debt becomes Notion tasks (inside #21)
- No separate tasks database in the MotorFix space (notion-search); tasks are MotorFix stories rows, Issue type Task, Role System, Status To do, Epic EP-1, priority from severity.
- `.claude/scripts/debt-tasks.mjs` (plan/mark) with `debt-tasks.spec.mjs` written first (red: module missing; then 8 passed). The Notion writes stay in the skill (`speckit-notion-sync debt`), which the script feeds; wired into speckit-auto (phase 14 and hand-off step 6), speckit-review, speckit-pr-test and AGENTS.md.
- Backfill: 13 tasks (ST-433 1, ST-435 4, ST-434 8); URLs on every bullet; re-plan returns [].
- Lap 2 on 18a0731: success, 3 medium (env + 2 pre-existing axe), nothing new. Lap 3 on 3893394 (after the debt step): success, 3 new non-blocking findings — the debt step moved the head after a passing lap (medium), speckit-review's step range (low), `mark` accepting a non-bullet line (low). All three fixed in the next commit (tests first for `mark`: 1 failed, then 9 passed), so none deferred and nothing new to file; lap 4 runs on that head. Each lap announced to the coordinator ("#21 QA starting" / "#21 QA done").
