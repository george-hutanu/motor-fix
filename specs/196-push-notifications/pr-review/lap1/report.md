**Agent review: failure** — PR #119 at `4ba7c79`, lap 1

Blocking: 16 (blocker 3, high 13) · medium 1 · low 2. Booted: postgres, redis, minio, api, web, worker.
- Ran on GitHub Actions (https://github.com/george-hutanu/motor-fix/actions/runs/37416836901): PostgreSQL with PostGIS, Redis and MinIO from the PR's own compose file, started by the PR QA workflow.
- Called the changed operations: GET /api/v1/push-subscriptions/key → 200; POST /api/v1/push-subscriptions → 400; POST /api/v1/push-subscriptions/test → 202.
- Not called: DELETE /api/v1/push-subscriptions/{id}: GET /api/v1/push-subscriptions answered 404, so there is no {id} to call it with.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | blocker | Page did not load: page.goto: Timeout 30000ms exceeded. | /app/driver/settings@driver · desktop · light · ro (+15 more) | shots/app-driver-settings-as-driver-desktop-light-ro.png |
| 2 | blocker | Page did not load: page.goto: Timeout 30000ms exceeded. | /app/admin/settings@admin · desktop · light · ro (+15 more) | shots/app-admin-settings-as-admin-desktop-light-ro.png |
| 3 | blocker | Page did not load: page.goto: Timeout 30000ms exceeded. | /app/garage@garage · desktop · light · ro (+15 more) | shots/app-garage-as-garage-desktop-light-ro.png |
| 4 | high | push panel flow failed on /app/driver/settings (ro) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 5 | high | push panel flow failed on /app/driver/settings (ro) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 6 | high | push panel flow failed on /app/driver/settings (en) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 7 | high | push panel flow failed on /app/driver/settings (en) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 8 | high | push panel flow failed on /app/admin/settings (ro) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 9 | high | push panel flow failed on /app/admin/settings (ro) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 10 | high | push panel flow failed on /app/admin/settings (en) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 11 | high | push panel flow failed on /app/admin/settings (en) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 12 | high | push panel flow failed on /app/garage (ro) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 13 | high | push panel flow failed on /app/garage (ro) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 14 | high | push panel flow failed on /app/garage (en) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 15 | high | push panel flow failed on /app/garage (en) |  | TimeoutError: page.waitForLoadState: Timeout 30000ms exceeded. |
| 16 | high | flow not run: turn on notifications, send a test, turn off, sign out forgets the device |  | .specify/.cache/qa-flows-119.mjs: const buttons = await page.getByRole('button', { name: enable[lang] }).count(); |
| 17 | medium | not swept: /app/driver/settings@driver, /app/admin/settings@admin, /app/garage@garage (the push panel was never seen in a browser) |  | apps/web/src/app/dashboard/live.ts:212: const res = await fetch('/api/v1/live', { |
| 18 | low | Sign-out waits on an unbounded API call although forget() says it never holds the sign-out back |  | apps/web/src/app/dashboard/push-device.ts:723: // messages. Never throws, never holds the sign-out back. |
| 19 | low | Push failure classified by matching the error message text |  | libs/domain/src/notifications/push.ts:3913: return /subscription\|key\|auth\|vapid/i.test(message) ? 'refused' : 'retry'; |

### Reproduction
1. Open /app/driver/settings@driver at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: Page did not load: page.goto: Timeout 30000ms exceeded..
2. Open /app/admin/settings@admin at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: Page did not load: page.goto: Timeout 30000ms exceeded..
3. Open /app/garage@garage at the desktop viewport (1440×900), light colour scheme, language ro. → Wait for the network to go idle. → Observe: Page did not load: page.goto: Timeout 30000ms exceeded..
4. sign in as driver → language ro → server has no VAPID key → open /app/driver/settings at 320 px
5. sign in as driver → language ro → server offers a VAPID key → open /app/driver/settings at 320 px
6. sign in as driver → language en → server has no VAPID key → open /app/driver/settings at 320 px
7. sign in as driver → language en → server offers a VAPID key → open /app/driver/settings at 320 px
8. sign in as admin → language ro → server has no VAPID key → open /app/admin/settings at 320 px
9. sign in as admin → language ro → server offers a VAPID key → open /app/admin/settings at 320 px
10. sign in as admin → language en → server has no VAPID key → open /app/admin/settings at 320 px
11. sign in as admin → language en → server offers a VAPID key → open /app/admin/settings at 320 px
12. sign in as garage → language ro → server has no VAPID key → open /app/garage at 320 px
13. sign in as garage → language ro → server offers a VAPID key → open /app/garage at 320 px
14. sign in as garage → language en → server has no VAPID key → open /app/garage at 320 px
15. sign in as garage → language en → server offers a VAPID key → open /app/garage at 320 px
16. The flows file only checks the heading and the count of turn-on buttons; it never taps Turn on, Send a test notification, Turn off, or signs out with push on. → Drive it next lap: context.grantPermissions(['notifications']), stub /api/v1/push-subscriptions/key with a real VAPID key, tap Turn on and expect POST /push-subscriptions, the on state and the two buttons; tap the test (toast), Turn off (DELETE, back to off); sign out with push on and expect the DELETE before the sign-out.
17. Open any dashboard route with a real session in the sweep or the flows (page.goto waitUntil networkidle, or waitForLoadState('networkidle')). → The frame keeps the /api/v1/live event stream open, so the network never goes idle and every load times out after 30 s. → Next lap: in the flows wait for the panel heading (goto with waitUntil 'domcontentloaded', then expect the heading) instead of networkidle; the sweep's networkidle on signed-in dashboards is a tester issue on main. web-e2e passes only because signInAs stubs the token, so /live fails at once.
18. frame.ts awaits this.push.forget() before closing the live stream and signing out; forget awaits DELETE /push-subscriptions/:id with no timeout. → A slow or hanging API holds the sign-out button for as long as the request lasts. Bound it (race with a short timeout) or do not await it.
19. A non-WebPushError is 'refused' (final, no retry) when its message matches /subscription\|key\|auth\|vapid/; a network error whose text happens to contain 'key' or 'auth' would not be retried (FR-010).

Screenshots: 32, one per route × viewport × scheme × language.
