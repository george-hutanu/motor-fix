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

## Resume after a stale run (2026-10-06)

- Spec review pass 1 BLOCKED (HIGH wildcard grant, MEDIUM detect crash and `add` accepting any `mcp__*` name, LOWs). Adversary spec (7 red) committed in 77d517f with 3 more red cases; fixes in f056174 (wildcards on tools and allowlist, non-Notion names refused, transcripts read per file with try, BOM stripped, typed `addedNames`, settings.json parse error reported). FR-002 reworded to the verb-prefix list. Code review patch items applied (no `.spec.md` filter, `projectSlug` imported in doctor.spec.mjs); `seen` kept because an adversary case asserts it; RECENT env skipped (optional).
- Spec review pass 2 BLOCKED on a bare `mcp__<id>` grant on a tools line: red case, fix 35c6031; confirmation pass APPROVE. Repairs 2 of 5.
- Verification: `npm run test:harness` 68 files / 1551 tests green; `check`/`detect` exit 0; doctor 17 ok; artifact-lint clean. trace-matrix shows 693 0/6 (harness specs are not scanned; the gate already fails on main for other harness features).
- Retro evidence (unjudged): 6 commits, platform +6, 0 deferred; Jev lane unavailable.
- Archive: spec Archived (2026-10-06), Spec Delta merged into platform.md with FR-003/FR-005 text made standalone (ef9b78e).
- Hand-off: PR body filled, ready, Notion story Implementing → QA (connector), labels QA; timeline row still PENDING (usage limit). QA run 37423687356 at dc9a099, dispatched --no-wait.
- Tail lap 3 (run 37452566426 at 011143c): agent-review failure — flows covered only Story 2 (high x2: Story 1, Story 4 unrun), `add` wrote agents before validating settings.json (medium), unused `detect().seen` (low). Fixed: red test then settings read first in `add`; `seen` dropped; flows now run Story 1 (detect/add/check/idempotent add on a copy) and Story 4 (doctor ok and warn). Merged origin/main (#149, shared platform.md and phases-plan.md). Spec Delta Adds set to none: FR-001–006 were already archived as 693-FR-001–006, so validate no longer reports delta-adds-existing. Repairs 3 of 5.
