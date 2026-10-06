# Feature Context: Make the cloud session setup and lifecycle scripts work without GraphQL

- **Feature**: 766-cloud-rest-fallback
- **Anchor**: ST-766 — https://app.notion.com/p/3f1607bff0d281819edfcc527eee0d1d
- **Gathered**: 2026-10-06
- **Source**: Notion — MotorFix — Product documentation; the repo's own ST-749 records
- **Read**: story ok (created by this run from the coordinator's brief) | feature n/a (a Task) | epic ok (Foundations, In progress) | architecture not read | decisions not read
- **Overall confidence**: high

The org-researcher could not be dispatched (this agent has no Agent tool): the story and epic were read in the run's own session with the connector.

## Story

- **ST-766** — Task, Medium, role System, 3 points, epic EP-1 Foundations; status To do → Planning by this run.
- Scope: `scripts/cloud-setup.sh` puts Node 24 first on PATH and persists it, and installs the chromium `@playwright/test` pins; with `CLAUDE_CODE_REMOTE=true` the lifecycle scripts' gh GraphQL calls fall back to `gh api` REST (`lifecycle.mjs` open/ready/handoff --restore, PR create/edit/ready/labels, check reads, the pr-lifecycle gate's reads, notion-sync's helpers); AGENTS.md "Cloud sessions" updated. Laptop behaviour unchanged.
- Out of scope (owner's decision): how PR QA is started (`pr-qa.yml` triggers, `dispatch.mjs`'s `workflow_dispatch`), how or by whom `agent-review` is set, `merge-gate.mjs`, any CI workflow.

## Decisions

- none found that touch this task.

## Constraints

- Tests first on vitest; `doctor.mjs --bless-hooks` only after reading the diff of a touched gate script; the harness-eval baseline must not drop — [coordinator brief, 2026-10-06] (confidence: high)
- At ready, QA cannot be dispatched from the cloud (403): recorded in the hand-off, no status set, no merge — [coordinator brief] (confidence: high)

## Prior Art

- ST-749 (`specs/749-cloud-sessions`) made the gates, identity and hand-off note cloud-aware, all gated on `CLAUDE_CODE_REMOTE`; its deferred items say `cloud-setup.sh` was never run on a real VM (this task fixes what the real VM showed) and `handoff --restore` reads at most 100 comments (REST pages through them).
