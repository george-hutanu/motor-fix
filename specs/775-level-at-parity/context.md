# Feature Context: level_at parity between the two readers

- **Feature**: 775-level-at-parity
- **Anchor**: ST-775 (Tech debt) — https://app.notion.com/p/3f1607bff0d281fb915bc842545c4624
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature n/a (tech debt, no feature page) | epic partial (page is 60k characters; not read in full, stories not queried) | architecture not read (internal harness; none touches the level stamp) | decisions not read (search for the level stamp found no decision page)
- **Overall confidence**: medium

## Story

- **ST-775** "Tech debt (ST-677): hour 24 fits LEVEL_AT but Python's fromisoformat refuses it while Date.parse accepts it, so the two…" — status Planning, priority Medium, role System, epic Foundations (https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), PR #184. Page last edited 2026-10-07T06:10Z.
- Scope per the story: "fix what pr-tester deferred in ST-677: hour 24 fits LEVEL_AT but Python's fromisoformat refuses it while Date.parse accepts it, so the two readers disagree on T24:00:00Z; limit the hour to ([01]\d|2[0-3]) in both regexes (also .specify/scripts/python/common.py _LEVEL_AT). Nothing writes hour 24 today."
- Body: severity medium; where `.claude/scripts/lib/feature.mjs:146`; found by pr-tester on PR #167; from story ST-677.
- Comments that moved scope: none. The page has no comments (notion-get-comments returned none, resolved included).

## Decisions

- The stamp is validated by one shared shape, `LEVEL_AT` (JS) and `_LEVEL_AT` (Python); any other shape counts as no waiting level in both readers. — [ST-677 "A zone-less level_at is read as local time in JS and UTC in Python", bot comment] (2026-10-06, confidence: high)
- The shape keeps its 6-digit fraction because ST-677's FR-003 names it and Python's isoformat writes it (code review MEDIUM). — [ST-677, bot comment] (2026-10-06, confidence: high)
- The hour fix is `([01]\d|2[0-3])` in both regexes. — [ST-775, User story and Finding] (2026-10-07, confidence: high)

## Constraints

- Both readers change together: `pendingLevel` in `.claude/scripts/lib/feature.mjs` and `_pending_level` / `_LEVEL_AT` in `.specify/scripts/python/common.py`. — [ST-775, Finding] (2026-10-07, confidence: high)
- ST-677 added the Python-vs-`pointTo` parity case in `level.spec.mjs`; a new case belongs there. — [ST-677, What] (2026-10-06, confidence: medium)
- `setLevel` always writes `toISOString()` with a Z, so only a hand-edited file can reach this. "Nothing writes hour 24 today." — [ST-677, Why it was deferred; ST-775, Finding] (2026-10-07, confidence: high)

## Prior Art

- ST-677 (Done, PR #167): treated a zone-less `level_at` as invalid in both readers and introduced the shared `LEVEL_AT` shape. ST-775 is the follow-up its PR tester deferred. — [ST-677] (2026-10-06)
- ST-662 (PR #134): the original `pendingLevel` / `_pending_level` work. Referenced from ST-677, not opened. — [ST-677, Source] (2026-10-06)
- Neighbouring harness debt found by search and not opened: "level.mjs point crashes on a non-numeric level in feature.json" — https://app.notion.com/p/3f0607bff0d28150b4c0f3bb24b6cc22 (2026-10-06).

## Open Decisions

- none found

## Contradictions with spec.md

- **spec.md** (2026-10-07): FR-002 and acceptance scenario 2 make the JS reader refuse a day the month does not have (`2026-02-30T00:00Z`) — **Notion**: ST-775 asks only that the hour be limited to `([01]\d|2[0-3])` in both regexes [ST-775] (2026-10-07) — spec.md goes beyond the anchor. The day-of-month case is the spec's own addition, taken from the invoking description, not from Notion. Same-day dates, so no newer side. Under Scope Authority the Notion anchor is the only source of scope.
- spec.md says the Notion task "holds the finding and no comment". That matches Notion; no contradiction.

## Proposed Clarifications (this command's proposals, not requirements)

- Does the owner accept FR-002 (day-of-month check in the JS reader) as part of ST-775, or should it be filed as its own tech-debt task and the spec limited to FR-001 plus the matching coverage? — from the contradiction above.
- The Notion text says "limit the hour in both regexes" and does not say a JS-side calendar check is needed; the plan should state whether the hour fix alone is enough for SC-001, which lists nine stamps including day-of-month ones. — from ST-775 scope.

## Gaps

- The epic Foundations page was not read in full (60k characters, no tool here could slice it), so its sibling stories and release were not checked.
- No Notion architecture page or decision on the `feature.json` level stamp exists; the search found only story pages. The harness is internal tooling, as expected.
- [NEEDS CLARIFICATION: whether the day-of-month rule (FR-002) is in scope for ST-775]

## Sources

- ST-775 (anchor) — https://app.notion.com/p/3f1607bff0d281fb915bc842545c4624
- ST-677 "A zone-less level_at is read as local time in JS and UTC in Python" (with its one comment) — https://app.notion.com/p/3f0607bff0d281fe8d32e51335e46153
- Epic Foundations (relation only; page not fully read) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Search "spec-kit harness feature.json level stamp" — result pages listed under Prior Art

## Refresh 2026-10-07

Baseline: Gathered 2026-10-07 (anchor last edited 06:10Z). Re-read ST-775 and its comments only.

- No new evidence on scope. The story's text (Finding, User story, hour limit `([01]\d|2[0-3])` in both regexes) is unchanged; still no day-of-month rule in Notion, so the FR-002 contradiction above stands. — [ST-775] (2026-10-07)
- Comments: none, resolved and block-level included. No comment moved scope.
- Property change only: Status moved from Planning to Implementing, PR #184 still linked; page last edited 2026-10-07T06:15Z. — [ST-775] (2026-10-07)
- Superseded: the Story section's "status Planning" is now stale (Implementing).
