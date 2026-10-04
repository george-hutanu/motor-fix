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
