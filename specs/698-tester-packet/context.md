# Feature Context: PR tester packet script and baseline delta

- **Feature**: 698-tester-packet
- **Anchor**: ST-698 (Tech debt, epic EP-1 Foundations) — https://app.notion.com/p/3f0607bff0d281aa9841fd35636fd69d | terms: pr-tester, PR QA workflow, baseline delta, agent cost
- **Gathered**: 2026-10-05
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story UNAVAILABLE | feature UNAVAILABLE | epic UNAVAILABLE | architecture UNAVAILABLE | decisions UNAVAILABLE
- **Overall confidence**: low

[UNAVAILABLE: notion — no Notion tool (search, fetch, get-comments, query-data-sources) is in this agent's tool list and no ToolSearch exists to load them; only Read and Write are available]

The run stops here. Notion is the only source, so an unreachable source means no digest. This is not "nothing found".

## Story

- **ST-698** — not read. Status, priority, role, comments: UNAVAILABLE.
- Comments that moved scope: UNAVAILABLE (not "none")

## Decisions

none read (source unavailable)

## Constraints

none read (source unavailable)

## Prior Art

none read (source unavailable). ST-688, ST-659 and ST-673 were not fetched.

## Open Decisions

none read (source unavailable)

## Contradictions with spec.md

none read (source unavailable)

## Proposed Clarifications (this command's proposals, not requirements)

- Re-run `/speckit-context` from a session or agent that has the Notion read tools loaded, then compare ST-698's comments with spec.md before `/speckit-clarify`.

## Gaps

- [NEEDS CLARIFICATION: story ST-698 body, comments, epic EP-1 and siblings ST-688, ST-659, ST-673 were not read]

## Sources

- ST-698 — https://app.notion.com/p/3f0607bff0d281aa9841fd35636fd69d (not opened)
- EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 (not opened)

## Read by the run itself (2026-10-05, notion-fetch from the orchestrating context)

The subagent had no Notion tool; the run fetched the story page directly for the `start` sync:

- ST-698 (Tech debt, Medium, System), epic EP-1 Foundations (In progress). User story: QA costs less without testing less; the pr-tester is about 10% of all cost over 81 runs, all on Opus.
- What: measure first; a packet script; a baseline delta against the last tested commit or main's last run. The pr-tester stays on Opus and keeps the full constitution.
- Files: `.claude/agents/pr-tester.md`, `.claude/skills/speckit-pr-test/SKILL.md`, `.claude/scripts/pr-test/*` (post and carry only if needed).
- Acceptance: tokens per run before and after on a real PR, measured; the same `agent-review` verdict on a replayed PR; merge gate and evals unchanged.
- Overlap: all files are in ST-688's (#140) territory; merge origin/main once #140 lands, before touching them.
- No comments read; the spec matches the story's scope.

## Refresh (2026-10-05)

- The story has no new comments since it was gathered, so nothing in scope changed.
