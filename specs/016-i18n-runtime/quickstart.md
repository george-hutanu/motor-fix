# Quickstart: 016-i18n-runtime

## Checks and unit tests

```bash
npx jest -c libs/i18n/jest.config.cts      # runtime, plurals, fallbacks, file + template checks
npx jest -c apps/web/jest.config.cts       # skeleton page in Romanian, switch to English in place
```

Expected: all green. To see the checks bite, add `<p>Salut</p>` to a template,
or delete a key from `libs/i18n/src/shell/en.json`, and rerun the first line:
it fails naming the file and the text or key.

## Server-rendered page

```bash
npx nx e2e web-e2e      # needs DATABASE_URL / REDIS_URL from .env.example
```

Expected: `/` arrives with `<html lang="ro">` and Romanian texts.

## Separate chunks per area

```bash
npx nx build web && ls dist/apps/web/browser/*.js
```

Expected: one small chunk per area file besides the shell's Romanian
(inlined in main).
