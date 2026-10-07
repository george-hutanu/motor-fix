# Feature Context: impossible day in level_at, parity between the two readers

- **Feature**: 784-impossible-level-date
- **Anchor**: ST-784 (Tech debt, from ST-775) — https://app.notion.com/p/3f2607bff0d28171bff8cc31c7d100e8
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature n/a (tech debt, no feature page) | epic relation only (Foundations, page and siblings not read) | architecture not read (internal harness) | decisions not read (harness-only; no decision page expected)
- **Overall confidence**: high

## Story

- **ST-784** "Tech debt (ST-775): a day the month does not have fits LEVEL_AT and Date.parse rolls it forward (2026-02-30T00:00Z read…" — status Planning, priority Medium, role System, issue type Tech debt, epic Foundations (https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), PR #191. Page last edited 2026-10-07T07:58Z.
- Scope per the story: "a day the month does not have fits `LEVEL_AT` and `Date.parse` rolls it forward (`2026-02-30T00:00Z` reads as 2 March), while Python's `fromisoformat` refuses it, so the two readers disagree; refuse it in `pendingLevel` by checking the parsed UTC date against the written fields (offset applied) or the written year/month/day against the calendar. Nothing writes such a stamp today."
- Body: severity medium; where `.claude/scripts/lib/feature.mjs:157`; found by review; from ST-775 (PR #184).
- Comments that moved scope: none. ST-784 has no comments (resolved and block-level included).

## Decisions

- Refuse the impossible day in `pendingLevel` (JS reader); two checks are offered and the story leaves the choice open: parsed UTC date against the written fields (offset applied), or written year/month/day against the calendar. — [ST-784, Finding] (2026-10-07, confidence: high)
- Parity means the same level-or-none at the same moment; the Python reader still returns no remaining time. — [ST-775 finish comment, bot] (2026-10-07, confidence: high)
- The hour limit `([01]\d|2[0-3])` already landed in both regexes via ST-775. — [ST-775 finish comment] (2026-10-07, confidence: high)

## Constraints

- Python already refuses an impossible day, so the change is in `.claude/scripts/lib/feature.mjs` `pendingLevel`; the parity specs must hold both readers. — [ST-784, Finding] (2026-10-07, confidence: high)
- ST-775 put its hour-24 parity cases in `level.adversary.spec.mjs` at a fixed moment, because `level.spec.mjs`'s Python table stamps from the current time; new cases follow that. — [ST-775 finish comment, Decisions] (2026-10-07, confidence: medium)
- Only a hand-edited file can reach this: "Nothing writes such a stamp today." — [ST-784, Finding] (2026-10-07, confidence: high)

## Prior Art

- ST-775 (PR #184, Implementing at last read): the hour-24 parity fix; it filed ST-784 as the deferred day-of-month follow-up. — [ST-775] (2026-10-07)
- ST-677 (Done, PR #167): zone-less `level_at` refused in both readers; introduced the shared `LEVEL_AT` shape. — [ST-775 context, reference] (2026-10-06)

## Open Decisions

- none found

## Contradictions with spec.md

- none. spec.md (2026-10-07) matches the story: it refuses impossible days in the JS reader, keeps Python unchanged, and says the task holds the finding and no comment. It decides the story's open choice (written fields, never the instant), which the story permits.

## Proposed Clarifications (this command's proposals, not requirements)

- none. The spec's choice of "written calendar fields decide" is one of the story's two named options.

## Gaps

- ST-775's finish comment lists an open harness question, not in ST-784's scope: `artifact-lint` reports `delta-adds-existing` on a feature after its Spec Delta is merged; worth a separate follow-up if it recurs here.
- Epic Foundations not read; its siblings and release were not checked. No architecture or decision page covers the `feature.json` level stamp.

## Sources

- ST-784 (anchor, no comments) — https://app.notion.com/p/3f2607bff0d28171bff8cc31c7d100e8
- ST-775 (parent story; one bot finish comment, 2026-10-07T06:29Z) — https://app.notion.com/p/3f1607bff0d281fb915bc842545c4624
- Epic Foundations (relation only) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
