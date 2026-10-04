# Design: See the audit history of my garage, or all of it as admin (ST-391)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, rolled up from epic EP-1) · Story: https://app.notion.com/p/3ee607bff0d281b7acf7cedaa984bb17

No screens in this build: the API only. The Build plan of EP-1 (slice 9, "Early starts and late items") builds the API here; the views wait for the admin dashboard (ST-160, EP-2) and the garage dashboard (ST-97, EP-5).

## Boards
- The story's `Design boards` property is the epic's roll-up (Sign in · dialog, Home, Mobile · Sign-in sheet, all nine mobile boards, Dashboard · Driver, A · Cockpit). None shows the audit history. The Build brief's Screens section says the view "Istoric modificări" is "**Not designed** in mock v22", so the mock was not opened for a board that does not exist.

## What to build to match it
- Nothing visual in this build. The API answers what the later view needs: entries newest first, 20 per page with a cursor for "more on scroll", the total, and for each entry the time, the actor (first name, role), the subject and field, the old and new values, and the AI assistant marker.

## States
- Shown in the mock: none.
- Not designed (late part, built with ST-97 and ST-160 from the Build brief): a list of rows like the request inbox (time, who, what, old → new), a filter bar above (garage, person, area, dates), rows stacked on a phone (MF-4), row skeletons while loading, "Reîncearcă" on error, "Nicio modificare în perioada aleasă" when empty, values formatted for the field (lei, Europe/Bucharest, state labels), long values cut at 120 characters with "mai mult", "Ion, proprietar · prin asistentul AI" for assistant entries, filters kept in the address.

## Mock vs Build brief
- No difference to resolve: the mock has no board for this view.
