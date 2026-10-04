# Design: Build the shared indicator lamp, rating dial and odometer digits
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d281e4a0d7e24116a9b9fc

## Boards
- Desktop (Cockpit) › Home (`Main.dc.html`): the large dial. 420×420 viewBox, the gauge rotated 150° so it sweeps 240° (pathLength 360, track dash `240 120`): an outer 3 px hairline track (r 180, line colour), tick marks at each whole point (r 180, 16 px, grey), and the amber value arc inside it (r 160, 6 px, round caps, dash `value/5 × 240`). Numerals 0–5 in Michroma 13 px around the arc (5 in amber). Rating in the middle-low area in Michroma 50 px, with a capital label under it. A needle swings to the best garage (out of scope: ST-53 and Discovery).
- Desktop (Cockpit) › Results (`Results.dc.html`): the small dial on each result card. 60 px, viewBox 68, r 28, 5 px track in the line colour and 5 px amber arc with round caps, the same 240° sweep from 150°; rating centred in Michroma 13 px. The lamp: a 10 px dot in the lamp colour with `box-shadow: 0 0 12px` in the same colour, then the label in Hanken Grotesk 600 15 px, 10 px apart. Lamp colours green 32D74B, red FF5A4F, amber FFB000, grey 9A9DA3.
- Desktop (Cockpit) › Garage profile (`Mechanic.dc.html`): the odometer estimate. Michroma 30 px numerals, each digit in its own 1.1em × 1.4em cell on the page colour with a 1 px line border and 8 px radius, the cell holding a 0–9 column moved by `translateY` (the roll). "From" and "to" on two rows with capital labels, and "LEI" in Michroma 11 px below. The whole estimate is one `role="img"` with an aria-label such as "Estimare de la 1.250 la 1.600 lei".
- Lamps appear on every board (status lines on cards, rows and dashboards).

## What to build to match it
- `mf-lamp`: dot + label as on Results; the dot glows with a token-coloured `box-shadow`; dot hidden from assistive technology.
- `mf-rating-dial`: one SVG for both sizes — the 240° track and the amber value arc with round caps, the rating centred in Michroma. Large: track, whole-point ticks and the arc, rating in Michroma at display size. Small: 60 px (≥44 px), number 13 px (≥12 px). No needle (ST-53 / Discovery).
- `mf-odometer`: the formatted price on one line ("1.250–1.600 lei") in Michroma numerals, each digit in its own cell as in the mock, so ST-53 can turn a cell into the rolling 0–9 column. Separators, the dash and "lei" sit outside the cells.
- All colours from `--mf-*` tokens: line, amber, green, red, secondary text, page.
- Catalogue: a section of the `/cockpit` sample page with every state.

## States
- Shown in the mock: lamp green / red / amber / grey; dial with a value (large and small); odometer with a range.
- Not designed (build from the Build brief, flag in the PR): dial with no reviews ("—", empty arc); odometer with a single value and with no value ("—"); unknown lamp state (grey); light theme for all three; reduced motion (nothing animates in this story).

## Mock vs Build brief
- Mock odometer shows from and to as two labelled rows of 30 px digits with "LEI" below → Build brief: one value "1.250–1.600 lei" with an en dash, through the ST-19 range format. The Build brief wins; 30 px digits would not fit 320 px, so the digits are smaller.
- Mock lamp labels are coloured in the lamp colour → Build brief: labels ≥4.5:1; the light theme's green fails that on raised surfaces, so the label uses the text colour and only the dot carries the state colour.
- Mock grey 9A9DA3 and light-theme amber FFB000 are not tokens / fail 3:1 in light → grey uses the secondary text token, amber the amber ink token (8A5E00 in light).
- Mock numbers in the mock text use "4,8" / "4.8" by language; the ST-19 rating format already writes them.
- Mock rolls digits, swings the needle and pulses lamps → all motion is ST-53's (orchestrator); this story leaves the hooks (per-digit cells, the dial's fill custom property).
