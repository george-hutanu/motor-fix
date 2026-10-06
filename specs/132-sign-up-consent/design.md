# Design: Accept the terms and the privacy notice at sign-up (ST-132)
Checked: 2026-10-05 · Story: https://app.notion.com/p/3ee607bff0d281538378d451b545ec2b

The story's Notes say "In the mock: Not shown" and the Build brief's Screens say "Not designed: no board shows the tick or the legal pages". No board was opened: there is none for this story. Logged, not blocking.

## Boards
- Sign in · dialog and Mobile · Sign-in sheet (feature "Accounts, roles and sign-in"): the sign-up mode with Nume, E-mail, Parolă and "Creează contul". The tick is not on them.

## What to build to match it
- The consent tick: **not designed**; it sits above the main button of every sign-up form *(proposed by the brief)*. Built like the sign-in dialog's "Ține-mă autentificat" row (`apps/web/src/app/sign-in/sign-in.ts`): a native checkbox at the 44 px tap height, with the text wrapping beside it and the two titles as links in the amber ink.
- The pages `/{lang}/terms` and `/{lang}/privacy`: **not designed**; plain public pages in the public frame, built like the e-mail check and unsubscribe pages (`apps/web/src/app/public/unsubscribe.ts`): a heading, the version and a draft notice, then the text in sections, readable width, no sideways scroll at 320 px.

## States
- Tick: unticked (initial), ticked, error "Bifează pentru a continua." under it after a submit with it empty, disabled while sending.
- Pages: the text only (static, no loading state).

## Mock vs Build brief
- No conflict: the mock does not show the tick or the pages; the brief marks both not designed.
