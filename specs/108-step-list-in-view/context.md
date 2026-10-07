# Feature Context: Step list in view (listing page shell)

- **Feature**: 108-step-list-in-view
- **Anchor**: ST-108 Move through the six steps with the step list in view — https://app.notion.com/p/3ee607bff0d281de8506f7904b959b0a | terms: none needed
- **Gathered**: 2026-10-07
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok | decisions ok
- **Overall confidence**: high

## Story

- **ST-108 Move through the six steps with the step list in view** — status Planning, priority Highest, role Garage, epic EP-2 Garage onboarding and verification (3 points, label front end, PR #192 linked)
- Scope per the story: "a list of the six steps that stays in view and shows where I am". Criteria: heading + one intro line; list titled and numbered 1-6 (Service-ul, Mărci, Prețuri, Mecanici, Fotografii și adresă, Verificare); list stays in view and highlights current step on desktop and phone; tapping jumps; phone = bar pinned under the header; Mecanici optional, Verificare required. Build brief (2026-10-03, "wins where it disagrees"): front end only, saves nothing, reads nothing, emits nothing, no permission check, anyone may open it.
- Comments that moved scope: none (story and feature page both have zero comments; page last edited 2026-10-07T08:03Z).

## Decisions

- Intro line must not promise phone calls: "Cine îți cere o ofertă știe deja că lucrezi pe mașina lui." — [ST-108 criteria + MF-29 "How it works"] (superseded 2026-10-03, confidence: high)
  - superseded by: the older wording "so owners who call already know you work on their car" (same pages, earlier text)
- Focus moves to the step heading on tap (scenario 4); highlighted step has `aria-current="step"`; list is a `nav` landmark; smallest text 12 px — [ST-108 Build brief, Acceptance scenarios and Rules] (2026-10-03, high)
- Survey and account come after the six steps and are not steps in the list — [ST-108 Build brief, Rules] (2026-10-03, high)
- Draft is kept in the browser (not in this story); no account needed to start the form — [MF-29 Build brief, Final rules 1-2] (2026-10-03, high)
- Front end is Angular + Spartan UI (Cockpit theme), no PrimeNG (the feature page's "PrimeNG components: Stepper or custom sticky list" is stale) — [Architecture decisions A1] (2026-10-04, high)
  - superseded by: MF-29 "PrimeNG components" toggle (2026-10-03)
- Server rendering applies to public pages only — [Architecture decisions A10] (2026-10-04, medium; whether this page counts as public is for the plan)

## Constraints

- One address per language, `/ro/listeaza-service` and `/en/list-your-garage`, following MF-1 (marked proposed) — [ST-108 Build brief, Rules] (2026-10-03, medium)
- Phone breakpoint 768 px, marked proposed; tapping the bar opens the six steps, marked proposed — [ST-108 Build brief, scenario 6] (2026-10-03, medium)
- Tick on a complete step is proposed and "not designed" in the mock; completeness rules belong to the validation story — [ST-108 Build brief, scenario 8 and Screens] (2026-10-03, medium)
- Light theme follows the device setting; the mock has only dark, light is derived from dark tokens — [ST-108 Rules; A43] (2026-10-04, medium)
- Tests named by the brief: Jest for the scroll spy and RO/EN step labels; Playwright for desktop tap-each-step and phone bar jumping to step 5 — [ST-108 Build brief, Tests] (2026-10-03, high)
- The page URL later carries `?draft=<token>` (ST-114), so the route must tolerate a query string — [ST-114 Build brief, Rules] (2026-10-03, medium)

## Prior Art

- ST-107 decision "account at the end" is Done; ST-114 (draft, To do), step stories ST-109/ST-112 etc. all need this page's shell and sections (hours/facilities and Mărci stories name ST-108 as a dependency) — [EP-2 Build plan, Slice 1-2] (2026-10-07)
- The mock has the fixed step list with highlighting working; ticks and the phone bar open state are not designed — [MF-29 "Where it stands"; ST-108 Screens] (2026-10-03). Mock is at claude.ai (recorded, not opened).
- Each step story owns its section of `LISTING_DRAFT.data` — the sections here are empty shells those stories fill — [MF-29 Build brief, rule 16 (proposed)] (2026-10-03)

## Open Decisions

- None block ST-108: story "Open: None". MF-29's open items (reminder timing, confirmation order) block ST-114 and ST-116, not this story.

## Contradictions with spec.md

- **spec.md** (2026-10-07): FR-011 "light and dark theme following the device" — **Notion**: ST-108 Rules say "light theme following the device setting"; A43 says light is derived from dark by the build team [ST-108, Architecture decisions] (2026-10-03/04) — newer: unknown (spec.md date not checked against 2026-10-07T08:03Z story edit); mild, spec is a superset.
- **spec.md** (2026-10-07): Clarification "page is not linked from header or Home" — **Notion**: scenario 1 starts from a visitor opening it "from the header or from Home"; Scope names only the shell [ST-108 Build brief] (2026-10-03) — newer: spec.md; consistent with Scope, noted only because the scenario implies links.
- **spec.md**: Story 4 says language switch must not reload or rebuild the page; Notion states only "nothing typed is lost" (scenario 7). Spec is stricter than the source.
- **spec.md** header says it was written 2026-10-07; the story page was last edited 2026-10-07T08:03Z. Time of day is not comparable here, so the page may be the newer side. Re-check with `git log -1 --format=%cI -- specs/108-step-list-in-view/spec.md`.

## Proposed Clarifications (this command's proposals, not requirements)

- Should FR-011 say "light theme following the device, dark where the Cockpit theme provides it", to match the brief's wording? — from the first contradiction
- Should the spec's own additions (the `#pasul-<n>` fragments, reduced-motion, tick announced "completat/done", outside-tap/Escape closing) be marked as autonomous defaults beyond the brief? They already are in Assumptions/Clarifications; confirm they stay out of the acceptance criteria. — from Scope Authority
- Confirm the page tolerates `?draft=<token>` without changing the highlighted step — from ST-114

## Gaps

- The design mock (claude.ai artifact) was not opened; the phone bar's open-state look is not designed per the brief.
- [NEEDS CLARIFICATION: is the page title/tab text specified anywhere? No Notion page says so.]

## Sources

- ST-108 Move through the six steps with the step list in view — https://app.notion.com/p/3ee607bff0d281de8506f7904b959b0a
- MF-29 List your garage: the onboarding form — https://app.notion.com/p/3ee607bff0d28117a3fffe7230aef5cb
- EP-2 Garage onboarding and verification — https://app.notion.com/p/3ee607bff0d281f8ba8ae20d1af741cf
- ST-114 Save a draft and come back to it later — https://app.notion.com/p/3ee607bff0d28182bfafc99b0021fc1f
- Architecture decisions — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Decisions and ideas — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d
