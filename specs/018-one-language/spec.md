# Feature Specification: Read every screen in one language, with user text as written

**Feature Branch**: `018-one-language`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-18 "Read every screen in one language, with user text as written" — Notion story https://app.notion.com/p/3ee607bff0d28104acfbf6d2ef09ee7a; EP-1 build-timeline row https://app.notion.com/p/3ee607bff0d281bdb9faff59898748ab (lane B · i18n & shell, W3, 3 points; machine translation of reviews out of scope at launch)."

**Sources**: Notion story ST-18 https://app.notion.com/p/3ee607bff0d28104acfbf6d2ef09ee7a (read 2026-10-04, page edited 2026-10-03; no comments) — its Build brief wins over the story body · EP-1 build-timeline row https://app.notion.com/p/3ee607bff0d281bdb9faff59898748ab (Blocked by ST-16 and ST-286, both merged) · this repository at `origin/main` 3670a68.

**Level**: 1 (one-session) — the Build brief states the rules, the scenarios and the tests; no plan, research or contracts are owed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Interface text is in one language only (Priority: P1)

A visitor who chose English reads every interface text of a screen in English,
and a visitor who chose Romanian reads it all in Romanian. Nothing of the other
language shows, apart from text people wrote and names.

**Why this priority**: It is the story's promise: never a mix of Romanian and
English.

**Independent Test**: Open each screen in English and look for any Romanian
interface text, then the reverse.

**Acceptance Scenarios**:

1. **Given** the English interface on any screen, **then** no Romanian interface
   text shows, and the reverse.
2. **Given** catalogue texts (job types, car systems), **then** they show in the
   interface language, from their Romanian and English names.

---

### User Story 2 - Text people wrote and names are shown as written (Priority: P1)

A review, a reply, a customer note or a caption shows exactly as its author
wrote it, in whatever language. Garage names, brand names and people's names are
never translated.

**Why this priority**: Translating a person's words or a name changes what they
said or who they are.

**Independent Test**: Show a Romanian review and a few names in the English
interface and compare them character for character with the stored text.

**Acceptance Scenarios**:

1. **Given** the English interface, **when** a review written in Romanian is
   shown, **then** it appears as written, with no translation and no translate
   button.
2. **Given** the English interface, **then** "Atelier Dinamo", "Dacia" and
   "Andrei M." show unchanged.
3. **Given** a signed-in person on their dashboard in either language, **then**
   their name shows as stored.

---

### User Story 3 - Romanian words with a hyphen stay whole, and long text wraps at 320 px (Priority: P2)

"service-ul", "s-a" and the like never break across two lines; and the longest
text of each screen wraps inside a 320 px phone in both languages.

**Why this priority**: A broken "service-" / "ul" reads as a mistake; text that
overflows hides content. Both are visible on the smallest phones only, which
ST-286 already guards in part.

**Independent Test**: Read the Romanian files for a hyphen between letters; open
each screen at 320 px in both languages.

**Acceptance Scenarios**:

1. **Given** the word "service-ul" at the end of a line, **then** it never breaks
   at the hyphen.
2. **Given** a width of 320 px, **then** the longest strings of each screen wrap
   without overflow or sideways scroll in both languages.
3. **Given** a phone, **then** no text is smaller than 12 px, in either language.

### Edge Cases

- A user text that happens to equal a translation key (`shell.brand`) still
  shows as that literal text, not the translation.
- A user text is empty: nothing is shown, and no key or placeholder appears.
- A catalogue item has no English name yet: the Romanian name shows (the
  existing rule that a missing text falls back to Romanian, 016-FR-007).
- The language changes while a user text is on screen: the user text does not
  change; the catalogue name does.
- A hyphen between a letter and a digit or space ("A-1", "- ") is not a word
  hyphen and is not required to be non-breaking.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The project checks MUST fail when a Romanian text joins two
  letters with a plain hyphen (U+002D), naming the area and the key; such words
  ("service-ul", "s-a", "într-o") are written with a non-breaking hyphen
  (U+2011). English texts are not checked.
- **FR-002**: Every existing Romanian text MUST pass FR-001, so "service-ul",
  "service-uri" and "s-a" in the current files keep the same reading and never
  break at the hyphen.
- **FR-003**: Text written by people MUST be shown through one shared display
  that shows it exactly as given, never looks it up as a translation, offers no
  translate control, and is marked so the browser's own page translation leaves
  it untouched.
- **FR-004**: Names — of garages, brands and people — MUST be shown through the
  same display as FR-003; the dashboard's signed-in name uses it.
- **FR-005**: A catalogue item's name MUST show in the current language from its
  Romanian and English names, change with the language without a reload, and
  fall back to the Romanian name when the English one is missing or blank.
- **FR-006**: With English chosen, no screen MUST show a Romanian interface text
  (a Romanian file value that differs from its English one), outside text shown
  as written; and with Romanian chosen, no English one.
- **FR-007**: At 320 px wide, in both languages, every screen MUST have no
  sideways scroll, no text cut off by its own box, and no text under 12 px.

### Key Entities

- **Catalogue item**: anything the platform names in both languages — job types,
  car systems; it carries a Romanian name and an English name.
- **User text**: any text a person wrote — review, reply, message, note,
  caption, the garage's own words for a job step — and any name; stored and
  shown as written.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 0 Romanian texts in the translation files with a plain hyphen
  between letters.
- **SC-002**: 0 interface texts of the other language on any screen of the app
  in either language, measured on every route the app has today.
- **SC-003**: 0 screens with sideways scroll, cut-off text or text under 12 px
  at 320 px wide, in either language.
- **SC-004**: User text and names are identical, character for character, to
  what was stored, in both languages.

## Assumptions

- (autonomous default) The non-breaking hyphen U+2011 is used, as the Build
  brief proposes; the cockpit font and its fallbacks render it like a hyphen.
- (autonomous default) Catalogue items arrive with the names `name_ro` and
  `name_en`, the column names the Build brief gives; no catalogue exists in the
  app yet, so the helper is built and tested on its own and used by the screens
  that list them (Results, job types) when they are built.
- (autonomous default) Reviews, notes and captions are built in later epics
  (story note "Left for later"); this story builds the display they will use and
  puts the one name the app shows today (the dashboard's signed-in name) through
  it.
- (autonomous default) The screens that exist today are Home (`/ro`, `/en`),
  the cockpit sample (`/cockpit`) and the three dashboards; Results and Garage
  profile do not exist yet, so FR-006 and FR-007 are measured on these routes.
  The release-time screenshot comparison in the brief's Tests belongs to the
  release pipeline with those screens and is not built here.
- (autonomous default) "Marked so the browser leaves it untouched" is the HTML
  `translate="no"` attribute.
- The cockpit sample's garage names are sample data in the cockpit library,
  which ST-53 (PR #31) is changing; they are not rerouted through the display in
  this story, and FR-006's check already treats them as not interface text
  (they are in no translation file).

## Out of Scope

- Machine translation of reviews (Open in the brief: not needed for launch).
- Each screen's own texts: built with that screen.
- Release-time screenshot comparison of Home, Results and Garage profile.

## Spec Delta

### Capability: `i18n`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007
