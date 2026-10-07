# Tasks: Live hub garage-channel rules from capabilities

**Input**: `specs/574-live-hub-capabilities/` (spec.md, plan.md). Tests come first (Constitution II); `live.hub.ts` changes only after the red proof.

Format: `- [ ] T### [P?] [US?] Description with file path`

## Phase 1: Tests first (red)

- [ ] T001 [US1] [US2] [US3] In `libs/domain/src/events/live.hub.audience.spec.ts` add per-family per-role cases (FR-001, FR-002, FR-003, SC-001): an `it.each` over the seven families of `KIND_CAPABILITY` (one representative kind each, plus `booking.moved` for the prefix) and one unmapped kind (`quote.sent`), asserting what the owner, a receptionist, a mechanic without rights, a `can_answer_quotes` mechanic and a `can_move_bookings` mechanic receive on `garage:g1` only; include the mover mechanic receiving `booking.moved`, a mechanic with every right not receiving `quote.sent`/`review.posted`/`price_list.updated`, and the membership check coming before the table (a removed receptionist hears nothing).
- [ ] T002 [US2] In the same file update the receptionist case: `review.posted`, `garage.updated` and `invite.sent` are now dropped (FR-002) beside `price_list.updated`, `member.removed`, `mechanic.updated`, `garage.settings_changed`, `garage.features_changed`; `request.created`, `message.sent`, `booking.move_proposed`, `quote.sent`, `booking.confirmed` still delivered; the owner still receives every kind.
- [ ] T003 [US1] In the same file add the disjointness test (FR-001, Edge Cases): over `EVENT_KINDS` from `@motor-fix/contracts` plus `garage.settings_changed`, each kind matches at most one entry of the exported `KIND_CAPABILITY`, and no entry's capability is `garage.own_jobs` or `garage.audit_history`.
- [ ] T004 Red proof: run `scripts/heavy.sh npx nx test domain --testPathPattern=live.hub.audience`; the new cases fail (no `KIND_CAPABILITY` export, receptionist still hears the three kinds). Record the failing names in `specs/574-live-hub-capabilities/auto-run.md`.

## Phase 2: Implementation (green)

- [ ] T005 [US1] [US2] [US3] In `libs/domain/src/events/live.hub.ts` delete `HIDDEN_FROM_RECEPTIONIST` and `MECHANIC_RIGHTS`, add the exported `KIND_CAPABILITY` table of plan.md and derive `allows()` from `capabilitiesOf(role, rights)` (feature switches first, membership second, the mechanic's own-key short-circuit, unmapped kind open for owner/receptionist and closed for a mechanic) (FR-001, FR-002, FR-003, SC-002, SC-003).

## Phase 3: Verification

- [ ] T006 Green: run the whole `libs/domain/src/events` hub suites (`live.hub.spec.ts`, `live.hub.adversary.spec.ts`, `live.audience.adversary.spec.ts`, the audience spec) through `scripts/heavy.sh`, plus `nx typecheck domain` and `biome check`; no assertion changed apart from the receptionist case (SC-001), and the diff touches only `libs/domain/src/events` and this feature's records (SC-003).

## FR map

FR-001: T001, T003, T005. FR-002: T001, T002, T005. FR-003: T001, T005. SC-001: T001, T002, T006. SC-002: T005. SC-003: T006.

## Dependencies

T001-T003 (same file, sequential) → T004 → T005 → T006.
