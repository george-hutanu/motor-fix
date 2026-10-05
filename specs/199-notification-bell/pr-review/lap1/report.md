**Agent review: success** — PR #80 at `388a418`, lap 1

Blocking: 0 (blocker 0, high 0) · medium 2 · low 3. Booted: postgres, redis, minio, api, web, worker.
- Called changed endpoints: /api/v1/notifications, /api/v1/notifications/unread-count.
- Unit and end-to-end tests left to CI (Unit tests and E2E tests; the merge gate waits for them).
- Flows (signed in, seeded accounts): API contract of all four bell endpoints (401, paging 20+5, 90-day and channel filter, ro/en texts, generic text, 400 invalid_cursor, 404 for another person, first read time kept, read-all scoped); in a browser the 9+ badge and its accessible name, the list, Mai multe, tap to read, mark all read, a second tab following a read, reload, a live test message toast within 2 s and badge, English, error with Reîncearcă, three loading skeletons, the 60-second refresh with no live event, refresh on open, the empty state, and the bell on the garage, mechanic and admin dashboards.
- Signed-in /app/driver walked at desktop, tablet, 390 and 320 px x light/dark x ro/en, bell closed and open: no sideways scroll, badge inside the screen, no axe violations, no uncaught errors (52 flow screenshots).
- Run from the 199-notification-bell checkout copy of .claude/scripts/pr-test (byte-identical to main): the main checkout has no node_modules, so the sweep could not load Playwright. Visitor /app/driver was left out of the sweep, because it shows the unchanged sign-in gate, whose expected refresh 401 the sweep counts as a console error.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | medium | A tab's own read collapses the list back to page 1 (rows loaded with 'Mai multe' vanish on every tap) |  | The list drops back to 20 rows and the tapped page-2 row disappears; reading older notifications needs 'Mai multe' again after every tap. Asserted by bell.spec.ts 'starts the list again from the top on a read elsewhere' and noted (kept) in auto-run.md's re-review. Fix: ignore the echo of this tab's own read (e.g. skip refresh when the event id is a row this store just read, or when the account id matches a read-all it just made) or merge the refreshed first page as `merge()` does. |
| 2 | medium | notification.read is published outside the transaction that saved read_at (Constitution VI), by the same exception notification.created takes |  | Not marked high: main already publishes live nudges the same way (notifications.service.ts:486, preferences.service.ts:239, email-confirmation.service.ts:262), a lost nudge costs at most a 60-second-stale badge, and the spec-reviewer's MEDIUM on this was recorded for the owner. It is still a literal breach: the owner should either amend VI to exempt live UI nudges or route them through the outbox. |
| 3 | low | Marking a row read returns its text in the account's language, not the screen's |  | That one row switches language (FR-002 asks for the requested language). Not reproduced in the run, because the switch saves the account language; it follows from the code. Fix: keep the shown text on read, or accept ?language= on the read call. |
| 4 | low | OpenAPI does not document the 400s the list and read endpoints answer |  | Run confirmed all three 400s, but apps/api/openapi.json lists only 200 for the list and 200/404 for read; no @ApiBadRequestResponse. |
| 5 | low | On desktop the bell's badge sits about 2 px from the window edge |  | shots/flow-bell-closed-desktop-dark-ro.png: the 9+ badge ends at about 1438 of 1440 px. The 6 px margin keeps it inside the window, but the header runs flush to the edge with no gutter, unlike the 16 px left gutter. |

### Reproduction
1. Driver with 25+ bell rows opens the bell and taps 'Mai multe' (25 rows shown) → Tap any unread row, e.g. one on page 2 → POST /:id/read publishes notification.read to account:{id}, which this same tab also receives → bell.ts:45 `if (message.kind === 'notification.read') void this.refresh();` -> refresh() does `this.items.set(page.items)` with the first page only
2. read(): updateMany(readAt) commits, then `await this.announce(...)` publishes straight to Redis → Constitution VI: 'An event is never published outside the transaction that saved its change.'
3. Screen language differs from the saved account language (e.g. chosen by the address, or before the account save lands) → Open the bell (rows come back in the screen language via ?language=) → Tap a row: bell.ts replaces the row with the POST /:id/read response, rendered with `this.language(accountId)`
4. GET /api/v1/notifications?cursor=<someone else's id> -> 400 invalid_cursor (spec edge case) → GET ?language=fr and POST /not-a-uuid/read -> 400 validation_failed
5. Sign in as the driver with 10+ unread → Open /app/driver at 1440x900

Screenshots: 32, one per route × viewport × scheme × language.
