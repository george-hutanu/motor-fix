# Implementation Plan: [FEATURE]

**Branch**: `[###-feature-name]` | **Date**: [DATE] | **Spec**: [link]

**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. Source every value from repo files (package.json, lockfile,
  tsconfig*.json, nx.json, jest.config.ts, the touched app's config) and cite
  the file — never from memory. The structure here is presented in advisory
  capacity to guide the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from the motor-fix Constitution (v1.1.0) — evaluate in order:

- [ ] **I. No Bloat (NON-NEGOTIABLE)**: plan is the smallest design that fully
  solves the feature — no speculative abstractions, no single-implementation
  layers, no new dependency where an existing one or local code suffices.
  Anything that looks like bloat goes to Complexity Tracking or gets cut.
- [ ] **II. Test Discipline**: failing tests first (`/speckit-tests`); Jest
  specs colocated with their source; API tests against real PostgreSQL and
  Redis; Playwright for end-to-end flows.
- [ ] **III. The Given Stack**: Angular + PrimeNG (Cockpit theme), NestJS,
  PostgreSQL, Redis — no substitute and no second framework for the same job.
- [ ] **IV. One Repository, One Toolchain**: fits the Nx apps `web`, `api`,
  `worker`, `mcp` and shared libs; no microservice, GraphQL, global store,
  search engine or broker; no eslint, prettier or per-project Biome config.
- [ ] **V. Rules Live in One Place**: API shapes in the OpenAPI document with a
  generated client; DTOs validated at the edge; one use case shared by
  screen, worker and MCP server; trust checked on the server.
- [ ] **VI. PostgreSQL Is the Truth**: nothing only in Redis; every state
  change saved with its outbox event in the same transaction.
- [ ] **Notion choices**: each Proposed choice this plan relies on cites its
  Notion Architecture page; each To-decide item (T1–T10) it touches is marked
  `[NEEDS CLARIFICATION]`, not assumed.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
