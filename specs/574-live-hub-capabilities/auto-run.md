# Auto run — 574-live-hub-capabilities

ST-574 (tech debt from ST-254): derive the live hub's garage-channel kind rules for owner, receptionist and mechanic from `capabilitiesOf()` through one kind-family-to-capability table. Start commit: 01b40fab.

## Preflight

- Level 2 (feature) recorded by `/speckit-size` before this run; branch `574-live-hub-capabilities` existed and was checked out before phase 2.

## Phases

- Phase 2 specify (fable, this phase): success. spec.md with 3 FRs, 3 SCs, Spec Delta `Modifies: 254-FR-003 -> FR-001`, 7 autonomous defaults; checklists/requirements.md all pass. feature.json points at specs/574-live-hub-capabilities; `level.mjs check`: level 2, unchanged (fr-count, clarification, contract, projects all clear). artifact-lint: 0 errors, 2 warnings (plan.md, tasks.md not yet written). after_specify hooks (notion sync start, design check, git commit) left to the caller.
