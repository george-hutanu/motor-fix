# Feature Specification: Move through the six steps with the step list in view

**Feature Branch**: `108-step-list-in-view`
**Created**: 2026-10-07
**Status**: Draft
**Input**: ST-108 "Move through the six steps with the step list in view" (EP-2, Highest, 3 points, Role: Garage) — https://app.notion.com/p/3ee607bff0d281de8506f7904b959b0a. Feature: https://app.notion.com/p/3ee607bff0d28117a3fffe7230aef5cb. Build brief current as of 2026-10-03; it wins over the acceptance criteria above it. Story page read in full on 2026-10-07, no comments on it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The listing page opens with its heading and six steps (Priority: P1)

A garage owner, signed in or not, opens "List your garage" at its address and sees, in the public frame, the label "PENTRU SERVICE-URI", the heading "Pune-ți service-ul pe hartă", one line of introduction and the six step sections, one after another on one long page, each with its numbered heading. The sections are empty shells: their content belongs to later stories.

**Why this priority**: Every later EP-2 story puts its fields into one of these sections; without the shell there is nowhere to build.

**Independent Test**: Open `/ro/list-your-garage` and `/en/list-your-garage` on a desktop and a phone; the label, heading, introduction and six numbered section headings are shown, in that language.

**Acceptance Scenarios**:

1. **Given** a visitor who is not signed in, **When** they open `/ro/list-your-garage`, **Then** the page shows the label "PENTRU SERVICE-URI", the heading "Pune-ți service-ul pe hartă" and the introduction "Spune ce primești și ce refuzi. Cine îți cere o ofertă știe deja că lucrezi pe mașina lui.", with no sign-in prompt.
2. **Given** the page, **Then** six sections follow, headed 1 "Service-ul", 2 "Mărci", 3 "Prețuri", 4 "Mecanici" marked "opțional", 5 "Fotografii și adresă", 6 "Verificare" marked "obligatoriu"; each section's body is empty.
3. **Given** a signed-in driver, **When** they open the page, **Then** they see the same page; no role or permission is checked.
4. **Given** `/en/list-your-garage`, **Then** the same page in English: the step labels are "The garage", "Brands", "Prices", "Mechanics" (optional), "Photos and place", "Verification" (required).

---

### User Story 2 - The step list stays in view and shows where I am (Priority: P1)

On a desktop the list "Pași" stays fixed beside the form while the owner scrolls, and highlights the step whose section is on screen. Tapping a step scrolls the page to that section and moves focus to its heading, so the owner can move between steps without hunting.

**Why this priority**: It is the story's purpose: a six-step form finished in one sitting needs the owner to always know where they are and how to get to the next step.

**Independent Test**: On a 1280 px window, scroll the page: the highlighted entry changes with the section on screen; tap "4 Mecanici": section 4 comes into view and its heading has focus.

**Acceptance Scenarios**:

1. **Given** a desktop (768 px or wider), **When** the page loads, **Then** the list "Pași" is shown beside the sections, numbers the steps 1 to 6 with the labels above, and highlights step 1.
2. **Given** the owner scrolls so that section 3 is the one in view, **Then** "3 Prețuri" is the highlighted entry and carries `aria-current="step"`; no other entry does.
3. **Given** the owner scrolls to the bottom of the page, **Then** step 6 is highlighted even when section 6 is shorter than the viewport.
4. **Given** the list, **When** the owner taps "4 Mecanici", **Then** the page scrolls so section 4 is in view under the header, its heading receives keyboard focus, and "4 Mecanici" becomes the highlighted entry.
5. **Given** keyboard use, **When** the owner tabs into the list and presses Enter on a step, **Then** the same jump happens.
6. **Given** the list, **Then** it is one `nav` landmark with an accessible name "Pași" / "Steps", so screen readers announce it as the step navigation.

---

### User Story 3 - On a phone the list is a bar under the header (Priority: P2)

Narrower than 768 px, the list has no room beside the form, so it becomes a bar pinned under the header that shows the current step ("3 / 6 · Prețuri"); tapping it opens the six steps, and tapping one jumps to its section.

**Why this priority**: Most owners will fill the form on a phone; without the bar they lose their place on a long page. It builds on Story 2's behaviour.

**Independent Test**: At 390 px, scroll to section 3: the bar reads step 3; tap the bar, tap "5 Fotografii și adresă": section 5 is in view, its heading has focus, the bar reads step 5 and the list is closed.

**Acceptance Scenarios**:

1. **Given** a 390 px phone, **When** the page loads, **Then** no list is beside the form; a bar is pinned under the header and shows the current step's number and label, "1 / 6 · Service-ul".
2. **Given** the owner scrolls to section 3, **Then** the bar reads "3 / 6 · Prețuri".
3. **Given** the bar, **When** the owner taps it, **Then** the six steps open under it, numbered and labelled as on the desktop, with the current one marked `aria-current="step"`.
4. **Given** the open list, **When** the owner taps "5 Fotografii și adresă", **Then** the list closes, section 5 is in view under the bar and its heading has focus.
5. **Given** the open list, **When** the owner taps outside it or presses Escape, **Then** it closes with no jump; after Escape, focus is back on the bar.
6. **Given** a 320 px phone, **Then** the page does not scroll sideways and the bar's text is at least 12 px.

---

### User Story 4 - Switching the language keeps my place and my input (Priority: P2)

The owner switches RO / EN from the header; every label of the page and the list changes language, and nothing they have typed in a section is lost.

**Why this priority**: The public frame already offers the switch on every page; a listing form that forgot its input on switch would lose work.

**Independent Test**: Type into a section field (one a later story adds; in this story, note the page is not reloaded), switch to EN: the labels change, the highlighted step is the same step, and typed text stays.

**Acceptance Scenarios**:

1. **Given** the Romanian page with step 3 highlighted, **When** the owner switches to English, **Then** the address becomes `/en/list-your-garage`, the label, heading, introduction and the six step labels are English, and step 3 is still the highlighted one.
2. **Given** a section holds typed input (added by a later story), **When** the language switches, **Then** the input is still there: the page is not reloaded or rebuilt by the switch.

---

### Edge Cases

- The page is opened with a fragment for a section (`#pasul-4`): the page lands on that section and the list highlights it.
- Two sections are both partly on screen: the current one is the last whose heading has reached the bottom edge of the header (or the phone bar); exactly one entry is current.
- The owner resizes from phone to desktop while the list is open: the bar and its open list give way to the fixed list with no step lost.
- The device asks for reduced motion: the jump is immediate, not animated.
- The server renders the page (public pages are server-rendered): the list is present and step 1 is highlighted before any script runs; the highlight then follows the scroll.
- A step label too long for the bar at 320 px (English "Photos and place") wraps or is cut with an ellipsis; the bar never scrolls sideways.
- The page is opened with a fragment that names no section (`#pasul-9`, or the other language's `#step-4` on `/ro`): it opens at the top with step 1 current; only the current language's ids are sections.
- The open phone list is taller than the space under the bar (a landscape phone): the list scrolls inside itself; the page behind does not move to make room.
- The owner scrolls the page while the phone list is open: it stays open and the bar's text follows the current step.
- The bar's text is not a live region: a screen reader is not interrupted as the owner scrolls.
- Before the page's script has run, an entry does nothing; there is no no-script fallback (Constitution I).
- Keyboard focus moved to a section heading is visible and does not leave the heading in the tab order permanently (focusable programmatically only).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The web app MUST serve "List your garage" as a public page at `/ro/list-your-garage` and `/en/list-your-garage` (one address per language, the same path after the prefix, as every public page: `apps/web/src/app/app.routes.ts:46`), in the public frame, to anyone, signed in or not, with no permission or role check and no sign-in prompt.
- **FR-002**: The page MUST show, in the current language, the small label "PENTRU SERVICE-URI" / "FOR GARAGES", the heading "Pune-ți service-ul pe hartă" / "Put your garage on the map" and the introduction "Spune ce primești și ce refuzi. Cine îți cere o ofertă știe deja că lucrezi pe mașina lui." / its English equivalent, never promising phone calls.
- **FR-003**: The page MUST hold six sections on one long page, in order, each with a numbered heading: 1 Service-ul / The garage, 2 Mărci / Brands, 3 Prețuri / Prices, 4 Mecanici / Mechanics marked "opțional" / "optional", 5 Fotografii și adresă / Photos and place, 6 Verificare / Verification marked "obligatoriu" / "required". Each section's body is empty in this story and offers a place for its story's content.
- **FR-004**: The page MUST show a step list titled "Pași" / "Steps", one `nav` landmark named by that title, listing the six steps with their number, label and optional/required mark. There is one list in the page, laid out beside the sections or under the phone bar by the 768 px breakpoint, never two copies.
- **FR-005**: Exactly one entry of the list MUST be the current step at any time, carrying `aria-current="step"` and a visible highlight: the last step whose heading has reached the bottom edge of the header (or the phone bar), step 1 before any has, and step 6 once the page is scrolled to its end.
- **FR-006**: Tapping or activating an entry with the keyboard MUST bring that step's section into view below the header (or the phone bar), move keyboard focus to the section's heading, and make that entry the current one, which it stays until the owner next scrolls (the jump's own scrolling never moves the highlight off it). With the device set to reduced motion the jump MUST be immediate.
- **FR-007**: At 768 px and wider the list MUST stay in view beside the sections while the page scrolls.
- **FR-008**: Narrower than 768 px the list MUST be a bar pinned under the header showing the current step as "<n> / 6 · <label>"; the page's header scrolls away, so the bar sticks to the top of the viewport once it is out of sight; the bar is a button with `aria-expanded` that opens the six steps under it (a disclosure: no focus trap); tapping a step jumps to it (FR-006) and closes the list; tapping outside or Escape closes it without a jump, Escape returning focus to the bar.
- **FR-009**: Switching the language MUST change every text of the page and the list, keep the same step current and keep any input in the sections: the page is not reloaded or rebuilt by the switch.
- **FR-010**: The list MUST show no completion tick in this story: what makes a step complete, and its tick, belong to the validation story.
- **FR-011**: The page MUST obey the phone layout rules: no sideways scroll at 320 px, 44 px targets for the bar and the entries, no text under 12 px, light and dark theme following the device. In both themes the current step differs from the others by more than colour (weight or a marker) and its highlight and the keyboard focus ring reach a 3:1 contrast against their background, text 4.5:1 (Cockpit tokens).
- **FR-012**: The page MUST read nothing, write nothing, emit no event and notify nobody.

### Key Entities

- **Step**: one of the six fixed steps: number (1–6), label in RO and EN, mark (none, optional, required). Not stored; the list is the page's own.

## Clarifications

### Session 2026-10-07

- Q: Is the page linked from the header or Home in this story? → A: No. The brief's scenario 1 says the visitor opens it "from the header or from Home" as the starting point, but its Scope names only the page's shell; the entry links belong to the header's and Home's own stories. The page is reachable by address. *(autonomous default, Constitution I)*
- Q: What does the phone bar do on tap? → A: It opens the six steps (the brief's proposed behaviour); choosing one jumps and closes it. *(autonomous default, from the brief's proposal)*
- Q: Is the page listed for search engines (PUBLIC_PATHS)? → A: Yes: it is public, for anyone, and has one address per language like the legal pages. *(autonomous default)*
- Q: Does the page get a different path per language, or one path under `/ro` and `/en`? → A: One path, `list-your-garage`, under both prefixes, as every public page; the language switch and hreflang already work that way. *(autonomous default, Principle I, `app.routes.ts:46`)*
- Q: Which single rule picks the current step? → A: The last step whose heading has reached the bottom edge of the header (or phone bar); step 1 before any; step 6 at the page's end. *(autonomous default)*
- Q: Is the desktop list and the phone's open list one element or two? → A: One `nav` in the DOM, laid out by CSS at 768 px, so exactly one entry carries `aria-current`. *(autonomous default)*
- Q: Is the phone bar's open list a disclosure or a dialog, and where does focus go on close? → A: A disclosure (button with `aria-expanded`), no focus trap; Escape returns focus to the bar; a step tap moves focus to the heading. *(autonomous default, Principle I)*
- Q: Is the completion tick built in this story? → A: No: nothing in this story can complete a step, so the tick goes to the validation story with the rules that define it. *(autonomous default, Principle I; brief scenario 8 is marked proposed and not designed)*

## Assumptions

- Phone breakpoint 768 px, the brief's proposal and the public frame's existing breakpoint. *(autonomous default)*
- Addresses `/ro/list-your-garage` and `/en/list-your-garage`: one path under both language prefixes, as the router and the language switch already do for every public page (`app.routes.ts:46`, `addresses.ts` `alternates()`). The brief proposed `/ro/listeaza-service`; a per-language slug needs a mechanism the frame lacks and is left to an SEO story. *(autonomous default, Principle I)*
- Introduction wording as proposed in the brief; the English texts of the label, heading and introduction are this story's translation of the Romanian. *(autonomous default)*
- Section fragments `#pasul-<n>` / `#step-<n>` identify the sections, so a later story and the tests can address them. *(autonomous default)*
- The page title in the tab is the heading in the current language. *(autonomous default)*
- The survey and the account step come after the six steps and are not listed (brief). The tick on a complete step (brief scenario 8, proposed, not designed) is left to the validation story, which defines completeness. *(autonomous default, Principle I)*
- The design check (`design.md`) names the header, heading, step list and six headings from the boards ListGarage.dc.html and MList.dc.html; where the mock and this spec disagree, `design.md` records it and the brief wins.
- Out of scope: each step's content, saving and restoring the draft, validation, the entry links from the header and Home.

## Spec Delta

### Capability: `garage-listing` (new)

- **Adds**: FR-001–FR-012
- **Modifies**: none
- **Removes**: none

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Both addresses open the page for a visitor and a signed-in driver with the label, heading, introduction and six numbered headings in the address's language; no sign-in dialog appears.
- **SC-002**: On a desktop, tapping each of the six entries brings its section into view, gives its heading focus and makes it the one entry with `aria-current="step"` (Playwright).
- **SC-003**: On a 390 px phone, the pinned bar shows the current step as the page scrolls and, opened, jumps to step 5 and closes (Playwright).
- **SC-004**: The scroll spy picks the step whose section is in view, step 1 at the top and step 6 at the bottom; the labels are the six Romanian and six English strings above (Jest).
- **SC-005**: At 320 px no route of the page scrolls sideways and no text is under 12 px (286-FR-002, 286-FR-004); the PR QA sweep's screenshots at 320, 390, tablet and desktop in light and dark, RO and EN show the list or the bar in place.
- **SC-006**: Switching RO / EN keeps the current step and the page instance; no network call other than the texts' own load is made by the page (FR-012).
