# Design: Invite a mechanic or receptionist to an account in my garage (ST-131)
Checked: 2026-10-06 · Mock: none for this story (no boards) · Story: https://app.notion.com/p/3ee607bff0d281f3aa26ca1f287f6138

## Boards
- None. The story's `Design boards` names no board, and the Build brief's Screens
  section says: "Not designed: the mock has no invitation step." The mechanic
  dashboard is reached in the mock only through the demo button "Vezi ca".
  The mock was therefore not opened for this story.

## What to build to match it
Built from the Build brief's proposed minimal screens, with the Cockpit theme's
existing primitives (the dialog/drawer from ST-157, form fields and buttons from
`libs/ui-cockpit` helm), no new component:

- **"Invită în echipă" dialog on the garage dashboard frame** (proposed in the
  Build brief). Opened from one button on the owner's garage dashboard frame.
  Fields: name, e-mail, kind (mecanic / recepționer, mecanic preselected), and,
  for a mechanic only, three ticks, all unticked: can move bookings, can answer
  quote requests, can record the final price. Buttons: "Trimite invitația" and
  "Anulează". On a phone (320 and 390 px) it opens as the bottom drawer the
  dialog primitive already becomes; no sideways scroll.
- **Acceptance screen over Home** at `/{lang}/invite/:token` (proposed). Text:
  "Atelier Dinamo te invită să te alături echipei ca mecanic." (receptionist:
  "… ca recepționer.") and the line that accepting means appearing on the
  garage's public profile, which can be hidden later. Signed out: the existing
  sign-in / sign-up dialog (with its terms tick) opens from "Acceptă"; signed in:
  "Acceptă" accepts at once and lands on the garage dashboard frame (ST-79's
  frame; ST-423's limited dashboard does not exist yet).

## States
- Shown in the mock: none.
- Not designed (built from the Build brief, flagged in the PR):
  - Dialog: sending (button busy), sent (confirmation with "Copiază linkul"),
    e-mail refused ("Nu am putut trimite invitația" with "Copiază linkul"),
    already open for that address (offer "Trimite din nou"), validation errors.
  - Acceptance: loading, valid, invalid/expired/revoked/used
    ("Invitația nu mai este valabilă. Cere service-ului una nouă."), accepting,
    feature switched off for a mechanic invite (same invalid message).
  - Light and dark, Romanian and English, 320 px, 390 px, tablet and desktop.

## Mock vs Build brief
- No mock exists for this flow; the Build brief's proposed minimal dialog and
  acceptance screen are used as given (owner's instruction for this run).
- Not built here (Build brief, Out of scope or deferred in `spec.md`): the Team
  page and its invite button, invite by phone/WhatsApp, the pending move screen.
