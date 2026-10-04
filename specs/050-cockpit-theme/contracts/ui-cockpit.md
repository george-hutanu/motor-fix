# Contract: `@motor-fix/ui-cockpit`

What later stories (ST-286, ST-51, ST-157, …) build on.

## TypeScript exports (`libs/ui-cockpit/src/index.ts`)

| Export | Kind | Contract |
| --- | --- | --- |
| `provideCockpitTheme(options?: { license?: string })` | `EnvironmentProviders` | Registers PrimeNG with `CockpitPreset`, `darkModeSelector: 'system'`, and the PrimeUI licence key when given. Called once in the app config; `apps/web` passes the build-time `PRIMEUI_LICENSE`. |
| `CockpitPreset` | PrimeNG `Preset` | Aura-based; every colour, radius and focus value is `var(--mf-*)`. |
| `Panel` | standalone component `mf-panel` | Input `title?: string`. Projects its content. Renders a 20 px card with a hairline border; the title, when given, is a Michroma capital label (`h2`). |
| `CockpitSamplePage` | standalone component | The owner's approval page; routed at `/cockpit`. |

## Stylesheet (`libs/ui-cockpit/src/styles/cockpit.css`)

Included once through the app's `styles`. Provides:

- every token in [data-model.md](../data-model.md), on `:root`, switching with `prefers-color-scheme` and `print`;
- `@font-face` for Michroma and Hanken Grotesk Variable (self-hosted, swap);
- base: `body` background, text colour, body font and size, `color-scheme`;
- `.mf-label`: Michroma, capitals, `--mf-size-label`, `--mf-label-tracking`;
- `:focus-visible` outline from the focus tokens;
- 44 px minimum on PrimeNG buttons, text inputs, tabs and the toggle switch's hit box;
- forced-colours rules: panels keep a border, focus stays visible.

## Rules for consumers

- Style only through `--mf-*` tokens and PrimeNG components; no colour literal outside this library (enforced by `colour-literals.spec.ts`).
- Solid amber (`severity` default / primary button) only for the one main action on a view.
