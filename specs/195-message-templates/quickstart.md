# Quickstart: validate message templates

1. Unit (no services): `scripts/heavy.sh npx jest -c libs/domain/jest.config.cts libs/domain/src/notifications/templat` — the renderer, the formats (scenarios 3 and 4 of the Build brief) and the check (real templates pass, each fixture fails with its rule).
2. Integration: `docker compose up -d`, then `scripts/heavy.sh env JEST_SUITE=integration npx jest -c libs/domain/jest.config.cts notifications.processor` — the test message to an `en` and an `ro` account reaches the Brevo mock with subject, text and HTML parts in that language; a row missing a template value is `failed` / `template_failed` and Brevo is not called.
3. Break a rule on purpose (e.g. delete the English e-mail of `templates/test-message.ts`) and run step 1: the check names the template, channel and language.
