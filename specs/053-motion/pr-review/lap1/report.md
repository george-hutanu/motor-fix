**Agent review: failure** — PR #31 at `ade9319`, lap 1

Blocking: 3 (blocker 1, high 2) · medium 8 · low 1. Booted: postgres, redis, api, web.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | blocker | End-to-end suite failed (exit 1) |  |  |
| 2 | high | Accessibility (serious): color-contrast — Elements must meet minimum color contrast ratio thresholds (1 element) | /cockpit · desktop · light · ro (+9 more) | shots/cockpit-desktop-light-ro.png |
| 3 | high | Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized) | /app/driver · desktop · light · ro (+11 more) | shots/app-driver-desktop-light-ro.png |
| 4 | medium | api readiness: storage down |  |  |
| 5 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 6 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 7 | medium | HTTP 401: http://127.0.0.1:54395/api/v1/me | /app/driver · desktop · light · ro (+11 more) | shots/app-driver-desktop-light-ro.png |
| 8 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | /app/driver · desktop · light · ro (+11 more) | shots/app-driver-desktop-light-ro.png |
| 9 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | /app/driver · desktop · light · ro (+11 more) | shots/app-driver-desktop-light-ro.png |
| 10 | medium | charts e2e 'grows the bars in without reduced motion' is now flaky: the panel rise likely delays its first screenshot |  | logs/e2e.log: expect(await shot(page)).not.toEqual(early) at charts.spec.ts:109. Likely cause, not proven: the chart's mf-panel now runs mf-rise (translateY 14px over 700 ms), and locator.screenshot() waits for the canvas to stop moving, so the 'early' shot is taken after the rise. By then Chart.js may already have finished growing the bars. Possible fixes: take the early shot from the page, or wait for the rise to end before starting the chart test. |
| 11 | medium | The stagger counts every sibling element, not panels, so the first panel on /cockpit waits 480 ms |  | panel.ts: `:host(:nth-child(2)) { --mf-panel-step: 1; } … :host(:nth-child(n + 12)) { --mf-panel-step: 11; }`. The two panels are the 9th and 10th children of <main>, so they start at 480 and 540 ms (measured). The 60 ms gap holds, but the first panel sits invisible for 480 ms, and any panel after 11 non-panel siblings waits the full 660 ms. FR-002 describes the stagger as being between panels. `:nth-child(n of mf-panel)`, or putting the panels in their own container, would start the first panel at 0. |
| 12 | low | The blink lowers text to 0.35 opacity, below contrast, for half of every second |  | cockpit.css `@keyframes mf-blink { 50% { opacity: 0.35; } }` on a text label (sweep finding: color-contrast, .mf-blink). For text, blink a dot next to the label instead, or keep the dimmed state above 4.5:1. |

### Reproduction
1. In the PR worktree: BASE_URL=http://127.0.0.1:54395 npx playwright test -c apps/web-e2e/playwright.config.mts --workers=1 → Observe: [65/66] [chromium] › apps/web-e2e/src/skeleton.spec.ts:3:1 › the skeleton page shows the release and both checks / [66/66] [chromium] › apps/web-e2e/src/skeleton.spec.ts:15:1 › the server sends the page in Romanian, every text filled in /   1 failed /     [chromium] › apps/web-e2e/src/charts.spec.ts:103:1 › grows the bars in without reduced motion ── /   65 passed (38.1s)
2. Open /cockpit at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule color-contrast on .mf-blink. → Observe: Accessibility (serious): color-contrast — Elements must meet minimum color contrast ratio thresholds (1 element).
3. Open /app/driver at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized).
4. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
5. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
6. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
7. Open /app/driver at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: HTTP 401: http://127.0.0.1:54395/api/v1/me.
8. Open /app/driver at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
9. Open /app/driver at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
10. run the full e2e suite three times against the booted PR head ade9319 → apps/web-e2e/src/charts.spec.ts:103 passed twice and failed once: the 'early' and the 1.5 s screenshot of the bar canvas were identical
11. open /cockpit with full motion → read the mf-rise delays of main > mf-panel
12. open /cockpit → axe color-contrast on .mf-blink

Screenshots: 36, one per route × viewport × scheme × language.
