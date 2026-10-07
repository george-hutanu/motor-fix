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

## Phase 5 — plan
- fable: success. plan.md only (no research/data-model/contracts/quickstart: no unknowns, no entity, no API change). KIND_CAPABILITY table replaces HIDDEN_FROM_RECEPTIONIST + MECHANIC_RIGHTS; mechanic uses plain membership in capabilitiesOf (no family maps to own_jobs/audit_history; the disjointness test guards it). Hooks: git commit done; agent-context update skipped (nothing managed to refresh). Constitution check all pass.

## Phase 6 — checklist
- sonnet: success. checklists/authorization.md, 10 items, all checked; 3 spec edits (unmapped garage kinds listed, owner = `garage` role, no family on own_jobs/audit_history).

## Phase 7 — tasks
- sonnet: tasks.md, 6 tasks (T001-T003 tests first, T004 red proof, T005 live.hub.ts, T006 green verification); FR-001..003 and SC-001..003 mapped.

## Phase 8 — analyze
- artifact-lint --check: 0 errors, 0 warnings; tasks cover FR-001..003, SC-001..003; no remediation.

## Phase 9 — tests
- live.hub.audience.spec.ts: receptionist case extended (review.posted, garage.updated, invite.sent withheld), 12-family × 5-role it.each, all-rights mechanic, membership-first, mechanic own channel, table disjointness over EVENT_KINDS + garage.settings_changed, no own_jobs/audit_history family. Red: suite failed to compile (TS2305 no exported KIND_CAPABILITY).

## Phase 10 — implement
- live.hub.ts: HIDDEN_FROM_RECEPTIONIST and MECHANIC_RIGHTS replaced by exported KIND_CAPABILITY; allows() = switches → staffRights (membership) → mechanic own key → unmapped open for owner/receptionist, closed for mechanic → capabilitiesOf(role, rights).includes(needs).
- live.audience.adversary.spec.ts pinned "gives a receptionist garage.updated": moved garage.updated to the withheld list with review.posted and invite.sent (the FR-002 change, SC-001 allowed).
- Unit suites libs/domain/src/events + auth: 20 suites, 729 passed.

## Phase 12–14 — harden and review
- test-adversary: 70 cases in libs/domain/src/events/live.hub.capabilities.adversary.spec.ts, all green, no defect found.
- code-reviewer: APPROVE. One LOW: KIND_CAPABILITY is exported only for its spec. Kept, because the disjointness test guards find()'s first-match order.
- spec-reviewer: APPROVE, no findings. The Notion refresh (phase 13) found nothing new.
- No repair laps used.
