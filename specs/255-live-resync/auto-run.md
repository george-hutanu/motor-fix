# Auto run — 255-live-resync

Description: ST-255 Get back in step after a lost connection (EP-1 Foundations, High, 5 points). Builds on ST-256 live-in-place.
Start commit: 7fa0467f591d8ef58b46961fd44ee2c923973d8e (main) · branch 255-live-resync · worktree .worktrees/255-live-resync · PR #103 (draft)

## Preflight
- Tree clean (fresh worktree from origin/main). `npm ci` under heavy.sh: exit 0. typecheck + lint + test under heavy.sh: green (exit 0).
- Constitution v1.8.0 read; no placeholders.
- Design check: design.md written (the mock has no offline states).
- Notion start: story Planning, timeline row Planning, Ready to work unticked directly (Query Data Source hit Notion's usage limit, so the epic-wide ready refresh could not run; a start ticks nothing else).

## 0 Size
- Level 2 (feature): web client, state machine, IndexedDB queue, e2e.

## 1 Constitution
- Verified, not rewritten.

## 2 Specify
- spec.md written from the Build brief: 12 FRs, 3 stories. Autonomous defaults are in its Assumptions.

## 3 Context
- org-researcher wrote context.md: 4 contradictions (sign-out drop, other 4xx, mechanic route, A32 key scope), 7 proposed clarifications; no story comments; epic page and "Decisions and ideas" only partly read.

## 4 Clarify (spec-challenger, 8 findings; 5 questions answered with their recommendations)
- Q1 queue always or offline only → always, plus a 60 s retry after a stalled send.
- Q2 bar on a first load with no stream → yes, 10 s from wanted.
- Q3 re-read on the expired/shutdown renewal → yes, at the 200.
- Q4 which answers refuse → 401 renew+resend; 408/429/5xx keep; other 4xx drop. Stream 401 not a failure; refused renewal → closed.
- Q5 hidden tab → nothing pauses; visible after ≥60 s acts like `online`; polling re-reads at once.
- Context contradictions resolved in Assumptions: sign-out drop kept (shared device), mechanic via /app/garage frame, A32/audit device time left to the endpoint stories.
- Not taken: SC-001's non-`online` bound (one backoff step + 5 s) is noted under Edge Cases instead.

## 5 Plan
- plan.md: Live state machine (state/offline/resync, backoff with LIVE_RANDOM, polling, watchdog, wake), Waiting service on IndexedDB, frame bar. Versions read from package.json / node_modules.

## 6 Checklist
- checklists/requirements.md: 11 items, all checked against spec/plan.

## 7 Tasks
- tasks.md: 9 tasks, FR → test table.

## 8 Analyze
- artifact-lint --check: 0 errors, 0 warnings. Manual pass: every FR has a task and a test; no CRITICAL. Note: T003 changes tests that pinned ST-253's "no reconnect after a drop", which this story replaces (FR-002) — a spec-driven change, not a weakening.

## 9 Tests (red)
- New: live.resync.spec.ts, waiting.spec.ts, frame.offline.spec.ts; e2e test in apps/web-e2e/src/live.spec.ts (60 s offline, /me re-read within 5 s). Changed: live.adversary.spec.ts (no-reconnect pins → backoff), frame*.spec.ts live mocks (offline, resync).
- Red: `jest live.resync live.adversary waiting frame*` → 4 suites failed, 35 tests failed, 74 passed (waiting.ts missing; LIVE_RANDOM/state/offline/resync missing).

## 10 Implement
- notion-sync implement: story and timeline → Implementing; PR #103 label → in development.
- cf5ab7c feat(web): Live state machine (state/offline/resync, backoff 1/2/5/10/30 s ±10%, polling after 3 failures, 60 s watchdog, wake after ≥60 s hidden, online), liveResource re-reads on resync, frame offline bar + resync → session.reload, shell.live texts. Pre-commit caught: ro "S-a" needed U+2011 (i18n check); a Session without token() threw inside the loop (tab-bar specs) → the loop now ends on an unexpected error, as before.
- 7cba1b9 feat(web): Waiting queue (IndexedDB `motor-fix`/`waiting`, in-memory fallback), in-order flush with Idempotency-Key, keeps on 0/401/408/429/5xx with a 60 s retry, drops other 4xx with notice + catchUp, 24 h expiry, sign-out drop, connected().
- Test fixes while going green (tests, not behaviour): HttpTestingController.match consumes what it returns (helper fixed); jsdom has no structuredClone, so fake-indexeddb refused every put (polyfilled from node:v8 in the spec); the sign-out test now waits for the drop; `after` helper renamed (Biome read it as a test hook).
- Decision: `add()` waits for the account's stored actions to load first, so a load-time flush never re-sends a just-stalled action out of turn.
- Decision: a 401 that survives the interceptor's renewal keeps the action (the session ends and the sign-out drops it) rather than dropping it as "other 4xx".

## 11 Converge
- Inline pass: T001–T009 all [X]; every FR has code and a test (tasks.md table). No unbuilt work appended.

## 12 Harden
- artifact-lint --check: clean. diff-audit: 4 errors fixed in b524b30 (3 dead type exports un-exported; `@ts-expect-error` replaced with Reflect.deleteProperty) plus the unbounded `for (;;)` in the flush rewritten as a shrinking while. Remaining warnings: fake-indexeddb dev dep (justified in plan Complexity Tracking), test-only exports (`Waiting` has no caller by design; `LIVE_RANDOM` is the test seam; `liveResource`/`LiveState` pre-existing or shared), live.ts's pre-existing `for (;;)` reader loop (ends at stream end or abort).
- Mutation: not run locally (AGENTS.md: mutation runs only in CI, nightly mutation.yml).
- test-adversary, spec-reviewer and code-reviewer dispatched in parallel.
- test-adversary: 88 tests (live.resync.adversary 39, waiting.adversary 49); 3 failed. Two were defects, fixed in 7c6d43a: an answer that arrived after close() opened the stream; a refusal that arrived after sign-out showed its notice and re-read. The third, a runtime refusal of a kind outside the three, was dropped: the type already refuses it at compile time. Committed as ffbbf41.

## 13 Refresh (org-researcher --since)
- Story moved Planning → Implementing (our own write); Build brief unchanged (2026-10-03, scenarios 1-9, Open: None); A32 unchanged and still Proposed. 0 new findings. EP-1 page too large to re-read; siblings not re-queried (Notion Query Data Source at its workspace limit).

## 14 Review (repair lap 1)
- spec-reviewer: APPROVE. #1 MEDIUM 401 kept vs FR-010 → kept as coded, FR-009 amended, test added (401 in the kept list). #2 specs/ not committed → not taken: specs/ is never committed in this repo (owner's rule). #3 "Seconds" comment → fixed. #4 LiveState export → kept: it is the type of Live's public `state` signal, which both queue specs stub.
- code-reviewer: BLOCK. #1 HIGH the 60 s watchdog did not cover the connect → fixed (heard() before fetch), test added. #2 untrusted IndexedDB records and non-HTTP errors kept forever → records validated on read, an error that is not an answer drops the action; tests added. #3 LIVE_RANDOM test seam → removed, specs spy on Math.random. #4 Waiting with no caller → decision: merge as spec'd (spec Assumptions). #5 one expiry notice per action → one per pass; test added. #6 bodies not cancelled → cancelled. #7 comment → fixed.
- Fixes: 7c6d43a. Web suite 841/841 green, typecheck green, pre-commit green. code-reviewer re-run dispatched once.

## 15 Agent context
- The update script rewrote the SPECKIT block in CLAUDE.local.md, which is tracked in this repo, and grew it by 2 lines (context ratchet). Reverted: a per-feature pointer in a tracked file would conflict between parallel branches. Nothing changed.

## 16 Retrospective evidence (unjudged)
- retro-evidence --since 7fa0467: 9/9 tasks, 12 FRs, 0 retired, 6 commits, 18 files +3016 −57, Spec Delta live-updates +12, deferred 0, 10 carryover items from earlier features. instincts triggered: none listed. Jev lane unavailable. No verdict written.
- code-reviewer re-run: APPROVE; every prior finding fixed and tested. New LOW (`sendable` accepts any method string) left unfixed, in the report.
- Merged origin/main (80 commits behind; conflicts in frame.ts header, now with the bell, and live.adversary.spec.ts, keeping this branch's backoff version); npm ci for Biome 2.5.15, reformatted. Web suite 955/955. 3d23c19 pushed.

## 17 Archive
- capabilities merge --apply: live-updates +12 ~0 -0. `.specify/capabilities/live-updates.md` left uncommitted in the worktree (owner's rule: never commit .specify/ on a feature branch).

## 18 Hand-off
- PR body filled (pr-body-check passes), ready, label QA; story and timeline → QA. Head 3d23c19.
- CI lap 1 (3d23c19): E2E failed. (a) The new live test: Chromium's setOffline keeps an open stream alive, so the bar never showed. Live now drops its stream on the browser's `offline` event (unit test first). (b) sign-in-gate: its fake token made the real stream 401 → renewal refused → Session.forget, so the language tap no longer saved. That test now stubs /api/v1/live; the queue consequence of a refused renewal is deferred (deferred.md). 374fa43 pushed; repair lap 2.
- CI lap 2 (374fa43): all 16 checks green, CI OK included.
- PR tester: lap 1 run 37291543368 on 3d23c19 failed (offline bar never showed, the same cause as CI); lap 2 run 37292839173 on 374fa43 → agent-review success. Findings: 0 blocker/high, 4 medium, 3 low. Two were deferred and filed as To do in Notion (deferred.md), and the rest went into the finish comment.

## 19 Merge
- main was 17 commits ahead with no shared files and no conflict, so no re-test (AGENTS.md). `gh pr merge 103 --merge` → 036aa0f. QA label removed.
- finish: story → Done, timeline Build status → Merged, finish comment posted. notion-ready EP-1 running.
2026-10-05T10:39:25Z notion-ready Foundations: +9 −2 (ticked ST-196, ST-510, ST-500, ST-491, ST-498, ST-440, ST-632, ST-479, ST-623; unticked ST-545, ST-504); 128 ready; items gathered by fetch (query quota hit)
