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

## 3. Org context

- org-researcher (background): partial — context.md written; Notion holds no wording for a code-load failure (the general text comes from the repo, `shell.form.problem.error`); ST-159 says error states are not designed. ST-157 brief's PrimeNG mention is stale (repo wins).

## 4. Clarify

- spec-challenger: 5 findings, all answered with its recommendation (focus only when on the panel; per-press catalogue failure; mirror alert markup; remove console.error; reflectComponentType check). Spec Clarifications section added; FR-002/007/008/009 and one edge case edited.

## 5. Plan

- before_plan hooks: design check skipped (design.md checked 2026-10-06, current); nothing to commit.
- `plan.md` written from the template: Technical Context cited from `package.json`, `nx.json`, `libs/overlays/{jest.config.cts,tsconfig*.json}`, `jest.preset.cjs`, the stryker floors; Constitution Check passes on every gate, no Complexity Tracking entry.
- Decisions: `failed` signal beside `task` in `panel.ts` (loading | failed | shown), one `load()` shared by the constructor and `retry()`, `console.error` removed, a synchronous throw and a non-component resolution are failures; message reuses `shell.form.problem.error`, button label is a new `shell.overlay.retry` (each section owns its retry label, as `notifications.retry` and `chart.retry`); the error block is three template lines in the panel; catalogue: fourth button in `sample-page.ts`'s overlay row with a per-press fail-once loader (`cockpit.overlay.openFailing`, `cockpit.overlay.failing`); one Playwright test in `apps/web-e2e/src/overlays.spec.ts`. The two adversary tests pinning the busy-for-ever state (`overlays.adversary.spec.ts:319`, `panel.adversary.spec.ts:559`) are rewritten.
- No research.md, data-model.md, contracts/ or quickstart.md (no open unknown, no entity, no API), as ST-157 and ST-159.
- after_plan hooks: commit (below); agent-context update skipped (CLAUDE.local.md is ratcheted and the Active plan line is the owner's).

## 6. Checklist

- `checklists/ux.md` (18 items): all checked; one gap fixed in spec.md (FR-004: focus fallback to the panel when the retry button is pressed), CHK017 struck (a retry announcement is beyond the skeleton's own rule).

## 7. Tasks

- `tasks.md`: 10 tasks (7 failing-test/i18n tasks first, 2 implementation in `panel.ts` and `sample-page.ts`, 1 proof run); includes rewriting the two adversary tests. level check: 2 unchanged; artifact-lint: 0 errors (1 warning `delta-missing`, though spec.md carries a Spec Delta; left as is).

## 8. Analyze

- artifact-lint: the Spec Delta was free-form → rewritten as `### Capability: overlays`, Adds FR-001..FR-010, Modifies none (157-FR-012 still holds for a loader that answers). Re-run: 0 errors, 0 warnings. Every FR maps to a task (T001–T009); no CRITICAL finding. 1 round.

## 9. Tests (red first)

- `npx jest overlays.spec overlays.adversary.spec sample-page.spec`: `Tests: 9 failed, 60 passed, 69 total` — 7 new overlay tests, the rewritten adversary test (busy-for-ever → alert) and the catalogue test, all red for the missing state. T001/T002 went to `overlays.spec.ts` (computer/phone switch and i18n in its harness), not `panel.spec.ts`.

## 10. Implement

- `panel.ts`: `failed` signal, `load()` shared by the constructor and `retry()` (sync throw and non-component answer fail too), `focusRetry()` (computer only, not when on the X), retry hands the focus to the panel, `console.error` removed, `.mf-overlay-error` styles. `sample-page.ts`: `openFailing()` fails the first try of each press. i18n: `shell.overlay.retry`, `cockpit.overlay.openFailing`/`failing`.
- overlays + ui-cockpit sample-page + i18n jest: `Tests: 718 passed, 718 total`. Typecheck overlays, ui-cockpit, web, web-e2e: green.
- e2e against `nx serve web` :4492: overlays.spec `17 passed` (incl. the new Retry test); cockpit, sheet, phone, one-language, task-form `93 passed`.

## 11. Converge

- Every task of tasks.md is [X] and each FR has its test; nothing unbuilt to append. 0 cycles.

## 12. Harden

- artifact-lint --check: clean. diff-audit --no-jev: 8 errors, all in `libs/ui-cockpit/src/lib/helm/table*` — the audit diffs against the stale local `main` (b27b5e6), so it reports other merged work; none in this change's files. No local mutation run (CI only).

## 13. Ticket refresh

- ST-492 comments re-read 2026-10-07: none. No new evidence.

## 15. Agent context

- Skipped: the managed block would grow CLAUDE.local.md past its ratchet; nothing tracked changed.

## 16. Retrospective evidence (unjudged)

- `retro-evidence.mjs --since 12fe0e0c --jev`: 8 commits (7 docs(specs), 1 feat); Jev lane unavailable (no key), so no suggested verdict. `instincts.mjs triggered`: none proposed.

## 14. Review

- spec-reviewer: APPROVE, 2 LOW (T004's record amended: panel.adversary.spec.ts needed no rewrite; notion-sync.md lines committed) → fixed.
- code-reviewer: APPROVE, 1 MEDIUM (test-adversary's 'retrying a loader that failed' block duplicated overlays.spec.ts → deleted), 1 LOW (`this.destroyed.onDestroy` in followVisibleArea → applied), 1 LOW defer (pre-existing helm/table.ts audit findings → deferred.md).
- test-adversary: its added block removed per the MEDIUM above; the rewritten failed-loader adversary test stays.
