# Feature Context: The shared indicator lamp, rating dial and odometer digits

- **Feature**: 051-cockpit-gauges
- **Anchor**: ST-51 Build the shared indicator lamp, rating dial and odometer digits — https://app.notion.com/p/3ee607bff0d281e4a0d7e24116a9b9fc
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture not needed (no data, API or security surface) | decisions not needed (no open decision touches the parts)
- **Overall confidence**: high

Note: the `org-researcher` subagent reported `[UNAVAILABLE: notion]` (its tool list names a different connector id than this session's), so the pages below were read by the run itself with read-only calls (fetch), and this digest written by hand under the same rules.

## Story

- **ST-51 Build the shared indicator lamp, rating dial and odometer digits** — status To do at read (set In progress by notion-sync), priority High, role System, epic EP-1 Foundations, 5 points.
- Scope per the story: the lamp (four states, always a label), the rating dial (0–5, amber arc, rating in the middle, large and small), the odometer digits for prices; each in both themes and both languages, with a catalogue page *(proposed `/dev/ui`)*. Build brief scenarios 1–9 quoted in spec.md.
- Comments that moved scope: none (no discussions on the page).

## Decisions

- Lamp meanings: green works on this brand / in order / on time; red does not take this brand / problem; amber needs attention; grey neutral or off; a lamp always has a label — [MF-3 Cockpit design system and motion, Build brief › States and lifecycle] (2026-10-04, confidence: high)
- Contrast WCAG 2.2 AA: 4.5:1 for text, 3:1 for lamps, icons and focus rings *(proposed measure)* — [MF-3, Build brief › Final rules 9] (2026-10-04, confidence: high)
- "A rating of 0 or no reviews yet. The dial shows an empty arc and "—", never 0.0 *(proposed)*" — [MF-3, Build brief › Edge cases] (2026-10-04, confidence: high)
  - supersedes, for a rating of 0: ST-51 scenario 5 names only "no reviews yet" (2026-10-03)
- Odometer: input integer bani, output whole lei in the language's format (ST-19), range with an en dash, VAT included — [ST-51, Build brief › Rules and validation] (2026-10-03, confidence: high)
- Every colour, size, radius and spacing is a token; no one-off styling in feature code — [MF-3, Build brief › Final rules 1] (2026-10-04, confidence: high)

## Constraints

- Motion (dial arc and needle swing, lamp pulse "a lamp marked as pulsing", odometer roll, reduced motion) is ST-53's, which needs ST-51 first — [ST-53 See screens build up with motion, Build brief › Scope, Acceptance scenarios 2, 3, 6] (2026-10-03, confidence: high). ST-53 expects a lamp it can mark as pulsing and a dial whose arc and needle it can swing.
- Forced colours: lamps keep their labels and the dot gets a visible outline *(proposed)* — [MF-3, Build brief › Edge cases] (2026-10-04, confidence: medium)
- Anything tappable is at least 44 px; smallest text on a phone 12 px — [MF-3, Final rules 7–8] (2026-10-04, confidence: high)

## Prior Art

- ST-50 (Cockpit theme) merged: `--mf-*` tokens in `libs/ui-cockpit/src/styles/cockpit.css`, `/cockpit` sample page — [EP-1 Build plan, slice 2] (2026-10-03)
- ST-19 (formats) merged: `formatRating`, `formatLei`, `formatLeiRange` in `libs/i18n` — [EP-1 Build plan, slice 2] (2026-10-03)
- ST-52 (chart style) builds in `libs/ui-cockpit` in parallel — [EP-1 Build plan, slice 3] (2026-10-03)
- The mock already shows the large dial (Home), the small dial and lamps (Results) and the odometer (garage profile) — see design.md.

## Open Decisions

- none found

## Contradictions with spec.md

- **spec.md** (2026-10-04): FR-007 "A dial with no rating (no value, or a value that is not a finite number) MUST show an empty arc and "—"" — **Notion**: a rating of 0 also shows "—" [MF-3, Edge cases] (2026-10-04) — newer: same date; the feature page is the more specific statement → Proposed Clarification.
- **spec.md** (2026-10-04): Assumptions "The optional lamp pulse is left to ST-53 entirely, including any input that switches it on" — **Notion**: ST-53 scenario 3 "Given a lamp marked as pulsing" [ST-53] (2026-10-03) — newer: spec.md, but ST-53 needs a marker this story owns → Proposed Clarification.
- **spec.md** (2026-10-04): no needle on the dial — **Notion**: "The swing of the needle is ST-53" [ST-51 Rules], "the arc and needle swing" [ST-53 scenario 2] — the dial is expected to have a needle → Proposed Clarification.

## Proposed Clarifications (this command's proposals, not requirements)

- Should a rating of 0 show "—" like no reviews? — from the MF-3 edge case.
- Should the lamp take a "pulse" marker now (no animation), so ST-53 can animate it? — from ST-53 scenario 3.
- Should the large dial carry a static needle at the value, so ST-53 can swing it? — from ST-51 Rules and ST-53 scenario 2.

## Gaps

- none

## Sources

- ST-51 — https://app.notion.com/p/3ee607bff0d281e4a0d7e24116a9b9fc
- MF-3 Cockpit design system and motion — https://app.notion.com/p/3ee607bff0d2817aa8bdc2f304d558b2
- EP-1 Foundations — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- ST-53 See screens build up with motion — https://app.notion.com/p/3ee607bff0d281e6a52dd360e3cf1cda
