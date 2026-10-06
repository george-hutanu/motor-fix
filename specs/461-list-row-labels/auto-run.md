# speckit-auto run — 461-list-row-labels

Description: ST-461 — phone list rows keep their column names (deferred by pr-tester from ST-286, PR #22).
Start: branch 461-list-row-labels from origin/main 0cf285c; worktree .worktrees/461-list-row-labels; cloud session.

## Preflight
- Tree clean; `npm ci` via heavy.sh; typecheck + lint + test:unit green (exit 0). spec-drift: no active feature yet.

## 0. Size
- level.mjs suggest: unsure (no NOTION_TOKEN). Answered: intent is fully stated (what must hold, what must not change), one lib → level 1.

## Lifecycle start
- Notion (connector): ST-461 To do → Planning, Ready to work unticked; no timeline row; EP-1 already In progress.
- Draft PR #165 (template body, planning label; bug, scope: ui-cockpit, EP-1, ui); PR link written on ST-461.

## 2. Specify
- Run inline: this session has no Agent tool, so the fable pin was missed (pin miss).
- Branch already created from origin/main by the caller; the git.feature hook's branch was not created again.
- Decision: roles + visually hidden header, no per-cell data-label (Principle I; names would read twice on wide screens). Logged in spec Assumptions.
- Decision: Jest proof, no Playwright: no app route renders a cockpit table yet.

## 7. Tasks
- Written inline (pin miss as above): T001–T005.

## 9. Tests
- table.spec.ts (roles; each cell named by its column header), cockpit.css.spec.ts (phone header visually hidden, never display:none). Red: 3 failed, 53 passed (Node 24; the image's Node 22 cannot load Angular's ESM in Jest, so every Jest run here prefixes the cloud-setup Node 24 PATH).

## 10. Implement
- Notion ST-461 Planning → Implementing; PR label in development.
- table.ts: explicit role on table, thead, tbody, tr, th, td. cockpit.css: phone header clipped to 1 px (position absolute, overflow hidden, clip-path inset(50%)) instead of display none.
- Green: ui-cockpit Jest 398/398.

## 12. Harden
- Size: <200 lines in libs → audits, adversary, durability read; mutation skipped (rarely worth it at this size, per the skill).
- artifact-lint: 2 errors → 0 (Spec Delta Modifies rewritten as `286-FR-007` → `FR-002`, FR-002 restating the whole rule). 1 warning kept: no plan.md at level 1.
- diff-audit: 0 errors. `@traces 461-FR-001/002` added; trace-matrix 2/2 (it also lists a phantom FR-007, read from the `286-FR-007` Modifies line; its regex takes any FR-### in the spec).
- test-adversary: 11 tests added (table.adversary.spec.ts), all pass, no defect.
- code-reviewer: APPROVE; MEDIUM redundant pairing test deleted, LOW misplaced comment restored.
- ui-cockpit Jest 409/409 before the deletion; lint and typecheck green.
- Cloud note: Node 24 is /usr/bin/node in this image (cloud-setup's PATH line), not /opt/nvm; hooks run with Node 22 first, so the stop test gate cannot load Angular's Jest while changes are uncommitted.

## 14. Review
- Workflow (spec-reviewer + code-reviewer, 3 refuters per finding): both APPROVE. 3 confirmed (1 MEDIUM, 2 LOW), 4 refuted; no CRITICAL/HIGH.
- Fixed: adversary spec trimmed to the checks no other spec makes (1000-row, class, hide-exclusion, main-column scope and main/key order tests dropped); tasks.md T001 wording and FR → test table corrected.
- Refuted: T001 wording (fixed anyway), two duplicate-test claims, the hard-coded 768px literal (the stylesheet hard-codes it too).
- ui-cockpit Jest 403/403 on the touched suites.

## 16. Retrospective evidence
- Gathered (`retro-evidence.mjs`); level 1, the verdict stays the owner's.

## 17. Archive
- `capabilities.mjs merge --apply`: phone-layout +1 added, ~1 modified (286-FR-007 → 461-FR-002). Spec status Archived (2026-10-06).
- `.specify/feature.json` (gitignored) was missing on this fresh VM: `level.mjs point` + `set 1` re-recorded level 1.
