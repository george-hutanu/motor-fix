# Context: Sign in with Apple or Google (ST-83)
Gathered: 2026-10-05 · Anchor: https://app.notion.com/p/3ee607bff0d281ae87e5f2ff6afae615

[UNAVAILABLE: notion — org-researcher has no tool for this session's Notion connector; the digest is the run's own reading of the story, the epic row and the build timeline row, by fetch (the Query Data Source quota was used up)]

## Story (ST-83, Status Planning, 8 points, High)
- User story: a visitor signs in with Apple or Google so they need no other password.
- Build brief (2026-10-03) wins: OpenID Connect per provider; sign in to a matching identity, link to an account with the same verified e-mail, or create a **driver** account. Garages sign up through the listing form (criterion 4 superseded 2026-10-03).
- Depends on ST-79 (accounts), ST-82 (sessions and landing), ST-80 (`createAccount`), ST-132 (terms tick for a new account).
- Proposed details: link on a verified e-mail only; pop-up on a computer, redirect on a phone; Apple's name stored the first time; the error text "Nu am putut contacta Google. Încearcă din nou sau intră cu e-mail sau telefon."; codes `provider_failed`, `provider_cancelled`, `consent_required`, `maintenance`; nobody notified.
- Screens: the two buttons below "sau" in the Sign in dialog and the mobile sheet; the terms step is not designed.
- Tests: Jest with mocked providers; Playwright Google against a stub OpenID provider "on staging" *(proposed)*.
- Out of scope: removing a method or adding a password (ST-84); garage accounts.

## Constraints
- Owner's dispatch (2026-10-05): Google keys `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` set on Railway's `api` service in staging and production; Apple none yet, built fully and hidden while unset; never call the real providers in tests; never read secret values.
- Rule 17 of the feature brief (via ST-132): every path that creates an account passes the consent through `createAccount`.
- The browser reaches the API through the web's edge (`/api/` proxy), so the provider's return address is on the web origin: staging https://web-staging-dd20.up.railway.app, production https://web-production-8be52.up.railway.app (`PUBLIC_WEB_URL`).

## Contradictions
- The brief proposes the e2e run "on staging"; staging holds the real Google keys, and the dispatch forbids calling the real provider in tests. Resolved in the spec: the stub runs beside the local servers.
- Criterion 4 (kind chosen by the switch) vs the brief (driver only): the brief and its 2026-10-03 note win.

## Proposed Clarifications
- Pop-up vs redirect (the brief marks it proposed).
- How the web learns which providers are configured.
