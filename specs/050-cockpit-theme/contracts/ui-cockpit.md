# Contract: `@motor-fix/ui-cockpit`

What later stories (ST-286, ST-51, ST-157, …) build on.

## TypeScript exports (`libs/ui-cockpit/src/index.ts`)

| Export | Kind | Contract |
| --- | --- | --- |
| `provideCockpitTheme()` | `EnvironmentProviders` | Sets the CDK overlay default `usePopover: false`, so the toaster stays above dialogs and drawers. No options; the colour scheme is CSS only. Called once in the app config. |
| `HlmButton` | directive `button[hlmBtn]`, `a[hlmBtn]` | `variant`: `'default'` (amber main action) \| `'secondary'` \| `'ghost'`; `disabled`. One size (44 px). |
| `HlmInput`, `HlmLabel` | directives `[hlmInput]`, `[hlmLabel]` | Field and its label (`for`/`id`). |
| `HlmSwitch` | component `hlm-switch` | `checked`/`checkedChange`, `ngModel`, `inputId`, `disabled`, aria inputs. |
| `HlmTabsImports` | `hlmTabs` (`tab`), `hlmTabsList`, `hlmTabsTrigger`, `hlmTabsContent` | brain tabs with roving focus. |
| `HlmTableImports` | `hlmTableContainer`, `hlmTable`, `hlmTHead`, `hlmTBody`, `hlmTr`, `hlmTh`, `hlmTd` | Styling only; a `tr` with `data-state="selected"` takes the selected look. |
| `HlmDialogImports` | `hlm-dialog`, `hlmDialogTrigger`, `*hlmDialogPortal`, `hlm-dialog-content` (`closeLabel` required), `hlm-dialog-header`, `hlmDialogTitle`, `hlmDialogClose` | brain dialog on CDK. |
| `HlmSheetImports` | `hlm-sheet` (`side`), `hlmSheetTrigger`, `*hlmSheetPortal`, `hlm-sheet-content` (`closeLabel` required), `hlm-sheet-header`, `hlmSheetTitle`, `hlmSheetClose` | The drawer. |
| `HlmPopoverImports` | `hlm-popover`, `hlmPopoverTrigger`, `*hlmPopoverPortal`, `hlm-popover-content` | |
| `HlmToaster`, `toast` | component `hlm-toaster`; function re-exported from `@spartan-ng/brain/sonner` | One toaster per page; `toast(title, { description })`. |
| `Panel` | standalone component `mf-panel` | Input `heading?: string` (not `title`, which would also leave a native tooltip on the host). Projects its content. Renders a 20 px card with a hairline border; the heading, when given, is a Michroma capital label (`h2`). |
| `CockpitSamplePage` | standalone component | The owner's approval page; routed at `/cockpit`. |

## Stylesheet (`libs/ui-cockpit/src/styles/cockpit.css`)

Included once through the app's `styles`. Provides:

- every token in [data-model.md](../data-model.md), on `:root`, switching with `prefers-color-scheme` and `print`;
- `@font-face` for Michroma and Hanken Grotesk Variable (self-hosted, swap);
- base: `body` background, text colour, body font and size, `color-scheme`;
- `.mf-label`: Michroma, capitals, `--mf-size-label`, `--mf-label-tracking`;
- `:focus-visible` outline from the focus tokens;
- the `spartan-*` rules that give every helm part its look from the tokens, with the 44 px minimum on buttons, inputs, tab triggers and the switch;
- forced-colours rules: panels keep a border, focus stays visible.

## Rules for consumers

- Style only through `--mf-*` tokens and the helm components; no colour literal outside this library (enforced by `colour-literals.spec.ts`).
- Solid amber (`hlmBtn` with the default variant) only for the one main action on a view.
