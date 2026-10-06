# Auto run — 725-lifecycle-gate-feature-dir

Level 1 (one-session). ST-725. Start commit 69f9260 (origin/main).

- **Size**: level 1 — classifier unsure; intent fully stated by the bug report (cause, fix, tests named), one hook.
- **Notion**: ST-725 created (Bug, Medium, Role System, epic Foundations, 1 point), Planning; Foundations timeline row created. Ready refresh pending: the connector's Query Data Source hit its usage limit.
- **Verify**: confirmed — `prLinked` reads `specs/<branch>` only (`pr-lifecycle-gate.mjs:165`); `handedOff` has no number fallback.
- **Specify**: spec.md (FR-001–FR-003, Spec Delta), tasks.md (T001–T006). No screens (design.md).
- **Decisions taken**: the fallback matches the slug too, not the number alone (spec Assumptions); no eval case, since the eval cases declare the state and never reach the folder lookup.
