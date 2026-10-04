# Research: The Cockpit theme

## 1. Where the tokens live
- **Decision**: one CSS file, `libs/ui-cockpit/src/styles/cockpit.css`; the component rules use `var(--mf-*)` for every colour, radius and focus value.
- **Rationale**: the theme must switch with the device instantly and without JS; a media query on custom properties does exactly that, works during SSR and before hydration, and keeps one place to change a value.
- **Alternatives**: Spartan's Tailwind theme variables (`--primary`, `--background`, …) mapped onto ours (a second naming layer, and a Tailwind build step).

## 2. Component library: Spartan UI, not PrimeNG (corrected 2026-10-04)
- **Decision**: `@spartan-ng/brain` 1.5.0 primitives (behaviour, ARIA, focus handling on Angular CDK) with helm components copied from the Spartan CLI 1.5.0 templates (`@spartan-ng/cli`, `src/generators/ui/libs/*/files`) into `libs/ui-cockpit/src/lib/helm`. Spartan 1.5 helms already separate looks into `spartan-*` hook classes (its style files apply Tailwind to those classes); the copies keep only those hook classes, as static host classes and `[class.x]` bindings, and `cockpit.css` paints them from the tokens.
- **Rationale**: the owner's decision (constitution v1.3.0): PrimeNG 22 (the only line for Angular 22) moved to the PrimeUI License with a licence key and shows a banner without one; front-end dependencies must be free and open source. No Tailwind: one stylesheet keeps one place per value (Principle I) and no second styling toolchain (Principle IV); helm's `classes()`/`hlm()` utility (clsx + tailwind-merge) is dropped with it.
- **Adaptations**: icons (`@ng-icons/lucide`) replaced by one inline close cross (`close-icon.ts`); dialog and drawer close buttons take a required `closeLabel` so the text stays with the page (later translation keys); the toaster wraps `brn-sonner-toaster` with `toastOptions.classes.toast = 'spartan-toast'`; `brn-switch` passes its `class` to its inner `<button role=switch>`, so the switch rules target `button.spartan-switch`; button sizes dropped (one 44 px size).
- **Evidence**: `npm view @spartan-ng/brain@1.5.0 peerDependencies license` (MIT; Angular `>=21 <23`); `node_modules/@spartan-ng/brain/fesm2022/spartan-ng-brain-sonner.mjs:5` imports `clsx`; Spartan CLI `style-nova.css` defines `.spartan-button`, `.spartan-switch`, … with Tailwind `@apply`.
- **Superseded**: PrimeNG 22.1.2 + `@primeuix/themes` 3.0.1 preset on Aura, with an optional `license` from a build-time `PRIMEUI_LICENSE` (built in commits 21e4077 and 6bd45cb, replaced forward, never rewritten).

## 3. Typefaces
- **Decision**: `@fontsource/michroma` (400, latin + latin-ext, `font-display: swap`) and `@fontsource-variable/hanken-grotesk` (one variable file per subset), imported at the top of `cockpit.css`. Stacks: label `'Michroma', 'Hanken Grotesk Variable', system-ui, sans-serif`; body `'Hanken Grotesk Variable', system-ui, sans-serif`.
- **Rationale**: self-hosted with swap (Build brief); per-glyph fallback to Hanken Grotesk through the stack (spec Assumptions); `unicode-range` loads only the subsets a page uses.
- **Evidence**: `node_modules/@fontsource/michroma/index.css` (latin-ext range `U+0100-02BA` covers ă U+0103, â U+00E2 in latin, î U+00EE, ș U+0219, ț U+021B); file sizes in plan Technical Context.
- **Open**: the ST-249 *proposed* budget says "at most 2 font files"; a Romanian page loads up to 4 subset files (86.7 KB, under 100 KB). Left to the owner's budget decision.

## 4. 44 px targets
- **Decision**: `min-height: var(--mf-tap)` on `.spartan-button`, `.spartan-input`, `.spartan-tabs-trigger` and `button.spartan-switch` (the switch's track is a `::before` inside the 44 px button); the helm button has no size input, so there is no smaller variant.
- **Alternatives**: computing padding to reach 44 px (fragile against font size changes).

## 5. Selected state and amber
- **Decision**: `.spartan-button-variant-default` = `var(--mf-amber)` fill with `var(--mf-on-amber)` text, Michroma capitals (the mock's CTA); `button.spartan-switch[data-state=checked]::before` = amber; the active tab (`[data-state=active]`) and a selected row (`[data-state=selected]`) = `var(--mf-amber-tint)` background, `var(--mf-amber-ink)` text and border; secondary buttons outlined in `--mf-line-strong` on transparent with the text colour; ghost transparent.
- **Evidence**: design.md board A; spec FR-007; brain sets `data-state` on tab triggers (`spartan-ng-brain-tabs.mjs`, `BrnTabsTrigger` host) and switches (`spartan-ng-brain-switch.mjs`).

## 6. Focus ring
- **Decision**: one global `:focus-visible` outline, 3 px solid `var(--mf-focus)` offset 3 px, which every helm part inherits (brain adds no outline of its own); toasts set `outline: none` in the toaster's own styles, so `.spartan-toast:focus-visible` restores the ring. `--mf-focus` is FFB000 in dark, 8A5E00 in light (FFB000 on F4F4F1 is 1.9:1).
- **Evidence**: design.md (mock `outline:3px solid #FFB000;outline-offset:3px`); `spartan-ng-brain-sonner.mjs` (`[data-sonner-toast]{…outline:none…}`).

## 7. Colour-literal check
- **Decision**: a Jest spec in `libs/ui-cockpit` walks `apps/web/src` and `libs/*/src`, skipping `libs/ui-cockpit`, generated directories (`libs/data-access/src/lib`, `libs/domain/src/generated`) and `*.spec.ts`, and fails on `#` + 3/4/6/8 hex digits not followed by a word character, or `rgb(`/`rgba(`/`hsl(`/`hsla(`.
- **Evidence**: spec Clarifications Q3; `biome.json` has no colour rule.

## 8. Screenshot comparison
- **Decision**: not stored; e2e asserts computed colours per scheme instead (spec Assumptions). The owner reviews `/cockpit` live.
