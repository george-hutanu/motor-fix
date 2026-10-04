# Design: See prices, numbers and dates in the format of my language (ST-19)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d28180a6a4e24b1d161a9b

ST-19 builds shared formats, not a screen. The boards below show the formats
every screen will use; the screens themselves arrive in later epics.

## Boards
- Desktop (Cockpit) › Home (`project/Main.dc.html`): rating dial and garage
  cards. Ratings with one decimal (`dec`: "4,9" / "4.9"), quotes such as
  "„Ofertă 4.200 lei, plătit 4.200 lei.”" / "“Quoted 4,200 lei, charged 4,200
  lei.”", hourly rates "<n> lei / oră" / "<n> lei / h".
- Desktop (Cockpit) › Results + map (`project/Results.dc.html`): distance
  "la 2,4 km" / "2.4 km away", rating "4,9", "de la <n> lei pe oră" /
  "from <n> lei per hour".
- Garage profile / listing (`project/ListGarage.dc.html`): same `dec` and `km`
  helpers, "lei / oră".
- Dashboards › Dashboard · Driver (`project/DashClient.dc.html`): thousands
  separator "." in Romanian and "," in English (`num`), short months
  `ian. feb. mart. apr. mai iun. iul. aug. sept. oct. nov. dec.` and
  `Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec`, dates "9 mart. 2026" /
  "9 Mar 2026", times "09:40", "azi, 10:07" / "today, 10:07", ratings
  "5,0 / 5" / "5.0 / 5"; a missing cost shows "–".
- Every board re-renders its values in place when RO / EN is pressed (the
  board's `lang()` signal), no reload.

## What to build to match it
- Format functions and template pipes in `libs/i18n` for money (bani → lei),
  money ranges, ratings, plain numbers, distances, percentages, dates and
  times, following the current language and changing with it.
- Month abbreviations exactly as the mock's `monRo` / `monEn` tables.
- The words around a value ("la … km", "… km away", "lei / oră", "azi, …")
  are screen texts and belong to each screen's translation keys; the format
  supplies the value ("2,4 km", "10:07").
- Calendar names (months, days from Monday, first day Monday) for the date
  picker the booking screens will use.

## States
- Shown in the mock: a missing cost shows "–" (en dash).
- Not designed: a date picker (no board has one), negative amounts, non-whole
  lei amounts, ranges with a missing end. Built from the Build brief and the
  spec's edge cases.

## Mock vs Build brief
- Missing value: mock "–" (en dash), Build brief "—" (em dash, proposed) → the
  Build brief wins (it is newer).
- Romanian short month for March: mock and AC "mart."; current browser data
  "mar." → the mock and AC win; the month table is fixed in code.
- Date picker: the Build brief names the PrimeNG locale; no board shows a
  picker and no component library is installed on `main` → only the names and
  first day are provided now.
