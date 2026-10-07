# Design: Save a draft and come back to it later (ST-114)

[UNAVAILABLE: design mock — Artifact read of https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr returned "artifact not found / not shared with this account"; filled from Notion's text (the story's Build brief › Screens, read 2026-10-07, page last edited 2026-10-07T10:07Z) and ST-108's design.md. Share the mock with this session's account and re-run `speckit-design-check` to replace this note.]

Checked: 2026-10-07 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, not opened) · Story: https://app.notion.com/p/3ee607bff0d28182bfafc99b0021fc1f · Epic: https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf · Feature: https://app.notion.com/p/3ee607bff0d28117a3fffe7230aef5cb

## Boards

- Desktop (Cockpit) › **List your garage** (ListGarage.dc.html): the page ST-108 built (label, heading, intro line, the sticky step list "Pași", six section headings). Of this story it shows only the button **"Salvează ciorna"** (the story's note: "In the mock: List your garage: the button Salvează ciorna. Nothing is saved"). The board also shows "Trimite spre verificare" (ST-116) and the steps' content (other stories).
- Mobile (Cockpit) › **Mobile · List your garage** (MList.dc.html): the same page on a phone, step bar pinned under the header; the same "Salvează ciorna" button.

## What to build to match it

- The button "Salvează ciorna" / "Save draft" on the page and its phone layout (FR-004): a secondary Cockpit button (`libs/ui-cockpit` helm button, the non-primary variant, so "Trimite spre verificare" stays the primary when ST-116 adds it), 44 px target, placed with the form's actions under the sections on desktop and reachable on the phone without covering the step bar. Exact position, size and colour are not recorded (mock not opened); the PR tester's screenshots are the check.
- Step 1 (section "1 Service-ul", the shell ST-108 left) gains the e-mail field (FR-001): Cockpit input with a label "E-mail" and the field's error under it (`aria-describedby`), full width on a phone.
- Status lines near the button / field, plain text at least 12 px, in an `aria-live="polite"` region (FR-019): "Ți-am trimis un link pe e-mail ca să continui de pe orice dispozitiv", "Ciorna e salvată", "Neconectat · salvăm când revii online", the storage-blocked note, the link-already-sent line with the time it can be sent again.
- Two whole-page states inside the public frame (FR-012), replacing the form: "Linkul nu mai e valid" with the button "Începe din nou" (opens the empty form); "Înscrierea a fost trimisă" with a sign-in button that opens the frame's sign-in dialog.
- Everything in Romanian and English (the frame's language), light and dark via Cockpit tokens, no sideways scroll at 320 px (108-FR-011).

## States

- Shown in the mock (per Notion): the button "Salvează ciorna" on both boards. Nothing is saved in the mock.
- Not designed (build from the Build brief, flag in the PR): the e-mail field on step 1; the "link sent" line and the other status lines (draft saved, offline, storage blocked, link already sent); the e-mail field's highlight when the button is pressed without an e-mail; the two e-mails (LISTING_CONTINUE_LINK, LISTING_REMINDER; layout of the message-templates story); the expired-link page and the "listing was sent" page; the English texts.
- Empty: the form as ST-108 left it, the e-mail field empty, no status line. Loading: the page reads the browser copy (synchronously) and, with `?draft=<token>`, the server copy before the form is shown; a short "Se încarcă ciorna…" line is acceptable but undesigned.

## Mock vs Build brief

- The brief's link path `…/listeaza-service?draft=<token>` → spec Clarifications win: `/<lang>/list-your-garage?draft=<token>`, the repo's route.
- The mock shows "Trimite spre verificare" beside "Salvează ciorna" → out of this story (ST-116); the button's place is left so the pair fits later.
- The mock shows the steps' fields → not this story; only the e-mail field joins step 1 (ST-109 adds the rest).
- The mock could not be opened, so no pixel-level difference is recorded.
