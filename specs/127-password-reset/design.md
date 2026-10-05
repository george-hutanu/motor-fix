# Design: Reset a forgotten password (ST-127)
Checked: 2026-10-05 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375, the same version `specs/082-sign-in/design.md` read on 2026-10-04; the Artifact read today returns the loader shell only, so the boards are as recorded there) · Story: https://app.notion.com/p/3ee607bff0d2810a99fffb2a805dc619

## Boards
- Desktop (Cockpit) › Sign in · dialog and Mobile (Cockpit) › Mobile · Sign-in sheet: the row under "Parolă" holds the "Ține-mă autentificat" checkbox on the left and "Ai uitat parola?" on the right, an amber text link (ST-82 left it out until this story).
- Build brief, Screens: "The e-mail step, the new-password step and the e-mail are not designed."

## What to build to match it
- "Ai uitat parola?" in the remember row of `mf-sign-in`, right-aligned, the same quiet amber text-button style as "Creează un cont" (`--mf-amber-ink`, bold, 44 px tap height); the row wraps on a 320 px phone.
- The e-mail step and the new-password step are tasks in the shared overlay (`Overlays.open`, shape `dialog`; a bottom sheet on a phone), built like sign-in: "MotorFix" muted first line, label above a 50 px field, the full-width 54 px amber main button, the field error under the field, the answer's message in the task's alert region.
- E-mail step: title "Resetează parola", field "E‑mail", button "Trimite linkul"; after sending, the neutral line and "Înapoi la autentificare".
- New-password step (over Home at `/{lang}/reset-password/:token`): title "Parolă nouă", field "Parolă nouă" (`autocomplete=new-password`), the hint "Cel puțin 8 caractere.", button "Salvează parola". Expired: the heading "Linkul a expirat", one line, button "Cere un link nou".
- Cockpit tokens only; Romanian words joined by a hyphen use U+2011.

## States
- Shown in the mock: the link in the sign-in dialog.
- Not designed (build from the Build brief, flag in the PR): the e-mail step, its sent state, the new-password step, its checking state, the expired state, the weak-password error, both e-mails.

## Mock vs Build brief
- None: the mock shows only the link, where the Build brief puts it.
