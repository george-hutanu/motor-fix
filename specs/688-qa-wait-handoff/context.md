# Context — 688-qa-wait-handoff

The org-researcher subagent had no Notion tools (`[UNAVAILABLE: notion — subagent tool list held no Notion reader]`); the main session read the story page itself on 2026-10-05. Comments, epic body and architecture pages were not read.

## Sources

- ST-688 story page https://app.notion.com/p/3f0607bff0d28183be81dbf78b072125 (fetched 2026-10-05T14:39Z): Tech debt, Medium, Role System, Epic EP-1 Foundations (In progress).

## Constraints

- Measured cost: 92 story/tail runs, 96 full cache rewrites, about 7% of all cost — story, User story property.
- The merge gate, `agent-review`, carry and the repair cap keep their meaning; nothing merges that could not merge today — story, What §4.
- Files in scope: speckit-auto (Hand-off, The tail), speckit-pr-test, pr-tester, dispatch.mjs, watch.mjs and their specs, AGENTS.md steps 4–6 — story, Files.

## Contradictions

- None found in what was read.

## Proposed Clarifications

- Overlap: PR #138 (ST-673) changes the dispatch paragraphs of speckit-auto "The tail" and speckit-watch step 4 to the agent type `task-runner`. Write against `git diff origin/main...origin/673-story-tail-agents` and merge `origin/main` once #138 lands, before going ready — story, Overlap.

## Open decisions

- None recorded on the story.
