**Agent review: failure** — PR #20 at `7276b4c`, lap 1

Blocking: 3 (blocker 0, high 3) · medium 5 · low 1. Booted: postgres, redis, api, web.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | Gauges panel overflows its container (320px dark ro) |  | {"w":309.140625,"right":325.140625,"cRight":320,"scrollW":325,"sideways":false} (screenshot /private/tmp/claude-502/-Users-georgehutanu-motor-fix/a8e23c2e-d52b-4bd0-a9a2-3f54c55b9f24/scratchpad/pr-20-lap1/shots/flow-1.png) |
| 2 | high | Gauges panel overflows its container (320px light ro) |  | {"w":309.140625,"right":325.140625,"cRight":320,"scrollW":325,"sideways":false} (screenshot /private/tmp/claude-502/-Users-georgehutanu-motor-fix/a8e23c2e-d52b-4bd0-a9a2-3f54c55b9f24/scratchpad/pr-20-lap1/shots/flow-2.png) |
| 3 | high | The range odometer does not fit a 320 px screen: it needs about 248 px, and the panel leaves 246 px | libs/ui-cockpit/src/lib/odometer.ts:18 | odometer.ts:18-20 `font-size: 20px; line-height: 1; white-space: nowrap;` and :30 `width: 1.1em` per digit: eight 22 px cells, 2 px gaps, separators and "lei" on one unbreakable line. The panel measures w 309.14, right 325.14, its container's right 320 (report rows 1-2). The deferred.md line saying "the gauges' own panel fits" holds only because the page column is already 5 px too wide. Fix it with a smaller or fluid digit size (for example clamp()), or let the range wrap at the dash |
| 4 | medium | api readiness: storage down |  |  |
| 5 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 6 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 7 | medium | The 320 px e2e check cannot catch the gauges panel running off the screen | apps/web-e2e/src/gauges.spec.ts:138 | The panel is 309 px wide but starts at x 16, so its right edge is at 325 and the test still passes. Assert `frame.right <= 320` (or document.documentElement.scrollWidth <= 320 once the deferred sample-page overflow is fixed) |
| 8 | medium | The dial and odometer sizes are literal px, not Cockpit tokens | libs/ui-cockpit/src/lib/rating-dial.ts:69 | FR-013: 'every colour, font, radius and spacing from the Cockpit --mf-* tokens'. Its list of part-specific exceptions names stroke widths, the dot size and the digit cell's radius and gap, but no font sizes. No display-size token exists, so either add one or write the exception into the spec |
| 9 | low | The catalogue's empty odometer is a bare "—" right after the range, so it reads as part of the range | libs/ui-cockpit/src/lib/gauges-sample.ts:53 | shots/cockpit-desktop-light-ro.png; at 320 px the dash wraps alone next to the button (shots/flow-1.png). A caption or a separate line per state would make the 'no price' state readable in the catalogue |

### Reproduction
1. open http://127.0.0.1:64294/cockpit at 320 px, dark, ro
2. open http://127.0.0.1:64294/cockpit at 320 px, light, ro
3. Open /cockpit at 320 px (dark or light, ro) → Measure the range odometer "1.250–1.600 lei" in the gauges panel: it covers x 37 to 285, about 248 px (shots/flow-1.png, row y=1996) → At 320 px the sample page leaves 288 px (16 px padding a side), and the panel's 20 px padding and 1 px border leave 246 px of content → Observe: the gauges panel's right border sits at x 324, outside the 320 px viewport. FR-013 says the parts MUST fit a 320 px wide screen
4. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
5. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
6. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
7. Read the test 'fits a 320 px wide screen inside its panel' → It asserts `wider: frame.width > 320`, and parts inside the panel frame only
8. Read rating-dial.ts:69 `font-size: 40px;` and odometer.ts:18 `font-size: 20px;`
9. Open /cockpit at 1280 px → The third odometer row reads "1.401 lei  1.250–1.600 lei  –  [Schimbă estimarea]"

Screenshots: 24, one per route × viewport × scheme × language.
