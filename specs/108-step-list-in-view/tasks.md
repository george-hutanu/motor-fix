# Tasks: Move through the six steps with the step list in view (ST-108)

**Input**: `specs/108-step-list-in-view/` (spec.md, plan.md, research.md, data-model.md, contracts/page.md, quickstart.md, design.md)

**Tests**: Required and first (Constitution II): every test task is written and seen failing before the implementation tasks of its phase.

**Scope held out** (Constitution I): the completion tick, entry links from the header and Home, step contents, saving, validation. No task builds them.

## Phase 1: Setup

No new project, dependency or lib: the page lives in `apps/web`, the texts in `libs/i18n`. No tasks.

## Phase 2: Foundational (blocks both stories)

- [ ] T001 [P] Add the `listing` text group (label, heading, intro, steps, step1 to step6, optional, required, bar) in Romanian to `libs/i18n/src/public/ro.json`, with the strings of contracts/page.md
- [ ] T002 [P] Add the same `listing` keys in English to `libs/i18n/src/public/en.json`
- [ ] T003 [P] Write the failing Jest spec `apps/web/src/app/public/steps.spec.ts` (new): `currentStep(tops, line, atEnd)` edges (none reached gives 1, greatest `n` with top <= line, `atEnd` gives 6), `STEPS` has six entries with marks null/optional/required as in data-model.md, and the six RO and six EN labels through `I18n` (covers FR-003, FR-005, SC-004)
- [ ] T004 Create `apps/web/src/app/public/steps.ts` (new): `STEPS` constant and `currentStep` until T003 passes (FR-003, FR-005)

## Phase 3: User Story 1 - The page opens with its heading and six steps (P1)

**Goal**: public page at both addresses with label, heading, introduction and six empty numbered sections.

**Independent test**: open `/ro/list-your-garage` and `/en/list-your-garage`; texts and headings show in that language, no sign-in prompt.

### Tests first

- [ ] T005 [P] [US1] Failing Jest spec `apps/web/src/app/public/list-your-garage.spec.ts` (new), page part: label, h1, introduction, six section headings with marks and ids `pasul-<n>` / `step-<n>` in RO and EN, section bodies empty, no tick, no HTTP call (FR-002, FR-003, FR-010, FR-012, SC-001)
- [ ] T006 [P] [US1] Failing assertions in `apps/web/src/app/addresses.spec.ts` that `list-your-garage` is a public path with one address per language (FR-001)
- [ ] T007 [P] [US1] Failing assertion in `apps/web/src/server/search.spec.ts` that the sitemap lists `/ro/list-your-garage` and `/en/list-your-garage` (FR-001)
- [ ] T008 [P] [US1] Failing Playwright spec `apps/web-e2e/src/list-your-garage.spec.ts` (new), page part: both addresses open for a visitor and a signed-in driver with no sign-in dialog, texts in the address's language (FR-001, FR-002, FR-003, SC-001)
- [ ] T009 [P] [US1] Add `/ro/list-your-garage` and `/en/list-your-garage` to the routes of `apps/web-e2e/src/phone.spec.ts` (320 px no sideways scroll, text >= 12 px; FR-011, SC-005)

### Implementation

- [ ] T010 [US1] Add `list-your-garage` to `PUBLIC_PATHS` in `apps/web/src/app/addresses.ts` (T006, T007)
- [ ] T011 [US1] Add the lazy `list-your-garage` child with its `title` resolver to the `:lang` route in `apps/web/src/app/app.routes.ts`
- [ ] T012 [US1] Create `apps/web/src/app/public/list-your-garage.ts` (new): header with `<mf-language-switch />`, label, h1, intro, the six `<section id>` shells with numbered `h2` (tabindex -1), the `nav` named "Pași" / "Steps" with the `ol`, Cockpit tokens, 44 px targets (FR-001 to FR-004, FR-009, FR-011, FR-012; T005, T008, T009 pass)

**Checkpoint**: page reachable and complete without scroll behaviour.

## Phase 4: User Story 2 - The step list stays in view and shows where I am (P1)

**Goal**: desktop list sticky beside the form, current step follows the scroll, tap jumps and focuses the heading.

**Independent test**: at 1280 px scroll and tap "4 Mecanici": section in view, heading focused, one `aria-current="step"`.

- [ ] T013 [US2] Failing Jest cases in `apps/web/src/app/public/list-your-garage.spec.ts`: exactly one `aria-current="step"`, step 1 first, a jump sets the current step and focuses the heading, Enter activates, nav name (FR-004, FR-005, FR-006, FR-009)
- [ ] T014 [P] [US2] Failing Playwright cases in `apps/web-e2e/src/list-your-garage.spec.ts`: at 1280 px the list stays in view while scrolling, highlight follows the section, step 6 at the page end, each of the six entries jumps, focuses its heading and becomes current, reduced motion jumps without smooth scroll, RO/EN switch keeps the step and the page instance (FR-005 to FR-007, FR-009, SC-002, SC-006)
- [ ] T015 [US2] In `apps/web/src/app/public/list-your-garage.ts`: sticky list from 768 px, scroll and resize spy (`afterNextRender`, passive, removed on destroy), jump with the 150 ms hold, focus with `preventScroll`, visible highlight in light and dark (FR-005 to FR-007, FR-011; T013, T014 pass)

## Phase 5: User Story 3 - On a phone the list is a bar under the header (P2)

**Goal**: below 768 px the same `nav` is a pinned bar "n / 6 · label" that opens the six steps.

**Independent test**: at 390 px open the bar, tap step 5: section 5 in view, heading focused, bar reads step 5, list closed.

- [ ] T016 [US3] Failing Jest cases in `apps/web/src/app/public/list-your-garage.spec.ts`: bar text "1 / 6 · Service-ul" then updates, `aria-expanded` toggles, a step tap closes, outside tap and Escape close with no jump, Escape focuses the bar (FR-008, SC-003)
- [ ] T017 [P] [US3] Failing Playwright cases in `apps/web-e2e/src/list-your-garage.spec.ts` at 390 px: bar text follows the scroll, opens, jumps to step 5 and closes, Escape returns focus to the bar; at 320 px no sideways scroll (FR-008, FR-011, SC-003, SC-005)
- [ ] T018 [US3] In `apps/web/src/app/public/list-your-garage.ts`: bar button with `aria-expanded`, pinned under the header, `open` signal, document click and Escape handling, CSS breakpoint at 768 px on the one `nav` (FR-004, FR-008; T016, T017 pass)

## Phase 6: User Story 4 - Switching the language keeps my place and my input (P2)

Behaviour is delivered by the one component instance and the key-based texts (T012, T015); its tests are in T005, T013 and T014 (FR-009, SC-006). No separate task.

## Phase 7: Verify

- [ ] T019 Run `quickstart.md`: Biome, typecheck, `nx test web`, `nx e2e web-e2e` (list-your-garage and phone specs) green

## Dependencies

T001, T002 before T005; T003 before T004. US1 (T005 to T012) before US2 (T013 to T015) before US3 (T016 to T018), all in `list-your-garage.ts`. T019 last.

## Parallel

T001, T002, T003; T005 to T009; T013 with T014; T016 with T017.

## FR to test map

FR-001: T006, T007, T008. FR-002: T005, T008. FR-003: T003, T005, T008. FR-004: T013. FR-005: T003, T013, T014. FR-006: T013, T014. FR-007: T014. FR-008: T016, T017. FR-009: T013, T014. FR-010: T005. FR-011: T009, T017. FR-012: T005.
