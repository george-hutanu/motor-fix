---
capability: garage-listing
updated: 2026-10-07
features:
  - 108-step-list-in-view
---

# Capability: Garage listing

How a garage owner lists a garage on MotorFix: the public "List your garage" page, its six steps and the step list that keeps the owner's place.

## Requirements

### 108-FR-001 — The web app MUST serve "List your garage" as a public page at `/ro/list-your-garage` and `/en/list-your-garage` (one address per language, the same path after the prefix, as every public page: `apps/web/src/app/app.routes.ts:46`), in the public frame, to anyone, signed in or not, with no permission or role check and no sign-in prompt.

_From 108-step-list-in-view._

### 108-FR-002 — The page MUST show, in the current language, the small label "PENTRU SERVICE-URI" / "FOR GARAGES", the heading "Pune-ți service-ul pe hartă" / "Put your garage on the map" and the introduction "Spune ce primești și ce refuzi. Cine îți cere o ofertă știe deja că lucrezi pe mașina lui." / its English equivalent, never promising phone calls.

_From 108-step-list-in-view._

### 108-FR-003 — The page MUST hold six sections on one long page, in order, each with a numbered heading: 1 Service-ul / The garage, 2 Mărci / Brands, 3 Prețuri / Prices, 4 Mecanici / Mechanics marked "opțional" / "optional", 5 Fotografii și adresă / Photos and place, 6 Verificare / Verification marked "obligatoriu" / "required". Each section's body is empty in this story and offers a place for its story's content.

_From 108-step-list-in-view._

### 108-FR-004 — The page MUST show a step list titled "Pași" / "Steps", one `nav` landmark named by that title, listing the six steps with their number, label and optional/required mark. There is one list in the page, laid out beside the sections or under the phone bar by the 768 px breakpoint, never two copies.

_From 108-step-list-in-view._

### 108-FR-005 — Exactly one entry of the list MUST be the current step at any time, carrying `aria-current="step"` and a visible highlight: the last step whose heading has reached the bottom edge of the header (or the phone bar), step 1 before any has, and step 6 once the page is scrolled to its end.

_From 108-step-list-in-view._

### 108-FR-006 — Tapping or activating an entry with the keyboard MUST bring that step's section into view below the header (or the phone bar), move keyboard focus to the section's heading, and make that entry the current one, which it stays until the owner next scrolls (the jump's own scrolling never moves the highlight off it). With the device set to reduced motion the jump MUST be immediate.

_From 108-step-list-in-view._

### 108-FR-007 — At 768 px and wider the list MUST stay in view beside the sections while the page scrolls.

_From 108-step-list-in-view._

### 108-FR-008 — Narrower than 768 px the list MUST be a bar pinned under the header showing the current step as "<n> / 6 · <label>"; the page's header scrolls away, so the bar sticks to the top of the viewport once it is out of sight; the bar is a button with `aria-expanded` that opens the six steps under it (a disclosure: no focus trap); tapping a step jumps to it (FR-006) and closes the list; tapping outside or Escape closes it without a jump, Escape returning focus to the bar.

_From 108-step-list-in-view._

### 108-FR-009 — Switching the language MUST change every text of the page and the list, keep the same step current and keep any input in the sections: the page is not reloaded or rebuilt by the switch.

_From 108-step-list-in-view._

### 108-FR-010 — The list MUST show no completion tick in this story: what makes a step complete, and its tick, belong to the validation story.

_From 108-step-list-in-view._

### 108-FR-011 — The page MUST obey the phone layout rules: no sideways scroll at 320 px, 44 px targets for the bar and the entries, no text under 12 px, light and dark theme following the device. In both themes the current step differs from the others by more than colour (weight or a marker) and its highlight and the keyboard focus ring reach a 3:1 contrast against their background, text 4.5:1 (Cockpit tokens).

_From 108-step-list-in-view._

### 108-FR-012 — The page MUST read nothing, write nothing, emit no event and notify nobody.

_From 108-step-list-in-view._
