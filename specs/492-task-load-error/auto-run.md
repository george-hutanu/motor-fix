# auto-run — 492-task-load-error

**Description**: ST-492 (Notion https://app.notion.com/p/3ef607bff0d28133a3efcea722e5d92b, tech debt from ST-157, PR #40): in libs/overlays/src/panel.ts a task whose lazy loader fails keeps showing the busy skeleton (aria-busy) with only the X working; it should instead show an error message and a retry button, using the wording/pattern of the shared saving-and-errors story. Retry calls the loader again; success shows the task as usual; closing still works.

**Start commit**: 12fe0e0c (origin/main) · branch `492-task-load-error` · worktree `.worktrees/492-task-load-error`

## 0. Size

Level 2 (feature), from the Notion facts: boards 1, Build brief not found. Recorded in `.specify/feature.json` (`level_for: next`), pointed at `specs/492-task-load-error` by `level.mjs point` in phase 2.

## 1. Constitution

v1.8.2 (`.specify/memory/constitution-card.md`), no placeholders. Principles that bear on this task: I (smallest change: one error state in the panel, reuse of the shared error pattern and texts), II (failing tests first in `libs/overlays`), III (Spartan button, Cockpit theme), VII (lifecycle: Planning, draft PR, push every commit).

## 2. Specify

Sources: the description, the Notion task page (no comments; Finding equals the description), `libs/overlays/src/panel.ts` (loader rejection only logs to the console, body stays `aria-busy`), `form-parts.ts` (`mf-task-error`, `role="alert"`), `libs/i18n/src/shell/{ro,en}.json` (`shell.form.problem.error`, `shell.notifications.retry`), `specs/157-dialog-drawer/spec.md` (Clarifications Q7), `.specify/capabilities/overlays.md` (157-FR-012, 159-FR-006/010/012/013).

Clarification table, answered autonomously (each is an `(autonomous default)` in spec.md Assumptions):

| # | Question | Answer |
| --- | --- | --- |
| 1 | Wording of the message and the button | The shared general problem text "Ceva nu a mers. Încearcă din nou." / "Something went wrong. Try again." and the existing retry label "Reîncearcă" / "Try again"; keys reused or added under `shell.overlay` at the plan's call |
| 2 | Where and how the error shows | In the body, replacing the skeleton, as an alert in the shared error style with the button below; not a toast, not a second dialog |
| 3 | Is the cause classified (offline, missing file)? | No: one general message; a loader failure carries no problem code |
| 4 | Retry limits or back-off | None; unbounded |
| 5 | Focus when the error shows | The retry button on a computer; the sheet keeps the focus on itself on a phone (ST-158) |
| 6 | Reachable in the catalogue? | Yes: one more button in `/cockpit`'s overlay section, a loader that fails once then resolves (159-FR-013 precedent) |
| 7 | The console line | Removed; the visible state is the record |

Spec: `specs/492-task-load-error/spec.md` (3 stories, FR-001 to FR-010, SC-001 to SC-004, Spec Delta modifying 157-FR-012). Checklist `checklists/requirements.md`: all items pass, one iteration.

Hooks after specify: `notion-sync start` (ST-492 To do → Planning, EP-1 unchanged, ready review list pre-existing, nothing ticked), design check (mock not shared with this session: `[UNAVAILABLE]` in design.md, filled from ST-157/ST-159 design notes), commit 9909a30f pushed, draft PR #170 opened (`planning`, `bug`, `scope: overlays`, `EP-1`), `notion-sync pr 170`. `level.mjs check`: level 2 unchanged (fr-count tripped at 10, nothing else).
