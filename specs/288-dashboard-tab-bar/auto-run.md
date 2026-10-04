# speckit-auto run log — 288-dashboard-tab-bar

- Description: ST-288 Reach every dashboard view from a bottom tab bar on a phone (Notion https://app.notion.com/p/3ee607bff0d2816f83b1d10d181fc8f1, EP-1 Foundations)
- Start commit: ddaf49f9ffe7d5f01d5c26e3c921893a77bdaad3 (origin/main), worktree agent-a683221759c5cee0a
- Story picked: ST-288 — To do, Ready to work, High, all blockers (ST-286, ST-82, ST-79) Merged, unblocks ST-289. Ties at High: ST-394 blocks nothing; ST-432 needs mutation runs, which never run locally.

## Preflight
- npm ci (heavy.sh) ok; typecheck 13/13 ok; lint ok; test:unit 11/11 projects ok.

## 0 Size
- Level 2 (feature): intent defined by the Build brief, but design has choices (view-list shape, view addresses, phone account controls).

## 2 Specify
- Branch 288-dashboard-tab-bar (story-number form, like 287-public-tab-bar).
- Autonomous: views become addresses under each dashboard (Build brief: "the route guard uses it too").
- Autonomous: garage feature switches and the live tab refresh deferred to EP-2 / ST-257 (Build brief "Out of scope": Garage feature switches).
- Autonomous: mechanic = garage list filtered by capabilities (Notion decision W01, `capabilitiesOf`).
