# Design: Set up the account model, the roles and their rights
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d281778692cbdd267fb72f

## Boards
- Dashboards (Cockpit) › Dashboard · Driver (`DashClient`): left sidebar (logo "MOTORFIX" linking Home, a role tag, `nav` "Meniu" of view buttons, a "VEZI CA" role-jump block, then the person's initials, name and "Ieși din cont"), a sticky glass header (view title and subtitle, RO/EN switch, bell), main area with the view.
- Dashboards (Cockpit) › Dashboard · Garage (`DashGarage`): same frame; garage menu.
- Dashboards (Cockpit) › Dashboard · Admin (`DashAdmin`): same frame; admin menu.
- Mobile boards `MDashClient`, `MDashGarage`, `MDashAdmin`: the same component at 390 px (`mobile` flag); the sidebar collapses (tab bars are ST-? in slice 9).

## Menu entries in the mock (Romanian / English)
- Driver: Panou / Dashboard · Cererile mele / My requests · Mașinile mele / My cars · Recenziile mele / My reviews · Service-uri salvate / Saved garages · Asistent AI / AI assistant · Setări / Settings.
- Garage: Panou · Cereri de ofertă / Quote requests · Programări / Schedule · Mecanici / Mechanics · Prețuri / Prices · Recenzii / Reviews · Profilul service-ului / Garage profile · Asistent AI.
- Admin: Panou · Service-uri / Garages · Utilizatori / Users · Recenzii raportate / Reported reviews · Mărci și lucrări / Brands and jobs · Asistent AI · Setări / Platform settings.

## What to build to match it
- One frame component for the three areas: aside (logo link to Home, role tag, `<nav aria-label="Meniu">` of buttons, account block with name and "Ieși din cont" at the bottom), header (`<h1>` with the selected entry's label), `<main>` with a plain empty state.
- Menu entries filtered by the capabilities table: a receptionist has no Mecanici, Prețuri, Profilul service-ului; a mechanic has Panou, plus Cereri de ofertă only with `can_answer_quotes` and Programări only with `can_move_bookings`.
- Colours and type follow the mock's dark Cockpit values only through the theme story (ST-50, running in parallel); this story uses plain semantic markup and no hard-coded palette.

## States
- Shown in the mock: the filled views of each dashboard (built by later epics).
- Not designed (build from the Build brief, flag in the PR): the empty state of a frame — "Nimic aici încă." (Nothing here yet.) *(proposed)*; the signed-out redirect.

## Mock vs Build brief
- The mock's "VEZI CA" role-jump buttons → not built (Build brief, scenario 8).
- The mock shows a role tag per dashboard → kept as text; role chips for two-role accounts belong to the role switch (ST-394).
- RO/EN switch and bell in the header → belong to ST-17 and the bell story; not built here.
- "Asistent AI" entries → EP-16; not built here.
- "Ieși din cont" in the mock is a link to sign-in → here a button that drops the in-memory session and goes Home; revoking the refresh token is the sign-out story.
