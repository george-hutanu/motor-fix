---
capability: cockpit-theme
updated: 2026-10-04
features:
  - 050-cockpit-theme
---

# Capability: Cockpit theme

The shared look of the web app: the `--mf-*` design tokens in a dark and a light set chosen by the device, the two self-hosted typefaces, the Spartan helm components (on `@spartan-ng/brain`) that take their surfaces, borders and focus rings from those tokens, and the panel part.

## Requirements

### 050-FR-001 — The theme MUST define the dark token set with exactly the dark values of US1 scenario 1, applied when the device prefers dark.

_From 050-cockpit-theme._

### 050-FR-002 — The theme MUST define the light token set with the values of US1 scenario 2, applied when the device prefers light (or states no preference) and when printing.

_From 050-cockpit-theme._

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

### 050-FR-010 — The type scale MUST be one set of tokens with no per-width variation and a 12 px floor: no rendered text smaller than 12 px at any width (checked at 375 px); body text (the default Hanken Grotesk size) 13 px or more; form-field text 16 px.

_From 050-cockpit-theme._

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

## Retired
