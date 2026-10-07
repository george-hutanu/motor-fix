# Feature Context: Audit history specs without restatements

- **Feature**: 473-audit-history-spec-dedup
- **Anchor**: ST-473 Tech debt (ST-391): restates several service-spec cases and re-declares the HTTP spec's helpers — https://app.notion.com/p/3ef607bff0d2811689dcd361b0febfc8 | terms: audit history, adversary spec, helpers
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature n/a (none linked) | epic partial (siblings only) | architecture n/a (test-only) | decisions n/a (test-only)
- **Overall confidence**: high

## Story

- **ST-473 Tech debt (ST-391)** — status Planning, priority Medium, role System, epic EP-1 Foundations (https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), PR #179
- Scope per the story: "delete the restated cases and share the helpers in one audit-history.testing.ts". Where: `libs/domain/src/audit/audit-history.adversary.integration.spec.ts`. Restated cases: "7-day default, no entry written by reading, foreign cursor, nested masking, system actor, 20th-entry cursor". Found by spec-reviewer, 2026-10-04, Medium.
- Comments that moved scope: none (0 comments on ST-473; 0 on ST-391)

## Decisions

- Test-only; scope is exactly the six named cases plus the shared helper module — [ST-473 page, Finding] (2026-10-06, confidence: high)
- The behaviours the six cases assert are product rules from the source story: default period last 7 days, reading is not recorded ("Audit history: reading it is not recorded"), 404 for another garage, 20 per page newest first — [ST-391, Build brief] (2026-10-04, confidence: high)

## Constraints

- ST-391's API is `GET /api/v1/audit-history` answering `{ items, nextCursor, total }`; the dedup must not change it — [ST-391, Data] (2026-10-04, confidence: high)

## Prior Art

- ST-391 (source story) is Done, PR #32; its three integration suites are the ones being tidied — [ST-391] (2026-10-04)
- ST-472 (Planning, PR #177) edits `audit-history.api.integration.spec.ts:207`: adds a signed-in case through AppModule + configureApp — [ST-472] (2026-10-06)
- ST-469 (To do) adds `@@index([at])` in `audit.prisma`; no spec overlap — [ST-469] (2026-10-04)

## Open Decisions

- none found

## Contradictions with spec.md

- none found. spec.md matches the ticket (six cases, `audit-history.testing.ts`, test-only).

## Proposed Clarifications (this command's proposals, not requirements)

- ST-472 touches the same API spec and may add its own bootstrap through AppModule + configureApp. Decide which PR merges first and whether the shared module must leave room for a non-test-app bootstrap — from ST-472.

## Gaps

- No feature page covers the audit history (ST-391: "not linked"), so no Notion rules beyond the story's Build brief.

## Sources

- ST-473 — https://app.notion.com/p/3ef607bff0d2811689dcd361b0febfc8
- ST-391 See the audit history of my garage, or all of it as admin — https://app.notion.com/p/3ee607bff0d281b7acf7cedaa984bb17
- ST-472 — https://app.notion.com/p/3ef607bff0d281468c87db57d36586a4
- ST-469 — https://app.notion.com/p/3ef607bff0d2815582c2e980a3369365
