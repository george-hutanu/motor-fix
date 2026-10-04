# Feature Context: Switch the interface between Romanian and English

- **Feature**: 017-language-switch
- **Anchor**: ST-17 Switch the interface between Romanian and English — https://app.notion.com/p/3ee607bff0d28131b3c1e5856c0e50bf
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture not read (no architecture change: front end only, no table, no flow) | decisions via epic page
- **Overall confidence**: high
- **How gathered**: the `org-researcher` subagent had no Notion tools in this session (its tool list names other connector ids) and wrote an UNAVAILABLE stub. The main session read the same pages with its own Notion connector, read-only, and wrote this digest. Nothing was written to Notion by this phase.

## Story

- **ST-17 Switch the interface between Romanian and English** — status To do (moved to In progress by the start sync), priority Highest, role Visitor, epic Foundations (EP-1), feature Romanian and English interface (MF-1), 3 points.
- Scope per the story's Build brief (2026-10-03): the RO / EN switch in the header of every screen; changes the whole interface at once; remembered on the device (`mf.lang`, proposed); every open tab follows through the storage event; for a signed-in person also saved on the account through ST-20. Scenarios 1–7 (6 and 7 proposed). Unit tests: default Romanian, stored choice applied, blocked storage → Romanian, account language wins at sign-in. E2E: two tabs on Home, switch in one, both English; reopen, still English.
- Comments that moved scope: none (no discussions on the page).

## Decisions

- Romanian is the default whatever the browser's language — [MF-1 feature, Build brief › Final rules 1] (2026-10-03, high)
- The language source order is: account (signed in), address prefix (public page), device's stored choice, then Romanian *(proposed order)* — [MF-1, Build brief › States and lifecycle] (2026-10-03, medium)
- Where the epic Build plan and the older execution plan disagree, the Build plan holds; each story's Build brief is the source of what to build — [EP-1, Build plan callout] (2026-10-03, high)
- ST-20 (account language) is built together with ST-195 (templates) in slice 5 — [EP-1, Build plan › Slice 5] (2026-10-03, high)

## Constraints

- `ACCOUNT.language` writes and `PATCH /api/v1/me` are ST-20's scope; ST-20 "Saving the language fails: the interface still switches" *(proposed)* — [ST-20 Build brief] (2026-10-03, high)
- The `/ro/` `/en/` prefixes, and switching the address without a reload, are ST-21's — [ST-21 Build brief, scenario 7] (2026-10-03, high)
- PrimeNG's SelectButton is named in MF-1 "For the build team"; AGENTS.md excludes PrimeNG — [MF-1, For the build team › PrimeNG components] (2026-10-03, high)
- Long strings must not break layouts at 320 px — [MF-1, States and edge cases] (2026-10-03, medium)

## Prior Art

- ST-16 runtime (`I18n.use`, `language` signal, `<html lang>`) merged on main (202c88e) — repo, not Notion.
- The mock: switch works on every screen; choice saved in the browser and synchronised between screens — [MF-1, Where it stands › In the mock today] (2026-10-03)

## Open Decisions

- Account-wins-at-sign-in is *(proposed)* — blocks: User Story 4 (built as proposed; overrulable).
- `mf.lang` storage name is *(proposed)* — blocks: FR-005 (built as proposed).

## Contradictions with spec.md

- none found. spec.md (2026-10-04) is newer than every Notion source read (2026-10-03).

## Proposed Clarifications (this command's proposals, not requirements)

- Should a signed-out visitor's switch also be saved when they later sign up? — from MF-1 Edge cases ("A visitor chose EN, then signs up … the new account is in English"); that is account creation (ST-80 / ST-20), not this story.

## Gaps

- none

## Sources

- ST-17 — https://app.notion.com/p/3ee607bff0d28131b3c1e5856c0e50bf
- MF-1 Romanian and English interface — https://app.notion.com/p/3ee607bff0d281618e30f8787e2c3dd3
- EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- ST-20 Keep my language on my account for messages — https://app.notion.com/p/3ee607bff0d281c186c2d53b64b7b117
- ST-21 Give each language its own web address — https://app.notion.com/p/3ee607bff0d281bbaa1de24ea602b2a2
