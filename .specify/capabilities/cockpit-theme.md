---
capability: cockpit-theme
updated: 2026-10-08
features:
  - 050-cockpit-theme
  - 158-small-action-sheet
  - 953-ui-review-checks
  - 954-input-border-contrast
---

# Capability: Cockpit theme

The shared look of the web app: the `--mf-*` design tokens in a dark and a light set chosen by the device, the two self-hosted typefaces, the Spartan helm components (on `@spartan-ng/brain`) that take their surfaces, borders and focus rings from those tokens, and the panel part.

## Requirements

### 954-FR-001 — In the dark theme, the strong line colour (`--mf-line-strong`) MUST reach a contrast ratio of at least 3:1 against each of the background, the panel and the raised panel surfaces, as measured by the WCAG 2.1 relative-luminance formula (the design-audit contrast tool).

_From 954-input-border-contrast._

### 954-FR-002 — In the light theme, and therefore the print set that reuses it, the strong line colour MUST reach at least 3:1 against each of the same three surfaces.

_From 954-input-border-contrast._

### 050-FR-003 — The theme MUST follow the device's colour-scheme setting live, with no reload, no stored choice and no in-app switch, and MUST NOT disturb form input when it changes.

_From 050-cockpit-theme._

### 050-FR-004 — Every colour token MUST exist in both the dark and the light set, and every token MUST be a CSS custom property named `--mf-*`.

_From 050-cockpit-theme._

### 050-FR-005 — The theme MUST define tokens for type (the two families, the size scale, label letter-spacing 0.14em), spacing (a 4 px scale), radius (20 px panels, 12 px controls, 10 px chips) and focus (ring width, offset and colour).

_From 050-cockpit-theme._

### 050-FR-006 — The theme MUST provide Spartan helm components in `libs/ui-cockpit` — button, input, label, toggle switch, tabs, table, dialog, drawer (sheet), toast (toaster) and popover, each built on its `@spartan-ng/brain` primitive — whose surfaces, borders, text, primary and selected colours, radii and focus rings resolve to the `--mf-*` tokens through the `spartan-*` style classes in `cockpit.css`, so that feature code needs no CSS. No colour literal sits outside the token blocks of `cockpit.css`, and no styling toolchain beyond that stylesheet (no Tailwind) is added.

_From 050-cockpit-theme._

### 050-FR-007 — The default (primary) button variant MUST be the solid amber fill with dark text, and amber is also the on-state of a toggle switch; the selected state (selected tabs, rows, chips) MUST use amber text and border on a 10% amber tint, as in the mock; the secondary and ghost button variants MUST NOT be amber.

_From 050-cockpit-theme._

### 050-FR-008 — The theme MUST be registered for the whole web app with one provider, `provideCockpitTheme()`, which sets the overlay defaults the helm overlays need (CDK overlays outside the browser top layer, so the toaster stays above dialogs and drawers); the colour scheme follows the system setting through CSS alone. No licence key and no dependency that needs one (constitution v1.3.0, Principle III).

_From 050-cockpit-theme._

### 050-FR-009 — In both themes, each text token (text, secondary text, amber text) MUST reach 4.5:1 against each surface (background, panel, raised panel), and the dark text on the amber fill MUST reach 4.5:1; each status colour (green, red) and the focus ring MUST reach 3:1 against each surface. Status colours are never body text (a lamp or status always has a text label), so 3:1 applies to them.

_From 050-cockpit-theme._

### 953-FR-021 — The Cockpit type scale MUST stay one set of tokens with no per-width variation and a 12 px floor (no rendered text under 12 px at any width); its body size (the default body typeface size) MUST be 16 px and its form-field size 16 px, so the theme itself meets FR-001 on every viewport.

_From 953-ui-review-checks._

### 050-FR-011 — Michroma MUST be used for labels, headings and numerals, in capitals with 0.14em spacing; Hanken Grotesk for all other text. Both MUST be self-hosted with `font-display: swap`, cover Latin Extended (ă, â, î, ș, ț), and fall back to Hanken Grotesk then the system sans-serif.

_From 050-cockpit-theme._

### 050-FR-012 — Every focusable element MUST show a visible focus ring on keyboard focus in both themes, and in forced-colours mode.

_From 050-cockpit-theme._

### 050-FR-013 — The interactive box (padding included) of buttons, inputs, toggle switches and tabs styled by the theme MUST be at least 44 px tall at every width; the theme offers no smaller size variant.

_From 050-cockpit-theme._

### 050-FR-014 — The theme MUST provide a panel part: a card with a 20 px radius, a hairline border, the panel surface, and an optional Michroma capital title; in forced-colours mode the border stays.

_From 050-cockpit-theme._

### 050-FR-015 — The theme MUST provide a sample page with the components listed in US6 scenario 1, reachable in the web app, for the owner's approval of the light theme.

_From 050-cockpit-theme._

### 050-FR-016 — No front-end source file outside the theme library — `.ts`, `.html`, `.css`, `.scss` under `apps/web/src` and `libs/*/src`, excluding `libs/ui-cockpit`, generated code and test files — MUST contain a hard-coded colour literal (`#` followed by 3, 4, 6 or 8 hex digits and no further word character, or `rgb(`/`rgba(`/`hsl(`/`hsla(`); a check in the test suite MUST fail when one appears.

_From 050-cockpit-theme._

### 954-FR-003 — The corrected colours MUST stay a neutral grey of the same hue family as today's (a mid-grey, no tint toward amber or blue; judged in review, not by a test), and no other colour token MUST change: the hover border (secondary text), the focus border (amber ink) and the invalid border (red) stay as they are, since they already pass 3:1.

_From 954-input-border-contrast._

### 954-FR-004 — The theme library's test suite MUST contain a test that measures the strong line colour against every surface in both themes and fails, naming the theme, the token, the surface and the ratio, when any pair is under 3:1, and that fails when the switch thumb colour (`--mf-text`) on the strong line colour is under 3:1. It collects every failing pair per theme before asserting, compares the unrounded ratio, and MUST be written before the token change and seen failing against today's values.

_From 954-input-border-contrast._

### 954-FR-005 — Every screen with a text field, the theme's sample page included, MUST be checked at 320 px, 390 px, tablet and desktop widths, in dark and light, Romanian and English: each field's border is visible, no screen scrolls sideways at 320 px, and no accessibility violation appears that the latest merged PR QA report did not already show for the same route, size, scheme and language. The PR's QA run is that check; its screenshots are the evidence.

_From 954-input-border-contrast._

### 954-FR-006 — The change MUST add no service, endpoint, queue, outside call or product action, and so no observability entry.

_From 954-input-border-contrast._

### 954-FR-007 — The decorative divider colour (`--mf-line`: panel borders, table rules, separators) MUST NOT change: it bounds no control and is outside WCAG 1.4.11.

_From 954-input-border-contrast._

## Retired

- `050-FR-010` — superseded by `953-FR-021` (2026-10-08)
- `050-FR-001` — superseded by `954-FR-001` (2026-10-08)
- `050-FR-002` — superseded by `954-FR-002` (2026-10-08)
