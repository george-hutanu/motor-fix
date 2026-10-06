**Agent review: failure** — PR #119 at `e690580`, lap 2

Blocking: 8 (blocker 0, high 8) · medium 3 · low 4. Booted: postgres, redis, minio, api, web, worker.
- Ran on GitHub Actions (https://github.com/george-hutanu/motor-fix/actions/runs/37421231007): PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow.
- Called the changed operations: GET /api/v1/push-subscriptions/key → 200; POST /api/v1/push-subscriptions → 400; POST /api/v1/push-subscriptions/test → 202.
- Not called: DELETE /api/v1/push-subscriptions/{id}: GET /api/v1/push-subscriptions answered 404, so there is no {id} to call it with.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | push panel heading missing on /app/driver/settings (en) |  | push-driver-en-nokey.png |
| 2 | high | push panel heading missing on /app/driver/settings (en) |  | push-driver-en-key.png |
| 3 | high | push panel heading missing on /app/admin/settings (en) |  | push-admin-en-nokey.png |
| 4 | high | push panel heading missing on /app/admin/settings (en) |  | push-admin-en-key.png |
| 5 | high | push panel heading missing on /app/garage (en) |  | push-garage-en-nokey.png |
| 6 | high | push panel heading missing on /app/garage (en) |  | push-garage-en-key.png |
| 7 | high | push turn-on/test/turn-off/sign-out flow failed (ro) |  | TimeoutError: locator.waitFor: Timeout 45000ms exceeded. Call log:   - waiting for getByRole('button', { name: 'Activează notificările' }) to be visible  push-flow-driver-ro.png |
| 8 | high | push turn-on/test/turn-off/sign-out flow failed (en) |  | TimeoutError: locator.waitFor: Timeout 45000ms exceeded. Call log:   - waiting for getByRole('button', { name: 'Turn on notifications' }) to be visible  push-flow-driver-en.png |
| 9 | medium | push panel shows no turn-on button with a server key on /app/driver/settings (ro) |  | push-driver-ro-key.png |
| 10 | medium | push panel shows no turn-on button with a server key on /app/admin/settings (ro) |  | push-admin-ro-key.png |
| 11 | medium | push panel shows no turn-on button with a server key on /app/garage (ro) |  | push-garage-ro-key.png |
| 12 | low | Push failure still classified by matching the error message text (lap 1 finding marked resolved, only partly fixed: coded network errors now retry, uncoded errors still go by regex) |  | libs/domain/src/notifications/push.ts:71: return /subscription\|key\|auth\|vapid/i.test(message) ? 'refused' : 'retry'; |
| 13 | low | Opening a push-panel page runs two refresh() calls at once (Frame.ngOnInit and PushPanel.ngOnInit); refresh does not guard against itself, so an on device is saved twice |  | apps/web/src/app/dashboard/push-device.ts:41: if (this.busy()) return; |
| 14 | low | web-push added as a caret range while the other runtime dependencies are pinned exactly |  | package.json:35: "web-push": "^3.6.7" |
| 15 | low | The English push panel has not been seen in a browser: the en shots render Romanian because the seeded account's language overrides mf.lang (the flows should tap EN) | /app/driver/settings@driver | shots/push-driver-en-key.png |

### Reproduction
1. sign in as driver → language en → server has no VAPID key → open /app/driver/settings at 320 px
2. sign in as driver → language en → server offers a VAPID key → open /app/driver/settings at 320 px
3. sign in as admin → language en → server has no VAPID key → open /app/admin/settings at 320 px
4. sign in as admin → language en → server offers a VAPID key → open /app/admin/settings at 320 px
5. sign in as garage → language en → server has no VAPID key → open /app/garage at 320 px
6. sign in as garage → language en → server offers a VAPID key → open /app/garage at 320 px
7. sign in as driver, server offers a VAPID key, notifications allowed → language ro, open /app/driver/settings at 1280 px → tap Turn on: POST /push-subscriptions, the on line and two buttons → tap Send a test notification: POST /push-subscriptions/test and the toast → tap Turn off: DELETE /push-subscriptions/<id>, back to the turn-on button → tap Turn on again, then Sign out: DELETE before the sign-out, then home
8. sign in as driver, server offers a VAPID key, notifications allowed → language en, open /app/driver/settings at 1280 px → tap Turn on: POST /push-subscriptions, the on line and two buttons → tap Send a test notification: POST /push-subscriptions/test and the toast → tap Turn off: DELETE /push-subscriptions/<id>, back to the turn-on button → tap Turn on again, then Sign out: DELETE before the sign-out, then home
9. sign in as driver → language ro → server offers a VAPID key → open /app/driver/settings at 320 px
10. sign in as admin → language ro → server offers a VAPID key → open /app/admin/settings at 320 px
11. sign in as garage → language ro → server offers a VAPID key → open /app/garage at 320 px
12. read pushResult/plainResult in push.ts → an uncoded Error whose message mentions 'key' or 'auth' is refused, any other is retried
13. push on in the browser → open /app/driver/settings → two POST /push-subscriptions go out (the server keeps one row)
14. read package.json dependencies
15. open the en screenshot → the panel and the shell are in Romanian

Screenshots: 32, one per route × viewport × scheme × language.
