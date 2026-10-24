# Bug Fix: the edge adversary spec answers 403 where it expects 502 under load

- **Slug**: 1006-edge-adversary-flake
- **Fixed**: 2026-10-24
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The unreachable API in the edge's adversary specs is now a listener the case keeps for its whole run and that resets each connection as it is accepted, so its port is never free for another worker's server; the clock waits in `edge.adversary.spec.ts` are replaced by the events they stood for.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/server/edge.adversary.spec.ts` | modified | "API is down" keeps the port (`resetAndDestroy` on `connection`) and asserts the API saw no request; half answer cut in the write callback, must fail as `TypeError`; abort case awaits the upstream's close; `EIGHT_MB_BUDGET` removed |
| `apps/web/src/server/edge.retry.adversary.spec.ts` | modified | the unreachable-API GET case modelled the same way, asserts the API saw no request |
| `apps/web/src/server/edge.unreachable.adversary.spec.ts` | added test | 8 adversary cases for an API that resets every connection |
| `apps/web/src/server/edge.ts` | unchanged | it is right to pass an upstream's answer on |

## Tests Added or Updated

- `edge.adversary.spec.ts` "answers 502 for every method when the API is down" — 502 for GET, POST, DELETE with the address held by the test.
- `edge.retry.adversary.spec.ts` "logs the path of an unreachable API without the query for a GET" — same fixture.
- `edge.unreachable.adversary.spec.ts` — every method 502, GET tried twice, POST once, no body replayed, the edge serves on.

## Local Verification

- Red: a probe handing the freed port to an origin-guarded server gave `[403, 403, 403]` on `origin/main`.
- `npx jest -c apps/web/jest.config.cts -w 4` on the three specs 50 times in a row: 50/50; the whole `apps/web/src/server` folder 20 times beside 8 `yes` CPU hogs: 20/20 (head 496db9d).
- `node .claude/scripts/lifecycle.mjs check`: ok.

## Deviations from Assessment

- The red is the probe, not a committed test: the bug is in the spec's own fixture, and a test that frees a port to show the race would carry the race.

## Follow-ups

- `apps/web/src/server/edge.spec.ts` has two `close(upstream)` cases with the same race; once #530 (ST-500) merged and `origin/main` was merged in, both were modelled the same way (T011).
