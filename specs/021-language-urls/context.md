# Feature Context: Give each language its own web address for search engines

- **Feature**: 021-language-urls
- **Anchor**: ST-21 — https://app.notion.com/p/3ee607bff0d281bbaa1de24ea602b2a2
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok (no comments) | feature MF-1 ok | epic EP-1 ok (Build plan) | architecture not read (no table, no flow, no module; Security page's cache times noted from the brief) | decisions via epic page
- **Overall confidence**: high
- **How gathered**: per the orchestrator, the `org-researcher` subagent cannot reach this session's Notion connector; the main session read the pages read-only and wrote this digest. Nothing was written to Notion by this phase.

## Story

- **ST-21** — Task, priority Medium, role System, epic Foundations (EP-1), feature MF-1, 5 points, labels front end + backend. Status To do (→ In progress by the start sync).
- Build brief (2026-10-03) scope: "a language prefix on every public address (`/ro/…`, `/en/…`), pages rendered on the server in the right language, the language links and canonical address for search engines, a sitemap, and the rules for what search engines may not index."
- Scenarios 1–9; tests: Jest for sitemap contents and noindex; Playwright fetching `/ro/` and `/en/` without JavaScript (lang, canonical, hreflang) and switching language "and see the address change without a reload".
- Comments that moved scope: none.

## Decisions

- Each story's Build brief is the source; the epic Build plan wins over the older execution plan — [EP-1 Build plan callout] (2026-10-03, high)
- ST-21 sits in slice 9: "the mechanism and the sitemap now, checked again when the public screens arrive in EP-4" — [EP-1 Build plan › Slice 9; Late items] (2026-10-03, high)
- Opening an `/en/` address directly: "English, and the choice is remembered *(proposed)*" — [MF-1 Build brief › Edge cases] (2026-10-03, medium)
- Language source order: account, address prefix, stored choice, Romanian *(proposed)* — [MF-1 › States and lifecycle] (2026-10-03, medium)
- The path after the prefix is the same in both languages *(proposed)* — [ST-21 › Rules] (2026-10-03, medium)

## Constraints

- `/` → 302 to `/ro/`, or `/en/` when the device remembers English *(proposed)* — [ST-21 scenario 2]; "A search engine opens `/`: it is sent to `/ro/`, the `x-default` language" — [MF-1 › Edge cases] (2026-10-03)
- Switching on a public page changes the address through the router, no reload, no extra history entry *(proposed)* — [ST-21 scenario 7]
- `x-default` is the Romanian address — [ST-21 scenario 3]
- Dashboards, confirmation, reset and invite links carry `noindex` and stay out of the sitemap — [ST-21 scenario 8]
- Unknown language prefix: 404 page in Romanian *(proposed)* — [ST-21 › States and errors]
- Reads GARAGE, MECHANIC, BRAND; writes nothing; sitemap cache dropped on garage/mechanic/verification events *(proposed)* — [ST-21 › Data, Live updates]

## Prior Art

- ST-16 runtime (`I18n.use`, `<html lang>`) and ST-17 switch (`LanguageChoice`, `mf.lang`, storage event) on main — repo, not Notion.
- 016-FR-011: server pages arrive in Romanian — `.specify/capabilities/i18n.md`.

## Open Decisions

- None open in Notion for this story ("Open: None").

## Contradictions with spec.md

- Brief scenario 2 / MF-1 edge case want a server 302 from `/` to `/ro/`; the spec renders `/` in Romanian on the server (canonical `/ro/`) and moves in the browser, because ST-17's remembered English must still apply when `/` is reopened and the server cannot read device storage. Recorded as an assumption in spec.md.

## Proposed Clarifications (this command's proposals, not requirements)

- A server-readable language cookie would allow the brief's 302 to `/en/` for a device that remembers English; not in any brief.

## Gaps

- GARAGE, MECHANIC, BRAND tables and the review rules / terms / privacy pages do not exist yet; the data-backed sitemap rules (scenarios 1, 4–6, 9) wait for EP-4.

## Sources

- ST-21 — https://app.notion.com/p/3ee607bff0d281bbaa1de24ea602b2a2
- MF-1 Romanian and English interface — https://app.notion.com/p/3ee607bff0d281618e30f8787e2c3dd3
- EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
