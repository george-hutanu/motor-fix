# Bug Assessment: the sign-in gate specs open the gate on load on staging

- **Slug**: 935-gate-specs-push-key
- **Created**: 2026-10-08
- **Source**: pasted text (Chief's task) and release runs 37714431210, 37717491578
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

Release `End to end on staging` fails `apps/web-e2e/src/sign-in-gate.spec.ts`
(74/76, 106/108) and `sign-in-gate-frame.spec.ts` (77, 100-102) from the
release of 0d5780c (#257) on, still on 7d48f7b, so production is not
promoted. PR CI, which starts its own servers, passes.

## Symptom

On staging, `/app/driver` opens the sign-in gate on load, before the test taps
EN: `getByRole('button', { name: 'Ieși din cont' })` is not found (hidden
behind the modal) or the EN click is intercepted by
`cdk-overlay-backdrop spartan-dialog-overlay`. Expected: the dashboard shows,
and only the refused language save opens the gate.

## Reproduction

1. `BASE_URL=https://web-staging-dd20.up.railway.app scripts/heavy.sh npx playwright test -c apps/web-e2e/playwright.config.mts sign-in-gate --retries 0`
2. 7 of 7 fail; the snapshot shows the dialog "Autentificare" open over "Panoul tău".
3. A probe with the same stubs logs, on load: `GET /api/v1/push-subscriptions/key` → 401,
   then `POST /api/v1/auth/refresh` → 401 (the stub's second renewal), then the gate.

## Suspected Code Paths

- `apps/web/src/app/dashboard/frame.ts:314` — `void this.push.refresh();` runs on every dashboard load.
- `apps/web/src/app/dashboard/push-device.ts:52-64` — `if (support !== 'supported' || !this.sw?.isEnabled) {` … `this.key ??= (await this.api.pushSubscriptionsControllerKey()).publicKey;`
- `apps/web/src/app/app.config.ts:33` — `provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() })`: the service worker, and so the key read, exists only in a production build.
- `apps/web-e2e/src/sign-in-gate.spec.ts`, `sign-in-gate-frame.spec.ts` `sessionEndsWhileWorking` — stub refresh, live, unread count, sign-in and `/me`, not the push key.

## Root Cause Hypothesis

The specs mean "only the save may be refused" and stub every other call the
dashboard makes on load, but not the push key read. Against a production
build (staging) the service worker is on, so the read goes to the real API
with the stub token `before`, is refused with `sign_in_required`, the
interceptor renews, the stub refuses that second renewal, and the gate opens
before the test acts. The dev server that PR CI runs disables the service
worker, so CI never makes the call. Confidence: high for the mechanism
(reproduced deterministically against staging). The onset at 0d5780c is not
explained by its diff (only `apps/web/src/app/public/steps.ts` and the garage
listing); the key read dates from ST-196 (2026-10-05) and passed at df7099e,
so whether the gate won that race before is timing-dependent. Confidence on
the onset: low.

## Proposed Remediation

**Preferred**: stub `**/api/v1/push-subscriptions/key` in both specs'
`sessionEndsWhileWorking` (answer `{ publicKey: null }`, which the device reads
as "unavailable"), as the unread count is. The product behaviour is right: a
refused call with a refused renewal should ask to sign in.

**Alternatives**:
- Make the specs refuse only after the save (count by URL): larger change to two spec helpers, same result.
- Skip the push read until the session is confirmed: product change for a test's stub; rejected.

**Files likely to change**:
- `apps/web-e2e/src/sign-in-gate.spec.ts`
- `apps/web-e2e/src/sign-in-gate-frame.spec.ts`

**Tests to add or update**: the two specs themselves; red against staging
before the change, green after.

## Risks & Considerations

- None to the product. A future load-time call un-stubbed in these specs would fail the same way only on staging.

## Open Questions

- None.
