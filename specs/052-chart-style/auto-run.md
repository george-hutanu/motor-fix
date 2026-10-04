# Auto run — 052-chart-style

Description: ST-52 — Build the shared chart style in libs/ui-cockpit (Cockpit theme tokens, dark and light; labels through the ST-19 formats). Notion story https://app.notion.com/p/3ee607bff0d28176aa7efb7b909ee35b.
Start commit: 9a2753c (origin/main after rebase, coordinator resume 2026-10-04). Branch 052-chart-style.

## Preflight
- Tree clean; typecheck green, lint green, `npm run test` green (10 tasks); spec-drift: no active feature yet.
- Constitution v1.4.0 read (Principle I first; VII task lifecycle).
- Coordinator resume: merge freeze until PR #21 merges; heavy commands through heavy.sh.

## 0 Size
- Level 2 (feature): new dependency and design choices (component shape, SSR, theme reading). Evidence: level.mjs suggest → 2.

## 2 Specify
- Spec folder forced to specs/052-chart-style (brief). Branch already created; before_specify branch hook not re-run.
- Autonomous defaults (spec Assumptions): host writes labels; plot 200 px; tap elsewhere = anywhere outside a bar/point; quartic ease-out over 1 s for the brief's cubic-bezier; chart texts in the shell area; tooltip as the mock's inverted chip.
- after_specify: notion-sync start (story → In progress, timeline row → In progress, epic unchanged); design-check → design.md (mock files DashClient/DashGarage/DashAdmin read).

## 3 Context
- org-researcher had no Notion tools in its tool list (other connector ids) → stub; digest written by the main run with read-only fetch/search. query-data-sources over workspace limit; used search.
- Constraint: Chart.js used directly (Technology stack, Proposed, A1, 2026-10-04); MIT. Mileage line is custom SVG per the stack page → catalogue line example is a count, not km.

## 4 Clarify (5 autonomous answers, spec-challenger input)
- One label per point (Principle I) · per-unit formatters formatLei/formatKm/formatNum · autoSkip, no rotation, ≥12 px · tokens read from computed style at draw and on scheme change · 1000 ms easeOutQuart; precedence loading>error>empty>chart; role=img summary on server too; 22 px hit radius.

## 5–8 Plan, checklist, tasks, analyze
- New dependency chart.js 4.5.1 (MIT), `--save-exact`, justified in plan Complexity Tracking (stack page names it).
- Two components on one abstract base (brief names both); config builder internal, not exported.
- E2E screenshot comparison done in-run (theme round trip), because Playwright baselines are per platform and e2e runs on Linux in CI/release.
- Checklist charts.md: 15/15. artifact-lint: 1 error (unknown capability `cockpit-charts`) → added `.specify/capabilities/cockpit-charts.md`; re-run clean; capabilities validate clean.

## 9 Tests (red first)
- `npx jest chart-config.spec.ts chart.spec.ts charts-sample.spec.ts` → 3 suites failed (modules missing), 0 passing.
- SSR check moved from the unit spec to e2e (afterRender hooks are not platform-gated in TestBed).

## 10 Implement
- jsdom: added a no-op 2D context (gradient tagged CanvasGradient, else Chart.js wraps it as options) and ResizeObserver stub to the lib test setup.
- ui-cockpit 11 suites / 127 tests green; e2e charts.spec.ts 9/9 + cockpit.spec.ts green on port 4252.
- Found: /cockpit sample table panel makes the page ~21 px wider than 320 px (pre-existing); e2e measures the charts with the rest hidden; follow-up chip filed.
- Commits: 2a7a07a feat(ui-cockpit): add the shared bar and line chart style · 21d835c feat(ui-cockpit): show the bar and line charts on the cockpit sample page. Draft PR #23.

## 11 Converge
- All T001–T009 built; nothing appended.

## 12 Harden
- diff-audit (local main stale → old base; filtered to this diff): import-extension findings are a stale rule (no lib uses .js extensions); chart.js new-dependency justified; ChartTheme test-only export → made private.
- Mutation: not run locally (coordinator: never run mutation tests locally; CI mutation workflow).
- test-adversary: chart.adversary.spec.ts, 48 tests, no real defects (5 own mistakes corrected).

## 14 Review (lap 1)
- spec-reviewer BLOCK: HIGH adversary spec fails tsc (index-signature access) → fixed with bracket access. MEDIUM 22 px hit radius never applies under column picking → decision: keep column picking (taps on 8 px bars), amend FR-002 and the clarification, drop `pointHitRadius`. MEDIUM SC-003 page overflow → deferred.md. LOW default `events` → removed. LOW T008 wording → fixed.
- code-reviewer BLOCK: HIGH canvas-leaves-DOM release path untested → covered by the adversary spec (empty→data→empty destroys the chart). MEDIUM hand-parsed hex → Chart.js `color` helper, and no fill when the token is not a colour (new unit test). MEDIUM defaults `events`/`responsive`/`tension` → removed. MEDIUM outside tap redraws every chart → returns early without an active tooltip. MEDIUM e2e pre-draw race → wait for the canvas `width` attribute. LOW `formatValue` unknown → comment.
- Coordinator: heavy commands paused for PR #21; the fix commit is staged and queued.

## 15 QA
- Lap 2 at 6a93f5a: agent-review success (0 blocker, 0 high; 4 medium, 1 low: storage down without Docker, two axe landmark findings on `/` (not touched here), one flow false positive retracted). e2e 40/40. 320 px overflow no longer reproduces. Report: pr-review/lap2/.
- #22 (ST-286) merged first and shares sample-page.ts, index.ts and the lockfile: merged origin/main (6220b7a), npm install (chart.js + @angular/service-worker), typecheck and test green; lap 3 on the new head.
