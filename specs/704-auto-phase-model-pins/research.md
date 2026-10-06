# Research — 704-auto-phase-model-pins

No research agent was dispatched: every unknown resolved from files read in
this session (Principle I: a subagent for a question a `grep` answers is
bloat). Evidence lines are `path:line` in this worktree unless marked.

## R1. Agent definition for the phase agent

- Decision: `subagent_type: task-runner` with an explicit `model`.
- Rationale: the Agent tool's `model` parameter "takes precedence over the
  agent definition's model frontmatter" (Agent tool schema, this session), so
  the definition's `model: opus` (`.claude/agents/task-runner.md:5`) does not
  stop a `fable` or `sonnet` phase. Its tool surface is the one a phase needs
  and nothing more: no allowlist (so the Notion connector reaches it under any
  server id, `.claude/agents/task-runner.md:24-26`, kept by
  `.claude/scripts/task-runner.spec.mjs:39-47`), `Skill`, `Bash`, `Edit`,
  `Write`, `Agent`, `Artifact`, `EnterWorktree` allowed
  (`task-runner.spec.mjs:23`), browser and session tools denied
  (`.claude/agents/task-runner.md:4`). AGENTS.md and CLAUDE.local.md are
  already in its context (`task-runner.md:15-18`), so the prompt stays short.
- Alternatives: `general-purpose` (what the trial's phase 2 and 5 agents
  used: `~/.claude/projects/-Users-georgehutanu-projects-motor-fix/565e5c5f-3244-431a-b602-206141d9b9d0/subagents/agent-a001294d4b9e51176.meta.json`
  `{"agentType":"general-purpose","model":"fable"}`) carries every browser,
  session and connector tool on its first turn, the cost `task-runner` was
  made to remove (`task-runner.md:3`). A new `phase-runner` definition would be
  a second copy of the same deny list (Principle I).
- Evidence: `.claude/agents/task-runner.md:1-6`, Agent tool schema (`model`:
  "Takes precedence over the agent definition's model frontmatter").

## R2. The model router leaves a phase agent alone

- Decision: no change to `.claude/hooks/agent-model-router.mjs`.
- Rationale: it exits before routing when the call names a model
  (`agent-model-router.mjs:178`, `if (input.model) process.exit(0)`) and
  routes only `code-reviewer` and `spec-reviewer`
  (`agent-model-router.mjs:40`, `ROUTED`; `:180`). A `task-runner` call with
  `model` set never reaches `chooseModel`.
- Alternatives: adding the phase agents to `ROUTED` would make the hook
  choose what the skill pin already fixes; rejected.
- Evidence: `.claude/hooks/agent-model-router.mjs:40,175-180`.

## R3. Foreground, not background

- Decision: `run_in_background: false` for every phase agent.
- Rationale: phases 2, 5, 6 and 7 are serial (each reads the one before:
  `.claude/skills/speckit-auto/SKILL.md:117-119`, "Run in this order"); the
  only concurrency the skill names is phase 3 beside phase 4 and 13/15/16
  beside 14 (`SKILL.md:121-129`), none of which is a dispatched phase. A
  background dispatch would add a `Monitor` wait and a notification turn on
  the story agent's Opus context for nothing.
- Evidence: `SKILL.md:115-129`; Agent tool schema (`run_in_background`: "Pass
  false only when your very next action depends on the result").

## R4. The dispatch list is fixed

- Decision: phase 2 and 5 on `fable`, 6 and 7 on `sonnet`; 3, 4 and 8 inline.
- Rationale: the pins, read from frontmatter today:
  `speckit-specify/SKILL.md:11` fable, `speckit-plan/SKILL.md:11` fable,
  `speckit-checklist/SKILL.md:11` sonnet, `speckit-tasks/SKILL.md:11` sonnet,
  `speckit-clarify/SKILL.md:11` opus, `speckit-analyze/SKILL.md:11` opus,
  `speckit-context/SKILL.md:11` sonnet. The run's model is Opus
  (`task-runner.md:5`). Clarify and analyze equal it, so they stay inline
  (spec FR-002). Context stays inline by the spec's assumption (its reading
  runs in `org-researcher`, `SKILL.md:240-242`). The mapping spec guards the
  pins (`.claude/skills/skill-models.spec.mjs:11-61`), so the new spec reads
  the pin from the frontmatter rather than repeating the table.
- Evidence: the `model:` lines above; `skill-models.spec.mjs:65-72` (the
  frontmatter regex the new spec reuses).

## R5. Where the SKILL.md edit lands, and the merge with PR #140

- Decision: edit only `## Phases` (one paragraph after `SKILL.md:119`) and
  the `### 2.`, `### 5.`, `### 6.`, `### 7.` subsections (`SKILL.md:219-299`);
  phases 4 and 8 gain one sentence saying "inline" so the new spec can read
  it. Nothing below `SKILL.md:539` (`## Hand-off`, `## The tail`) changes, nor
  the `gh pr create`/`gh pr ready`/`gh pr merge` lines (`SKILL.md:557-558,
  637`).
- Rationale: FR-007. PR #140 (ST-688) is merged (`gh pr view 140` →
  `MERGED`) and this branch is behind it (`git log HEAD..origin/main` lists
  `3486742 Merge pull request #140`); its hunks on this file are at
  `@@ -560,57 +560,26 @@` and `@@ -626,50 +595,39 @@` (`git diff origin/main --
  .claude/skills/speckit-auto/SKILL.md`), below every line this feature
  touches, so `git merge --no-edit origin/main` is clean. The implement phase
  merges first, then edits, so the byte-identity check (SC-006) runs against
  the merged text.
- Evidence: `git diff origin/main -- .claude/skills/speckit-auto/SKILL.md`
  hunk headers; `SKILL.md:115-130,219-299,539-658`.

## R6. The harness spec's shape and what it reads

- Decision: `.claude/skills/speckit-auto/phase-dispatch.spec.mjs`, vitest,
  text-level like its neighbours. It reads each `### N. <Phase>` subsection
  for phases 2–8 and asserts: a dispatched phase's one `` `model: <x>` ``
  token equals the pin in `speckit-<skill>/SKILL.md` frontmatter; an inline
  phase (4, 8) carries no `` `model:` `` token and the word `inline`; every
  dispatch line names `subagent_type: task-runner` and
  `run_in_background: false`.
- Rationale: vitest 5.0.3 (`package-lock.json:28305`) through
  `npm run test:harness` = `vitest run --config .claude/vitest.config.ts`
  (`package.json:99`), include `**/*.spec.mjs` rooted at `.claude/`
  (`.claude/vitest.config.ts`). The existing prose checks on this file use
  the same pattern: a section slicer and `assert.match`
  (`.claude/scripts/tail-handoff-wiring.spec.mjs:14-19`,
  `.claude/agents/agent-replies.spec.mjs:15-21`). The envelope requirement
  is already enforced for `speckit-auto` (`agent-replies.spec.mjs:44,72-79`:
  `hasEnvelope` and a cap `at most N lines`, N ≤ 25), so the new spec does
  not repeat it; the dispatch prompt simply repeats the four lines verbatim.
- Alternatives: a JSON dispatch table read by both the skill and the spec —
  a second source for what the frontmatter already says; rejected.
- Evidence: files cited above.

## R7. Reading turns and tokens from transcripts

- Decision: measure with `jq` over `~/.claude/projects/<project>/<session>.jsonl`
  and `<session>/subagents/agent-*.jsonl`, grouped by `.message.model`,
  dropping `<synthetic>` turns; identify each agent by its
  `agent-*.meta.json` (`agentType`, `description`, `model`, `spawnDepth`).
- Rationale: a transcript line of `type: "assistant"` carries
  `.message.model` (e.g. `claude-fable-5-1`) and `.message.usage` with
  `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens` (read this session from
  `-Users-georgehutanu-projects-motor-fix/2b506914-….jsonl`). Some lines
  carry `model: "<synthetic>"` (3 in that file; 1 each in two subagents) and
  no usage: excluded. No price appears in a transcript, and the harness keeps
  none on purpose (`.claude/scripts/lib/telemetry.mjs:11`, "no pricing table
  lives here"): money is not measurable. The run's own transcripts: session
  `565e5c5f-3244-431a-b602-206141d9b9d0` (story agent
  `agent-a7bb69b0abfa95090`, depth 1, `model: opus`; phase 2
  `agent-a001294d4b9e51176`, `fable`; phase 5 `agent-ac0a7434ee0bfdd46`,
  `fable`; phases 6 and 7 to come). The "before" run: ST-673's story agent, a
  depth-1 subagent of session `2b506914-0798-46cf-8306-143d93248a6a` (its
  reviewers' meta files name "ST-673"; the story agent is found by the
  `specs/673-story-tail-agents` path in its transcript).
- Alternatives: the telemetry ledger (`.specify/telemetry/`) holds totals per
  session, not per model; rejected as the source.
- Evidence: jq output in this session; `telemetry.mjs:1-24`.
