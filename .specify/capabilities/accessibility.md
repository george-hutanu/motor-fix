---
capability: accessibility
updated: 2026-10-18
features:
  - 248-launch-screens-accessible
---

# Capability: Accessibility

What the web app does so that everyone can use it, to WCAG 2.2 AA: target and text sizes on phones, contrast in both themes, keyboard operation with a focus ring never hidden, the skip link, dialog focus, names in both languages, announcements, the shared rule for empty message regions, and the end-to-end suite's one accessibility-scanner helper. Requirements arrive with feature 248 (`node .claude/scripts/capabilities.mjs merge 248-launch-screens-accessible --apply` at archive).

## Requirements

### 248-FR-001 — Every link, button, field, tab and other control on the core-flow screens MUST have a touch target of at least 44 × 44 px at 320 px and 390 px (links inside running text excepted), and no text on a phone MUST render under 12 px; tab labels are 12 px. No core-flow screen MUST scroll sideways at 320 px (reflow).

_From 248-launch-screens-accessible._

### 248-FR-002 — (#1141) On the sign-in sheet and on the phone sign-in, the "Ține-mă autentificat" checkbox MUST toggle from a tap anywhere in a 44 × 44 px area around it (its label is the hit area, or the input itself is 44 × 44), and the PR QA sweep MUST no longer report a tap-target finding for it.

_From 248-launch-screens-accessible._

### 248-FR-003 — On the core-flow screens, in both themes, text MUST reach a contrast of 4.5:1 (3:1 for large text), and icons, lamps, field borders and the focus ring MUST reach 3:1 against the adjacent colour; colour MUST never be the only signal of a state (a lamp also has a word or an icon).

_From 248-launch-screens-accessible._

### 248-FR-004 — Everything on the core-flow screens MUST be operable with the keyboard alone: every control reachable with Tab in the screen's reading order and activated with Enter or Space, every closable overlay closed with Esc; the focused element always shows a visible focus ring and is never hidden behind the sticky header, the bottom tab bar or the consent bar (the page scrolls so it is clear of them).

_From 248-launch-screens-accessible._

### 248-FR-005 — Dialogs, drawers and bottom sheets MUST keep the focus inside while open, close with Esc, and return the focus to the element that opened them.

_From 248-launch-screens-accessible._

### 248-FR-006 — Each page MUST start with a "Sari la conținut" / "Skip to content" link, the first focusable element, visible when focused, that moves the focus to the page's main content; it is part of the app shell so every route has it.

_From 248-launch-screens-accessible._

### 248-FR-007 — Every button, field, lamp, dial, rolling-digit display and meaningful image on the core-flow screens MUST expose an accessible name or label in Romanian and in English; a decorative image is hidden from the accessibility tree; the page language exposed to assistive technology matches the language the page is shown in, on every route.

_From 248-launch-screens-accessible._

### 248-FR-008 — Live updates on the core-flow screens (a new request, a stage change, a form error, a sent confirmation) MUST be announced politely without moving the focus. A field's error message MUST be programmatically associated with its field (the field points at the message and is marked invalid while it shows).

_From 248-launch-screens-accessible._

### 248-FR-009 — (#1208) One shared "visually hidden when empty" rule MUST replace `:empty { display: none }` on message regions (error, warning, status, hint and message live regions) in the web stylesheets, so an empty region stays in the accessibility tree while showing nothing; rules that hide empty layout containers (suggestion lists, sections, a host with no content) are out of this requirement and unchanged.

_From 248-launch-screens-accessible._

### 248-FR-010 — Nothing on the core-flow screens MUST require dragging: the listing's place marker can be set without dragging (the address search), and the photo tiles can be reordered with their buttons; the results list does everything the results map does (pick a garage, open its profile); this requirement verifies what exists rather than adding controls.

_From 248-launch-screens-accessible._

### 248-FR-011 — The sign-in screens MUST accept pasted passwords and codes, and the phone sign-in's code field MUST stay marked as a one-time code so the phone can fill in the WhatsApp code; the contact link MUST remain in the same place (the footer) on every page.

_From 248-launch-screens-accessible._

### 248-FR-012 — Reduced motion MUST stay respected on every changed component and nothing MUST flash more than three times a second.

_From 248-launch-screens-accessible._

### 248-FR-013 — (#315) One shared helper in the end-to-end suite MUST load and run the accessibility scanner; only the helper may name the scanner's bundle file, and the eight specs that copied the loader MUST run the same rules with the same results through it.

_From 248-launch-screens-accessible._

### 248-FR-014 — Every problem found during the pass MUST be written down: those on the core-flow screens are fixed in this feature; those outside the core flows are fixed here when small, otherwise listed in the story's finish comment with the screen and the rule, never as a tech-debt ticket. The screen-reader run of the three core flows on real devices (VoiceOver with Safari on an iPhone, TalkBack with Chrome on Android, NVDA with Chrome on Windows for the admin's verification file) is part of that record as a documented manual check: the quickstart and the PR describe the steps and what to listen for; it is not automated and does not block the merge.

_From 248-launch-screens-accessible._
