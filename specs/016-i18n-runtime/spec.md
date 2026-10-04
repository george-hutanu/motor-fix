# Feature Specification: Translation files and runtime language switching

**Feature Branch**: `016-i18n-runtime`

**Created**: 2026-10-04

**Status**: Archived (2026-10-04)

**Input**: User description: "ST-16 Set up translation files and runtime language switching (Notion story ST-16, epic Foundations EP-1). Romanian and English, switch at runtime with no reload, in the Angular SSR web app. One ro.json/en.json pair per area so parallel lanes never share one translation file."

**Sources**: Notion story ST-16 https://app.notion.com/p/3ee607bff0d281c3927ec1b8e980be00 (read 2026-10-04, page edited 2026-10-03; no open comments) · epic EP-1 Foundations https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707 · feature https://app.notion.com/p/3ee607bff0d281618e30f8787e2c3dd3

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every text comes from a translation file, per area (Priority: P1)

A developer adding a screen to any area of the web app (shell, public, driver,
garage, mechanic, admin) puts its interface text into that area's Romanian and
English files, never into the screen. Two people building different areas never
edit the same translation file.

**Why this priority**: Every later screen of every role depends on it; without
it, every screen would have to be revisited to become bilingual.

**Independent Test**: Run the project's checks with a screen that types text
directly into its template, and with an area whose English file lacks a key the
Romanian file has: both checks fail, naming the file and the text or key.

**Acceptance Scenarios**:

1. **Given** the web app, **then** each of the six areas has one Romanian and
   one English file, and the existing skeleton page shows only text that comes
   from the shell area's keys.
2. **Given** an area whose Romanian and English files do not have the same keys,
   **when** the checks run, **then** they fail and name the area and the key.
3. **Given** a template with interface text typed directly in it, **when** the
   checks run, **then** they fail and name the file and the text.
4. **Given** a Romanian text written with ş or ţ (cedilla), **when** the checks
   run, **then** they fail and name the key.

---

### User Story 2 - The language changes while the app runs (Priority: P1)

A person reading a screen in Romanian changes the language to English: every
visible text changes at once, the page does not reload, and the page declares
English as its language.

**Why this priority**: It is the story's purpose — "switched without a reload".

**Independent Test**: Render a screen, change the language to English, and
observe the same screen instance now showing English text, with the page
language set to `en`.

**Acceptance Scenarios**:

1. **Given** a screen showing Romanian, **when** the language is set to `en`,
   **then** every visible text on it changes to English without reloading the
   page, and the page language becomes `en`.
2. **Given** English is shown, **when** the language is set back to `ro`,
   **then** every visible text returns to Romanian and the page language
   becomes `ro`.
3. **Given** a page served from the server, **then** it arrives in Romanian,
   declares `ro` as its language, and shows no empty text and no raw key.

---

### User Story 3 - Nothing is ever blank (Priority: P2)

When an English text is missing, or the English file of an area cannot be
loaded, the person sees the Romanian text instead — never an empty space and
never a key.

**Why this priority**: A blank label is worse than a label in the other
language; Romanian is the product's first language.

**Independent Test**: Remove one key from an English file (at run time, not in
the shipped files) and show the screen in English; make an English file fail to
load and show the screen in English.

**Acceptance Scenarios**:

1. **Given** a key missing in English, **when** the screen is in English,
   **then** that text shows in Romanian.
2. **Given** an area's English file fails to load, **when** the screen is in
   English, **then** the area shows its Romanian texts.

---

### User Story 4 - Only the areas in use are downloaded, and counts read right (Priority: P3)

A driver browsing public pages never downloads the garage or admin texts; a
count reads naturally in each language ("1 service", "3 service-uri",
"48 de service-uri").

**Why this priority**: Keeps the first page light as areas grow, and makes
counts correct from the first screen that shows one.

**Independent Test**: Open a screen of one area and observe which text files
were requested; render a count of 1, 3 and 48 in Romanian and English.

**Acceptance Scenarios**:

1. **Given** a person who opens only one area, **then** no text file of another
   area (other than the shell's) is requested.
2. **Given** a counted text, **when** the count is 1, 3 or 48 in Romanian,
   **then** it reads "1 service", "3 service-uri", "48 de service-uri".

### Edge Cases

- A key missing in Romanian too is a build failure when a template names it
  literally (FR-004's unknown-key check); a key built at run time from data is
  the caller's responsibility.
- Setting a language that is not in the list of languages does nothing; the
  current language stays.
- A text whose placeholder (`{name}`) gets no parameter shows the placeholder
  as written.
- A Romanian file that cannot be loaded is an asset outage and out of scope;
  Romanian is the floor every fallback lands on.
- Switching language twice quickly ends on the last language chosen.
- Text written by people (names, reviews) is shown as written; only interface
  text is translated.
- Brand and product names are still served from keys, with the same value in
  both languages.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The list of supported languages MUST be defined once, as Romanian
  (`ro`) and English (`en`); Romanian is the default language and the fallback
  language.
- **FR-002**: Each area — shell, public, driver, garage, mechanic, admin — MUST
  have its own Romanian file and its own English file; no translation file is
  shared between areas.
- **FR-003**: The project checks MUST fail when an area's Romanian and English
  files do not have the same keys (compared as the flattened dotted key set),
  or when a value is empty or whitespace only, naming the area and the key.
  Plural keys are exempt from parity at the category level: each language
  carries the categories its plural rules use (Romanian one/few/other, English
  one/other).
- **FR-004**: The project checks MUST fail when an Angular template in the web
  app or its libraries contains interface text not taken from a key — a text
  node, the literal part of an interpolated text, or a static `title`,
  `aria-label`, `placeholder`, `alt` or `label` attribute — that contains a
  letter, naming the file and the text. Expressions and bound attributes are
  not text, except a string literal containing a letter shown inside `{{ }}`
  that is not the key given to the translation (`{{ x ?? 'unknown' }}`). The checks MUST also fail when a template passes a literal key to
  the translation that no Romanian file defines, naming the file and the key.
- **FR-005**: The project checks MUST fail when a Romanian text uses ş, Ş, ţ or
  Ţ (cedilla) instead of ș, Ș, ț or Ț (comma below).
- **FR-006**: Setting the language at run time MUST change every visible
  interface text to the new language without reloading the page, and MUST set
  the page's declared language (`<html lang>`) to it. Setting a language
  outside the list does nothing: no error, and the current language stays.
- **FR-007**: A text missing in the current language MUST show in Romanian —
  never an empty text and never the key.
- **FR-008**: When an area's file for the chosen language fails to load, the
  area MUST show its Romanian texts.
- **FR-009**: An area's text files MUST be downloaded only when that area is
  used — its Romanian file always, its English file when English is current;
  the shell's Romanian texts ship with the app.
- **FR-010**: Counted texts MUST follow each language's plural rules, one key
  per plural category; in Romanian 0, 1, 3, 19, 20 and 48 read "0
  service-uri", "1 service", "3 service-uri", "19 service-uri", "20 de
  service-uri", "48 de service-uri".
- **FR-011**: Pages rendered on the server MUST arrive in Romanian, declaring
  `ro`, with every text already filled in.
- **FR-012**: The existing skeleton page MUST take all its interface text from
  the shell area's keys.

### Key Entities

- **Language**: one of the supported languages (`ro`, `en`); one is current.
- **Area**: a part of the app with its own texts (shell, public, driver,
  garage, mechanic, admin); the shell's texts are always present.
- **Translation file**: the texts of one area in one language, as keys
  (English, dotted, grouped by screen, e.g. `auth.signIn.title`) to text.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The untranslated-text check reports zero findings on the web app,
  and fails on a template given one typed-in text.
- **SC-002**: After a language change, 100% of the visible interface texts on
  the screen are in the new language, and the page was not reloaded.
- **SC-003**: Zero empty texts and zero raw keys are shown when an English text
  or file is missing.
- **SC-004**: Visiting one area requests zero text files of other areas besides
  the shell.

## Clarifications

### Session 2026-10-04

- Q: The Build brief's scenario 6 (API error codes shown through keys, A28
  proposed) — in scope? → A: Deferred to ST-159 (shared saving, validation and
  errors), whose brief requires "a message key in both languages" per code and
  is the first story that shows an API error to a person; keys and a helper now
  would have no caller (constitution Principle I). The API's problem details
  already carry a stable `code` (`apps/api/src/problem.filter.ts:12-16`). The
  owner may overrule this. (autonomous default)
- Q: How is the switch exercised before the RO / EN control exists? → A: The
  control and remembering the choice are ST-17 (out of scope per the Build
  brief). This story exposes the switch as the library's public API and proves
  it in component tests; the end-to-end check here covers the server-rendered
  Romanian page and `lang="ro"`. The brief's end-to-end switch on Home with the
  sign-in dialog open needs screens and a control that do not exist yet and
  moves to ST-17. (autonomous default)
- Q: When a person is in English and opens an area, which files load, and is
  every area's Romanian bundled? → A: Only the shell's Romanian ships with the
  app. An area's Romanian file loads whenever the area is used, in any
  language, and its English file loads in addition when English is current.
  "Romanian from the build" means the shipped Romanian file. A Romanian file
  that cannot be loaded is an asset outage, like a missing script, and is out
  of scope. (autonomous: recommended)
- Q: What counts as typed-in interface text for the check? → A: A text node or
  a static attribute value (`title`, `aria-label`, `placeholder`, `alt`,
  `label`) that contains a letter, after trimming. Expressions inside `{{ }}`
  and bound attributes (`[x]`, `(x)`) are code, not text. Strings in component
  classes are not checked here (a known gap ST-18 can close). (autonomous:
  recommended)
- Q: How are counted texts written, and what do the boundary counts read? →
  A: One key per plural category (`.one`, `.few`, `.other`), chosen by the
  language's standard plural rules — no message-format dependency
  (Principle I). Romanian: 0 → "0 service-uri", 1 → "1 service", 3 → "3
  service-uri", 19 → "19 service-uri", 20 → "20 de service-uri", 48 → "48 de
  service-uri"; English: one/other. (autonomous: recommended)
- Q: Does an empty value pass the parity check? → A: No; an empty or
  whitespace-only value fails it, naming the area and key. Keys are compared as
  the flattened dotted set; order does not matter. (autonomous: recommended)
- Q: Does setting an unsupported language throw? → A: No; it is a silent no-op
  and the current language stays (ST-17 will feed it values read from storage).
  (autonomous: recommended)

## Assumptions

- The six areas are the Build brief's list; areas without screens yet get
  their file pair now so parallel lanes each own a file from day one.
  (autonomous default)
- The language is not remembered between visits and is not taken from the URL
  or the account — those are ST-17, the per-language addresses story and the
  account-language story. Every visit starts in Romanian. (autonomous default)
- The checks run as part of the project's test suite, which runs on every
  commit and before every release; that is the "build check" the brief asks
  for. (autonomous default)
- "Retries on the next navigation" (brief, States and errors) is met when a
  later language change or area visit tries the file again; no timed retry.
  (autonomous default)
- Sentences are written whole, with placeholders, never glued from pieces
  (Build brief, Rules); a review rule, not a mechanical check.
- A third language is not needed for launch (brief, Open); adding one is a new
  file pair per area and one entry in the language list.
- The API's status values (`ok`, `error`) on the skeleton page are data from the
  API and are shown as received; the words around them are interface text.
  (autonomous default)

## Spec Delta

### Capability: `i18n`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012
