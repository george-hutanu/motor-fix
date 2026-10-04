# Design: Switch the interface between Romanian and English (ST-17)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (version 1791040637-c375, `project/Main.dc.html`) · Story: https://app.notion.com/p/3ee607bff0d28131b3c1e5856c0e50bf

## Boards
- Desktop (Cockpit) › Home: the header ends with a `role="group"` (label
  "Limbă" / "Language", key k162) holding two buttons "RO" and "EN", each
  44×44 px, `aria-pressed` on the current one, aria-labels "Română" and
  "English". The group is a pill: 3 px padding, 1 px #2A2D31 border, radius 12,
  background #0F1113. The current button is amber #FFB000 with ink #0B0C0E; the
  other is transparent with ink #C9CBD0; Michroma 10 px, 0.08em tracking; colour
  fades in 220 ms. Every text on the board re-renders in place on a switch.
- The same switch is in the header of Results + map, Garage profile, List your
  garage, the four dashboards and the mobile boards (Build brief › Screens). Of
  those, only Home (the skeleton page) and the dashboard frame exist in the app
  today.
- Mock behaviour: reads `localStorage['mf-lang']` (anything but `en` → `ro`),
  writes it on a tap (errors swallowed), and follows other tabs through the
  `storage` event plus a `BroadcastChannel('mf-lang')`.

## What to build to match it
- One switch component used in the header of Home and of the dashboard frame:
  a labelled group of two plain buttons RO / EN with `aria-pressed` and the
  "Română" / "English" names, at least 44 px tall. Minimal styling only (the
  current one visibly marked); the Cockpit colours and the Michroma face come
  with ST-50's theme, which is not merged — do not depend on `libs/ui-cockpit`.
- Phone: the switch stays in the header (the mock keeps it next to the mini
  nav at ≤ 640 px).
- The dashboard frame's texts move to keys so the switch changes them.

## States
- Shown in the mock: Romanian (default) and English, switched live; the current
  button highlighted.
- Not designed (build from the Build brief, flag in the PR): storage blocked
  (Romanian every visit, no error), a remembered value that is not a language
  (ignored), the account's language winning at sign-in, the server-rendered
  first paint being Romanian before a remembered English is applied.

## Mock vs Build brief
- Storage key: mock `mf-lang`, brief `mf.lang` *(proposed)* → the Build brief
  wins: `mf.lang`.
- Group label: mock "Limbă", brief "Limba" / "Language" → the Build brief wins:
  "Limba" (both are correct Romanian; flagged for the owner).
- Tab sync: mock uses the `storage` event and a BroadcastChannel; brief names
  only the storage event → the Build brief wins: the storage event only
  (Principle I; the channel adds nothing while storage works, and with storage
  blocked every visit is Romanian anyway).
- Control: brief says "SelectButton" (PrimeNG's name); PrimeNG is excluded and
  ST-50's helm components are not merged → two buttons with `aria-pressed`, as
  the mock's own markup does.
- Button names: the mock gives the buttons aria-labels "Română" / "English";
  the brief names only the group → the buttons keep their visible text "RO" /
  "EN" as their name (label-in-name), the group carries "Limba" / "Language".
- The mock has no accounts; the brief's account-language rules (scenario 7,
  ST-20) are not in the mock → built from the brief (read only; the write is
  ST-20's).
