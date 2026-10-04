# Research: The Cockpit theme

## 1. Where the tokens live
- **Decision**: one CSS file, `libs/ui-cockpit/src/styles/cockpit.css`; the preset uses `var(--mf-*)` for every colour, radius and focus value.
- **Rationale**: the theme must switch with the device instantly and without JS; a media query on custom properties does exactly that, works during SSR and before hydration, and keeps one place to change a value.
- **Alternatives**: tokens in TypeScript emitted through PrimeNG's `extend` (variables would be `--p-*`, not `--mf-*`, and non-PrimeNG parts would depend on the preset); two PrimeNG colour schemes with literal values (two copies of every value).
- **Evidence**: `@primeuix/themes/dist/aura/base/index.mjs` — Aura v3 writes scheme-dependent values as `light-dark(a, b)`, and `@primeuix/styled` emits `color-scheme: light|dark` from `darkModeSelector` (default `"system"`), so tokens that reference our variables resolve the same in both schemes.

## 2. PrimeNG for Angular 22 and its licence
- **Decision**: `primeng` 22.1.2 with `@primeuix/themes` 3.0.1, styled mode, preset on Aura.
- **Evidence**: `npm view primeng@22.1.2 peerDependencies` (`@angular/core ^22.1.0`); 21.x peers `^21.0.7`. `node_modules/primeng/fesm2022/primeng-config.mjs:395-415`: `providePrimeNG` verifies a PrimeUI licence key offline; without one it logs a warning and shows a small fixed "Invalid PrimeUI License" banner (`primeng-license.mjs`). The licence (`node_modules/@primeui/license-manager/LICENSE.md`) offers a free Community License for small organisations, with a key.
- **Consequence**: the theme works without a key, but the banner shows. Getting a key is the owner's step (registration); `providePrimeNG` takes it as `license`. Reported as an open question, not built (no key exists to wire).

## 3. Typefaces
- **Decision**: `@fontsource/michroma` (400, latin + latin-ext, `font-display: swap`) and `@fontsource-variable/hanken-grotesk` (one variable file per subset), imported at the top of `cockpit.css`. Stacks: label `'Michroma', 'Hanken Grotesk Variable', system-ui, sans-serif`; body `'Hanken Grotesk Variable', system-ui, sans-serif`.
- **Rationale**: self-hosted with swap (Build brief); per-glyph fallback to Hanken Grotesk through the stack (spec Assumptions); `unicode-range` loads only the subsets a page uses.
- **Evidence**: `node_modules/@fontsource/michroma/index.css` (latin-ext range `U+0100-02BA` covers ă U+0103, â U+00E2 in latin, î U+00EE, ș U+0219, ț U+021B); file sizes in plan Technical Context.
- **Open**: the ST-249 *proposed* budget says "at most 2 font files"; a Romanian page loads up to 4 subset files (86.7 KB, under 100 KB). Left to the owner's budget decision.

## 4. 44 px targets
- **Decision**: global rules in `cockpit.css`: `min-height: var(--mf-tap)` on `.p-button`, `.p-inputtext`, `.p-tab`; the toggle switch's native input box is extended to 44 px tall around the visual track; the preset maps the `sm` sizes of buttons and fields to the default sizes, so there is no smaller variant.
- **Alternatives**: computing padding tokens to reach 44 px (fragile against font size changes).
- **Evidence**: `@primeuix/themes/dist/aura/button/index.mjs` (height comes from `form.field.padding.y` + font size), `aura/toggleswitch/index.mjs` (`height: 1.375rem`).

## 5. Selected state and amber
- **Decision**: `primary.color = var(--mf-amber)` (button fill, toggle on); `highlight` = `var(--mf-amber-tint)` background with `var(--mf-amber-ink)` text; tabs' active colour and bar = `var(--mf-amber-ink)`; secondary buttons outlined in `--mf-line-strong` on transparent with text colour.
- **Evidence**: design.md board A; spec FR-007; `aura/tabs/index.mjs` (`activeColor: {primary.color}`), `aura/button/index.mjs` (`secondary.*`).

## 6. Focus ring
- **Decision**: `focusRing` 3 px solid `var(--mf-focus)` offset 3 px for every component, `formField.focusRing` set to the same (Aura sets none for fields), plus `:focus-visible` outline for non-PrimeNG elements; `--mf-focus` is FFB000 in dark, 8A5E00 in light (FFB000 on F4F4F1 is 1.9:1).
- **Evidence**: design.md (mock `outline:3px solid #FFB000;outline-offset:3px`); `aura/base` `formField.focusRing: none`.

## 7. Colour-literal check
- **Decision**: a Jest spec in `libs/ui-cockpit` walks `apps/web/src` and `libs/*/src`, skipping `libs/ui-cockpit`, generated directories (`libs/data-access/src/lib`, `libs/domain/src/generated`) and `*.spec.ts`, and fails on `#` + 3/4/6/8 hex digits not followed by a word character, or `rgb(`/`rgba(`/`hsl(`/`hsla(`.
- **Evidence**: spec Clarifications Q3; `biome.json` has no colour rule.

## 8. Screenshot comparison
- **Decision**: not stored; e2e asserts computed colours per scheme instead (spec Assumptions). The owner reviews `/cockpit` live.
