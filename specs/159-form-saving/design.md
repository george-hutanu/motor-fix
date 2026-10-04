# Design: Build shared saving, validation and errors for small actions
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d28158a0bee4952af0d856

The story's Design boards roll up from EP-1 (Sign in · dialog, Home, Mobile · Sign-in sheet, the mobile boards, Dashboard · Driver, A · Cockpit). Its Build brief's Screens: "The forms of Overlays.dc.html: sign-in and sign-up first. Validation, error and offline states are not designed." Read with the Artifact tool: `project/Overlays.dc.html`.

## Boards
- Overlays › sign-in / sign-up (auth): a column of fields, 16 px apart; each field a `label` with its text above (15 px, 700) and a 50 px input (12 px radius, `#4A4E55` border, `#0B0C0E` fill, 17 px text), amber focus ring; the main action a full-width 54 px amber button with the Michroma 12 px uppercase label; secondary actions as 50 px outlined buttons.
- Overlays › review, reply, message (the tasks that confirm in place): after the main button, the form is replaced by a centred column: a 56 px green circle with a check, an 18 px bold sentence ("Trimis. …" / "Sent. …"), and a full-width 50 px outlined "Închide" / "Close" button. The other tasks simply close and update the screen behind (`mf-done` event).
- Reduced motion: the mock stops every animation and transition.

## What to build to match it
- Field message: under the field, 13 px, `--mf-red-ink` (new token: `--mf-red` on the raised light panel is 3.85:1; light `#b3261e`), with the field's border in `--mf-red` (the kit's `data-matches-spartan-invalid` look).
- Error next to the main button: the same red text in a line just above the button row, inside a live region (`role="alert"`).
- Busy main button: the label stays, a small spinner appears before it; `aria-busy`, `aria-disabled`, dimmed like a disabled button; under reduced motion the spinner does not turn (ST-53's global rule removes the animation).
- Confirmation in place: the mock's done column — check circle in `--mf-green`, an 18 px bold sentence (`role="status"`), a full-width secondary "Închide" / "Close" button.
- Texts in Romanian and English; Romanian words with hyphens use U+2011.
- Catalogue (`/cockpit`): a sample form task in the existing sample style (Spartan helm button, input, label) to reach every state.

## States
- Shown in the mock: idle form; done in place (review, reply, message); done by closing (the other tasks).
- Not designed (build from the Build brief, flag in the PR): field validation messages, the busy button, the server error next to the button, the network error, maintenance. Offline and expired session are other stories (ST-253, ST-130).

## Mock vs Build brief
- Field height 50 px in the mock → the kit's input keeps its 44 px minimum (ST-50); the story does not restyle inputs.
- Main button full width in the auth board → the sample keeps the kit's button sizing; a task decides its own layout.
- The mock never fails a save → the Build brief's states (invalid, sending, failed) win; their look follows the tokens above.
