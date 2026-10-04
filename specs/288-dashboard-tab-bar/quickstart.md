# Quickstart: validate the dashboard tab bar

Prerequisites: `docker compose up -d`, the seeded accounts (`libs/domain/src/seed.ts`), `.env` from `.env.example`.

1. Unit: `scripts/heavy.sh npx jest -c apps/web/jest.config.cts apps/web/src/app/dashboard --maxWorkers=2` — the view lists, the filter, the guard, menu = bar.
2. End to end: `scripts/heavy.sh npx nx e2e web-e2e -- dashboard-tab-bar.spec.ts dashboards.spec.ts phone.spec.ts` — at 375 px each seeded role sees the bar, taps every tab, each view opens with its tab current; at 768 px the bar is hidden and the menu shown; a receptionist typing `/app/garage/team` lands on `/app/garage`.
3. By hand: `npx nx serve web`, sign in as `service@example.test` at 320 px and 390 px, light and dark, RO and EN; the page never scrolls sideways and the bar does.
