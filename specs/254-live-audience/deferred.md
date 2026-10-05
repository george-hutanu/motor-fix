# Deferred — 254-live-audience

- [ ] LOW the garage-access cache in LiveHub keeps an expired entry until that garage is read again or reread on an event; nothing sweeps it, so it grows with the number of distinct garages whose staff ever connected to one API copy — delete an entry when it is found expired, or sweep on a timer, once garage counts are known — libs/domain/src/events/live.hub.ts:131 (code-reviewer #4, 2026-10-05)
