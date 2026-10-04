# Feature Specification: The Cockpit theme — colours, type and panels

**Feature Branch**: `050-cockpit-theme`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "ST-50 Build the Cockpit theme: colours, type and panels (Notion story ST-50, epic Foundations EP-1 https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707). PrimeNG with the Cockpit theme for every component, including a light theme derived from the dark one that follows the device setting (decision superseding ST-54, 2026-10-03); smallest text on a phone is 12px."

**Sources**: the Notion story [ST-50](https://app.notion.com/p/3ee607bff0d281e5a35be24ed2edf607) (acceptance criteria and Build brief, read 2026-10-04; the story has no comments), its feature page [MF-3 Cockpit design system and motion](https://app.notion.com/p/3ee607bff0d2817aa8bdc2f304d558b2), the epic [Foundations (EP-1)](https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707), and `.specify/memory/constitution.md`. The Build brief wins where it and the story's acceptance criteria differ; the 2026-10-03 decision (a light theme at launch following the device; 12 px minimum on a phone) supersedes the earlier dark-only, 9 px-label wording.

This story is the shared look every later screen is built on. Its users are everyone who opens MotorFix (visitors and every role) and, directly, the build team, who style screens only through it. The Build brief named PrimeNG and a theme preset; the owner's decision of 2026-10-04 (constitution v1.3.0, Principle III; Notion Architecture decisions A1) replaced PrimeNG with Spartan UI — `@spartan-ng/brain` primitives on Angular CDK with helm components copied into `libs/ui-cockpit` — because PrimeNG 22 needs a licence key and every front-end dependency must be free and open source. The tokens, type, contrast and panel requirements are unchanged; only the component layer moved (see Spec Delta, Correction).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Any screen opens in the Cockpit look that matches the device's dark or light setting (Priority: P1)

A person opens MotorFix. If their device is in dark mode, they see the near-black instrument-cluster look of the mock; if it is in light mode, they see the derived light theme. If the device switches while a screen is open, the colours change at once and nothing they typed is lost.

**Why this priority**: every screen depends on the colour tokens; nothing else in the epic's UI can be built consistently without them.

**Independent Test**: open the sample page with the browser emulating dark, then light, and read the background, panel, hairline, text and accent colours; type in a field, flip the emulated scheme, and check the text is still there.

**Acceptance Scenarios**:

1. **Given** a device in dark mode, **When** any screen opens, **Then** it uses background 0B0C0E, panels 101215 and 15171A, hairlines 2A2D31, text F2F2F0, secondary text B5B8BE, amber FFB000, green 32D74B, red FF5A4F.
2. **Given** a device in light mode, **When** any screen opens, **Then** it uses background F4F4F1, panels FFFFFF and ECECE8, hairlines D3D5D8, text 15171A, secondary text 50545B, amber fill FFB000 with dark text, amber 8A5E00 for amber text and lines, green 1E8E34, red D93A30.
3. **Given** the device switches from dark to light while a form is open, **When** the switch happens, **Then** the colours change without a reload and the typed value stays.

---

### User Story 2 - Standard components take their look from the theme, never from one-off styling (Priority: P1)

A developer drops a Cockpit helm button, input, toggle switch, dialog, drawer, toast, popover or table (from `@motor-fix/ui-cockpit`) into a screen. It renders with Cockpit surfaces, hairline borders, radii and amber focus rings without any CSS in the feature code.

**Why this priority**: the story's purpose ("every standard component looks the same without one-off styling").

**Independent Test**: render the sample page, which contains each listed component with no component-level CSS, and check their surfaces, borders and focus rings resolve to the tokens.

**Acceptance Scenarios**:

1. **Given** the listed helm components, **When** they render, **Then** their surfaces, borders and focus rings come from the theme tokens.
2. **Given** the main action on a view, **When** it renders, **Then** it is the only solid amber control; selected chips and tabs use amber text and border on a light amber tint, a toggle that is on uses amber; secondary actions do not.
3. **Given** anything tappable from the theme (buttons, inputs, toggles, tabs), **When** it renders, **Then** it is at least 44 px tall.

---

### User Story 3 - Text is legible: two typefaces, sizes and contrast (Priority: P1)

A person reads MotorFix on a phone or a desktop in either theme. Labels, headings and numerals are in Michroma capitals with wide spacing; everything they read is in Hanken Grotesk. No text on a phone is smaller than 12 px; body text is at least 13 px; form fields on a phone are at least 16 px. Every text colour keeps WCAG AA contrast against its background. Romanian letters show correctly.

**Why this priority**: the 2026-10-03 decision and accessibility; it cannot be retrofitted after screens exist.

**Independent Test**: at 375 px wide, read every rendered text element's computed font size; run the contrast test over every token pair in both themes; render a Romanian label in both typefaces.

**Acceptance Scenarios**:

1. **Given** a phone (375 px wide), **When** any screen renders, **Then** no text is smaller than 12 px, capital labels and tab labels included.
2. **Given** any text and background pair in either theme, **When** the contrast test runs, **Then** text is at least 4.5:1 and large text, status colours, icons and focus rings are at least 3:1.
3. **Given** a Romanian label with ș, ț, ă, â and î, **When** it renders in Michroma and in Hanken Grotesk, **Then** every glyph shows; where Michroma lacks one, that glyph renders in Hanken Grotesk.
4. **Given** the typefaces fail to load, **When** a screen renders, **Then** text shows in the system sans-serif at the same sizes.

---

### User Story 4 - Keyboard focus is always visible (Priority: P1)

A person tabs through a screen. Every focusable element shows a visible focus ring in both themes, including in Windows high-contrast (forced colours) mode.

**Why this priority**: an acceptance criterion of the story and the feature.

**Independent Test**: tab through the sample page in both schemes and check each focused element has a visible outline or ring.

**Acceptance Scenarios**:

1. **Given** keyboard navigation, **When** focus moves, **Then** a visible focus ring shows on every focusable element in both themes.
2. **Given** forced-colours mode, **When** a panel and a focused control render, **Then** the panel keeps its border and the focus ring stays visible.

---

### User Story 5 - Panels (Priority: P2)

A developer wraps content in the Cockpit panel. It renders as a rounded card (radius 20 px) with a hairline border and a small capital title.

**Why this priority**: the one shared part this story owns; later stories (lamp, dial, dashboards) sit inside panels.

**Independent Test**: render a panel with a title and check its radius, border, title typeface and case.

**Acceptance Scenarios**:

1. **Given** a panel with a title, **When** it renders, **Then** it is a card with a 20 px radius, a hairline border, the panel surface colour, and a Michroma capital title of at least 12 px.

---

### User Story 6 - The owner approves the derived light theme on a sample page (Priority: P2)

The owner opens a sample page that shows the main components and a panel, and views it in both themes, to approve the light theme or ask for changes before launch.

**Why this priority**: the light theme is not designed in the mock; the owner approves it before it goes live [X26g].

**Independent Test**: open the sample page in dark and light emulation and compare screenshots.

**Acceptance Scenarios**:

1. **Given** the sample page, **When** it is opened in dark and in light, **Then** it shows a primary and a secondary button, an input, a toggle switch, a table, a selected tab, a panel, and controls that open a dialog, a drawer, a toast and a popover.

---

### Edge Cases

- The device switches scheme while a screen is open → colours change at once, no reload, no lost input (US1).
- A font fails to load → system sans-serif at the same sizes, layout intact (US3).
- Michroma lacks a Romanian glyph → that glyph falls back to Hanken Grotesk (US3).
- Forced colours (Windows high contrast) → panels keep borders, focus rings stay visible (US4).
- Printing → printed pages use the light tokens (feature page edge cases, *proposed*).
- A browser with no colour-scheme preference → light, as browsers report it (`prefers-color-scheme: light` is the default).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The theme MUST define the dark token set with exactly the dark values of US1 scenario 1, applied when the device prefers dark.
- **FR-002**: The theme MUST define the light token set with the values of US1 scenario 2, applied when the device prefers light (or states no preference) and when printing.
- **FR-003**: The theme MUST follow the device's colour-scheme setting live, with no reload, no stored choice and no in-app switch, and MUST NOT disturb form input when it changes.
- **FR-004**: Every colour token MUST exist in both the dark and the light set, and every token MUST be a CSS custom property named `--mf-*`.
- **FR-005**: The theme MUST define tokens for type (the two families, the size scale, label letter-spacing 0.14em), spacing (a 4 px scale), radius (20 px panels, 12 px controls, 10 px chips) and focus (ring width, offset and colour).
- **FR-006**: The theme MUST provide Spartan helm components in `libs/ui-cockpit` — button, input, label, toggle switch, tabs, table, dialog, drawer (sheet), toast (toaster) and popover, each built on its `@spartan-ng/brain` primitive — whose surfaces, borders, text, primary and selected colours, radii and focus rings resolve to the `--mf-*` tokens through the `spartan-*` style classes in `cockpit.css`, so that feature code needs no CSS. No colour literal sits outside the token blocks of `cockpit.css`, and no styling toolchain beyond that stylesheet (no Tailwind) is added.
- **FR-007**: The default (primary) button variant MUST be the solid amber fill with dark text, and amber is also the on-state of a toggle switch; the selected state (selected tabs, rows, chips) MUST use amber text and border on a 10% amber tint, as in the mock; the secondary and ghost button variants MUST NOT be amber.
- **FR-008**: The theme MUST be registered for the whole web app with one provider, `provideCockpitTheme()`, which sets the overlay defaults the helm overlays need (CDK overlays outside the browser top layer, so the toaster stays above dialogs and drawers); the colour scheme follows the system setting through CSS alone. No licence key and no dependency that needs one (constitution v1.3.0, Principle III).
- **FR-009**: In both themes, each text token (text, secondary text, amber text) MUST reach 4.5:1 against each surface (background, panel, raised panel), and the dark text on the amber fill MUST reach 4.5:1; each status colour (green, red) and the focus ring MUST reach 3:1 against each surface. Status colours are never body text (a lamp or status always has a text label), so 3:1 applies to them.
- **FR-010**: The type scale MUST be one set of tokens with no per-width variation and a 12 px floor: no rendered text smaller than 12 px at any width (checked at 375 px); body text (the default Hanken Grotesk size) 13 px or more; form-field text 16 px.
- **FR-011**: Michroma MUST be used for labels, headings and numerals, in capitals with 0.14em spacing; Hanken Grotesk for all other text. Both MUST be self-hosted with `font-display: swap`, cover Latin Extended (ă, â, î, ș, ț), and fall back to Hanken Grotesk then the system sans-serif.
- **FR-012**: Every focusable element MUST show a visible focus ring on keyboard focus in both themes, and in forced-colours mode.
- **FR-013**: The interactive box (padding included) of buttons, inputs, toggle switches and tabs styled by the theme MUST be at least 44 px tall at every width; the theme offers no smaller size variant.
- **FR-014**: The theme MUST provide a panel part: a card with a 20 px radius, a hairline border, the panel surface, and an optional Michroma capital title; in forced-colours mode the border stays.
- **FR-015**: The theme MUST provide a sample page with the components listed in US6 scenario 1, reachable in the web app, for the owner's approval of the light theme.
- **FR-016**: No front-end source file outside the theme library — `.ts`, `.html`, `.css`, `.scss` under `apps/web/src` and `libs/*/src`, excluding `libs/ui-cockpit`, generated code and test files — MUST contain a hard-coded colour literal (`#` followed by 3, 4, 6 or 8 hex digits and no further word character, or `rgb(`/`rgba(`/`hsl(`/`hsla(`); a check in the test suite MUST fail when one appears.

### Key Entities

- **Design token**: a named CSS custom property (`--mf-*`) with one value per theme (colour) or one value for both (type, spacing, radius, focus).
- **Theme**: dark or light; derived from the device, never stored.
- **Helm component**: a Spartan helm directive or component in `libs/ui-cockpit` wrapping a `@spartan-ng/brain` primitive; it carries `spartan-*` style classes that `cockpit.css` paints from the `--mf-*` tokens.
- **Panel**: the shared card part.

## Spec Delta

### Capability: `cockpit-theme`

- **Adds**: FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016

**Correction (2026-10-04, `/speckit-correct-course`)** — the owner replaced PrimeNG with Spartan UI (constitution v1.3.0, Principle III: PrimeNG 22 needs a licence key; front-end dependencies stay free and open source). Nothing here was merged into a capability yet, so the corrected requirements stay `Adds`:

- FR-006 was "one PrimeNG preset, `CockpitPreset`" → is now helm components in `libs/ui-cockpit` painted by `spartan-*` classes in `cockpit.css` from the `--mf-*` tokens.
- FR-007 was "the preset's primary colour / highlight" → is now the default button variant, the switch on-state and the selected tab/row state.
- FR-008 was "PrimeNG dark-mode selector + optional PrimeUI licence key from `PRIMEUI_LICENSE`" → is now `provideCockpitTheme()` setting the overlay defaults; scheme by CSS only; no key.
- Removed with it: `primeng`, `@primeuix/themes`, `CockpitPreset`, `apps/web/src/primeui-license.ts`, `PRIMEUI_LICENSE` in `.env.example`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the colour pairs listed in the contrast test pass WCAG 2.2 AA in both themes (Build brief, *proposed* measure).
- **SC-002**: 0 text elements under 12 px on the sample page at 375 px wide, in either theme (Build brief [24]).
- **SC-003**: 0 hard-coded colour literals in source outside the theme library.
- **SC-004**: Switching the device scheme on an open form loses 0 characters of input and needs 0 reloads.
- **SC-005**: 100% of focusable elements on the sample page show a visible focus ring when tabbed to, in both themes.

## Clarifications

### Session 2026-10-04

- Q: Do the light-theme starting values ship as-is? → A: Yes, as the Build brief's *proposed* starting values; the owner approves them on the sample page before launch [X26g]. Approval is the owner's step, outside this run. (autonomous default; Build brief)
- Q: Where does the sample page live? → A: In the theme library, registered as one lazy route `/cockpit` in the web app. (autonomous default; Build brief scenario 11 needs it reachable, AGENTS.md ownership of `apps/web` by ST-16 keeps the web-app edit to one route entry)
- Q: How does the PrimeUI licence key reach PrimeNG 22? → A: Superseded the same day: the owner dropped PrimeNG for Spartan UI (constitution v1.3.0), so there is no key. (owner decision, 2026-10-04)
- Q: Spartan helm components ship with Tailwind classes; is Tailwind added? → A: No. The helm components are copied with only their `spartan-*` style-hook classes, and `cockpit.css` styles those classes from the tokens — one stylesheet, no second styling toolchain (Principles I and IV). (autonomous, recommended; research.md §2)
- Q: Does the end-to-end suite compare stored screenshots of the sample page, as the Build brief's Tests suggest? → A: No stored baseline while the light theme awaits the owner's approval; the suite asserts computed colours per scheme, and the owner reviews `/cockpit` by eye. (autonomous, recommended; context.md contradiction 2)
- Q: Which pairs does the contrast test cover, and is a status colour used as text held to 4.5:1 or 3:1? → A: Text tokens × surfaces at 4.5:1, dark-on-amber at 4.5:1, status colours and the focus ring × surfaces at 3:1; status colours always sit beside a text label, so 3:1. (autonomous, recommended by spec-challenger; FR-009)
- Q: Is 44 px the rendered height at every width, or a phone-only tap target? → A: The interactive box including padding, at every width, with no smaller size variant. (autonomous, recommended; FR-013)
- Q: Which files does the colour-literal check scan? → A: Front-end `.ts/.html/.css/.scss` under `apps/web/src` and `libs/*/src`, excluding `libs/ui-cockpit`, generated code and tests. It stays a Jest test (Notion says "a lint rule"; Biome has no rule for colour literals and a custom lint script would be a second toolchain — Principle IV). (autonomous, recommended; FR-016; context.md contradiction 1)
- Q: Is the type scale one set of sizes, or per breakpoint, and does the 16 px field size belong here? → A: One scale, 12 px floor at every width (Build brief, *proposed* for larger screens); body = the 13 px default; 16 px is the input font-size token; per-width layout stays with MF-4. (autonomous, recommended; FR-010)
- Q: Is the selected state a solid amber fill or the mock's amber border and text on a 10% tint? → A: The mock's tint treatment; solid amber is kept for the one main action and a toggle's on-state. (autonomous, recommended; FR-007; design.md board A)

## Assumptions

- Spartan UI's headless `@spartan-ng/brain` primitives carry behaviour and accessibility; the look comes only from `cockpit.css` (owner decision 2026-10-04, constitution v1.3.0). (autonomous default)
- The tokens' source of truth is one CSS file in `libs/ui-cockpit`; the component rules reference them with `var()`, so there is one place to change a value (Principle I). (autonomous default)
- Without a colour-scheme preference, browsers report light, so light is shown; dark is the default only when the device asks for it. (autonomous default, browser behaviour)
- Printed pages use the light tokens (feature page edge cases, *proposed*). (autonomous default)
- The lamp, rating dial, odometer digits, charts, motion, phone layouts, dialogs/drawers/sheets as shared parts are out of scope (story Build brief, Out of scope). The helm dialog, drawer, toast and popover land here only as Spartan's thin wrappers with the Cockpit look, shown on the sample page; the shared dialog/drawer/sheet patterns (layouts, phone sheets, motion) stay with their own stories.
- Colour is never the only signal — that rule is applied in ST-51, not here (Build brief).
- The "no hard-coded colour" check is a Jest test over the repository's source (the Build brief names it "a lint rule"; Biome has no built-in rule for colour literals, so a test keeps it in the existing toolchain — Principle IV). (autonomous default)
- A Romanian glyph Michroma lacks falls back per glyph to Hanken Grotesk through the font stack, rather than switching the whole label (Principle I; same visible outcome for a label whose other letters Michroma has). (autonomous default)
- Fonts: Michroma at its one weight and Hanken Grotesk as one variable font, each split by the browser into a Latin and a Latin Extended file via `unicode-range`, so a page loads only the subsets it uses. The ST-249 budget (2 font files, 100 KB) is *proposed* and open; this is recorded for that decision. (autonomous default; context.md Open Decisions)
- The screenshot comparison in the Build brief's Tests is replaced by assertions on computed colours in both schemes: the light theme is not yet approved, so a stored screenshot baseline would freeze unapproved values. (autonomous default)
