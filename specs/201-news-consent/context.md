# Context: ST-201 news only with consent

Gathered: 2026-10-05 · Source: Notion only (MotorFix — Product documentation), read this session through the connector.

## Story
- ST-201 https://app.notion.com/p/3ee607bff0d2812eb821e9c31b7f0b23 — Driver, Medium, 3 points, labels front end, backend, legal. Build brief current as of 2026-10-03 (wins over the criteria above it).
- Depends on ST-197 (preference store), ST-194 (sending), ST-195 (templates): all merged.
- Needs a lawyer to review the consent text; Launch readiness signs off all legal texts.

## Timeline
- Foundations row https://app.notion.com/p/3ee607bff0d281868347eea0306104ef: lane D · Messaging, W5, blocked by three rows (all merged). Outside / open: "Before launch: operator company (S8) and the lawyer's review of the consent text."

## Constraints
- News by e-mail only, off by default, at most one a month (Europe/Bucharest), quiet hours 22:00–08:00 [X25].
- Unsubscribe token HMAC-signed, tied to one account, never expires *(proposed)*.
- Admin-only send `POST /api/v1/admin/news` *(proposed)*; others 404.
- Audit: consent given and withdrawn, each news send [27].

## Contradictions
- None between the story, the brief and the timeline.

## Proposed clarifications
- Error codes' case (the brief's upper case vs the API's lower snake case).
- Who hosts the consent dialog before ST-138 exists.

## Open
- Operator company not set up (S8): the consent text must name it. Lawyer review pending.
