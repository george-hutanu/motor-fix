# Context: ST-53 See screens build up with motion, or still with reduced motion

Gathered: 2026-10-04 · Source: Notion "MotorFix — Product documentation" only, read by the run itself (read-only fetches); the org-researcher subagent's tool list names a different Notion connector id here, as in ST-51.

## Anchors
- Story ST-53 https://app.notion.com/p/3ee607bff0d281e6a52dd360e3cf1cda — edited 2026-10-03; Build brief current as of 2026-10-03; no discussions or comments.
- Feature MF-3 Cockpit design system and motion https://app.notion.com/p/3ee607bff0d2817aa8bdc2f304d558b2 — edited 2026-10-04.
- Epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 — Build plan slice 3: ST-53 (needs ST-50, ST-51) before ST-157 (needs ST-50, ST-16, ST-53).
- Build timeline row https://app.notion.com/p/3ee607bff0d2814a99f3c92ba70d07cc — W4, lane A · UI kit, 3 points; "Also adds the dialog pop animation to ST-157."

## Decisions
- Motion values (Build brief, *proposed as shared tokens `--mf-motion-*`*): rise and fade 700 ms, 14 px; panels 60 ms apart *(proposed)*; dial 1100 ms; pop 420 ms from 94%; curve `cubic-bezier(.32,.72,0,1)`; lamp 1 → 0.45 → 1 every 1.2–1.8 s; live badge blinks *(proposed: once a second)*.
- `prefers-reduced-motion: reduce` is read once at start and followed live; every animation checks one shared signal; motion state `full` / `reduced`, not stored.
- No flashing more than 3 times a second.
- MF-3 edge case: reduced motion turned on mid build-up → animation stops at once and the final state shows.

## Constraints
- Front end only, `libs/ui-cockpit`; reads and writes nothing on the server.
- Tests: Jest — the shared signal turns every animation off; the tokens hold the mock's values. Playwright — with `reducedMotion: 'reduce'` open Home and a dashboard, no running animation; with full motion the panels finish building within 1.5 s.
- Motion never blocks input; a live update does not replay the build-up (ST-256 owns its highlight).

## Out of scope
- The Home headline brand swap and the big dial on Home (Discovery and garage profile); they use these tokens.
- The live badge in use (Live from the workshop, release 2).
- Charts' growth (ST-52) and the live-update highlight (ST-256), except that the reduced-motion rule covers them.

## Contradictions
- Mock values differ from the Build brief (rise 900 ms / 18 px / blur, pop 460 ms from 60%, needle overshoot curve, lamp 2.4 s). The Build brief is newer and says it wins.
- The epic's Design boards (sign-in, mobile) are the epic's, not this story's; the Build brief names all boards of mock v22.

## Proposed clarifications
- Roll duration for the odometer (not in the brief; mock 900 ms).
- Whether the "shared signal" or the CSS media query is the switch for CSS motion.

## Refresh
2026-10-04: story re-read after implementation; no comments, no discussions; Build brief unchanged (as of 2026-10-03). No new evidence.
