---
name: "speckit-implement"
description: "Execute the implementation plan by processing and executing all tasks defined in tasks.md"
argument-hint: "Optional implementation guidance or task filter"
compatibility: "Requires spec-kit project structure with .specify/ directory"
metadata:
  author: "github-spec-kit"
  source: "templates/commands/implement.md"
user-invocable: true
disable-model-invocation: false
model: opus
---


## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Pre-Execution Checks

**Check for extension hooks (before implementation)**:
- Check if `.specify/extensions.yml` exists in the project root.
- If it exists, read it and look for entries under the `hooks.before_implement` key
- If the YAML cannot be parsed or is invalid, skip hook checking silently and continue normally
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
- For each remaining hook, do **not** attempt to interpret or evaluate hook `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
  - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
- When constructing command invocations from hook command names, replace dots (`.`) with hyphens (`-`). For example, `speckit.git.commit` → `/speckit-git-commit`.
- For each executable hook, output the following based on its `optional` flag:
  - **Optional hook** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Pre-Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```
  - **Mandatory hook** (`optional: false`):
    ```
    ## Extension Hooks

    **Automatic Pre-Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}

    Wait for the result of the hook command before proceeding to the Outline.
    ```
    After emitting the block above you MUST actually invoke the hook and wait for it to finish before continuing. Run it the same way you would run the command yourself in this agent/session (the invocation may differ from the literal `{command}` id shown above, e.g. a skills-mode agent runs it as `/skill:speckit-...` or `$speckit-...`). Emitting the block alone does not run the hook.
- If no hooks are registered or `.specify/extensions.yml` does not exist, skip silently

## Outline

1. Run `python3 .specify/scripts/python/check_prerequisites.py --json --require-tasks --include-tasks` from repo root and parse FEATURE_DIR and AVAILABLE_DOCS list. All paths must be absolute. For single quotes in args like "I'm Groot", use escape syntax: e.g 'I'\''m Groot' (or double-quote if possible: "I'm Groot").

2. If `FEATURE_DIR/checklists/` exists, count the unchecked `- [ ]` items per file and report them; never ask, never edit a checklist.

3. Load and analyze the implementation context:
   - **REQUIRED**: Read tasks.md for the complete task list and execution plan
   - New files follow AGENTS.md "Folder structure": a submodule gets its own subfolder, a web component is `<name>/<name>.ts|html|css` (`node scripts/structure-check.ts` checks)
   - **REQUIRED**: Read plan.md for tech stack, architecture, and file structure
   - **IF EXISTS**: Read data-model.md for entities and relationships
   - **IF EXISTS**: Read contracts/ for API specifications and test requirements
   - **IF EXISTS**: Read research.md for technical decisions and constraints
   - Read `.specify/memory/constitution-card.md` for governance constraints. Open a principle's section in `.specify/memory/constitution.md` only when a decision turns on its exact wording.
   - **IF EXISTS**: Read quickstart.md for integration scenarios

4. Parse tasks.md structure and extract:
   - **Task phases**: Setup, Tests, Core, Integration, Polish
   - **Task dependencies**: Sequential vs parallel execution rules
   - **Task details**: ID, description, file paths, parallel markers [P]
   - **Execution flow**: Order and dependency requirements

5. Execute implementation following the task plan:
   - **Phase-by-phase execution**: Complete each phase before moving to the next
   - **Respect dependencies**: Run sequential tasks in order, parallel tasks [P] can run together
   - **Follow TDD approach**: Execute test tasks before their corresponding implementation tasks
   - **File-based coordination**: Tasks affecting the same files must run sequentially
   - **Validation checkpoints**: Verify each phase completion before proceeding

6. Implementation execution rules:
   - **Setup first**: Initialize project structure, dependencies, configuration
   - **Tests before code**: If you need to write tests for contracts, entities, and integration scenarios
   - **Core development**: Implement models, services, CLI commands, endpoints
   - **Integration work**: Database connections, middleware, logging, external services
   - **Polish and validation**: Unit tests, performance optimization, documentation

7. Progress tracking and error handling:
   - Report progress after each completed task
   - Halt execution if any non-parallel task fails
   - For parallel tasks [P], continue with successful tasks, report failed ones
   - Provide clear error messages with context for debugging
   - Suggest next steps if implementation cannot proceed
   - **IMPORTANT** For completed tasks, make sure to mark the task off as [X] in the tasks file.

8. Completion validation:
   - Verify all required tasks are completed
   - Check that implemented features match the original specification
   - Validate that tests pass and coverage meets requirements
   - Confirm the implementation follows the technical plan

Note: This command assumes a complete task breakdown exists in tasks.md. If tasks are incomplete or missing, suggest running `/speckit-tasks` first to regenerate the task list.

## Mandatory Post-Execution Hooks

**You MUST complete this section before reporting completion to the user.**

Check if `.specify/extensions.yml` exists in the project root.
- If it does not exist, or no hooks are registered under `hooks.after_implement`, skip to the Completion Report.
- If it exists, read it and look for entries under the `hooks.after_implement` key.
- If the YAML cannot be parsed or is invalid, skip hook checking silently and continue to the Completion Report.
- Filter out hooks where `enabled` is explicitly `false`. Treat hooks without an `enabled` field as enabled by default.
- For each remaining hook, do **not** attempt to interpret or evaluate hook `condition` expressions:
  - If the hook has no `condition` field, or it is null/empty, treat the hook as executable
  - If the hook defines a non-empty `condition`, skip the hook and leave condition evaluation to the HookExecutor implementation
- When constructing command invocations from hook command names, replace dots (`.`) with hyphens (`-`). For example, `speckit.git.commit` → `/speckit-git-commit`.
- For each executable hook, output the following based on its `optional` flag:
  - **Mandatory hook** (`optional: false`) — **You MUST emit `EXECUTE_COMMAND:` for each mandatory hook**:
    ```
    ## Extension Hooks

    **Automatic Hook**: {extension}
    Executing: `/{command}`
    EXECUTE_COMMAND: {command}
    ```
    After emitting the block above you MUST actually invoke the hook and wait for it to finish before continuing. Run it the same way you would run the command yourself in this agent/session (the invocation may differ from the literal `{command}` id shown above, e.g. a skills-mode agent runs it as `/skill:speckit-...` or `$speckit-...`). Emitting the block alone does not run the hook.
  - **Optional hook** (`optional: true`):
    ```
    ## Extension Hooks

    **Optional Hook**: {extension}
    Command: `/{command}`
    Description: {description}

    Prompt: {prompt}
    To execute: `/{command}`
    ```

## Re-read the ticket before reporting

Re-read the story's GitHub issue with its comments (`gh issue view <n> --comments -R george-hutanu/motor-fix-specs`) and report any comment that moved scope, with its author and date; if it cannot be read, say the check did not run.

## Completion Report

Report final status with summary of completed work.

## Done When

- [ ] All tasks in tasks.md completed and marked `[X]`
- [ ] Implementation validated against specification, plan, and test coverage
- [ ] Extension hooks dispatched or skipped according to the rules in Mandatory Post-Execution Hooks above
- [ ] Completion reported to user with summary of completed work

## Project Constitution Gate: No Bloated Code (NON-NEGOTIABLE)

<!-- project-local addition (constitution v1.0.0) — re-apply after `specify integration upgrade` -->

motor-fix Constitution Principle I applies to everything this skill produces:

- Produce the smallest output that fully solves the problem. No speculative
  abstractions, no single-implementation layers, no scaffolding "for later".
- No new dependency when an existing dependency or a few lines of local code
  covers the need.
- No dead code, unused exports, padding tasks, or boilerplate left from
  generators.
- Complexity that cannot be justified against a current, concrete requirement
  is cut — not deferred to review.
- No internal identifier in the source: no FR id, feature number, task id or
  issue number, in a comment or anywhere else. They name what the repo does not
  contain — the spec is local-only, the numbering is renumbered, the ticket
  moves — leaving a reference a future reader cannot resolve. The one
  exception (Constitution II) is a whole-line `// @traces <feature>-FR-<n>`
  comment in a test file, which `trace-matrix.mjs` reads. The FR → task
  mapping lives in `tasks.md` and the completion report.
- A comment is code that has to earn its line. Write one only where the code
  cannot speak for itself: why a non-obvious choice was made, a constraint from
  outside the file, a trap the next reader would re-introduce. No restating the
  next line, no section banners, no step numbers, no notes addressed to this
  run. When in doubt, delete it and make the code clearer instead.

Full text: `.specify/memory/constitution.md`.

## Agent Execution Rules: implement deltas

<!-- project-local addition (constitution v1.1.0) — re-apply after `specify integration upgrade` -->

The constitution's Agent Execution Rules apply in full. Specific to this command:

- Run every phase to completion in this turn. The only stops are a
  destructive action or a scope change only the user can decide. Never end with "Next, I'll…" — do it.
- Batch the independent tool calls of `[P]` tasks in one response.
- A pre-existing bug found along the way is fixed in this task's PR
  (AGENTS.md "The tracker is GitHub"); one that needs an owner decision
  becomes a needs-confirmation question on the task.
- Verify by running the touched workspace's tests
  (`npm run test -w apps/<name>` or `-w libs/<name>`) and quote the result
  line: run it into a log and read only the exit code, the summary and the failures (AGENTS.md "Agent replies": `tail -n 40`, then `grep -nE '✕|●|FAIL|Error'` on a failure). A task is `[X]` only after that.
- One line of progress per completed task. The completion report stands
  alone: what was built, what was verified (command + result), follow-ups,
  anything left out and why.
- After a context compaction, re-read tasks.md and plan.md; `[X]` markers
  are the truth, not memory.

Cut (project-local override), because no run here takes these lanes:

- Step 2, Check checklists status (the status table and its "proceed?" stop):
  `/speckit-auto` phase 6 leaves every checklist at zero unchecked, and no
  run answers the question; step 2 now counts and reports.
- Step 4, Project Setup Verification (the ignore-file matrix): `.gitignore`
  exists and the stack is fixed (AGENTS.md "Product and stack").
- The Jira lane of Re-read the ticket before reporting: the tracker is
  GitHub; the section keeps one `gh issue view` line.
