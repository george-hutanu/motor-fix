# Design: Move between public screens with a bottom tab bar on a phone (ST-287)
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375; `project/Mobile.dc.html`, `project/Main.dc.html`, `project/Mechanic.dc.html`) · Story: https://app.notion.com/p/3ee607bff0d281e1bf91cd25024ee64e

## Boards
- Mobile (Cockpit) › Mobile · Results (`Mobile.dc.html`): a `nav` fixed to the
  bottom, 82 px tall, three equal columns (`grid-template-columns: repeat(3,
  minmax(0, 1fr))`), `padding: 6px 8px 22px`, a 1 px #2A2D31 top border, the
  "glass" ground `rgba(11,12,14,.74)` with an 18 px backdrop blur (solid
  #0B0C0E under `prefers-reduced-transparency`). Each tab is a link: a 25 px
  stroked icon above its label, `gap: 2px`, `min-height: 52px`, weight 700,
  11 px, no underline. Inactive #B5B8BE; the active tab ("Service-uri" here)
  is amber #FFB000 and carries `aria-current="page"`. Icons: a magnifier
  (Caută), a map pin (Service-uri), a person (Cont), all `aria-hidden`.
- Mobile (Cockpit) › Mobile · Home (`MHome` = `Main.dc.html` with
  `mobile=yes`) and Mobile · Garage profile (`MGarage` = `Mechanic.dc.html`
  with `mobile=yes`): the same bar, `position: sticky; bottom: 0` at the end
  of the page, `padding: 6px 8px max(14px, env(safe-area-inset-bottom))`,
  labels 12 px. The colour of each tab comes from the page (Home: Caută
  active; garage profile: Service-uri active). The bar shows below 640 px
  (`.mf-tabbar` media query); the desktop site bar shows above it.
- The tabs link to Home, Results and the sign-in sheet (`MSignIn`; on
  `Main.dc.html` the Cont tab opens the sign-in overlay over the page).
- Texts (key → RO / EN): k36 Caută / Search, k37 Service-uri / Garages, k38
  Cont / Account, k41 (the nav's label) Secțiuni / Sections.

## What to build to match it
- One shared component, `mf-public-tab-bar`, at the bottom of every public
  screen: a `nav` landmark, three links with icon and label, never icons
  alone. Sticky at the bottom of the public frame, as on Home and the garage
  profile, so it never covers the last line of a page.
- Cockpit tokens instead of the mock's literals: ground `--mf-bg` at 74 %
  with the blur (solid `--mf-bg` with reduced transparency), top border
  `--mf-line`, inactive `--mf-text-secondary`, active `--mf-amber-ink` (equal
  to #FFB000 in the dark theme, the readable dark amber in the light one).
- Labels in the body font at `--mf-size-label` (12 px), weight 700; tabs
  52 px tall; bottom padding `max(14px, safe-area bottom inset)`.
- Hidden from 768 px (the Build brief's breakpoint, the shared phone query);
  the desktop header stays the one already on Home.

## States
- Shown in the mock: active and inactive tabs, dark theme, 390 px.
- Not designed (build from the Build brief, flag in the PR): the light
  theme, 320 px, the bar hidden while the on-screen keyboard is open, the
  placeholder screens behind Service-uri and Cont (the real ones come in
  EP-4 and ST-82), focus rings on the tabs (the theme's shared
  `:focus-visible` ring).

## Mock vs Build brief
- Labels 11 px on the results board → 12 px everywhere (decision 2026-10-03;
  Home and garage boards already use 12 px). The Build brief wins.
- Fixed 22 px bottom padding on the results board → the safe-area inset
  (Home and garage boards and the Build brief agree). The Build brief wins.
- The nav's label "Secțiuni" / "Sections" → "Navigare principală" (Build
  brief; English "Main navigation"). The Build brief wins.
- The bar shows below 640 px in the mock → below 768 px (Build brief,
  scenario 8, and the shared phone breakpoint of ST-286). The Build brief
  wins.
- Active tab as colour only on Home and garage boards → colour plus
  `aria-current="page"` everywhere (results board and Build brief).
