# Design: Reach every dashboard view from a bottom tab bar on a phone (ST-288)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, published version 1791040637-c375; `project/MDashClient.dc.html`, `MDashGarage`, `MDashMech`, `MDashAdmin`, and the `DashClient`/`DashGarage`/`DashMech`/`DashAdmin` components they import with `mobile="yes"`) · Story: https://app.notion.com/p/3ee607bff0d2816f83b1d10d181fc8f1

## Boards
- Mobile (Cockpit) › Mobile · Driver / Garage / Mechanic / Admin dashboard: the
  desktop dashboard component at 390 px. The side menu is hidden and a
  `<nav class="mf-glass mf-tabbar" aria-label="Secțiuni">` sits at the end of
  the page, `position: sticky; bottom: 0`, `padding: 6px 8px max(14px,
  env(safe-area-inset-bottom))`, 1 px top border, glass ground (solid under
  reduced transparency), `overflow-x: auto`.
- Each tab: a button, `flex: 1 0 auto; min-width: 66px; min-height: 48px;
  padding: 0 6px`, a column with an 18×3 px rounded marker above a short label
  (12 px, weight 700, no wrap). Inactive text #B5B8BE with a dim marker; the
  active tab amber text and amber marker. No icons, no count badges.
- Tabs (short labels, RO / EN): driver Panou/Home · Cereri/Requests ·
  Mașini/Cars · Recenzii/Reviews · Salvate/Saved · AI · Setări/Settings;
  garage Panou · Cereri · Program/Schedule · Mecanici/Team · Prețuri/Prices ·
  Recenzii · Profil/Profile · AI; admin Panou · Service-uri/Garages ·
  Utilizatori/Users · Raportate/Reported · Mărci/Brands · AI · Setări.
- Desktop side menu (`aside.mf-side`, 252 px): the same entries in the same
  order with the long labels (Cererile mele, Mașinile mele, …), a role tag on
  top, and the avatar, name and "Ieși din cont" at the bottom.
- Phone header: sticky glass header with the view title (`h1`) and the RO/EN
  switch; the bell is hidden on a phone.

## What to build to match it
- One shared component `mf-dashboard-tab-bar` inside the dashboard frame,
  sticky at the bottom below 768 px, hidden from 768 px, where the side menu
  shows. Cockpit tokens instead of literals: ground `--mf-bg` at 74 % with
  the blur (solid with reduced transparency, like `mf-public-tab-bar`), top
  border `--mf-line`, inactive `--mf-text-secondary`, active `--mf-amber-ink`.
- Tabs: marker + short label, `min-width: 66px`, at least 44 px tall (the
  mock's 48 px kept), label `--mf-size-label` (12 px) weight 700, no wrap;
  `flex: 1 0 auto` so a tab grows to fit its label and the bar scrolls
  sideways.
- One view list per dashboard, each view with its long menu label and its
  short tab label; the side menu shows the long one, the bar the short one.
- Account controls on a phone: the mock has none (see below). Build: the
  aside stays above the header as an account band (logo, area, name, "Ieși
  din cont"); only its menu is hidden, and the header keeps the title and the
  language switch.

## States
- Shown in the mock: the active tab (first view by default); the overflowing
  bar (behaviour only, no board).
- Not designed (build from the Build brief, flag in the PR): the receptionist
  and the permission-limited mechanic lists; an unknown or refused view
  address; the account controls on a phone.

## Mock vs Build brief
- Breakpoint: the mock switches at 900 px; the Build brief says 768 px → the
  Build brief wins (shared phone rule, `BREAKPOINTS.tablet`).
- State attribute: the mock uses `aria-pressed` on buttons; the Build brief
  says links with `aria-current="page"` → the Build brief wins (views get
  addresses).
- Landmark name: the mock says "Secțiuni"; the Build brief says the bar is
  labelled with the dashboard's name → the Build brief wins (it is newer).
- Mechanic: the mock has a separate mechanic dashboard (Ziua mea, Programul
  meu, …); the owner's decision of 2026-10-03 (W01) gives the mechanic the
  limited garage dashboard until release 2 → the decision wins.
- "AI" tab (Asistent AI): in the mock, but the AI assistant connection is its
  own epic (release 3) and the current menus have no such view → left out
  until that epic adds the view to the list.
- Account controls: the mock has no sign-out and no name on a phone; the
  spec (FR-012) keeps them reachable in the account band above the header →
  flagged in the PR.
