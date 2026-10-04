# Quickstart: validate the Cockpit theme

## Unit
```
npx nx run ui-cockpit:test
npx nx run ui-cockpit:typecheck
```
Expect: token presence and values in both themes, contrast pairs, fonts, preset mapping, provider config, panel, sample page, colour-literal scan — all green.

## End to end
Local Postgres and Redis running, `DATABASE_URL`/`REDIS_URL` set (the e2e config also starts the api).
```
npx playwright test -c apps/web-e2e/playwright.config.mts cockpit
```
Expect: `/cockpit` in dark and light emulation shows the dark and light token colours; switching scheme keeps typed text; at 375 px no text under 12 px; every tab stop shows a ring; buttons, inputs, tabs and the toggle are at least 44 px; the panel has a 20 px radius and a border, also with forced colours.

## By eye (owner approval, [X26g])
`npx nx run web:serve`, open `http://localhost:4200/cockpit`, switch the OS appearance between dark and light.
