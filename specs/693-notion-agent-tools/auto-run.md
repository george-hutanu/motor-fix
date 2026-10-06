# Auto run — 693-notion-agent-tools

- **Description**: Harness bug affecting every story: `org-researcher` and
  `spec-reviewer` list their Notion tools by MCP server id, the desktop app's
  connector id changes between sessions (today `fd62790a-…`, on neither list),
  so `/speckit-context` returns `[UNAVAILABLE: notion]`. Fix: both agents carry
  the current id's read tools and stay read-only; `notion-agent-tools.mjs`
  (`check`, `add`, `detect`) owns the list and `doctor.mjs` warns on drift; a
  missing tool is reported plainly with the one-command fix; harness specs.
- **Story**: ST-693 — https://app.notion.com/p/3f0607bff0d281b3b181cde072bd7f9c (Tech debt, EP-1 Foundations)
- **Base**: origin/main 69f9260
- **Branch**: `693-notion-agent-tools`
- **PR**: #147 (draft, `planning`, `bug`, `scope: harness`)
- **Level**: 1 (one-session)

## Phase 2 — Specify (2026-10-06)

- `specs/693-notion-agent-tools/spec.md`: 4 stories, FR-001–FR-006, 5
  assumptions `(autonomous default)`, 3 success criteria, Spec Delta Adds
  FR-001–FR-006 to `platform`. No `[NEEDS CLARIFICATION]` marker left; the
  quality checklist is at `checklists/requirements.md`, all items pass.
- Branch existed; the `before_specify` branch hook was skipped. Feature
  pointed and level set: `level.mjs point` then `set 1 --current`.
- Commit `7866973 docs(specs): ST-693 specify the Notion agent tools fix`, pushed.
- `after_specify` hooks: `lifecycle.mjs open` pushed and opened draft #147
  (exit 3 on Notion, finished with `--notion-done`); Notion `start` and
  `pr 147` done through the connector: story To do → Planning, PR linked,
  Ready to work unticked, epic already In progress. The build-timeline row
  write hit Notion's Query Data Source usage limit: logged PENDING in
  `notion-sync.md`, retried next run. Design check: no screens,
  `design.md` written. Agent-context update (optional) skipped.
- Next: phase 3, `/speckit-context`. Note: this story's own `org-researcher`
  lacks the current id too, so expect `[UNAVAILABLE: notion]` until FR-001
  lands; phase 3 may read the story directly through the session's connector.

## Phase 3 — Context

_pending_

## Phase 7 — Tasks

- Model sonnet. `tasks.md` written (9 tasks, tests first, every FR mapped); analyze skipped (level 1).
- STATUS: success — tasks.md committed and pushed.
