# Bug Fix: 994-photos-step-e2e-flake

## Change

- `apps/web-e2e/src/accounts.ts`: added `hydrated(page, path?)`. It goes to the path, if one is given, and then waits until no `[ngh]` node is left. Angular removes that marker as it hydrates each server-rendered node, so when none are left the page answers to input. A live stream cannot hold this wait.
- `apps/web-e2e/src/photos-step.spec.ts`: no `networkidle` and no `ready()` remain.
  - `toPhotos`, the draft link and the English tests use `hydrated()`.
  - After reordering, the test reads the photo keys and checks that all three are there. It then waits for the draft's server save (`PATCH /listing-drafts/:id`) that carries those keys in that order, because the other browser reads the server copy.
  - After each reload, and in the other browser, it waits for the tile count and then reads the keys once. They must match the expected order: the reordered order, or `[first, third]` after the removal. A poll was tried first: its single read took 4.9 s on a page busy with the map, and it ran out of its 5 s budget.
  - Both browser contexts point the place step's map at the app's own empty style (`__MF_MAP_STYLE`, as `place-step.spec.ts` does). The old `networkidle` wait had in effect been waiting for the outside tiles and the software WebGL render. They are now gone, so nothing is left to wait for, and the runs went from 26–57 s to 17–20 s.
  - Every assertion the spec had is still there. The checks after the reloads are stronger: they now compare against the order captured before the reload, not one read after it.

## Why not the app

A page that holds a live stream is how the product is meant to work (#295's maintenance banner, the dashboards). The defect was the test's assumption that the network goes quiet. #295's `QUIET_FOR` guess only exists to fit that assumption, and once the suite stops relying on `networkidle` it can go (see deferred).

## Verification

See `test.md` and `specs/994-photos-step-e2e-flake/auto-run.md`.
