# UI contract: the "List your garage" page (ST-108)

What later stories, the tests and the PR tester may rely on. No API or DTO
changes: the page calls nothing.

## Addresses

- `/ro/list-your-garage`, `/en/list-your-garage`: public, server-rendered,
  no sign-in prompt, a query string tolerated (`?draft=<token>` later).
- `PUBLIC_PATHS` lists `list-your-garage`: the sitemap holds both addresses
  with hreflang alternates; the page carries canonical and alternate links.
- Tab title: the heading in the current language.
- Fragments: `#pasul-1` … `#pasul-6` (ro), `#step-1` … `#step-6` (en) land
  on that section, under the bar on a phone.

## Texts (`libs/i18n/src/public/{ro,en}.json`, group `listing`)

| Key | ro | en |
| --- | --- | --- |
| `label` | PENTRU SERVICE-URI | FOR GARAGES |
| `heading` | Pune-ți service-ul pe hartă | Put your garage on the map |
| `intro` | Spune ce primești și ce refuzi. Cine îți cere o ofertă știe deja că lucrezi pe mașina lui. | Say what you take and what you turn down. Whoever asks you for a quote already knows you work on their car. |
| `steps` | Pași | Steps |
| `step1` | Service-ul | The garage |
| `step2` | Mărci | Brands |
| `step3` | Prețuri | Prices |
| `step4` | Mecanici | Mechanics |
| `step5` | Fotografii și adresă | Photos and place |
| `step6` | Verificare | Verification |
| `optional` | opțional | optional |
| `required` | obligatoriu | required |
| `bar` | {n} / 6 · {label} | {n} / 6 · {label} |

The hyphens in `SERVICE-URI` and `service-ul` are written as the catalogue
check requires (`libs/i18n/src/check.ts`, `BREAKING_HYPHEN`): a non-breaking
hyphen, as the existing texts do (`"service‑ul"` in `ro.json`).

## DOM and accessibility

- One `<nav aria-label="Pași|Steps">` in the page; inside it one
  `<button aria-expanded>` (the phone bar; `display: none` from 768 px) and
  one `<ol>` of six `<li><button>` entries reading "n Label" plus
  "· opțional|optional" on 4 and "· obligatoriu|required" on 6.
- Exactly one entry carries `aria-current="step"` at any time; it also has
  the visible highlight.
- Each section: `<section id="pasul-n|step-n">` with `<h2 tabindex="-1">`
  "n Label[ · mark]" and an empty body; later stories add their content
  inside the section.
- Activating an entry: the section scrolls into view under the bar or header
  (immediate under `prefers-reduced-motion: reduce`), its `<h2>` gets focus,
  the entry becomes current, the phone list closes.
- Phone bar text: `"<n> / 6 · <label>"`, at least 12 px, one line with an
  ellipsis, a 44 px target; the open list is a disclosure (no focus trap);
  Escape closes it and focuses the bar; an outside tap closes it.
- No completion tick, no sign-in prompt, no network call of the page's own.
- The `nav` comes first in the DOM, before the sections, so keyboard and
  screen-reader users reach the step list first; the desktop grid places it
  beside the sections (a grid area, not a second copy).
- The bar text is not an `aria-live` region; the open list scrolls inside
  itself (max height under the bar) when it does not fit.
- Fragments naming no section, or the other language's ids, open the page at
  the top with step 1 current.
- Current step: a non-colour cue (weight or marker) besides the highlight;
  highlight and focus ring 3:1, text 4.5:1 in light and dark.
