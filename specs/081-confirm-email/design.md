# Design: Confirm my e-mail address
Checked: 2026-10-05 · Story: https://app.notion.com/p/3ee607bff0d281fbb2b2ed051f341579

The story's Notes say "In the mock: Not shown", and the Build brief's Screens section says "Not designed: no board shows the e-mail, the banner or the confirmation page." Its Design boards roll up from EP-1 and none of them is about this story, so the mock was not opened at a board for it.

## Boards
- None for this story.

## What to build (from the Build brief, with the kit's existing pieces)
- **E-mail**: the existing `ACCOUNT_EMAIL.email_check` template (ST-195): subject "Confirmă adresa de e-mail", button "Confirmă adresa" / "Confirm the address".
- **Banner** on every dashboard, above the view's content, below its header: "Confirmă-ți adresa de e-mail" / "Confirm your e-mail address", and a secondary kit button "Retrimite" / "Send again" (44 px tap target). Role `status`, wraps on a 320 px phone. Outcome by the frame's existing toaster.
- **Confirmation page** `/{lang}/confirm-email/:token` inside the public frame, one heading and one line:
  - confirming: "Confirmăm adresa…" / "Confirming your address…" (busy);
  - confirmed: "Adresa ta de e-mail este confirmată." / "Your e-mail address is confirmed." with a link to MotorFix's home;
  - expired: "Linkul a expirat" / "The link has expired", with the kit button "Trimite un link nou" / "Send a new link", then "Am trimis un link nou pe e-mail." / "We sent a new link by e-mail.";
  - error: "Nu am putut confirma adresa acum." / "We could not confirm your address just now." with "Încearcă din nou" / "Try again".
- Romanian words joined by a hyphen use U+2011, as the rest of the catalogue.

## States
- Not designed (built from the brief, flagged in the PR): every state above.

## Mock vs Build brief
- No mock to disagree with.
