# Deferred — 659-merge-gate-carry-deadline

Verified review findings that are real but not this change.

- **A fail-closed gate that crashes at load passes.** `run-hook.mjs` hands back a gate's exit code as is, so a gate that dies before its handler runs (a syntax error, an import Node cannot load) exits 1, which Claude Code reads as non-blocking. Making a fail-closed entry's exit other than 0 or 2 refuse is two lines, but then a crashed gate blocks its tool until fixed, for all seven fail-closed gates: an owner decision. Pre-existing; found by code-reviewer on PR #137. — Notion: https://app.notion.com/p/3f0607bff0d2819b9492f3e7e9eaf6c1
- **One carry reader instead of two.** `carry.mjs` keeps the sync `readCarryState` for `findCarry` (the `/speckit-watch` lookup) beside the gate's async `fetchCarryState`. When the CLI is next touched, make `findCarry` async and delete `readCarryState`. code-reviewer on PR #137. — Notion: https://app.notion.com/p/3f0607bff0d281f9ab4ec33f8647dccb
- **A test for a fail-closed gate stopped by a signal other than the timeout.** `run-hook.spec.mjs` covers the timeout (which also sets `signal`), not the `was stopped by <signal>` message path. spec-reviewer on PR #137. — Notion: https://app.notion.com/p/3f0607bff0d281e4acfcdda5dfb5acce
