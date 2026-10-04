# Design: Build the Cockpit theme: colours, type and panels
Checked: 2026-10-04 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, version 1791040637-c375) · Story: https://app.notion.com/p/3ee607bff0d281e5a35be24ed2edf607

## Boards
- Earlier directions › A · Cockpit (`DirA.dc.html`, 1440×900): the chosen direction. Near-black ground 0B0C0E, panels 15171A with 1 px 2A2D31 border and 16–18 px radius, amber FFB000 for the one CTA ("FIND GARAGES", 56 px tall, 14 px radius, Michroma 13 px / 0.14em on amber with 0B0C0E text) and for the selected brand (1.5 px amber border, amber text, 10% amber fill). Secondary action: 1 px 4A4E55 border, 12 px radius, 44 px tall, Hanken Grotesk 600 15 px. Lamps green 32D74B / red FF5A4F with a text label beside each. Focus: `outline: 3px solid #FFB000; outline-offset: 3px`.
- Desktop (Cockpit) › Home (`Main.dc.html`): the same palette applied at page scale. Radii in use: 12 px (most controls, 10×), 24 px (large panels), 20/18/16/14/11 px elsewhere. Michroma capital labels at 10–14 px with 0.08–0.3em spacing; body Hanken Grotesk 13–20 px. Extra greys in the mock: 9A9DA3, C9CBD0, 8D9096, 6B717A, 4A4E55 (tertiary text, unselected labels, strong lines).

## What to build to match it
- Tokens (`--mf-*`) for the palette above, the two families, a size scale, 0.14em label tracking, a 4 px spacing scale, radii 20 (panel) / 12 (control) / 10 (chip), and the focus ring (3 px, offset 3 px, amber).
- A PrimeNG preset where the primary is amber with 0B0C0E text, the selected state is amber, secondary buttons are outlined in the strong line colour, and every control is at least 44 px tall.
- The panel part: a 20 px card on the panel surface with a 1 px hairline border and a Michroma capital title.
- Phone: no board text below 12 px (the mock's 10–11 px labels and 11 px tab labels are raised to 12 px — decision 2026-10-03).

## States
- Shown in the mock: dark only; selected (amber), hover (brighter amber glow), focus (amber outline), reduced motion.
- Not designed (build from the Build brief, flag in the PR): the whole light theme (starting values in the Build brief, owner approves on the sample page before launch [X26g]); forced colours; font-load failure; print.

## Mock vs Build brief
- Mock capital labels 9–11 px → Build brief: at least 12 px everywhere on a phone and, *proposed*, on larger screens. The Build brief wins.
- Mock panel radii vary 16–24 px → Build brief fixes 20 px for panels and 10–12 px for controls. The Build brief wins.
- Mock focus ring is amber FFB000 → in the light theme FFB000 on F4F4F1 is under 3:1, so the light focus ring uses the light theme's amber line colour 8A5E00 (Build brief: "amber 8A5E00 for amber text and lines"; contrast rule 3:1 for focus rings).
- Mock loads fonts from Google Fonts → Build brief: self-hosted with `font-display: swap`. The Build brief wins.
