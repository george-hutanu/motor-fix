# Feature Specification: One standard pull request template, enforced on every PR

**Feature Branch**: `433-pr-template`

**Created**: 2026-10-04

**Status**: Draft

**Level**: 1 (one-session)

**Input**: User description: "ST-433 Define one standard pull request template and enforce it on every PR (Notion story ST-433 https://app.notion.com/p/3ef607bff0d28182a864e99cd80cd6a8, epic Foundations EP-1 https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). The template is `.github/pull_request_template.md`; a check in its own workflow fails a PR whose body misses a required section or keeps placeholder text; every agent path that opens a PR uses the template with `--body-file`."

**Sources**: the Notion story ST-433 (acceptance criteria and Build brief, 2026-10-04), `.specify/memory/constitution.md` (Principle VII, the task PR lifecycle), `AGENTS.md`, `.claude/skills/speckit-auto/SKILL.md`, `.claude/skills/speckit-git-commit/SKILL.md`, `.claude/hooks/pr-lifecycle-gate.mjs`, and this repository at `origin/main` 8cb1882.

The users are whoever opens or reviews a PR here: the agents running the task lifecycle, and the owner. No product screen changes.

## Clarifications

### Session 2026-10-04

- Q: Are the template's hint comments placeholder text that must be deleted? → A: No. Hints live in HTML comments, which GitHub does not render; the check strips them before judging. Placeholder text is the visible `_(fill in: …)_` marker, and that must be replaced. (autonomous default: keeps the template honest to fill without making people delete invisible text)
- Q: Does a draft PR have to be fully filled in? → A: No. Constitution VII opens the draft at the first commit, before anything is tested. On a draft the check requires every section heading to be there; on a ready PR it requires everything. Marking ready re-runs the check (`ready_for_review`). (autonomous default)
- Q: How does a section that does not apply pass? → A: `N/A` followed by the reason. A bare `N/A` fails.
- Q: Which PRs are exempt? → A: PRs opened by bots (Dependabot), whose bodies are generated. (autonomous default: `.github/dependabot.yml` exists)
- Q: Where does the list of required sections come from? → A: From the template file itself, so changing the template changes the check with no second list to keep in step.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A ready PR whose body follows the template passes (Priority: P1)

An agent or a person fills in every section of the template, ticks the checklist, gives the PR a Conventional title with a scope and marks it ready. The `PR template` check passes.

**Acceptance Scenarios**:

1. **Given** a body made from the template with every section filled in and every box ticked, and a title `feat(api): ST-1 do a thing`, **When** the check runs on a ready PR, **Then** it passes.
2. **Given** a section answered `N/A — no screen changed`, **When** the check runs, **Then** that section passes.
3. **Given** the Agent review section still at its `Pending` line, **When** the check runs, **Then** it passes; the automated reviewer fills it in later.

### User Story 2 - A ready PR that drops a section or keeps a placeholder fails (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a body missing a required section heading, **When** the check runs, **Then** it fails and names the section.
2. **Given** a body still containing a `_(fill in: …)_` placeholder, **Then** it fails and names the section.
3. **Given** a section left empty, or answered with a bare `N/A`, **Then** it fails and names the section.
4. **Given** a labelled line of the template (for example `- Unit:` under How it was tested) removed from its section, **Then** it fails and names the label.
5. **Given** an unticked checklist box, **Then** it fails and quotes the item.
6. **Given** a title that is not a Conventional Commit with a scope, **Then** it fails and says so.
7. **Given** a Notion story section with neither a Notion link nor `N/A` and a reason, **Then** it fails.

### User Story 3 - A draft PR only needs the template's shape (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a draft PR whose body is the unchanged template, **When** the check runs, **Then** it passes.
2. **Given** a draft PR whose body drops a section heading, **Then** it fails and names the section.

### User Story 4 - Every agent path opens PRs from the template (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `speckit-git-commit`, `speckit-auto`'s hand-off, `AGENTS.md`'s lifecycle and the `stop:pr-lifecycle` gate's message, **When** they tell an agent to open a PR, **Then** they say `gh pr create … --body-file` with a body made from `.github/pull_request_template.md`, and before `gh pr ready` they say to fill it in completely (`gh pr edit --body-file`) and check it locally.

### Edge Cases

- Body is empty (`null` in the event payload): every section is missing.
- Headings differ in case or trailing spaces: matched case-insensitively and trimmed.
- Extra sections a PR adds: allowed.
- Windows line endings in the body (GitHub's web editor sends `\r\n`): handled.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST have `.github/pull_request_template.md` with these sections: Why, Notion story, Spec folder, What changed, How it was tested (Unit / Integration / End-to-end lines, with commands), UI evidence (desktop and mobile), Risk and rollback, Checklist (Conventional title, tests first, design checked, Notion in sync) and Agent review.
- **FR-002**: A checker MUST report every required section (each `## ` heading of the template) missing from a PR body, on draft and ready PRs alike.
- **FR-003**: On a ready PR the checker MUST report every section that still holds a `(fill in:` placeholder, is empty after HTML comments are removed, or is a bare `N/A`.
- **FR-004**: On a ready PR the checker MUST report every labelled line of the template (`- Label:`) missing from its section, and every unticked checklist box.
- **FR-005**: On a ready PR the checker MUST report a title that is not a Conventional Commit with a scope.
- **FR-006**: On a ready PR the checker MUST report a Notion story section that has neither a Notion link nor `N/A` with a reason.
- **FR-007**: A workflow of its own (`.github/workflows/pr-template.yml`) MUST run the checker on `pull_request` opened, edited, synchronize, reopened and ready_for_review, fail when it reports anything, and skip PRs opened by bots. `ci.yml` is not changed.
- **FR-008**: Every agent instruction that opens or readies a PR MUST use the template through `--body-file`, and fill it in completely before `gh pr ready`.

## Spec Delta

### Capability: `platform`

- **Adds**: FR-001–FR-008

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: This feature's own PR passes the `PR template` check with its body made from the template.
- **SC-002**: The checker's unit tests cover each acceptance scenario of User Stories 1–3.

## Assumptions

- Branch protection making the check required is an owner setting on GitHub, not part of this change. (autonomous default)
- The automated agent reviewer that fills the Agent review section is a separate task (task 3); this change only reserves the section and a marker it can replace.
- The title rule matches the commit-message policy: `type(scope): subject`, `!` allowed. (autonomous default)
