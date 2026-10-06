# Design: Tech debt (ST-157): a task whose loader fails shows an error and a retry
[UNAVAILABLE: design mock — artifact not found (not shared with this session's account)]
Checked: 2026-10-06 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, as read by ST-157 and ST-159 on 2026-10-04) · Story: https://app.notion.com/p/3ef607bff0d28133a3efcea722e5d92b (ST-492, from ST-157 https://app.notion.com/p/3ee607bff0d2811db730c1017d198dd2)

ST-492 is a tech-debt task with no Build brief of its own; its Design and Design boards roll up from EP-1 through ST-157, whose Build brief's Screens are "the dialogs and drawers of Overlays.dc.html; Sign in · dialog; Write a review · drawer; Day sheet; Photo, video, live · drawer", and whose States and errors say only "Opening a task whose code is still downloading shows the panel with a skeleton at once *(proposed)*". This session could not open the mock; the boards below are what `specs/157-dialog-drawer/design.md` and `specs/159-form-saving/design.md` recorded from mock v22 two days ago, and nothing here needs a board those did not read.

## Boards
- Overlays › shell (from ST-157): a `role="dialog" aria-modal="true"` panel with a header (title, 44 × 44 px close button "Închide" / "Close"), a line, and a body that scrolls on its own with 20 px 22 px padding. The body is where the skeleton sits today and where the error state goes.
- Overlays › sign-in, review, reply, message (from ST-159): the error next to the main button is red text (`--mf-red-ink`, 13 px) in a `role="alert"` line; main actions are full-width 54 px amber buttons, secondary actions 50 px outlined buttons with the Michroma 12 px uppercase label.

## What to build to match it
- In the overlay body, in place of the skeleton: the shared error text style (`ERROR_TEXT` of `libs/overlays/src/form-parts.ts`, `role="alert"`) with "Ceva nu a mers. Încearcă din nou." / "Something went wrong. Try again.", then one secondary (outlined, `spartan-button-variant-secondary`, as the discard question's buttons) "Reîncearcă" / "Try again" button, 44 px tap target, full width on a phone.
- The header, the X, the backdrop and every way to close are unchanged; the body drops `aria-busy` while the error shows and gets it back while a retry runs.
- The catalogue's overlay section (`libs/ui-cockpit/src/lib/sample-page.ts`) gets one more button beside "Open the sample form" that opens a task whose loader fails once and resolves on retry.

## States
- Shown in the mock: open, closed; the dialog, drawer and bottom-sheet shapes (ST-157, ST-158).
- Not designed (build from the spec, flag in the PR): the loading skeleton (ST-157 built it from the Build brief), the load error and its retry button (this task), the retry's second loading pass.

## Mock vs Build brief
- The mock has no loading or error state for a task's code; ST-157's Build brief added the skeleton *(proposed)* and deferred the failure to the saving-and-errors story (ST-159), whose Build brief says its error states are not designed. This task follows ST-159's built pattern (red alert text, the shared general problem message) and the kit's secondary button; nothing in the mock contradicts it.
- Wording: the mock's "Încearcă din nou" sits inside the general problem sentence; the button label "Reîncearcă" is the repo's existing retry label (`shell.notifications.retry`), not a mock text.
