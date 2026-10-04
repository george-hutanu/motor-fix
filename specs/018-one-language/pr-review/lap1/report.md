**Agent review: success** — PR #36 at `21c573c`, lap 1

Blocking: 0 (blocker 0, high 0) · medium 7 · low 2. Booted: postgres, redis, api, web.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | medium | api readiness: storage down |  |  |
| 2 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | / · desktop · light · ro (+15 more) | shots/home-desktop-light-ro.png |
| 3 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | / · desktop · light · ro (+15 more) | shots/home-desktop-light-ro.png |
| 4 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | /ro · desktop · light · ro (+15 more) | shots/ro-desktop-light-ro.png |
| 5 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | /ro · desktop · light · ro (+15 more) | shots/ro-desktop-light-ro.png |
| 6 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | /en · desktop · light · ro (+15 more) | shots/en-desktop-light-ro.png |
| 7 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | /en · desktop · light · ro (+15 more) | shots/en-desktop-light-ro.png |
| 8 | low | The 320 px 'cut text' check only measures horizontal overflow; text clipped vertically by a fixed-height box with overflow hidden would pass (FR-007 says 'no text cut off by its own box') | apps/web-e2e/src/one-language.spec.ts:149 | `el.scrollWidth > el.clientWidth + 1,` |
| 9 | low | Adversary specs repeat cases the primary specs already cover (translate="no", empty text, unchanged on language switch, key-looking text; for the pipe: English name, fallback, switch), which edges toward padding under Principle II | libs/i18n/src/as-written.adversary.spec.ts:286 | `it('marks the display so browser translation leaves it alone', async () => {` |

### Reproduction
1. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
2. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
3. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
4. Open /ro at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
5. Open /ro at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
6. Open /en at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
7. Open /en at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
8. Read the diff at apps/web-e2e/src/one-language.spec.ts:149
9. Read the diff at libs/i18n/src/as-written.adversary.spec.ts:286

Screenshots: 64, one per route × viewport × scheme × language.
