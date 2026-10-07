# Implementation Plan: Save a draft and come back to it later

**Branch**: `114-save-draft` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/114-save-draft/spec.md`; the owner's context in [context.md](./context.md) (Constraints: module `garages`, API `listing-drafts`, RFC 9457 errors, 404 for another party's resource); the design in [design.md](./design.md) (mock unavailable this run; boards show only the secondary "Salvează ciorna" button).

## Summary

A garage owner filling in the six-step "List your garage" form (ST-108's page) never loses what they typed: the browser keeps a copy in `localStorage`, and once an e-mail is entered the server keeps the authoritative copy, reachable from any device through a tokenized link sent by e-mail (`?draft=<token>`, resolved by the hash alone, removed from the address bar on open). A reminder goes once after 3 days without a change and an untouched draft is deleted, photos included, after 90 days. Technically: a `ListingDraft` + `ListingDraftToken` pair in the `garages` Prisma schema, four `@Public()` routes under `/api/v1/listing-drafts` keyed by `X-Listing-Token`, the e-mails as `Notification` rows with a nullable account and a `listingDraftId` (link only in the queue job), two e-mail templates, one `DailyTask` run by the worker's existing 09:00 daily job, and the page's step 1 e-mail field, button and status notes. Research in [research.md](./research.md) (R1–R16), the model in [data-model.md](./data-model.md), contracts in [contracts/](./contracts/).

## Technical Context

**Language/Version**: TypeScript 6.0.3 (`package.json` devDependencies), Node ≥ 24 (`package.json` engines; local v26.5.0), `target es2023`, `module esnext`, `moduleResolution bundler`, `strict` (`tsconfig.base.json:9-10,37-38`); the web app `module preserve`, `target es2022`, `strictTemplates` (`apps/web/tsconfig.json:6,11,13`); `libs/domain` `module commonjs` (`libs/domain/tsconfig.json:5`); `apps/web-e2e` `nodenext` so its relative imports end in `.js` (`apps/web-e2e/tsconfig.json:3-4`, `src/confirm-email.spec.ts:1`).

**Primary Dependencies**: Angular 22.2.1 (`package-lock.json:453`) standalone + signals, `@spartan-ng/brain` 1.5.0 (`:11617`) with the helm copies in `libs/ui-cockpit` (`HlmButton`, `HlmInput`, `HlmLabel`); NestJS 12.1.2 (`:8640`, ESM-only), `@nestjs/swagger` 12.0.2, `class-validator` 0.15.1, `class-transformer`; Prisma 7.10.0 with `@prisma/adapter-pg` (`:24739`; generator `prisma-client`, output `libs/domain/src/generated/prisma`, `libs/domain/prisma/schema/*.prisma`, `libs/domain/prisma.config.ts`); BullMQ 6.3.11 (`:15082`) + ioredis 6.0.0; `@aws-sdk/client-s3` 3.1146.0 (storage); `ng-openapi-gen` for `libs/data-access` (`libs/data-access/project.json`: input `apps/api/openapi.json`, dependsOn `api:openapi`); Nx 23.2.1; Biome 2.5.15. No new dependency.

**Storage**: PostgreSQL (truth: drafts, token hashes, notification rows, the 5-per-hour count — FR-009); Redis only as BullMQ's queue (the `send` job carries the link; a lost job never loses data); the S3-compatible bucket for the draft's photos (keys in `data.files`, owner id = draft id, `libs/domain/src/storage/storage.service.ts:42`); the browser's `localStorage` for the local copy (FR-002).

**Testing**: Jest 30.5.2 (`package-lock.json:19881`, root `jest.config.ts`, `jest.preset.cjs` with `JEST_SUITE`; Nest targets run with `--experimental-vm-modules`); API and processor specs as `*.integration.spec.ts` on real PostgreSQL and Redis through `apiBoot` (`apps/api/src/api-boot.testing.ts`); web specs in jsdom through the Angular preset; Playwright 1.63.0 (`:10793`, `apps/web-e2e/playwright.config.mts`) with the local Brevo mailbox (`http://127.0.0.1:3025/messages?to=`, tag `@mailbox`, `apps/web-e2e/src/staff-invite.spec.ts:8-31`).

**Target Platform**: Angular SSR web app (phones 320/390 px first, tablet, desktop, light/dark, RO/EN), NestJS API and worker on Railway (`scripts/railway-deploy.ts`), PostgreSQL 16+PostGIS, Redis.

**Project Type**: Nx monorepo — apps `web`, `api`, `worker`, `web-e2e`; libs `contracts`, `domain`, `data-access`, `i18n`, `ui-cockpit`, `overlays`.

**Performance Goals**: a save answers within the request (no e-mail is sent inline: the route queues it); the browser copy is written at most once per second of typing and the server copy at most every 5 s; the link resolves with one unique-index lookup on the token hash (SC-002: the link opens the draft within 5 s).

**Constraints**: `data` ≤ 262 144 bytes → 413 `draft_too_large` (the JSON body limit must be raised above body-parser's 100 kB default, `node_modules/body-parser/lib/utils.js:62`, R4); five link e-mails per draft per hour counted in PostgreSQL → 429 `link_already_sent` + `retryAfterSeconds`; tokens never stored, logs never carry e-mail or token (FR-018); same 404 body for a bad, foreign or missing token; `submitted` → 409 `draft_submitted`; `updated_at` set only by owner saves (R1); the link's host is `PUBLIC_WEB_URL` (`libs/domain/src/notifications/email-config.ts:14,65`); quiet hours hold the reminder, not the link (`libs/domain/src/notifications/catalogue.ts:30`); the sending story (ST-116) sets `submitted`, out of scope here; per-step validation belongs to each step's story.

**Scale/Scope**: one page extended (`apps/web/src/app/public/list-your-garage.ts`), one new Angular module file `draft.ts`, 4 API routes, 2 Prisma models + 1 model change + 1 migration, 1 service + 1 sweep in `libs/domain/src/garages`, 2 templates, 1 processor change, ~19 i18n keys, 1 Playwright spec. Feature level 2 (`.specify/feature.json`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates from the motor-fix Constitution (v1.8.2, card `.specify/memory/constitution-card.md`):

- [x] **I. No Bloat (NON-NEGOTIABLE)**: no new dependency; tokens reuse `newToken`/`hashToken`; e-mails reuse `emailRow`, the processor and Brevo; the reminder and clean-up ride the existing daily job rather than a second scheduler (R7); the browser copy is one `localStorage` key, no service, no IndexedDB (R5); constants in one file each side. The only generalisation (a `DailyTask` list on `RemindersScheduler`) replaces a 80-line copy and is recorded in Complexity Tracking.
- [x] **II. Test Discipline**: `/speckit-tests` writes the failing specs first (FR-020's list in quickstart.md); Jest specs colocated (`listing-drafts.service.spec.ts`, `listing-draft-sweep.integration.spec.ts`, `draft.spec.ts`, `list-your-garage.spec.ts`); API specs on real PostgreSQL and Redis; Playwright with the mail sink for the cross-device flow.
- [x] **III. The Given Stack**: Angular + Spartan UI (Cockpit) field, label and buttons; NestJS; PostgreSQL; Redis through BullMQ; no new front-end dependency.
- [x] **IV. One Repository, One Toolchain**: everything in the existing apps and libs; no new lib; no broker beyond BullMQ; Biome only.
- [x] **V. Rules Live in One Place**: DTOs in `libs/contracts/src/listing-drafts.dto.ts`, validated at the edge; routes documented with `@ApiHeader`/`@ApiProperty`, client regenerated (`npx nx run data-access:generate`), never hand-edited; the e-mail rule lifted to `EMAIL_PATTERN` and shared by server and form (R8); the size, cap and retention constants once; the token check on the server only.
- [x] **VI. PostgreSQL Is the Truth**: drafts, hashes, the cap count and the notification rows in PostgreSQL; the `send` job holds only the link, and a lost job leaves a `queued` row and an intact draft (R3); the reminder's claim and its notification row in one transaction (R7). No outbox event is needed: no other module reacts to a draft.
- [x] **VII. Lifecycle**: draft PR #199 open, label `planning`, task Planning in Notion (`notion-sync.md`); each phase one commit, pushed.
- [x] **Notion choices**: context.md's Constraints honoured (module `garages`, `listing-drafts` routes, RFC 9457 lower-snake codes, 404 for another party's resource); no T1–T10 item touched (notifications, storage and tokens follow decisions already built: `.specify/capabilities/notifications.md`, `storage.md`, `email-confirmation.ts`).

## Project Structure

### Documentation (this feature)

```text
specs/114-save-draft/
├── spec.md, context.md, design.md, auto-run.md, notion-sync.md
├── plan.md              # this file
├── research.md          # Phase 0: R1–R16
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── listing-drafts.md   # the four routes, DTOs, error codes
│   └── page.md             # the page, i18n keys, e-mails, timers
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
libs/contracts/src/
├── auth.dto.ts                         # export EMAIL_PATTERN (R8)
├── listing-drafts.dto.ts               (new) Create/Save DTOs, ListingDraftData, response DTOs
└── index.ts                            # export the new file

libs/domain/prisma/schema/
├── garages.prisma                      # + ListingDraft, ListingDraftToken, enum ListingDraftStatus
└── notifications.prisma                # Notification.accountId nullable, + listingDraftId
libs/domain/prisma/migrations/20261007150000_listing_draft/migration.sql   (new)

libs/domain/src/garages/
├── garages.module.ts                   # provide ListingDraftsService, controller, sweep; export sweep
├── listing-drafts.ts                   (new) DRAFT_MAX_BYTES, LINKS_PER_HOUR, REMIND_AFTER_DAYS, DELETE_AFTER_DAYS, link()
├── listing-drafts.service.ts           (new) create, current, save, sendLink; tokens, cap, 404/409/413
├── listing-drafts.service.spec.ts      (new)
├── listing-drafts.controller.ts        (new) @Public() routes, X-Listing-Token header, Cache-Control: no-store (FR-021)
├── listing-drafts.throttle.ts          (new) Redis per-IP counter, 10 creates/hour, 429 draft_rate_limited (FR-021)
├── listing-drafts.throttle.spec.ts     (new)
├── listing-draft-sweep.ts              (new) DailyTask: remind(now), cleanUp(now)
└── listing-draft-sweep.integration.spec.ts (new)

libs/domain/src/notifications/
├── catalogue.ts                        # LISTING_REMINDER → 'single'
├── notifications.service.ts            # + sendToDraft(kind, draftId, link)
├── notifications.processor.ts          # recipient from account or listingDraft; link from job data
├── templates/listing.ts                (new) LISTING_CONTINUE_LINK, LISTING_REMINDER
└── templates/registry.ts               # register both

libs/domain/src/scheduler/daily.ts      # + DailyTask interface, DAILY_TASKS token
libs/domain/src/cars/reminders.module.ts # RemindersScheduler runs the DAILY_TASKS list
apps/worker/src/main.ts                 # wire ListingDraftSweep into the daily tasks

apps/api/src/
├── app.module.ts                       # GaragesModule already registered; controller via the module
├── bootstrap.ts                        # JSON body limit 320 kB (R4)
├── public-routes.integration.spec.ts   # + the four listing-drafts routes
└── listing-drafts.api.integration.spec.ts (new) FR-020 API scenarios
apps/api/openapi.json                   # regenerated
libs/data-access/src/lib/               # regenerated client (ListingDraftsService)

apps/web/src/server/search.ts            # + Referrer-Policy: no-referrer on /<lang>/list-your-garage (FR-021)
apps/web/src/server/search.spec.ts       # + the header assertion
apps/web/src/app/public/
├── list-your-garage.ts                 # e-mail field, button, notes, link load, states
├── list-your-garage.spec.ts            # + the new behaviour
├── draft.ts                            (new) BrowserDraft, reconcile(), storage read/write, constants
└── draft.spec.ts                       (new)
libs/i18n/src/public/ro.json, en.json   # group listing: ~19 keys (contracts/page.md)

apps/web-e2e/src/listing-draft.spec.ts  (new) @mailbox: save, link in a second context, invalid link
```

**Structure Decision**: the feature lives where its neighbours already are: the garage-owner domain in `libs/domain/src/garages` (beside `staff-invite.*`), the DTOs in `libs/contracts`, the page in `apps/web/src/app/public`. The e-mail path changes the notifications module minimally (one nullable FK, one entry point, one recipient helper) instead of a parallel sender; the daily sweep joins the worker's one daily job. No new project.

## Design notes

- **Step 1 field and the button** (design.md, contracts/page.md): the e-mail field is the first control of step 1's section with a hint line and an error line (`aria-describedby`); the secondary Cockpit button "Salvează ciorna" sits in an `.actions` row after the sections, with one `role="status"` note under it. Whole-page states for an invalid link and a sent listing replace the form inside the frame. Not designed in the mock; built from the Build brief and flagged in the PR.
- **Timing** (R5, R15): browser copy 1 s after the last change; server copy every 5 s while typing, on step change, on the button, on `online`; one server save in flight at a time with one queued behind it.
- **Link open** (R12): browser-only (`afterNextRender`), `GET current` with the header, store replaced, jump to the saved step, `replaceUrl` without the query.
- **Sweep** (R7): `remind` claims with `UPDATE … WHERE reminded_at IS NULL RETURNING` in the transaction that writes the row; `cleanUp` deletes storage keys then the draft; errors per draft logged with the id only.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `DailyTask` list on `RemindersScheduler` (`DAILY_TASKS`) | FR-015/FR-016 need a daily tick; one exists at 09:00 Bucharest in `reminders.module.ts:45-93` | a second queue + scheduler for the sweep copies ~80 lines (`reminders.module.ts:93-140`); a per-draft `ObjectTimers` job would hold a delayed job per draft for 90 days |
| `Notification.accountId` nullable + `listingDraftId` + CHECK | FR-010: the draft's e-mail has no account; Clarifications want the queue's retries and delivery status | sending through Brevo directly (as the staff invite) loses retries and status; a second table for draft e-mails duplicates the processor |
| JSON body limit raised in `bootstrap.ts` | FR-006 allows 256 KB; body-parser refuses at 100 kB with no stable code | none: without it a 200 KB draft never reaches the 413 rule |

## Post-design Constitution re-check

All gates still hold after Phase 1: no new dependency or project; the three additions above are each tied to a numbered FR and the smaller option is named; every rule has one home (DTO, constant file, template); PostgreSQL holds every state the feature has.
