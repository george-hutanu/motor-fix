# Feature Specification: Live hub garage-channel rules from capabilities

**Feature Branch**: `574-live-hub-capabilities`
**Created**: 2026-10-07
**Status**: Draft
**Input**: ST-574 "Tech debt (ST-254): the live hub restates who may read which event kinds" — https://app.notion.com/p/3f0607bff0d281698e70e92df00231f6 (Tech debt, Role System, no screens). Read from the caller's established facts (`/speckit-auto` preflight); the task page was not re-fetched in this phase and its comments are an unread source. "The live hub (`libs/domain/src/events/live.hub.ts`) restates who may read which event kinds through a garage channel apart from `libs/domain/src/auth/capabilities.ts`. Derive the owner/receptionist/mechanic garage-channel kind rules from `capabilitiesOf()` via one table mapping kind families to the capability needed to read them. Consequence: a receptionist (no `garage.reviews`, `garage.profile` or `garage.team` capability) stops receiving `review.*`, `garage.updated` (the profile kind) and `invite.*` through `garage:{id}`."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One table says what a garage role may hear (Priority: P1)

The rule for which event kinds reach a garage owner, a receptionist or a mechanic through the garage's live channel is derived from the role's capabilities (the Security page's "Capabilities by role", as `capabilitiesOf()` already encodes it) through one table that maps each kind family to the capability needed to read it. The hub keeps no second list of kinds per role, so a capability change (a row added to the role table, a new mechanic permission) changes what the live stream delivers without a second edit.

**Why this priority**: it is the finding itself. Today the hub holds its own receptionist exclusion list and its own mechanic right-to-kind pairs (`live.hub.ts:17-26`); the capability table lives elsewhere (`capabilities.ts:43-85`) and the two have already drifted: a receptionist hears reviews, profile changes and invites that the capability table says they may not read.

**Independent Test**: a unit test for every kind family in the table, for each garage role, against a hub whose only role input is `capabilitiesOf()`; and a unit test that every kind in the contract's list (plus `garage.settings_changed`) falls in at most one family of the table; that the hub holds no other role-named kind list is a review checklist item.

**Acceptance Scenarios**:

1. **Given** the kind-to-capability table, **When** an event of a mapped kind family meets a staff stream only on `garage:{garageId}`, **Then** it is delivered exactly when the connection's role (with a mechanic's permissions) holds that capability.
2. **Given** an event of a kind no family in the table covers (for example `quote.sent`, `booking.confirmed`, `job.started`, `garage.slots_changed`), **When** it meets an owner's or a receptionist's stream on the garage channel, **Then** it is delivered, as today.
3. **Given** the garage owner, **When** any kind meets their stream on the garage channel, **Then** it is delivered, as today: the owner holds every garage capability.

---

### User Story 2 - A receptionist hears only what they may read (Priority: P1)

A receptionist's live stream through the garage channel carries the kinds of the areas a receptionist may read (requests and messages, the schedule, final prices, own jobs, audit history) and the kinds no area claims, and no longer carries review kinds, the garage profile change or invite kinds, which belong to areas a receptionist may not read, alongside the price-list, team and feature-switch kinds it already withheld.

**Why this priority**: the behaviour change the derivation produces, and the one a product owner would notice: a receptionist's dashboard stops lighting up for a review, a profile edit or an invite it cannot open.

**Independent Test**: unit tests for a receptionist stream on `garage:{garageId}` receiving `review.posted`, `garage.updated` and `invite.sent` (dropped), `price_list.updated`, `member.removed`, `mechanic.updated`, `garage.settings_changed` and `garage.features_changed` (dropped, as before), and `request.created`, `message.sent`, `booking.move_proposed`, `quote.sent`, `booking.confirmed` (delivered).

**Acceptance Scenarios**:

1. **Given** a receptionist stream on `garage:{garageId}`, **When** `review.posted`, `garage.updated` or `invite.sent` passes through with that key in its audience, **Then** the stream does not receive it.
2. **Given** the same stream, **When** `price_list.updated`, `member.removed`, `mechanic.updated`, `garage.settings_changed` or `garage.features_changed` passes through, **Then** the stream does not receive it, as today.
3. **Given** the same stream, **When** `request.created`, `message.sent`, `booking.move_proposed`, `quote.sent` or `booking.confirmed` passes through, **Then** the stream receives it, as today.

---

### User Story 3 - A mechanic through the garage hears no more and no less than today (Priority: P2)

A mechanic's stream through the garage channel is driven by the same table: a kind reaches it only when it belongs to a family whose capability the mechanic holds through their permissions (`can_answer_quotes` → requests and messages, `can_move_bookings` → booking moves). Kinds no family claims still do not reach a mechanic through the garage, and everything on their own `mechanic:{mechanicId}` channel, and the feature switches, work as before.

**Why this priority**: the derivation must not change a mechanic's stream; this story is the proof that it does not.

**Independent Test**: the existing mechanic cases in the hub's unit suites pass unchanged, plus one case per mechanic-reachable family with the permission on and off, and one unmapped kind (`quote.sent`, `booking.created`) that stays undelivered through the garage.

**Acceptance Scenarios**:

1. **Given** a mechanic stream on `garage:{garageId}` with `can_answer_quotes`, **When** `request.created` or `message.sent` passes through, **Then** it is delivered; without the permission it is not.
2. **Given** the same stream with `can_move_bookings`, **When** `booking.move_proposed` or `booking.moved` passes through, **Then** it is delivered; without the permission it is not.
3. **Given** the same stream with every permission, **When** `quote.sent`, `booking.confirmed`, `review.posted` or `price_list.updated` passes through on the garage key only, **Then** it is not delivered.
4. **Given** a mechanic stream that meets a `job.*` or `booking.*` event on its own `mechanic:{mechanicId}` key, **When** it passes through, **Then** it is delivered whatever the permissions, as today.

---

### Edge Cases

- A kind needs exactly one capability: the families are disjoint prefixes, and a test asserts that every kind in `EVENT_KINDS` plus `garage.settings_changed` matches at most one family.
- No family may name `garage.own_jobs` or `garage.audit_history`, which every mechanic holds: the disjointness test also rejects such a family, so the garage channel never opens to every mechanic.
- `garage.settings_changed` is named by the hub today but not by the contract's kind list; it stays in the feature-switches family so its behaviour (withheld from a receptionist) does not change should a story emit it.
- A `media.*` kind of a garage that switched `live_media` off is still dropped for every staff stream before any role rule runs.
- A receptionist stream that meets `review.posted` on both `garage:{garageId}` and `public:garage` still receives it through the public key: the role rule applies only to a stream that met the event on staff keys alone.
- A mechanic whose permissions change: the garage access cache is dropped on `mechanic.updated` and re-read, so the next event is judged on the new capabilities, as today.

## Clarifications

### Session 2026-10-07

- Q: Does the staff-membership check still come before the table for an owner and a receptionist? → A: Yes (254-FR-004); a removed receptionist hears nothing through the garage. (spec-challenger 1)
- Q: Is a role-keyed default for unmapped kinds a "per-role list"? → A: No: the default (open for owner and receptionist, closed for a mechanic) is one policy flag, not a kind list; SC-002 forbids kind lists and right pairs only. (spec-challenger 2)
- Q: A kind matching two families? → A: Cannot happen: one capability per kind, tested over `EVENT_KINDS` plus `garage.settings_changed`. (spec-challenger 3)
- Q: Is `booking.move*` the prefix or the move proposal only? → A: The prefix, as today (`booking.moved`, `booking.move_lapsed`, `booking.move_refused` included); the mechanic stream is unchanged. (spec-challenger 4)
- Q: Do invite kinds and a mechanic's review/profile kinds follow the table? → A: Yes: Notion's Security "Capabilities by role" (decided 2026-10-03) and ST-400 give a receptionist no team or invite right and no review or profile management; a mechanic holds neither capability, so neither reaches them through the garage, as today. (context.md)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Whether an event kind reaches a garage-staff stream that met it only on `garage:{garageId}` MUST be derived from the connection role's capabilities (`capabilitiesOf(role, permissions)`, the one capability table) through one table mapping kind families to the capability needed to read them: `price_list.*` → `garage.prices`; `member.*`, `mechanic.*`, `invite.*` → `garage.team`; `garage.settings_changed`, `garage.features_changed` → `garage.feature_switches`; `garage.updated` → `garage.profile`; `review.*` → `garage.reviews`; `request.*`, `message.*` → `garage.requests`; `booking.move*` → `garage.schedule`. The hub MUST hold no other per-role list of kinds. (Modifies 254-FR-003.)
- **FR-002**: For an owner or a receptionist who is still that garage's staff in that role (254-FR-004, checked before the table), a kind in a mapped family MUST reach the stream only when the role holds that family's capability, and a kind in no family MUST reach it. In consequence the owner still receives every kind, and a receptionist no longer receives `review.*`, `garage.updated` or `invite.*`, on top of the `price_list.*`, `member.*`, `mechanic.*`, `garage.settings_changed` and `garage.features_changed` kinds already withheld.
- **FR-003**: For a mechanic, a kind MUST reach the stream through the garage channel only when it is in a mapped family whose capability the mechanic holds through their permissions (`can_answer_quotes` → `request.*`, `message.*`; `can_move_bookings` → every kind starting `booking.move`, `booking.moved` included), and a kind in no family MUST NOT; a kind met on the mechanic's own `mechanic:{mechanicId}` channel, the staff-membership check and the feature switches (254-FR-004, 254-FR-005) are unchanged.

### Key Entities

- **Kind family**: a prefix or exact name over event kinds (`review.*`, `garage.updated`), paired with the one capability needed to read it.
- **Owner**: the `garage` role in `capabilitiesOf()` and the hub; this spec says owner for it.
- **Garage capability**: a row of the Security page's "Capabilities by role" for a garage role; the owner holds all, the receptionist a fixed subset, the mechanic a subset grown by their permissions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Each kind family in FR-001, and one unmapped kind, is proved for each garage role (owner, receptionist, mechanic with and without the relevant permission) by a unit test; the existing hub suites keep passing with no changed assertion apart from the three receptionist kinds FR-002 now withholds.
- **SC-002**: The hub's source holds exactly one kind-to-capability table and no role-named kind list or right-to-kind pair (checked in review); the receptionist exclusion list and the mechanic right pairs are gone. A role-keyed default for unmapped kinds (open for owner and receptionist, closed for a mechanic) is a policy, not a kind list, and is allowed.
- **SC-003**: No contract, API route, screen or client changes: the diff touches `libs/domain/src/events` and its tests only, apart from this feature's records.

## Spec Delta

### Capability: `live-updates`

- **Adds**: FR-002, FR-003
- **Modifies**: 254-FR-003 → FR-001
- **Removes**: none

## Assumptions

- (autonomous default) Level 2 (feature), as `/speckit-size` recorded before this phase: one backend unit in `libs/domain/src/events`, no screen, no design boards (the Notion task is a Task with Role System, no `Design` property).
- (autonomous default) The kind-to-capability map is the one in FR-001, read off the current hub rules (`live.hub.ts:17-26`) and the capability table (`capabilities.ts:43-85`): every kind the hub names today keeps the capability its area implies, and the three kinds the receptionist loses (`review.*`, `garage.updated`, `invite.*`) are the only behaviour change, as the task states.
- (autonomous default) `garage.updated` is the profile kind: the contract (`libs/contracts/src/events.ts`) lists `garage.updated` and no `garage.profile_changed`.
- (autonomous default) `garage.settings_changed` stays in the table although the contract's kind list does not carry it: the hub names it today and removing it would be a change the task does not ask for.
- (autonomous default) Kinds in no family include `garage.messaged`, `garage.reported`, `garage.warned` and `garage.slots_changed`. An unmapped kind reaches an owner and a receptionist and not a mechanic through the garage: this is today's behaviour (254-FR-003: owner everything, receptionist all but the exclusion list, mechanic nothing else), kept so that only the derivation changes.
- (autonomous default) The mechanic's `can_record_final_price` → `garage.final_price` row maps to no kind family: no kind of that area reaches a mechanic through the garage today, and the task names none.
- (autonomous default) No web change: the receptionist dashboard reacts to a kind it no longer receives by not reacting; nothing on the client lists the kinds a role expects.
