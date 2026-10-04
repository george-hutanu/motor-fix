# Design: Sign in with e-mail and password
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d2810e8ab4ed9099e3e908

The story's Design boards roll up from EP-1: "Desktop (Cockpit): Sign in · dialog", "Mobile (Cockpit): Mobile · Sign-in sheet". Read with the Artifact tool: `project/SignIn.dc.html` and `project/MSignIn.dc.html` are both `Results` with `overlay="auth"` open (1440 × 900 and 390 × 844); the task itself is the `auth` kind of `project/Overlays.dc.html`; the triggers are in `project/Results.dc.html` and `project/Main.dc.html`.

## Boards
- Sign in · dialog: the Results screen with the shared overlay dialog over it; header "Autentificare" with "MotorFix" as its subtitle and the 44 px close button.
- Body, top to bottom: the driver/garage switch ("Sunt șofer" / "Am un service", superseded: not shown in sign-in mode), its blurb, "E-mail" (placeholder "tu@exemplu.ro", `type=email`, `autocomplete=email`), "Parolă" (placeholder "Parola ta", `type=password`, `autocomplete=current-password`), a row with the "Ține-mă autentificat" checkbox (ticked by default, amber accent) and "Ai uitat parola?" (amber link), the main button "Intră în cont" (amber, full width, 54 px, Michroma 12 px uppercase with 0.14em tracking), a "sau" divider, "Continuă cu Apple" / "Continuă cu Google" (ghost, 50 px), and "Ești nou pe MotorFix? Creează un cont".
- Fields: 50 px tall, 12 px radius, 1 px `#4A4E55` border, 17 px text, label 15 px bold above, 7 px gap; 16 px between rows.
- Mobile · Sign-in sheet: the same task at 390 px as a bottom sheet (the bottom-sheet behaviour is another story; see below).
- Triggers: the desktop header's "Autentificare" link, the narrow header's 44 px account icon ("Cont"), and the phone tab bar's "Cont" tab all open `auth` over the current screen.

## What to build to match it
- The task opens through `Overlays.open(loader, { shape: 'dialog', title: 'public.signIn.title' })` from `libs/overlays` (ST-157); "MotorFix" is the first line of the body, in the muted text colour, because the overlay header has a title only.
- Form: Cockpit tokens for the fields (`--mf-line-strong` border, `--mf-radius-*`, `--mf-tap`), the kit's `spartan-button` default variant for "Intră în cont", a native checkbox with `accent-color: var(--mf-amber)`.
- Field errors under each field (`aria-describedby`, `aria-invalid`), the answer's message in a `role="alert"` region above the button.
- Texts (RO / EN): "Autentificare" / "Sign in", "E‑mail" / "E-mail", "tu@exemplu.ro" / "you@example.com", "Parolă" / "Password", "Parola ta" / "Your password", "Ține‑mă autentificat" / "Keep me signed in", "Intră în cont" / "Sign in"; Romanian words joined by a hyphen use U+2011.
- Triggers: the "Cont" tab of `mf-public-tab-bar` (phones) opens the dialog when signed out; on ≥ 768 px a top bar in the public frame holds "Autentificare" until the desktop header (Home story, EP-4) exists.

## States
- Shown in the mock: the form, the ticked checkbox.
- Not designed (build from the Build brief, flag in the PR): loading (button disabled with progress), field errors, `invalid_credentials`, `too_many_attempts`, `account_suspended`, `maintenance`, offline; the signed-out dashboard address opening Home with the dialog.

## Mock vs Build brief
- The driver/garage switch → the brief: not shown in sign-in mode; the last role opens.
- Apple, Google, "Ai uitat parola?", "Creează un cont" → other stories (Google and Apple, password reset, sign-up ST-80); not shown until they exist (a control that does nothing is not built).
- The phone bottom sheet → its own story; at 390 and 320 px the dialog keeps ST-157's 16 px gutter.
- The main button's label: the brief names it "Intră în cont" and the title "Autentificare"; the mock agrees.
- The mock's link straight to a dashboard → the brief: sign-in never leaves the current screen until it succeeds, then the role's landing opens.
