**Agent review: failure** — PR #80 at `b54ed60`, lap 4

Blocking: 3 (blocker 0, high 3) · medium 0 · low 0. Booted: postgres, redis, minio, api, web, worker.
- Called changed endpoints: /api/v1/notifications, /api/v1/notifications/unread-count.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | high | The bell or its list survives the revoke (revoked-small-phone) |  | shots/flow-revoked-small-phone-tab1.png |
| 2 | high | The bell or its list survives the revoke (revoked-desktop) |  | shots/flow-revoked-desktop-tab1.png |
| 3 | high | The bell's list stays open over the public home page after the session is revoked, still showing the signed-out account's notifications |  | Seen at both viewports in lap 4 at b54ed60: shots/flow-revoked-desktop-tab1.png (drawer with 'Mesaj de test: notificările funcționează.', unread mark and 'Marchează tot ca citit' over the home page), shots/flow-revoked-small-phone-tab1.png (bottom sheet over the home page). Overlays.open() leaves closing to CDK, which closes on a history change (popstate) but not on Router.navigateByUrl, so the overlay outlives the Frame and its Bell. This is not caused by the merge: revoked() was already in frame.ts at 357a8b6, and lap 3 did not cover this path. Fix (test first): close the bell's list when the session ends or the Frame is destroyed (e.g. BellList or Bell closes its ref when Session.current() becomes null, or in a DestroyRef callback). frame.ts:212-216 (session.ended: signed out in another tab) navigates the same way and may show the same thing; that path was not tested here. |

### Reproduction
1. revoke while the bell list is open
2. revoke while the bell list is open
3. Sign in as sofer2@example.test on /app/driver (320 px phone or 1440 px desktop) → Admin sends a test notification; tap the bell so the list (drawer / bottom sheet) is open → In a second tab of the same browser, complete a password reset for the same account (session.revoked) → Tab 1 leaves /app/driver for / as ST-127 intends, but the 'Notificări' drawer stays open on top of the public page with the previous account's rows and 'Marchează tot ca citit'

Screenshots: 32, one per route × viewport × scheme × language.
