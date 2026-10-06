# Tasks - 673-story-tail-agents

- [x] T001 Red: .claude/scripts/task-runner.spec.mjs covers FR-001 (opus, no allowlist, deny list with the heavy tools and none of the needed or Notion ones), FR-002 (story, tail and watch dispatches name task-runner, merge keeps sonnet, AGENTS.md names it), FR-003 (no "follow/read AGENTS.md", the delta command), FR-005 (auto reads the card, reviewers the full file); .claude/scripts/constitution-card.spec.mjs covers FR-004; FR-006 through the existing agent-replies.spec.mjs loop over .claude/agents.
- [x] T002 Green: .claude/agents/task-runner.md; .specify/memory/constitution-card.md.
- [x] T003 Green: speckit-auto (story dispatch under Parallel runs, The tail, Preflight and phase 1 read the card), speckit-watch step 4, AGENTS.md lifecycle step 4 and "Agent replies"; the agent-replies.spec.mjs comment follows (tail-handoff-wiring.spec.mjs needed no change).
- [x] T004 Measure the first turn (claude -p --agent task-runner) against the same call without an agent; confirm Skill and Agent are listed; doctor.mjs and npm run test:harness green.
- [x] T005 Review lap 1: keep Artifact and WebStorm reachable, drop the reviewers' AGENTS.md re-read, REREAD across quoted and bulleted text, pin the 10-line cap, file the out-of-scope findings in deferred.md.
