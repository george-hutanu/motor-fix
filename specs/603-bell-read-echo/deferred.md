# Deferred findings: 603-bell-read-echo

Findings a review verified but deliberately did not act on in this feature.

- [ ] `apps/web/src/app/dashboard/bell.ts:105` — **medium** — pre-existing: the server announces a read before it answers, so this tab's echo reloads the already-lowered unread count while `read()` is still waiting, and `read()` then lowers the count by one again; the bell's badge shows one unread fewer than there are until the next minute's refresh (code-reviewer, 2026-10-05)
- [ ] `apps/web/src/app/dashboard/bell.ts:158` — **low** — pre-existing: two first-page reloads in quick succession (a read and a new notification, or two reads) are merged in the order their answers land, so an older answer arriving last can show a row as unread again until the next reload (code-reviewer, 2026-10-05)
