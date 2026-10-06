# Design check — 563-expired-token-sweep

No screens: ST-563 adds an expired-token case to the API's route sweep
(`apps/api/src/public-routes.integration.spec.ts`). It is test-only work and
touches no screen, no board in the clickable mock and no Screens section of a
Build brief, so there is nothing to compare against the design. The refusal it
proves (`401 sign_in_required`) is the one the web app already answers with
the sign-in dialog; that screen is unchanged.
