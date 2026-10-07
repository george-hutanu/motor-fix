# Feature Specification: Adding the tester's findings twice adds them once

**Feature Branch**: `446-add-findings-idempotent`
**Created**: 2026-10-07
**Status**: Archived (2026-10-07)
**Input**: ST-446 (tech debt from ST-434, PR #21): "`.claude/scripts/pr-test/post.mjs:125` — `--add` writes the merged findings back into report.json, so a retry after a failed status call adds the agent's findings twice." — https://app.notion.com/p/3ef607bff0d2810c9563e3aa508caadf. Also covers ST-484 (tech debt from ST-464, PR #29): "`--add --dry-run` writes the added findings into report.json, so the real post that follows adds them a second time and the review lists them twice." — https://app.notion.com/p/3ef607bff0d28100b521e47601cd967e

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A second post with the same findings lists each once (Priority: P1)

The PR tester posts its verdict with `post.mjs --report <out>/report.json --add <out>/agent-findings.json`. The call folds the agent's findings into report.json and writes it back. When the call is run again with the same files (a retry after the `agent-review` status call failed, or the real post after a `--dry-run` preview), the review, its summary count and report.json list every finding once, not twice.

**Acceptance Scenarios**:

1. **Given** a report and the agent's findings, **When** they are added, **Then** the report holds the run's findings followed by the agent's, and the verdict, summary and Markdown are recomputed (unchanged behaviour).
2. **Given** a report that already holds the agent's findings (written back by an earlier `--add`, dry or not), **When** the same findings are added again, **Then** the findings, verdict, summary and Markdown are identical to the first result.
3. **Given** an agent finding that differs from every finding in the report in any field, **When** it is added, **Then** it is added.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `addFindings` MUST NOT add a finding equal (in every field) to one the report already holds, so adding the same findings again leaves the report unchanged.
- **FR-002**: `addFindings` MUST still add every finding the report does not already hold, in the order given, after the report's own, and recompute the verdict, summary and Markdown from the result.

## Clarifications

### Session 2026-10-07

- Q: Fix by not writing report.json back (or not under `--dry-run`), or by making the add idempotent? → A: Idempotent add. The write-back is what the tester's later steps read (the merged report.json and report.md are what QA copies into `pr-review/`), and both defects are one defect: an add that is not idempotent. One change in `addFindings` fixes the retry (ST-446) and the dry-run-then-post (ST-484); skipping the write under `--dry-run` alone would leave the retry broken (Principle I: the smallest change that fully solves it). (autonomous default)
- Q: What counts as "the same finding"? → A: Equal in every field (its JSON form). Findings are read from the same `agent-findings.json` each time, so a repeated add gives byte-identical objects; two findings that differ in any field (another step, other evidence) are both kept. (autonomous default)

## Assumptions

- Two identical findings in one `agent-findings.json` are one finding; listing it twice was never wanted. (autonomous default)
- No other caller of `addFindings` exists (`grep -rn addFindings .claude/` finds only `post.mjs` and its spec). (autonomous default)

## Spec Delta

### Capability: `platform`

- **Adds**: none
- **Modifies**: none
- **Removes**: none

(A harness fix; no capability requirement changes.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Adding the same findings twice gives a report deep-equal to adding them once.
- **SC-002**: The existing `post.spec.mjs` cases pass unchanged.
