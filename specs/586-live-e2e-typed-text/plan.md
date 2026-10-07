# Implementation Plan: Typed-text step in the live end-to-end test

**Branch**: `586-live-e2e-typed-text` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/586-live-e2e-typed-text/spec.md`

## Summary

Add one Playwright test to `apps/web-e2e/src/live.spec.ts`, next to the driver's confirm-dialog check: the seeded garage owner opens "Invită în echipă", clicks into "Nume" and types a name key by key; an admin sends the live test update over the API; the test asserts the status line within 2 s, the dialog still open, the field's value and focus unchanged, zero document loads and no invite `POST` recorded. Test-only: no product code, no helper, no new dependency. The CI E2E job is the green proof.

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json:78`), Node 24 in CI (`scripts/cloud-setup.sh`), `module`/`moduleResolution` `nodenext` with `strict` (`apps/web-e2e/tsconfig.json`), so relative imports carry `.js` (`live.spec.ts:9` imports `./accounts.js`).

**Primary Dependencies**: `@playwright/test` 1.63.0 (`package.json:52`), `@nx/playwright` preset (`apps/web-e2e/playwright.config.mts:1`); the test reuses `live.spec.ts`'s own `accessToken`, `accountId`, `openDashboard` and `ACCOUNTS` from `./accounts.js`.

**Storage**: N/A (seeded data read only; the dialog is never submitted, FR-003).

**Testing**: Playwright, project `chromium` (Desktop Chrome), `baseURL` `http://localhost:4200`, servers started by the config's `webServer` list (mailbox, openid, api, worker, web; the worker relays outbox events to the live streams); `failOnFlakyTests` and 4 workers locally and in CI (`playwright.config.mts`). Tag `@seeded` inherited from the describe block (`live.spec.ts:…'the live connection @seeded'`). CI runs it in the `e2e` job (`.github/workflows/ci.yml:145`); `web-e2e:typecheck` is `tsc --noEmit -p apps/web-e2e/tsconfig.json` (`apps/web-e2e/project.json:17-19`).

**Target Platform**: the web app under test in Chromium on a GitHub runner (or the laptop under `scripts/heavy.sh`).

**Project Type**: Nx monorepo, app `web-e2e` only.

**Performance Goals**: the status line visible within `2_000` ms, the bound the sibling checks use (SC-002).

**Constraints**: the open modal hides the dashboard from the accessibility tree, so the line is found by `[role="status"]` + text as the sibling test does (`live.spec.ts:113-120`); the dialog is a real invite form, so the context is closed at the end, never submitted or cancelled (spec Clarifications 1–2); `page.on('load')` counts reloads, attached right after the dashboard opens (Clarification 4); `pressSequentially` after a click into "Nume" (Clarification 3).

**Scale/Scope**: one new test (~45 lines) in one file; selectors already proven by `staff-invite.spec.ts:51-54` (`Invită în echipă` button and dialog, `Nume` label).

## Constitution Check

Gates from the motor-fix Constitution (v1.8.2):

- [x] **I. No Bloat**: one test, no helper extracted (the sibling-debt helper move for `invite-staff.spec.ts` is a separate task; this test needs only four locator calls, below the threshold for a shared harness), no new dependency.
- [x] **II. Test Discipline**: the change is the test; it is red-first by nature (it fails if a live update closes the dialog, clears the field, moves focus or reloads) and green on the unchanged app. Playwright for the end-to-end flow.
- [x] **III. The Given Stack**: untouched.
- [x] **IV. One Repository, One Toolchain**: `apps/web-e2e`, root Biome, root Playwright config.
- [x] **V. Rules Live in One Place**: no API or DTO change; the test calls the existing `POST /api/v1/admin/live/test` as its siblings do.
- [x] **VI. PostgreSQL Is the Truth**: no state change (no submit).
- [x] **Notion choices**: none relied on; no To-decide item touched.

Re-check after design: unchanged, no violations.

## Project Structure

### Documentation (this feature)

```text
specs/586-live-e2e-typed-text/
├── spec.md
├── context.md
├── design.md
├── plan.md              # this file
├── quickstart.md        # how to run the proof
├── checklists/
└── tasks.md             # /speckit-tasks output
```

`research.md`, `data-model.md` and `contracts/` are not written: Technical Context has no unknown, the test adds no entity and no interface.

### Source Code (repository root)

```text
apps/web-e2e/
├── playwright.config.mts
├── tsconfig.json
└── src/
    ├── accounts.ts          # ACCOUNTS, PASSWORD, ready, signIn (reused)
    ├── live.spec.ts         # the new test goes after the confirm-dialog test (modified)
    └── staff-invite.spec.ts # proves the dialog's selectors (unchanged)
```

**Structure Decision**: one modified file, `apps/web-e2e/src/live.spec.ts`; everything the test needs already lives in that file or `accounts.ts`.

## Complexity Tracking

None: no violations.
