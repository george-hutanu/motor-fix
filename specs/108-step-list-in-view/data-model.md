# Data Model: Move through the six steps with the step list in view (ST-108)

Nothing is stored (FR-012). The page holds one fixed list and three pieces of
browser state.

## Step (fixed, `apps/web/src/app/public/steps.ts`)

| Field | Type | Values |
| --- | --- | --- |
| `n` | 1–6 | the step's number, also its order |
| `label` | text key | `public.listing.step1` … `public.listing.step6` |
| `mark` | `null` / `'optional'` / `'required'` | 4 is `optional`, 6 is `required`, the rest `null` |
| `id` | per language | `pasul-<n>` (ro), `step-<n>` (en): the section's fragment |

The list is a constant of six entries; the template, the bar, the spy and the
tests read it. Labels are resolved through `I18n.t` at render time, never
stored translated.

## Page state (the component, browser only)

| Signal | Type | Initial | Changed by |
| --- | --- | --- | --- |
| `current` | 1–6 | 1 (server render and first paint) | the spy on `scroll` and `resize`; a jump sets it to the tapped step |
| `open` | boolean | false | the bar's tap toggles; a jump, an outside tap or Escape set it false |
| `hold` | timer or null | null | set by a jump; cleared 150 ms after the jump's last scroll event |

Invariants:

- exactly one entry carries `aria-current="step"` (the one whose `n` equals
  `current`);
- `current = currentStep(tops, line, atEnd)` whenever `hold` is null and a
  scroll or resize has happened; `currentStep` returns the greatest `n` whose
  heading top ≤ `line`, 1 when none, 6 when `atEnd`;
- `open` has no effect at 768 px and wider (CSS shows the list regardless).

## Transitions

```text
load (server) ─────────────► current = 1, open = false
first render (browser) ───► update(): current from the headings' positions (a fragment landing included)
scroll / resize ──────────► hold ? (restart hold timer) : current = currentStep(...)
tap entry n ──────────────► current = n, hold = timer, scrollIntoView(h2[n]), focus(h2[n]), open = false
hold timer fires ─────────► hold = null (current unchanged until the next scroll)
tap bar ──────────────────► open = !open
outside tap / Escape ─────► open = false (Escape also focuses the bar)
language switch ──────────► texts and ids re-render; current and open unchanged (same component instance)
```
