# Design: Set up e-mail sending (ST-194)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22) · Story: https://app.notion.com/p/3ee607bff0d281df9c01d35400d5195f

No screens: the Build brief's Screens section says "None designed. The test message is API-only *(proposed)*."

## Boards
- None for this story. The story's notes say no message is actually sent in the mock; texts on several screens promise one, for example "Service-ul primește decizia pe e-mail" in Admin · Dosar de verificare. Those screens belong to their own stories.

## What to build to match it
- Nothing visible. The bell that would show the `in_app` rows is ST-199's; the "Adresa de e-mail nu primește mesaje" hint in Setări after a bounce is a later settings story, fed by `email_bounced_at`.

## States
- Shown in the mock: none.
- Not designed (built from the Build brief): grouping of several events, the bounce fallback hint, quiet hours.

## Mock vs Build brief
- No difference to resolve: the mock has no screen for this story.
