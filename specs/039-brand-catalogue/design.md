[UNAVAILABLE: design mock — Artifact read of https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr returned "artifact not found — deleted or not shared with this account"]

# Design: Set up the brand catalogue and its upkeep (ST-39)
Checked: 2026-10-07 · Mock: https://claude.ai/artifact/EoPWH9MHmuY5Jfw7vTWTHr (v22, could not be opened) · Story: https://app.notion.com/p/3ee607bff0d2817494b2f51c09ad7cf7

## Boards
- None for this task. The Build brief's Screens section says: "None. The brands
  are shown in List your garage step 2 (ST-… the listing form's brand step),
  Home and Results." The story's Notes name the boards that show its result:
  twelve brand buttons in "List your garage", step 2 "Mărci"; lamps and lists
  on Home, Results and the garage profile use eight brands and six sample garages.
  Those boards belong to the stories that build the screens.

## What to build to match it
- No screen. A backend and data task: the brand list and its loader, the public
  brand search, the garage brand tables and the one read function.
- What the later screens will need from it, so the data fits the boards: the
  twelve brands of the listing form (BMW, Mini, Mercedes-Benz, Audi, Volkswagen,
  Škoda, Dacia, Renault, Ford, Toyota, Hyundai, Tesla) present and active in the
  development list, names written as the mock writes them ("Škoda",
  "Mercedes-Benz"); popularity order for the eight-brand lamps on Home and
  Results; a garage's answer per brand (`works_on`, `does_not_take`,
  `unstated`) for the red lamp and the "shown last" rule; the brand note and
  refusal phrase for the profile's limits text.

## States
- Shown in the mock: not seen (mock unavailable); the Notes say twelve brand
  buttons in step 2 and eight brands in the lamps.
- Not designed (build from the Build brief): the loader's refusal of a duplicate
  file, a retired brand hidden from pickers, the search's empty result. None of
  these is a screen in this task.

## Mock vs Build brief
- Mock: twelve brands on the listing form, eight on Home. Build brief (2026-10-03,
  newer): the list holds every car brand sold in Romania, offered with search
  everywhere; the development list ships at least the twelve of the mock. The
  Build brief wins.
- Mock: no limits note or refusal phrase visible per the Notes. Build brief:
  `GARAGE.brand_note` (≤140) and `GARAGE.refusal_phrase` (≤60), proposed. Built
  as data only here; the profile that shows them is another story's.
