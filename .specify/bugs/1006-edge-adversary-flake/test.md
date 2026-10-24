# Bug Verification: the edge adversary spec answers 403 where it expects 502 under load

- **Slug**: 1006-edge-adversary-flake
- **Verified**: 2026-10-24
- **Fix**: ./fix.md
- **Result**: resolved

## Checks

- The mechanism no longer applies: no case in `edge.adversary.spec.ts`, `edge.retry.adversary.spec.ts` or `edge.unreachable.adversary.spec.ts` closes its upstream before the calls it asserts on.
- `grep -E "setTimeout|AbortSignal.timeout|Date.now" apps/web/src/server/edge.adversary.spec.ts`: 0 lines; no test timeout argument.
- 50/50 consecutive runs of the three specs; 20/20 loaded runs of `apps/web/src/server` (Jest `-w 4`, 8 `yes` CPU hogs, `scripts/heavy.sh`, hogs killed after); `origin/main` ed1ca271b was 20/20 loaded too, the race being rare, and the probe reproduced it deterministically.
- CI: pending on PR #532.
