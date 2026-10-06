# Feature Specification: Tighten the Dependabot merge exemption

**Feature Branch**: `610-dependabot-exemption`

**Created**: 2026-10-06

**Status**: Draft

**Input**: "Tighten the Dependabot merge exemption: committer check and refusal wording". Deferred from the PR tester's review of PR #90 (lap 2, two LOW findings): (1) `.claude/hooks/merge-gate.mjs` gives a red Dependabot PR the shared `ciRefusal` advice to fix it on the branch and run the PR tester again, which is wrong for an exempt PR; (2) `.claude/hooks/pr-lifecycle-gate.mjs` `isDependabot` checks commit authors only, so a commit that keeps author dependabot[bot] but was committed by someone else (cherry-pick, `--author`, rebase) stays exempt.

Notion: ST-610 https://app.notion.com/p/3f0607bff0d281d6ab62d7fd978b5e01 (Task, Low, Role System, epic Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707).

## Finding, verified against the code

- `isDependabot` (`.claude/hooks/pr-lifecycle-gate.mjs:74`) reads `pr.author.login` and every `commits[].authors[].login`; nothing about who committed or pushed.
- `gh pr view --json commits` carries `authoredDate, authors, committedDate, messageBody, messageHeadline, oid` and no committer, so the committer has to come from the REST API (`GET repos/{owner}/{repo}/pulls/{n}/commits`: `committer.login`, `commit.verification.verified`).
- A real Dependabot commit (PR #99, 46aaf57) reads `committer.login: web-flow`, `verification.verified: true, reason: valid`; the owner's own commits on that branch read `committer.login: george-hutanu`, `verified: false, reason: unsigned`.
- `decideMerge` (`.claude/hooks/merge-gate.mjs:92`) sends a Dependabot PR to `ciRefusal`, whose red message says "fix it on the branch, and run the PR tester again on the new head".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Dependabot commit somebody else committed is not exempt (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a PR opened by Dependabot whose every commit is authored by dependabot[bot], committed by `web-flow` or `dependabot[bot]` and signature-verified, green on every check, **When** it is merged, **Then** the merge gate lets it through with no agent-review status.
2. **Given** the same PR where one commit's committer is `george-hutanu` (a cherry-pick or a local rebase), **When** it is merged, **Then** the merge gate refuses it for want of an agent-review status.
3. **Given** the same PR where one commit is committed by `web-flow` but its signature is not verified, **When** it is merged, **Then** the merge gate refuses it the same way.
4. **Given** a Dependabot PR whose committers the gate could not read, **When** it is merged, **Then** the merge gate refuses it as it refuses a PR it could not read, telling the agent to try again (fail closed; review lap 1, code-reviewer LOW #2).
5. **Given** the same ready, green PR at session end, **When** the Stop gate judges it, **Then** a fully Dependabot PR is asked to merge, and one with a foreign committer is asked for the PR tester.

### User Story 2 - A red Dependabot PR is told what actually helps (Priority: P2)

**Acceptance Scenarios**:

1. **Given** an exempt Dependabot PR with a failing check, **When** it is merged, **Then** the refusal names the failing check, does not tell the agent to run the PR tester, and says a commit pushed to the branch takes the exemption away; it points at `@dependabot rebase` / `@dependabot recreate` or a PR of one's own.
2. **Given** a non-Dependabot PR with an agent-review success and a failing check, **When** it is merged, **Then** the refusal is unchanged (fix on the branch, run the PR tester again).

### Edge Cases

- A commit present in `gh pr view` but missing from the REST list (pagination cap, race with a push) has no committer data and so is not exempt.
- The committer read only happens for a PR whose author is Dependabot: every other PR costs no extra GitHub call.
- A committer login of `dependabot[bot]` counts as well as `web-flow` (Dependabot rebases sign as either).
- The eval cases declare the PR (`SPECKIT_PR_STATE`), committer fields included; no network.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `isDependabot` MUST also require every commit's committer login to be `web-flow` or `dependabot[bot]` and its signature to be verified; a commit with no committer data is not Dependabot's.
- **FR-002**: Both gates MUST read the committers from the REST pulls commits API for a PR whose author is Dependabot, matched to the PR's commits by sha. In the merge gate a failed read refuses the merge with a retry; in the Stop gate (fail open) it leaves the commits without committer data, so the PR is not exempt.
- **FR-003**: The merge gate MUST give an exempt Dependabot PR with a failing check its own refusal: it names the failing checks, never asks for the PR tester, says a pushed commit takes the exemption away, and points at `@dependabot rebase` / `@dependabot recreate` or closing it for a PR of one's own.

### Key Entities

None.

## Success Criteria *(mandatory)*

- **SC-001**: The vitest cases for a foreign committer, an unverified signature, missing committer data and the Dependabot red wording fail before the change and pass after it.
- **SC-002**: `npm run test:harness`, `node .claude/scripts/harness-eval.mjs --check` and `node .claude/scripts/doctor.mjs` pass.

## Assumptions

- `web-flow` and `dependabot[bot]` are the committers allowed (autonomous default, from the task text and PR #99's real commit). `web-flow` also commits a rebase done through GitHub's "Update branch" button by a person; such a rebase replays Dependabot's change unchanged, and a merge-update adds a commit authored by that person, which the author check already refuses.
- The committer data rides on each commit as `committer: { login }` and `verified`, so the eval cases can declare it in `SPECKIT_PR_STATE`.
- The red wording changes only for the exempt path; the pending and missing-CI-OK messages say nothing about the tester and stay shared.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001–FR-003
