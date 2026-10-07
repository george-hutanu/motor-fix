# Implementation Plan: Live hub garage-channel rules from capabilities

**Branch**: `574-live-hub-capabilities` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/574-live-hub-capabilities/spec.md`
(ST-574, tech debt from ST-254; [context.md](./context.md), [design.md](./design.md): no screens).

## Summary

`libs/domain/src/events/live.hub.ts` keeps two role-named kind lists of its own
(`HIDDEN_FROM_RECEPTIONIST`, `MECHANIC_RIGHTS`, lines 17–26) beside the one
capability table in `libs/domain/src/auth/capabilities.ts` (`TABLE`,
`capabilitiesOf()`). Replace both with one exported table `KIND_CAPABILITY`
(kind family → the capability that reads it, FR-001) and let `allows()` ask
`capabilitiesOf(role, rights)` whether the connection holds it. Behaviour
change: a receptionist stops hearing `review.*`, `garage.updated` and
`invite.*` through `garage:{id}` (FR-002); the owner and the mechanic are
unchanged (FR-003). Diff: `live.hub.ts` and its audience spec only (SC-003).

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:78`), target `es2023`
(`tsconfig.base.json:38`); the domain lib compiles and tests as `commonjs`
(`libs/domain/tsconfig.json:5`, `libs/domain/tsconfig.spec.json:3`). Node
`>=24.0.0` (`package.json:85`).

**Primary Dependencies**: `@nestjs/core` 12.1.2 (`package.json:19`, only the
`Logger` is used here); `@motor-fix/contracts` (`EVENT_KINDS` in
`libs/contracts/src/events.ts`, read by the new disjointness test);
`capabilitiesOf`, `Capability`, `Permissions`, `Role` from
`libs/domain/src/auth/capabilities.ts`. No new dependency.

**Storage**: N/A for this change: the hub reads `GarageAccess`
(`libs/domain/src/events/garage-access.ts`) as before; nothing in PostgreSQL
or Redis changes.

**Testing**: Jest 30.5.2 with ts-jest 29.4.14 through `@nx/jest` 23.2.1
(`package.json:66,76,47`), root preset `jest.preset.cjs`, project config
`libs/domain/jest.config.cts` (`testEnvironment: node`). Unit spec, no
`*.integration.spec.ts`: the hub is tested with a fake `LoadGarageAccess`.

**Target Platform**: the `api` NestJS server (Linux container, `Dockerfile`),
where `LiveHub` serves SSE streams.

**Project Type**: Nx monorepo lib (`libs/domain`), backend unit only.

**Performance Goals**: none beyond today: `allows()` runs per staff stream per
event; a handful of `RegExp.test` calls and one `capabilitiesOf()` array
(≤ 10 entries) per call is the same order as the current code.

**Constraints**: context.md Constraints kept: fail closed (no audience →
dropped), feature switches checked first, access cache and re-reads untouched,
private kinds never through `public:` keys. 254-FR-004 (membership) is checked
before the table.

**Scale/Scope**: one source file (~15 lines net), one spec file; no contract,
route, client or screen change (SC-003).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. No Bloat (NON-NEGOTIABLE)**: one table and one helper replace two
  tables and one helper; `capabilitiesOf()` is reused, not copied. The
  mechanic branch takes the simpler of the two designs below. No new file,
  dependency, option or export beyond `KIND_CAPABILITY` (exported for the
  disjointness test, which `/speckit-tests` writes).
- [x] **II. Test Discipline**: `/speckit-tests` adds the red cases to
  `live.hub.audience.spec.ts` (colocated) before `live.hub.ts` changes; the
  red-first gate sees the spec file touched on the branch. No PostgreSQL or
  Redis is needed; Playwright is out of scope (no screen).
- [x] **III. The Given Stack**: NestJS lib code in TypeScript; nothing added.
- [x] **IV. One Repository, One Toolchain**: `libs/domain`, root Jest, Biome.
- [x] **V. Rules Live in One Place**: this is the principle the task
  restores: the role→capability rule stays in `capabilities.ts`, and the only
  new rule (kind family→capability) lives once, in the hub, which is its sole
  consumer. Trust is checked on the server.
- [x] **VI. PostgreSQL Is the Truth**: no state change.
- [x] **Notion choices**: the capability rows come from the Security page's
  "Capabilities by role" (context.md, 2026-10-03) as `capabilitiesOf()`
  encodes them; no To-decide item (T1–T10) is touched.

Post-design re-check: unchanged, all pass. Complexity Tracking stays empty.

## Design

### The table (FR-001), in `live.hub.ts`

```ts
export const KIND_CAPABILITY: [RegExp, Capability][] = [
  [/^price_list\./, 'garage.prices'],
  [/^(member|mechanic|invite)\./, 'garage.team'],
  [/^garage\.(settings_changed|features_changed)$/, 'garage.feature_switches'],
  [/^garage\.updated$/, 'garage.profile'],
  [/^review\./, 'garage.reviews'],
  [/^(request|message)\./, 'garage.requests'],
  [/^booking\.move/, 'garage.schedule'],
];
```

`HIDDEN_FROM_RECEPTIONIST` and `MECHANIC_RIGHTS` are deleted; `Capability`
and `capabilitiesOf` are imported from `../auth/capabilities`. A small
`const capabilityFor = (kind) => KIND_CAPABILITY.find(([kinds]) => kinds.test(kind))?.[1]`
gives the one capability of a kind (`undefined` for an unmapped kind).

### `allows()` (FR-002, FR-003)

Order kept from today: feature switches first, then membership
(254-FR-004), then the kind rule.

- **Owner / receptionist**: `access.owners`/`access.receptionists` has the
  account; then `const needed = capabilityFor(kind)`; unmapped → `true`;
  mapped → `capabilitiesOf(role, NONE).includes(needed)` (the owner's and
  receptionist's `capabilitiesOf` ignore permissions; pass a constant
  all-false `Permissions` rather than widen the signature).
- **Mechanic**: `rights = access.mechanics.get(accountId)`; none → `false`;
  a key on `mechanic:{id}` among the met keys → `true` (unchanged); else
  mapped kind → `capabilitiesOf('mechanic', rights).includes(needed)`,
  unmapped → `false` (the role-keyed default SC-002 allows).

**Chosen: plain membership in `capabilitiesOf('mechanic', rights)`**, not the
variant that subtracts the base mechanic rows (`garage.own_jobs`,
`garage.audit_history`). Why: no family in `KIND_CAPABILITY` maps to either
row, so the subtraction can never change a result; it would add code that
only a future table row could exercise (Principle I). The guard is a test, not
code: the disjointness test also asserts that no family names
`garage.own_jobs` or `garage.audit_history`, so a future row that would open
the garage channel to every mechanic fails the suite rather than slipping
through. Own-jobs kinds keep reaching a mechanic through `mechanic:{id}` only.

The three branches collapse to: membership for the role, then
`needed === undefined ? role !== 'mechanic' : capabilitiesOf(role, rights ?? NONE).includes(needed)`,
with the mechanic's own-key short-circuit before it. Implementation may keep
the branches explicit if that reads better; either is under 20 lines.

### Tests (`libs/domain/src/events/live.hub.audience.spec.ts`)

- Update the receptionist case: the hidden list grows by `review.posted`,
  `garage.updated`, `invite.sent`; the owner still gets everything.
- Per-family per-role cases (SC-001): an `it.each` over the seven families
  (one representative kind each, plus `booking.moved` for the prefix) and one
  unmapped kind (`quote.sent` or `booking.confirmed`), asserting what the
  owner, the receptionist, a mechanic without rights, `quoter` and `mover`
  receive through `garage:g1`.
- Disjointness: over `EVENT_KINDS` from `@motor-fix/contracts` plus
  `garage.settings_changed`, each kind matches at most one entry of
  `KIND_CAPABILITY`; and no entry's capability is `garage.own_jobs` or
  `garage.audit_history`.
- Existing suites (`live.hub.spec.ts`, `live.hub.adversary.spec.ts`,
  `live.audience.adversary.spec.ts`) keep passing with no changed assertion
  apart from the receptionist case (SC-001). Check: the adversary specs do
  not assert a receptionist receiving a review, profile or invite kind.

Run: `npx nx test domain --testPathPattern=live.hub` through
`scripts/heavy.sh` when it covers more than a few files; `post-edit-check.sh`
runs the colocated spec on each edit.

## Project Structure

### Documentation (this feature)

```text
specs/574-live-hub-capabilities/
├── spec.md
├── context.md
├── design.md
├── plan.md              # this file
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks output (next phase)
```

No `research.md` (no NEEDS CLARIFICATION; every dependency is in-repo and was
read), no `data-model.md` (no entity or storage change), no `contracts/` (no
API change, SC-003) and no `quickstart.md` (the validation is the one Jest
command above).

### Source Code (repository root)

```text
libs/domain/src/
├── auth/
│   └── capabilities.ts                 # read only: Capability, capabilitiesOf, Permissions, Role
└── events/
    ├── garage-access.ts                # read only: GarageAccess
    ├── live.hub.ts                     # KIND_CAPABILITY replaces HIDDEN_FROM_RECEPTIONIST + MECHANIC_RIGHTS; allows() derives from capabilitiesOf
    └── live.hub.audience.spec.ts       # receptionist case updated; per-family per-role cases; disjointness test
libs/contracts/src/
└── events.ts                           # read only: EVENT_KINDS
```

**Structure Decision**: the existing `libs/domain/src/events` layout, two
files touched, nothing new.

## Complexity Tracking

None: no constitution gate is violated.
