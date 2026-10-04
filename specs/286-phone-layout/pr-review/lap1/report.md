**Agent review: success** — PR #22 at `8109218`, lap 1

Blocking: 0 (blocker 0, high 0) · medium 4 · low 1. Booted: postgres, redis, api, web.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | medium | api readiness: storage down |  |  |
| 2 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 3 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 4 | medium | Phone list rows drop the column names for screen readers: the header row is display:none and the table/tr are re-displayed as block/flex | /cockpit · mobile | shots/cockpit-mobile-dark-en.png |
| 5 | low | Layout is exported from @motor-fix/ui-cockpit with no consumer yet |  |  |

### Reproduction
1. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
2. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
3. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
4. libs/ui-cockpit/src/styles/cockpit.css phone query: `.spartan-table:has([data-column="main"]) .spartan-table-header { display: none; }`, the table and body set to `display: block`, rows to `display: flex` → Open /cockpit at 375 px with VoiceOver (iOS Safari): the key value is read as a bare "4,9" with no "Rating" header, and WebKit drops table semantics for a table re-displayed as block → Suggested: hide the header row visually (clip / sr-only pattern) instead of display:none, or keep role=table/row/cell explicitly on the helm directives
5. libs/ui-cockpit/src/index.ts: `export { Layout, type LayoutName } from './lib/layout';` and nothing in apps/ or libs/ injects it → FR-008 requires the signal now, so it is in scope; Principle I wants its first reader (bottom sheet / tab bar story) soon

Screenshots: 24, one per route × viewport × scheme × language.
