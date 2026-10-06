# Feature Context: Idle watch tick without a model turn

- **Feature**: 703-idle-watch-gate
- **Anchor**: ST-703 Idle watch tick without a model turn — https://app.notion.com/p/3f0607bff0d2811c9381d8dee97c729c
- **Gathered**: 2026-10-05
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok (read by the run session, read-only: the org-researcher had no Notion tools this run) | feature none linked | epic ok (status only) | architecture skipped (harness task) | decisions skipped (harness task)
- **Overall confidence**: medium

## Story

- **ST-703 Idle watch tick without a model turn** — status Planning (To do when read), priority Medium, role System, issue type Tech debt, epic EP-1 Foundations
- Scope per the story: "an idle tick costs no model turn, and the model wakes only when the watcher has a fix to apply or an agent to dispatch"; What: `watch.mjs --gate` silent with exit 0 when a pass would do nothing, non-zero with the compact fix list when it would; the schedule wakes the model only when the gate fires, mechanism verified and idle-tick cost measured before and after from real transcripts; `speckit-watch/SKILL.md` (scheduling, step 1, empty pass), the AGENTS.md watch bullet, and the reminder if it names the old schedule.
- Comments that moved scope: none (no comments on the page, 2026-10-05).

## Decisions

- none found

## Constraints

- EP-1 Foundations is In progress — [EP-1 page, Status] (2026-10-05, confidence: high)

## Prior Art

- none found in Notion; in the repo, ST-464 (watch command), ST-688 (PR #140, merged 3486742) shaped `watch.mjs`.

## Open Decisions

- none found

## Contradictions with spec.md

- none found

## Proposed Clarifications (this command's proposals, not requirements)

- none

## Gaps

- The feature, architecture and decisions areas were not read: the org-researcher had no Notion tools this run, and a harness task has no feature page.

## Sources

- ST-703 — https://app.notion.com/p/3f0607bff0d2811c9381d8dee97c729c
- EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
