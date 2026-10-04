# Design: Create an account with e-mail and password
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d2813a9bd4d4acd406ca56

The story's Design boards roll up from EP-1: "Desktop (Cockpit): Sign in · dialog", "Mobile (Cockpit): Mobile · Sign-in sheet". Read with the Artifact tool: the task is the `auth` kind of `project/Overlays.dc.html`; its sign-up mode is the same markup with `auth.signup` true (`toggleMode`).

## Boards
- Sign in · dialog, sign-up mode: the shared overlay dialog; header "Cont nou" / "New account" with "MotorFix" as its subtitle (sign-in mode: "Autentificare").
- Body, top to bottom: the driver/garage switch ("Sunt șofer" / "Am un service"), its blurb (driver: "Cererile tale de ofertă, mașinile și recenziile scrise." / "Your quote requests, your cars and the reviews you wrote."; garage: "Profilul tău, cererile de ofertă și recenziile primite de la șoferi."), "Nume" (`autocomplete=name`), "E-mail" (placeholder "tu@exemplu.ro"), "Parolă" (placeholder "Parola ta"), the main button "Creează contul" / "Create account", the "sau" divider with Apple and Google, and the switch line "Ai deja cont? Intră în cont" / "Already have an account? Sign in".
- Sign-in mode's switch line: "Ești nou pe MotorFix? Creează un cont" / "New to MotorFix? Create an account"; centred, muted lead text, amber 16 px bold link-button, 44 px tall.
- Sign-up mode has no "Ține-mă autentificat" row and no "Ai uitat parola?".
- Fields as in sign-in: 50 px, 12 px radius, `#4A4E55` border, 17 px text, 15 px bold label above.

## What to build to match it
- Two tasks in the shared `dialog` shape: the existing sign-in task, and a sign-up task titled `public.signUp.title` ("Cont nou" / "New account"). The switch line in each closes its task and the opener opens the other one, carrying the typed e-mail; the overlay header takes its title at open, and `libs/overlays` is being changed by ST-158, so the title is not made mutable here.
- Sign-up body: "MotorFix" and the driver blurb as the first lines (muted), "Nume", "E‑mail", "Parolă" with a show/hide button (Build brief), the alert region, "Creează contul" (kit default button, full width, 54 px), the switch line.
- `autocomplete`: `name`, `email`, `new-password`.
- Texts in RO / EN, Romanian words joined by a hyphen with U+2011.

## States
- Shown in the mock: the empty form.
- Not designed (build from the Build brief, flag in the PR): saving (button disabled with progress), field errors, `email_taken`, `weak_password`, `too_many_attempts`, `maintenance`, offline.

## Mock vs Build brief
- The driver/garage switch and "Am un service" → the brief (superseded 2026-10-03): public sign-up creates drivers only, and "Am un service" would lead to List your garage, which has no route and no design yet. Not shown: a control that leads nowhere is not built (Principle I); the story that builds List your garage adds it.
- Apple, Google → their own story; not shown.
- The terms tick → ST-132 adds it to this form (timeline ordering note).
- The "e-mail taken" links → the brief proposes sign-in and reset-password links; reset does not exist yet, and the switch line under the button already leads to sign-in with the e-mail kept.
- The mock's link straight to a dashboard → the account is created first, then the driver landing opens.
- Phone: the bottom sheet is ST-158's; at 390 and 320 px the dialog keeps ST-157's 16 px gutter and becomes a sheet when ST-158 merges.
