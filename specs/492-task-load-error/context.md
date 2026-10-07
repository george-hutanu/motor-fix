# Feature Context: A task that fails to load shows an error and a retry

- **Feature**: 492-task-load-error
- **Anchor**: ST-492 Tech debt (ST-157) loader failure — https://app.notion.com/p/3ef607bff0d28133a3efcea722e5d92b | terms: overlay, loader, error, retry
- **Gathered**: 2026-10-06
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic partial (epic page not fetched; sibling stories read via the feature page) | architecture not needed (front-end only) | decisions not read (no open decision touches this)
- **Overall confidence**: medium

## Story

- **ST-492** — status Planning, priority Low, role System, epic EP-1 Foundations (https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), feature MF-5 "Small actions in dialogs, drawers and sheets", PR #170.
- Scope per the story: the whole of it is one Finding: "A task whose loader fails keeps a busy skeleton with only the X working; it should show an error message and a retry, from the shared saving-and-errors story. (spec Clarifications; spec-challenger 7)". Where: `libs/overlays/src/panel.ts`; severity low; found by review of PR #40.
- Comments that moved scope: none (0 comments, read 2026-10-06).

## Decisions

- Failed save keeps the task open, keeps the text, shows the error next to the main button — [Feature MF-5, States and edge cases / Final rule 8] (2026-10-03, confidence: high)
- Closing is always by X, click outside, Escape; focus stays inside the task — [ST-157, Acceptance criteria] (2026-10-04, confidence: high)
- Texts in both languages, smallest text 12 px, touch targets at least 44 px, motion follows reduced motion — [Feature MF-5, Final rule 10] (2026-10-03, confidence: high)
- Shared error texts live in the shell texts, each code has a message key in both languages — [ST-159 finish comment, item 7, georgeh, 2026-10-04] (confidence: high)

## Constraints

- The loader-skeleton state is the only loading state defined: "Opening a task whose code is still downloading shows the panel with a skeleton at once (proposed)" — [ST-157, Build brief, States and errors] (2026-10-04, confidence: high)
- Scope of the overlay service is `libs/overlays`, front end only, no data, events or notifications — [ST-157 Build brief; Feature MF-5 Data and events] (2026-10-04, confidence: high)
- Saving, validation and errors belong to ST-159 and are "out of scope" of ST-157; ST-159 covers form saving (idle, invalid, sending, done, failed), not a code-loading failure — [ST-157 Out of scope; ST-159 Build brief] (2026-10-04, confidence: medium)
- Bottom sheet on a phone (under 768 px) keeps the same discard and closing rules — [ST-158, scenario 8] (2026-10-05, confidence: high)
- ST-159 says "Validation, error and offline states are not designed" in the mock: no board shows this error state — [ST-159, Screens] (2026-10-04, confidence: high)
- ST-159 error text pattern: shown next to the button, the proposed offline text is "Nu ești conectat. Încearcă din nou când revine conexiunea." — [ST-159, scenario 6] (2026-10-04, confidence: medium)

## Prior Art

- ST-157 shared dialog and drawer — Done, PR #40; origin of the debt — [ST-157] (2026-10-04)
- ST-158 bottom sheet on a phone — Done, PR #48 — [ST-158] (2026-10-05)
- ST-159 shared saving, validation and errors — Done, PR #44; its finish comment records `toProblem`, a `messages` i18n-prefix option, the `--mf-red-ink` token and the catalogue sample server (fake in the catalogue) — [ST-159 comment, georgeh] (2026-10-04)
- Four sibling follow-ups filed from ST-159 sit in the same feature (e.g. two buttons named "Close", dialog height shift when the error line clears) — [ST-159 comment, items 12-15] (2026-10-04)

## Open Decisions

- ST-159 item 16: confirm or replace the proposed maintenance text — blocks: nothing here (different message).
- ST-159 item 17: `{ field, code }` field-error shape, with A28 (RFC 9457) still proposed — blocks: nothing here, unless the loader failure is routed through `toProblem`.

## Contradictions with spec.md

- **spec.md** (2026-10-06): "the message reuses the saving-and-errors story's general problem text ... 'Ceva nu a mers. Încearcă din nou.'" — **Notion**: neither ST-159 nor the feature page quotes that general text; the only wording in Notion is the offline line and the proposed maintenance line. The general text can come only from the repo, not from Notion [ST-159] (2026-10-04) — newer: spec.md. Not a conflict, but the citation is unsupported by Notion.
- **spec.md** (2026-10-06): "the PR tester's sweep" and a retry that "calls the loader" imply a design pattern — **Notion**: ST-157 Build brief says "Built on PrimeNG Dialog and Drawer" and the feature page lists PrimeNG components, while AGENTS.md (newer decision) forbids PrimeNG for Spartan UI. Plan should follow the repo (Spartan), treating the Notion lines as stale [ST-157, Rules] (2026-10-04) — newer: repo.

## Proposed Clarifications (this command's proposals, not requirements)

- Should the retry copy come from the shared `shell.form.problem.error` key or an overlay-owned key? Notion fixes no wording for a code-load failure — from Contradictions, first item.
- Should the new state be added to the ST-157 Build brief "States and errors" and to the feature's states table (it lists only "A failed save") so Notion matches the shipped behaviour? — from the Constraints and the Spec Delta; this is a follow-up for the owner, not an action taken here.
- Is a design board needed? ST-159 says error states are not designed; propose logging that in `design.md` rather than blocking — from Constraints.

## Gaps

- [NEEDS CLARIFICATION: the ST-157 "spec Clarifications" and "spec-challenger 7" cited by ST-492 are repo artefacts, not Notion pages; their text was not read here.]
- No decision in "Decisions and ideas" or Architecture decisions was read; none found by title for loader failure.

## Sources

- ST-492 task — https://app.notion.com/p/3ef607bff0d28133a3efcea722e5d92b
- Build the shared dialog and right-hand drawer (ST-157) — https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2
- Open small actions as a bottom sheet on a phone (ST-158) — https://app.notion.com/p/3ee607bff0d281f58f12cf9b799a4628
- Build shared saving, validation and errors for small actions (ST-159, with its finish comment) — https://app.notion.com/p/3ee607bff0d28158a0bee4952af0d856
- Small actions in dialogs, drawers and sheets (MF-5) — https://app.notion.com/p/3ee607bff0d2815b88a7c6c67a7ede4d
