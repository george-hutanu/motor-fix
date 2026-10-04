**Agent review: failure** — PR #37 at `445f3ab`, lap 1

Blocking: 1 (blocker 0, high 1) · medium 16 · low 0. Booted: postgres, redis, api, web.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized) | /ro/account · desktop · light · ro (+15 more) | shots/ro-account-desktop-light-ro.png |
| 2 | medium | api readiness: storage down |  |  |
| 3 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | / · desktop · light · ro (+15 more) | shots/home-desktop-light-ro.png |
| 4 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | / · desktop · light · ro (+15 more) | shots/home-desktop-light-ro.png |
| 5 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | /ro · desktop · light · ro (+15 more) | shots/ro-desktop-light-ro.png |
| 6 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | /ro · desktop · light · ro (+15 more) | shots/ro-desktop-light-ro.png |
| 7 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | /en · desktop · light · ro (+15 more) | shots/en-desktop-light-ro.png |
| 8 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | /en · desktop · light · ro (+15 more) | shots/en-desktop-light-ro.png |
| 9 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | /ro/garages · desktop · light · ro (+15 more) | shots/ro-garages-desktop-light-ro.png |
| 10 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (1 element) | /ro/garages · desktop · light · ro (+15 more) | shots/ro-garages-desktop-light-ro.png |
| 11 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | /ro/garages/atelier-dinamo · desktop · light · ro (+15 more) | shots/ro-garages-atelier-dinamo-desktop-light-ro.png |
| 12 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (1 element) | /ro/garages/atelier-dinamo · desktop · light · ro (+15 more) | shots/ro-garages-atelier-dinamo-desktop-light-ro.png |
| 13 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | /ro/mechanics/ion-popescu · desktop · light · ro (+15 more) | shots/ro-mechanics-ion-popescu-desktop-light-ro.png |
| 14 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (1 element) | /ro/mechanics/ion-popescu · desktop · light · ro (+15 more) | shots/ro-mechanics-ion-popescu-desktop-light-ro.png |
| 15 | medium | HTTP 401: http://127.0.0.1:60054/api/v1/me | /ro/account · desktop · light · ro (+15 more) | shots/ro-account-desktop-light-ro.png |
| 16 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | /ro/account · desktop · light · ro (+15 more) | shots/ro-account-desktop-light-ro.png |
| 17 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (1 element) | /ro/account · desktop · light · ro (+15 more) | shots/ro-account-desktop-light-ro.png |

### Reproduction
1. Open /ro/account at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: Console error: Failed to load resource: the server responded with a status of 401 (Unauthorized).
2. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
3. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
4. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
5. Open /ro at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
6. Open /ro at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
7. Open /en at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
8. Open /en at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
9. Open /ro/garages at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
10. Open /ro/garages at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on mf-placeholder. → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (1 element).
11. Open /ro/garages/atelier-dinamo at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
12. Open /ro/garages/atelier-dinamo at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on mf-placeholder. → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (1 element).
13. Open /ro/mechanics/ion-popescu at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
14. Open /ro/mechanics/ion-popescu at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on mf-placeholder. → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (1 element).
15. Open /ro/account at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: HTTP 401: http://127.0.0.1:60054/api/v1/me.
16. Open /ro/account at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
17. Open /ro/account at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on mf-placeholder. → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (1 element).

Screenshots: 128, one per route × viewport × scheme × language.
