**Agent review: success** — PR #24 at `d8232b5`, lap 2

Blocking: 0 (blocker 0, high 0) · medium 7 · low 3. Booted: postgres, redis, api, web.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | medium | api readiness: storage down |  |  |
| 2 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 3 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 4 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | /ro · desktop · light · ro (+11 more) | shots/ro-desktop-light-ro.png |
| 5 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | /ro · desktop · light · ro (+11 more) | shots/ro-desktop-light-ro.png |
| 6 | medium | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | /en · desktop · light · ro (+11 more) | shots/en-desktop-light-ro.png |
| 7 | medium | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | /en · desktop · light · ro (+11 more) | shots/en-desktop-light-ro.png |
| 8 | low | Lap-1 items resolved: /de/ stays Romanian with English remembered, and the not-found page has its <main> |  | shots/flow-04-de-en.png |
| 9 | low | The landmark-one-main/region axe findings on /, /ro and /en come from the Home page, which this PR does not change |  | shots/home-desktop-light-ro.png |
| 10 | low | A language switch in another tab still turns an open /de/ page English |  | libs/i18n/src/switch.ts |

### Reproduction
1. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
2. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
3. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
4. Open /ro at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
5. Open /ro at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
6. Open /en at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
7. Open /en at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
8. Set mf.lang=en → Open /de/ and wait for hydration → html lang="ro", 'Pagina nu există', no English text, <main> holds the h1, mf.lang still en (flows-24 '/de/ with en remembered stays Romanian' passed)
9. The Home component is not in the PR's file list; the same axe findings were present in lap 1 → Out of scope for ST-21; worth a follow-up giving Home a <main>
10. apps/web/src/app/not-found/not-found.ts undoes the remembered language only once, in afterNextRender → LanguageChoice.restore() keeps a storage listener (`if (key === KEY && newValue) void this.i18n.use(newValue);`), so choosing EN in a second tab switches the /de/ page to English

Screenshots: 48, one per route × viewport × scheme × language.
