# Research: Offline message on the service worker's 504

No Technical Context item was NEEDS CLARIFICATION; the three decisions below
were resolved from installed sources in the worktree.

## R1 — What the service worker answers for a fetch it could not complete

- Decision: treat only a 504 with no body as the worker's "could not reach
  the network" answer (spec Assumptions).
- Rationale: the installed worker builds exactly that answer when its network
  fetch times out or fails: `this.adapter.newResponse(null, { status: 504,
  statusText: "Gateway Timeout" })`. The body is `null`, so `HttpClient`
  hands `toProblem` an `HttpErrorResponse` whose `error` is `null` or `''`,
  which `parsed` and `fromBody` already read as "no problem code".
- Alternatives considered: also mapping 503 (the worker's own update check
  treats 503 and 504 alike, `ngsw-worker.js:1994`), rejected: that path is
  the worker's manifest fetch, not an app request, and the story names 504
  only.
- Evidence: `node_modules/@angular/service-worker/ngsw-worker.js:935`
  (version 22.2.1, `node_modules/@angular/service-worker/package.json:3`);
  `apps/web/src/app/app.config.ts:31` (worker only in the production build).

## R2 — Where the branch sits and what "no problem body" means

- Decision: one `if` in `toProblem` between the status-0 return and the
  `fromBody` return: `status === 504`, parsed body without a non-empty string
  `code`, `navigator.onLine === false` → `{ code: 'offline', status: 504 }`.
  "No problem body" is `fromBody`'s existing test (`typeof body['code'] !==
  'string' || body['code'] === ''` after `parsed`), so a text body, an
  array, `null`, `''` and `{ code: '' }` all count as none.
- Rationale: SC-003 asks for one file and no new export, with the branch
  beside the status-0 rule; reusing `fromBody`'s predicate keeps one
  definition of "problem body" (Principle V in miniature) and keeps every
  other status on its current path, so SC-002's expectations hold without
  edits.
- Alternatives considered: mapping inside `fromBody` by status (rejected:
  `fromBody` is status-agnostic today and the spec places the rule beside the
  status-0 one); a new `isOfflineAnswer` export (rejected: SC-003); changing
  `codeForStatus` in contracts (rejected: FR-004, one file; and it would
  affect the API's own problem codes).
- Evidence: `libs/overlays/src/form.ts:213-245` (`toProblem`, `parsed`,
  `fromBody`); `libs/contracts/src/problem.ts:36-47` (`codeForStatus`: 504
  → `internal_error`); spec.md FR-001, FR-003, SC-003, Clarifications.

## R3 — The offline signal

- Decision: `globalThis.navigator?.onLine === false`, read once when the
  failure is mapped, exactly as the status-0 rule does; nothing injected.
- Rationale: the spec's Clarifications fix "once, at mapping time"; the
  existing specs already stub it with `jest.spyOn(navigator, 'onLine',
  'get')` under jsdom, so the new cases need no new test scaffolding; SSR has
  no `navigator`, which the optional chain already handles (FR-003).
- Alternatives considered: the web app's live-updates offline bar as the
  signal (rejected: would need injection in a plain function and more than
  the ~5 lines the story is worth, spec Assumptions).
- Evidence: `libs/overlays/src/form.ts:217-221`;
  `libs/overlays/src/form.spec.ts:354-367` and
  `form.adversary.spec.ts:480-489` (the spy pattern);
  `libs/overlays/jest.config.cts` (`testEnvironment: 'jsdom'`).
