# Context: Watch every running agent and get stale work moving again (ST-464)

Gathered: 2026-10-04 · Source: the Notion space "MotorFix — Product documentation" only.

The `org-researcher` subagent could not load any Notion tool, because its allowlist names other connector ids than this session's. The pages below were read directly by the run's own session.

## Sources

- ST-464 story, https://app.notion.com/p/3ef607bff0d281c89794da24167062c8 — created 2026-10-04 by this run from the owner's request. Status In progress. 0 comments.
- ST-434 "Test and review every ready PR like a QA engineer before it merges", https://app.notion.com/p/3ef607bff0d2812185effb0ff2095302 — Done, edited 2026-10-04 09:37. It defines the PR tester, the `agent-review` status and the repair cap. Its Build brief says "Memory-heavy commands take the shared lock (`scripts/heavy.sh`)".
- EP-1 Foundations, https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 — In progress, edited 2026-10-03. Platform and harness tasks sit in it with no feature. Nothing in it is about agents or worktrees.
- Foundations build timeline (`collection://2437de64-…`): no row for a harness task. A search for ST-434 found none.

## Constraints

- Harness only. No product code or screen (ST-464 Build brief, Scope and Screens).
- Depends on the PR tester and its `agent-review` status (ST-464 Build brief, Depends on; ST-434).
- Out of scope: sessions on other machines or in the cloud (ST-464 Build brief).
- Phase thresholds are proposed defaults the owner may change (ST-464 Build brief, Rules).

## Contradictions

- None found. The owner's rule "4 QA runs at once" (2026-10-04, this session) is newer than the earlier limit of 3 heavy slots set on the same day (`scripts/heavy.sh`, AGENTS.md), so the newer one wins (spec Clarifications).

## Proposed Clarifications

- None beyond the spec's Clarifications.
