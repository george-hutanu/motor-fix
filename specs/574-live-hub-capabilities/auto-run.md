# Auto run — 574-live-hub-capabilities

ST-574 (tech debt from ST-254): derive the live hub's garage-channel kind rules for owner, receptionist and mechanic from `capabilitiesOf()` through one kind-family-to-capability table. Start commit: 01b40fab.

## Preflight

- Level 2 (feature) recorded by `/speckit-size` before this run; branch `574-live-hub-capabilities` existed and was checked out before phase 2.

## Phases

- Phase 2 specify (fable, this phase): success. spec.md with 3 FRs, 3 SCs, Spec Delta `Modifies: 254-FR-003 -> FR-001`, 7 autonomous defaults; checklists/requirements.md all pass. feature.json points at specs/574-live-hub-capabilities; `level.mjs check`: level 2, unchanged (fr-count, clarification, contract, projects all clear). artifact-lint: 0 errors, 2 warnings (plan.md, tasks.md not yet written). after_specify hooks (notion sync start, design check, git commit) left to the caller.

## Preflight
- Start 01b40fab (= origin/main). origin/main does not fix it: `HIDDEN_FROM_RECEPTIONIST` and `MECHANIC_RIGHTS` still in libs/domain/src/events/live.hub.ts:17-26; receptionist still gets review.*, garage.updated, invite.*.
- Notion page 3f0607bf… confirmed as ST-574 (userDefined:ID). Full-suite preflight not rerun: worktree fresh from green main, npm ci done.
- Size: level 2 (notion facts: boards rollup, brief not found).
- Notion start: ST-574 → Planning. Draft PR #194 (labels planning, tech debt, EP-1, scope: domain); `pr 194` linked.

## Phase 3 — context
- org-researcher: success; Security "Capabilities by role" (2026-10-03) and ST-400: receptionist has no review management, profile, team or invite right; ST-254's older receptionist list superseded. 0 open decisions.

## Phase 4 — clarify
- spec-challenger: 5 findings, each answered with its recommendation (membership check first; role-keyed default allowed; one capability per kind tested over EVENT_KINDS + garage.settings_changed; booking.move prefix incl. booking.moved; source-reading check moved to review). Context clarifications folded in. level check: 2 kept; capabilities validate clean.
