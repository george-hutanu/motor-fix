# Auto run — 253-live-connection

- Description: ST-253 Set up the real-time connection to open dashboards (Notion story https://app.notion.com/p/3ee607bff0d281739e3df7b8fc484d49, epic EP-1 Foundations)
- Start: branch `worktree-agent-a4dfb40bb2c556ea5` at e58ed38 (origin/main); feature branch `253-live-connection`
- Story pick: ST-253 over ST-194 (both Highest, 8 points): ST-194's Build brief depends on ST-257 (To do); every ST-253 blocker (ST-252, ST-82, ST-79) is Done, and it unblocks ST-254–257.

## Preflight
- Tree clean; `npm ci` (heavy.sh) ok; `npm run typecheck && npm run lint && npm test` (heavy.sh) exit 0 — typecheck 13 projects, test 11 projects.
- Constitution v1.6.0 read; no placeholders.

## 0 Size
- Level 2 (feature): the intent is in the Build brief; the design has choices (fan-out, reader, expiry).

## 2 Specify
- Spec written; 0 [NEEDS CLARIFICATION]; 6 autonomous defaults under Assumptions (toast text, test body, per-copy cap, one reconnect, roleInUse channels, mechanic in garage channel).
- after_specify: Notion start (ST-253 Planning, timeline Planning, EP-1 unchanged), draft PR #57 (planning, feature, scope: events, EP-1, ui), PR linked on the story, Ready to work unticked; design.md written (no screens; shared toast).

## 3 Context
- org-researcher: 22 findings, 4 contradictions (story edit time = this run's own writes; mechanic missing from FR-015; per-copy cap narrows the brief; 403 for suspended is an addition).

## 4 Clarify
- spec-challenger: 5 findings, all taken as questions, each answered with its recommendation:
  - Q1 which ends reconnect → `bye` with reason expired/evicted/shutdown; reconnect on expired and shutdown only (keeps the 10-stream cap from thrashing).
  - Q2 lifetime → the dashboard frame (shell), not the home view.
  - Q3 multi-garage staff → one garage, the role in use's (policy.ts roleInUse / ActorGuard).
  - Q4 mechanic dashboard → mechanics land on /app/garage (policy.ts landingFor); FR-015 names all four roles.
  - Q5 Redis down → streams open with heartbeats; subscriber resubscribes; only the test POST answers 503.
- Minor applied: the test address answers 401 without a token, 404 to signed-in non-admins.

## 5–8 Plan, checklist, tasks, analyze
- plan.md + research, data-model, contracts/live.md, quickstart; Complexity Tracking: the web reader is a file in apps/web (not a new Nx lib, one consumer); AuthModule global (one guard and Prisma for the events module).
- checklists/live.md: 13 items, all judged satisfied with a reason each.
- tasks.md: 11 tasks. Analyze: artifact-lint 0/0 after the Spec Delta named a new capability `live-updates` (stub file under .specify/capabilities); one plan/tasks mismatch fixed (EventsModule options).

## 9 Tests (red)
- New suites: live.hub.spec, live.api.integration.spec, live.spec (web), frame.spec additions, access-token expiry; e2e live.spec. Red: 5/5 suites failing (modules absent).
- test-adversary: 3 files, ~116 tests. Four corrected to the house rules after implementation: two-garage fixture (schema forbids two owner rows → owner + receptionist), forged role (roleInUse falls back to the held role, policy.ts), reconnect "delay" (reconnect is immediate), one-byte-at-a-time flush.

## 10 Implement
- Local DB motorfix_st253, Redis db 13, API :3253, web :4253 (.env git-ignored).
- Full Jest: 120 suites, 2918 tests passed. typecheck 0, biome 0.
- e2e (BASE_URL :4253): 189 passed; 3 failed unrelated — pwa.spec needs the production build; overlays.spec scroll check on /cockpit flakes by a few px on the dev server (a different case each run).
- Commits: 8830658 feat, a197646 refactor (dead exports).

## 12 Harden
- diff-audit: dead exports removed (LIVE_BYE_REASONS → type, interfaces private). `import-extension` ERRORs: known false positive (bundler resolution, every lib file extensionless). `suppression` / `untested-new-file` on libs/data-access: generated code. `unbounded-loop` WARN on the reader: exits on stream end or abort.
- Mutation: not run locally (AGENTS.md: CI nightly only).

## Browser walk (built-in pane)
- Driver dashboard, admin test update: toast at 320 px dark RO, 390 px light EN, tablet dark EN, desktop light EN; no sideways scroll; Cockpit toast colours in both themes.

## 14 Review
- spec-reviewer APPROVE (3 LOW: re-verify comment → fixed; `Connection` header → removed; open handle in worker mode → deferred.md).
- code-reviewer APPROVE (MEDIUM #1 client gone during the channel lookup kept a slot → fixed in the hub, test first; LOW #2 log the failed subscribe → done; MEDIUM #3 decision two Redis helpers → kept B, a dedicated fail-fast publisher so the test address answers 503 at once rather than after the 2 s command timeout; LOW #4 AccessClaims export → removed; LOW #5 loop exit comment → added).
- No CRITICAL/HIGH; no re-review needed.

## 15 Agent context
- CLAUDE.local.md is tracked here; its "Active plan" pointer left as is, to avoid a conflict with the other open PRs.

## 16 Retro evidence (unjudged)
- retro-evidence --since e58ed38 --jev: 11/11 tasks, 15 FRs, Spec Delta live-updates +15, 0 deferred at the time; 5 carryover items from earlier features; jev lane unavailable (no key), so no suggested verdict.
- instincts triggered: none (jev lane unavailable).
