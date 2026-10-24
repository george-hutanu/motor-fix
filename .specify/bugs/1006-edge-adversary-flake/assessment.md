# Bug Assessment: the edge adversary spec answers 403 where it expects 502 under load

- **Slug**: 1006-edge-adversary-flake
- **Created**: 2026-10-24
- **Source**: https://github.com/george-hutanu/motor-fix-specs/issues/338 (host github.com, allowlisted; read with `gh issue view`)
- **Verdict**: valid
- **Severity**: low (test-only; a red pre-commit or CI run on a branch that does not touch the edge)

## Report (verbatim or summarized)

ST-1006: `apps/web/src/server/edge.adversary.spec.ts` failed twice on 2026-10-09 in pre-commit runs on branches that do not touch it: the 8 MB response case went past the 5 s Jest timeout on a busy machine (#308 tail), and an assertion expecting 502 received 403 (#295 lap 9). Both passed on retry and alone.

## Symptom

Under parallel load, "answers 502 for every method when the API is down" gets 403 from the edge instead of 502; separately, the 8 MB response case once ran past 5 s.

## Reproduction

1. On `origin/main` ed1ca271b, the whole `apps/web/src/server` folder, Jest `-w 4`, beside 8 `yes` CPU hogs, through `scripts/heavy.sh`: 20 of 20 runs green (320 tests each). The race is rare and did not show.
2. Deterministic probe (temporary spec, not committed): boot the edge on an upstream, `close(upstream)` as the case does, let a server with `mountOriginGuard(app, ['s3cret'])` listen on the freed port, then GET, POST and DELETE `/api/v1/x` through the edge: `[403, 403, 403]` where `[502, 502, 502]` is expected, the reported symptom exactly.
3. Timing of the 8 MB cases under the same load, three runs: 19-27 ms (request) and 29-40 ms (response); the 5 s timeout seen on #308 predates ST-259's streamed rewrite and ST-1191's 30 s budget.

## Suspected Code Paths

- `apps/web/src/server/edge.adversary.spec.ts` "answers 502 for every method when the API is down": `await close(upstream);` then three calls through an edge still pointed at that port.
- `apps/web/src/server/origin-guard/origin-guard.ts:22`: `res.status(403).end();` for every request without the CDN secret; its two specs listen on port 0 in parallel workers.
- `apps/web/src/server/edge.ts` `refused()`: `res.status(502).end();` is the only status the edge sets itself; any other comes from whoever answered.
- `apps/web/src/server/edge.retry.adversary.spec.ts` "logs the path of an unreachable API without the query for a GET": the same `await close(upstream);`.

## Root Cause Hypothesis

The spec models "the API is down" by freeing the upstream's port. The port returns to the ephemeral pool while specs in other Jest workers keep calling `listen(0)`; when an origin-guard spec is handed it, the edge forwards to that server and passes on its 403. The edge is right to pass on an upstream's answer; the fixture lets a foreign server become the upstream. Confidence: high (mechanism shown by the probe; the 403 has no other source). Secondary: two cases wait by the clock (`setTimeout(…, 10)` plus `AbortSignal.timeout(3000)`; a 2 s race), and the 8 MB cases carry a raised 30 s budget they do not need.

## Proposed Remediation

**Preferred**: keep the upstream bound for the whole case and reset each connection as it is accepted (`socket.resetAndDestroy()` on `connection`); the edge fails before any answer, takes the same `refused()` path, and the port is never free for another server. Same change in the retry spec's unreachable case. Replace the clock waits with the events they stand for, and drop `EIGHT_MB_BUDGET`.

**Alternatives**:
- Point the edge at a fixed port outside the ephemeral range (port 1): still depends on nothing listening there.
- Keep `close(upstream)` and retry on 403: a retry hides the race, ruled out by the dispatch.

**Files likely to change**:
- `apps/web/src/server/edge.adversary.spec.ts`
- `apps/web/src/server/edge.retry.adversary.spec.ts`

**Tests to add or update**:
- The two unreachable-API cases also assert the API saw no request.

## Risks & Considerations

- A reset at accept is ECONNRESET, not ECONNREFUSED; the edge handles both in `refused()` (1345-FR-011 names a reset and a refusal alike).
- `edge.spec.ts` has two `close(upstream)` cases with the same race; it is in PR #530 (ST-500) and stays out of this change.

## Open Questions

- none
