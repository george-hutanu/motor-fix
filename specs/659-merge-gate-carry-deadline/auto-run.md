# Auto run — 659-merge-gate-carry-deadline

Level 1 (one-session). ST-659, PR #137.

- **Verify**: confirmed. No hook `timeout`, `spawnSync` with no limit reading a signal as exit 0, up to 14 sequential gh reads (15 s + 13 × 10 s), and `catch { process.exit(0) }` on a failed PR read.
- **Specify**: spec.md (FR-001–FR-005, Spec Delta `platform`), tasks.md (T001–T011). No screens (design.md).
- **Tests first**: 10 new specs red at a25e475 (the old gate hung the full 15 s on a slow gh); eval case `merge-gate-refuses-a-carry-it-cannot-verify-in-time`.
- **Implement** (7743054): 30 s deadline with an abort over async gh reads; refusal on timeout, on a failed PR read and on any throw in the handler; carry state read in rounds (PR, head statuses, compare, the rest at once), each sha once; `run-hook.mjs` honours `timeout_ms` (45 s) and refuses a fail-closed gate stopped by it or by a signal; settings.json hook timeout 60 s.
- **Proof**: `npm run test:harness` 1178/1178; `harness-eval.mjs --check` 81/81; `doctor.mjs` 16 ok after `--bless-hooks` (diff read first).
- **Review**: spec-reviewer APPROVE, code-reviewer APPROVE. Patched: ticket ids out of comments and the eval `why`, maxBuffer dropped, SIGTERM from the wrapper aborts gh children, handler comment narrowed, T006 text. Deferred (deferred.md, filed in Notion): crash-at-load fail-closed (owner decision), one carry reader, a non-timeout signal test.
- **Decisions taken**: deadline 30 s / wrapper 45 s / hook 60 s; REST statuses kept over GraphQL (GraphQL lists only the latest state per context); `findCarry` stays sync for `/speckit-watch`.
- **Archive**: Spec Delta merged into `.specify/capabilities/platform.md` (+5).
