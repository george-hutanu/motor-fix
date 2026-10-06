# Quickstart: Offline message on the service worker's 504

Everything is proved by the overlays library's Jest specs under jsdom, with
`navigator.onLine` stubbed; no server, browser or service worker is needed.

## Prerequisites

- Node ≥ 24 (`package.json` engines), `npm ci` done once.

## Run

```sh
scripts/heavy.sh npx jest libs/overlays/src/form.spec.ts libs/overlays/src/form.adversary.spec.ts > /tmp/overlays.log 2>&1; echo "exit $?"; tail -n 20 /tmp/overlays.log
```

Expected: exit 0; both suites pass, including the new cases in
`describe('toProblem')`:

| Scenario (spec) | What the test reads |
| --- | --- |
| US1-1 offline, 504, body `null` / `''` / `'<html></html>'` / `{ code: '' }` | `{ code: 'offline', status: 504 }` |
| US1-2 offline, status 0 | `{ code: 'offline', status: 0 }` (existing case, unchanged) |
| US1-3 online, status 0 | `{ code: 'network', status: 0 }` (existing case, unchanged) |
| US2-1 online, 504, no body | `{ code: 'internal_error', status: 504 }` |
| US2-2 offline, 504, `{ code: 'token_expired' }` | `{ code: 'token_expired', status: 504 }` |
| US2-3 offline, 500, no body | `internal_error` (adversary case, title renamed, assertion kept) |

Before the implementation (`/speckit-tests`), the US1-1 cases fail and every
other case passes; after it, all pass.

Then, as the pre-commit hook does:

```sh
npx biome check libs/overlays/src/form.ts libs/overlays/src/form.spec.ts libs/overlays/src/form.adversary.spec.ts
scripts/heavy.sh npx nx run overlays:typecheck
```

Expected: no Biome finding; `ngc` and `tsc` exit 0.

## Seeing it in the app (optional, not a gate)

Build and serve the production web app (`scripts/heavy.sh npx nx build web`,
then serve `dist/apps/web/browser` so `ngsw-worker.js` registers), open a
task form, switch the browser's devtools network to Offline, save: the form
shows "Nu ești conectat. Încearcă din nou când revine conexiunea." and keeps
the typed values. Before the change it shows "Ceva nu a mers la noi".
