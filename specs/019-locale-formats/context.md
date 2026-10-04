# Feature Context: Prices, numbers and dates in the format of my language

- **Feature**: 019-locale-formats
- **Anchor**: ST-19 See prices, numbers and dates in the format of my language — https://app.notion.com/p/3ee607bff0d28180a6a4e24b1d161a9b
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok (Technology stack) | decisions not read (no finding needed one)
- **Overall confidence**: high

Read by the main run, read-only Notion tools only: the `org-researcher`
subagent's tool list did not include this session's Notion connector, so it
returned `[UNAVAILABLE: notion]` and wrote no findings (logged in auto-run.md).

## Story

- **ST-19** — status To do (set to In progress by this run), priority High, role Visitor, epic EP-1 Foundations, 3 points, label front end.
- Scope per the story's Build brief (2026-10-03): shared format pipes in `libs/i18n` for money, numbers, ratings, distances, dates and times in RO and EN; the date picker locale; an instant change on language switch. Eight acceptance scenarios (1.400 / 1,400 lei; 4,9 / 4.9; 9 mart. 2026 / 9 Mar 2026; 800–1.200 lei; 14:30 Bucharest; 2,5 km; picker names, Monday first; instant switch).
- Comments that moved scope: none (page has no discussions).

## Decisions

- The date picker is Spartan's, localised with the Angular locale data — [Technology stack, Front end › Two languages] (2026-10-04, confidence: high)
  - superseded: "the PrimeNG locale for the date picker" — [ST-19 Build brief, Scope] (2026-10-03); and "PrimeNG locale settings for the date picker" — [Romanian and English interface, For the build team] (2026-10-03)
- Components are Spartan UI (brain + helm in `libs/ui-cockpit`), not PrimeNG — [Technology stack, Front end › Components] (2026-10-04, high)
- "Dates, numbers and lei use the Angular locale of the chosen language" — [Technology stack, Two languages] (2026-10-04; row status Proposed, confidence: medium)
- Formats follow the language; times on a 24-hour clock (proposed), always Europe/Bucharest; "lei" in both languages — [Romanian and English interface, Build brief › Final rules 6] (2026-10-03, high)

## Constraints

- ST-52 (lamp, dial, odometer digits) needs ST-19: odometer "output in lei with no decimals, in the language's format (ST-19). A range shows as from–to with an en dash" — [Build the shared indicator lamp, rating dial and odometer digits] (2026-10-03, high)
- Server-side formats in e-mails are ST-195's, "the same rules on the server" (proposed) — [ST-19 Build brief, Out of scope] (2026-10-03, high)
- EP-1 Slice 2 is shown as "the themed shell in Romanian and English … with prices and dates in each language's format" — [Foundations, Build plan › Story order] (2026-10-03, medium)

## Prior Art

- ST-16 (translation runtime, `libs/i18n`, `I18n.language()` signal, impure `t` pipe) — merged on main (PR #4).
- ST-17 (RO / EN switch) — in progress in parallel; not on main.
- The mock (DashClient board) already writes the months as `ian. … mart. … sept.` and `Jan … Sep`, and numbers with "." / "," grouping — see design.md.

## Open Decisions

- none found that block this story.

## Contradictions with spec.md

- **spec.md** (2026-10-04): "The Build brief names the PrimeNG locale; no front-end component library is installed on `main`, so nothing library-specific is added here." — **Notion**: the picker is Spartan's, localised with the Angular locale data [Technology stack] (2026-10-04) — newer: same date. Spec's outcome holds (no picker is installed), but its reason should cite Spartan, not PrimeNG.
- **spec.md**: formats built on the browser's Intl with fixed month tables — **Notion**: "use the Angular locale of the chosen language" (Proposed) [Technology stack] (2026-10-04). Angular's `ro` locale data writes March "mar." and `en-GB` September "Sept", contradicting the AC ("mart.") and the mock ("Sep"); the AC and mock still need overrides either way.
- **Sibling wording**: ST-74-area review story writes a range "3.800 – 4.400 lei" (spaced, proposed wording) — ST-19 brief: "800–1.200 lei" (no spaces). [See reviews and the rating breakdown on a garage profile] (2026-10-03) — same date; ST-19 owns formats.

## Proposed Clarifications (this command's proposals, not requirements)

- Angular locale data (`registerLocaleData` + `formatNumber`/`formatDate`) or Intl with ro-RO / en-GB? — from the Technology stack row (Proposed) vs the Build brief rule (proposed). 
- Should the Spartan date picker's names come from the calendar names this story exposes? — from the 2026-10-04 decision.
- Range spacing: "800–1.200 lei" (ST-19) wins over "3.800 – 4.400 lei" (sibling wording)?

## Gaps

- No board shows a date picker; its look and behaviour are not designed.

## Sources

- ST-19 story — https://app.notion.com/p/3ee607bff0d28180a6a4e24b1d161a9b
- EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Romanian and English interface — https://app.notion.com/p/3ee607bff0d281618e30f8787e2c3dd3
- Technology stack — https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2
- Build the shared indicator lamp, rating dial and odometer digits — https://app.notion.com/p/3ee607bff0d281e4a0d7e24116a9b9fc
- See reviews and the rating breakdown on a garage profile — https://app.notion.com/p/3ee607bff0d28126a334c745825629bf

## Refresh 2026-10-04

No changes since 2026-10-04 (morning read). The story's and its timeline row's last edit (07:05) is this run's own status write; the feature page (2026-10-03 18:45) and Technology stack (05:56) are unchanged since they were read. No comments.
