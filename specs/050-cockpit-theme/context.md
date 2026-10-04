# Feature Context: The Cockpit theme — colours, type and panels

- **Feature**: 050-cockpit-theme
- **Anchor**: ST-50 Build the Cockpit theme: colours, type and panels — https://app.notion.com/p/3ee607bff0d281e5a35be24ed2edf607 | terms: Cockpit theme, PrimeNG preset, light theme, Michroma, Hanken Grotesk
- **Gathered**: 2026-10-04
- **Source**: Notion — MotorFix — Product documentation
- **Read**: story ok | feature ok | epic ok | architecture ok | decisions ok
- **Overall confidence**: high (the "Decisions and ideas > Open decisions" page was too large to fetch whole; decision 24 and X26g were confirmed through the story, feature, epic, Front end architecture and Architecture decisions A43 instead)

## Story

- **ST-50 Build the Cockpit theme: colours, type and panels** — status In progress, priority Highest, role System, epic EP-1 Foundations, feature MF-3 Cockpit design system and motion, 8 points, labels front end + design. Page last edited 2026-10-04T05:23Z.
- Scope per the story: "So that every screen and every standard component looks the same without one-off styling, we need the Cockpit colours, typefaces and panels as one shared theme." Acceptance criteria: only listed colours and the two typefaces (now plus a light theme); components take surfaces, borders and focus rings from the theme; amber only for the one main action and the selected state; focus always visible; strong contrast, body at least 13 px, phone text at least 12 px; tappable at least 44 px; a panel is a rounded dark card with a hairline border and small capital title. The Build brief (current as of 2026-10-03) "wins" where it and anything above disagree; it fixes scope to `libs/ui-cockpit` (tokens as CSS variables, PrimeNG preset, dark and light sets chosen by the device, two self-hosted typefaces, the panel part) and lists 11 acceptance scenarios.
- Comments that moved scope: none. The story has no comments (get-comments with all blocks and resolved returned nothing). Scope moved through inline "Superseded 2026-10-03" edits instead (see Decisions).

## Decisions

- A light theme ships at launch and follows the device setting (`prefers-color-scheme`); no in-app switch (marked proposed); the theme is not stored. — [ST-50 Build brief; MF-3 Final rules 3; Decide: is a light theme needed (ST-54, Done)] (2026-10-03, confidence: high)
  - superseded: "Every screen uses only the colours ... listed on the feature page" (dark only), and the epic's "decision on a light theme" wording — [ST-50 acceptance criteria; Foundations scope table] (older wording, both edited 2026-10-03)
- The light theme is derived from the dark tokens by the build team; no separate design is supplied; the owner approves it before launch and it does not go live before approval [X26g] (A43, Given). — [Architecture decisions A43; ST-50 scenario 11, Open] (2026-10-03, confidence: high)
- Smallest text on a phone is 12 px everywhere, capital and tab labels included [24]; the mock's 11 px tab labels are to be fixed; capital labels at least 12 px on larger screens is proposed. — [ST-50 AC 5 and Rules; Front end architecture, Budgets; MF-3 Rules] (2026-10-03, confidence: high)
  - superseded: "labels in capitals are 9 px with wide spacing" — [MF-3 Rules; ST-50 AC 5] (2026-10-03, the new line sits beside the struck one)
- Stack is Given: Angular (standalone, signals) with PrimeNG and a custom Cockpit theme made of design tokens, plus a few custom components. — [Technology stack, Front end; A1] (2026-10-03, confidence: high)
- Tokens are CSS variables `--mf-*`, mapped into a PrimeNG preset `CockpitPreset` on the styled mode, dark-mode selector following the system setting; panel radius 20 px, controls and chips 10 to 12 px, 4 px spacing scale, label spacing 0.14em. All marked *(proposed)* by the page except the 20 px radius and 0.14em, which come from the mock. — [ST-50 Build brief, Rules and validation] (2026-10-03, confidence: medium)
- Dark values: 0B0C0E background, 101215 and 15171A panels, 2A2D31 hairlines, F2F2F0 text, B5B8BE secondary, FFB000 amber, 32D74B green, FF5A4F red. Light starting values (proposed): F4F4F1, FFFFFF and ECECE8, D3D5D8, 15171A, 50545B, amber fill FFB000 with dark text and 8A5E00 for amber text and lines, 1E8E34, D93A30. — [ST-50 scenarios 1 and 2; MF-3 building blocks] (2026-10-03, confidence: high for dark, medium for light)
- Contrast measure (proposed): WCAG 2.2 AA, 4.5:1 text, 3:1 large text, lamps, icons and focus rings. — [ST-50 scenario 5; MF-3 Final rules 9] (2026-10-03, confidence: medium)
- Typefaces self-hosted with `font-display: swap` (proposed); Michroma for labels, headings and numerals, Hanken Grotesk for everything read; if Michroma lacks ș, ț, ă, â or î that label uses Hanken Grotesk; if fonts fail, system sans-serif at the same sizes. — [ST-50 scenario 8, Rules, States; MF-3 Final rules 4] (2026-10-03, confidence: high)
- Forced colours: panels keep borders, focus rings stay visible (proposed). Printing uses the light tokens (proposed, MF-3 Edge cases). — [ST-50 States; MF-3 Edge cases] (2026-10-03, confidence: medium)

## Constraints

- Scope boundary: the lamp, rating dial and odometer digits, charts, motion, phone layout rules, and dialogs/drawers/sheets belong to sibling stories, not ST-50; "colour is never the only signal" is applied in ST-51. — [ST-50 Out of scope, Rules] (2026-10-04, confidence: high)
- Nothing from the server: no reads, writes, audit history or events. — [ST-50 Data, Events] (2026-10-04, confidence: high)
- No version numbers are fixed for PrimeNG or Angular: "use the current long-term-support release of each when the build starts." — [Technology stack, header] (2026-10-03, confidence: high)
- Proposed weight budget for a public page (ST-249): JavaScript 250 KB compressed, CSS 60 KB, at most 2 font files and 100 KB. Two self-hosted families must fit it. — [Security, performance and operations, performance budget] (2026-10-03, confidence: medium: located by search excerpt, page not read in full)
- A public page shows main content within 2.5 s on a mid-range phone on 4G; a dashboard's first load is only the shell plus that role's area. — [Front end architecture, Budgets, proposed] (2026-10-03, confidence: medium)
- Tests the story names: Jest for token presence in both themes, a contrast test over the listed pairs, and a "no hard-coded colour in feature libraries (a lint rule)"; Playwright with `colorScheme` emulation and screenshot comparison, no text under 12 px at 375 px, focus ring on every tabbed element. — [ST-50 Tests] (2026-10-04, confidence: high)
- The shared look is consumed through `libs/ui-cockpit` ("theme, dial, lamp, digits, panels"), used by `apps/web`; PrimeNG components are themed through the tokens, custom parts live in the library. — [Front end architecture, Structure and Patterns; MF-3 Build brief] (2026-10-03, confidence: high)
- Form fields at least 16 px on a phone is attributed to MF-4 (phone layout rules). — [ST-50 Rules] (2026-10-04, confidence: medium)

## Prior Art

- ST-54 Decide: is a light theme needed — Done; its decision (yes, at launch, following the device) is the upstream of this story. — [Decide: is a light theme needed] (2026-10-03)
- Mock v22, board "A · Cockpit" (DirA.dc.html) and every board show the dark look applied everywhere; the light theme is not designed in the mock. URL recorded, not opened: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr — [ST-50 Screens; Foundations Design] (2026-10-03)
- Siblings that build on ST-50, all in the same epic and not duplicated here: the lamp, rating dial and odometer digits (needs ST-50, ST-19); shared chart style; motion and reduced motion (needs ST-50, ST-51); dialog and drawer (needs ST-50, ST-16, ST-53); phone layout rules (needs ST-50). Their statuses were not read. — [Foundations, Build plan slices 2 and 3] (2026-10-03)
- ST-421 monorepo, Railway and release pipeline is first in the epic and a dependency of ST-50. — [ST-50 Build brief Depends on; Foundations Slice 1] (2026-10-03)

## Open Decisions

- Owner approval of the light theme [X26g]: the starting values are proposed; approval needs a sample page with the main components in both themes. — blocks: the light theme going live (FR-002, US6), not the build.
- Weight budget for fonts and CSS (ST-249, proposed): at most 2 font files and 100 KB, CSS 60 KB. — blocks: how many font files and weights FR-011 may ship, and the size of the preset CSS.
- Michroma coverage of ș, ț, ă, â, î: no page states it; the brief only gives the fallback rule. — blocks: whether the fallback in FR-011 triggers in practice.

## Contradictions with spec.md

- **spec.md** (2026-10-04, same day as the story's last edit at 05:23Z; order not determinable): FR-016 and Assumptions: the no-hard-coded-colour check is "a Jest test over the repository's source" — **Notion**: "no hard-coded colour in feature libraries (a lint rule)" [ST-50 Tests] (2026-10-04) — newer: same date.
- **spec.md** (2026-10-04): Assumptions: "The screenshot comparison ... is replaced by assertions on computed colours" — **Notion**: Playwright should "render a sample page ... in dark and in light (`colorScheme` emulation) and compare screenshots" [ST-50 Tests; scenario 11 owner review of a sample page] (2026-10-04) — newer: same date.

## Proposed Clarifications (this command's proposals, not requirements)

- Should the colour-literal check stay a Jest test, with the deviation from "a lint rule" recorded as a decision, or become a Biome rule or custom lint script? — from contradiction 1.
- Should screenshot comparison stay out until the owner approves the light theme (as the spec says), with the story's Playwright screenshot test deferred, or be added as a non-gating artifact for the owner's review? — from contradiction 2.
- Should the font plan state a file count and weight (for example one file per family) so the ST-249 budget of 2 font files and 100 KB is met? — from Constraints, weight budget.
- Should the spec's "browser with no preference shows light" assumption be confirmed against the brief's "dark or light, from `prefers-color-scheme`"? The Notion pages do not say what a device with no preference shows. — from Decisions, device setting.
- Should the PrimeNG version be pinned to the current LTS at build start and recorded in plan.md, since Notion fixes none? — from Constraints, versions.

## Gaps

- [NEEDS CLARIFICATION: where the sample page lives (spec chooses a lazy `/cockpit` route in the web app); Notion says only "a sample page ... in both themes", with no route.]
- The statuses of ST-51 and the other sibling stories were not read; the Cockpit lamp, dial and panel boundary may need rechecking when those start.
- No Notion page states the numbers for the contrast of amber on the light surfaces beyond the proposed 8A5E00; the contrast test is where it will be settled.
- The Open decisions page (decision 24 text itself) was too large to fetch whole; its content was confirmed from the pages that cite it.

## Sources

- Build the Cockpit theme: colours, type and panels (ST-50) — https://app.notion.com/p/3ee607bff0d281e5a35be24ed2edf607
- Cockpit design system and motion (MF-3) — https://app.notion.com/p/3ee607bff0d2817aa8bdc2f304d558b2
- Foundations (EP-1) — https://app.notion.com/p/3ee607bff0d281188cb4c6724bd45707
- Decide: is a light theme needed (ST-54) — https://app.notion.com/p/3ee607bff0d281168257f30d7e4f7d48
- Architecture decisions (A1, A43) — https://app.notion.com/p/3ee607bff0d28111907edddc4bdd066a
- Front end architecture — https://app.notion.com/p/3ee607bff0d2811688cde6508dfcd09a
- Technology stack — https://app.notion.com/p/3ee607bff0d2819ab8e3ee6926a249f2
- Security, performance and operations (excerpt) — https://app.notion.com/p/3ee607bff0d2810d852efa0a9346afd3
- Decisions and ideas / Open decisions (excerpt) — https://app.notion.com/p/3ee607bff0d281df9485ce97dfa3332d

## Refresh 2026-10-04

Read directly by the run after the org-researcher subagent reported no Notion tool in its session: Architecture decisions (last edited 2026-10-04T05:56Z) and the ST-50 story's comments.

### New decisions
- A1 amended: "Angular with Spartan UI (Cockpit theme) on the front end: @spartan-ng/brain headless primitives and helm components copied into our own `libs/ui-cockpit`, on Angular CDK" — reason: PrimeNG 22 moved to the PrimeUI License with a key; the owner wants a fully free, MIT stack. — [Architecture decisions, A1] (2026-10-04, confidence: high)
  - supersedes: "Stack is Given: Angular … with PrimeNG" and the `CockpitPreset` wording in the ST-50 Build brief (Decisions above, 2026-10-03/04). spec.md was corrected the same day (Spec Delta › Correction).

### New constraints
none found

### New contradictions with spec.md
none — the remaining PrimeNG/`CockpitPreset` lines in the story's Build brief are older than A1's amendment, so the amendment wins and spec.md already follows it.

### Story changes
ST-50 has no comments (page-level and block-level); status not re-read here.
