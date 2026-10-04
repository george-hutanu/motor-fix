# Research: Account model, roles and their rights

## Access token format
- Decision: HS256 JWT built with `node:crypto` (`createHmac`, `timingSafeEqual`), claims `sub` (account id), `role` (role in use), `iat`, `exp`; key `AUTH_TOKEN_SECRET`.
- Rationale: Notion names no library, algorithm or claims (context.md Gaps); ST-394 needs the role in the token; ~30 lines beat a dependency (Principle I).
- Alternatives: `jose` / `@nestjs/jwt` (new dependency for one algorithm); opaque tokens in Redis (Redis would hold the only copy of a session — constitution VI).
- Evidence: context.md "Decisions" (no JWT named), ST-394 in context.md Prior Art; `package.json` has no JWT library.

## Where the actor is loaded
- Decision: an opt-in Nest guard `ActorGuard` (`@UseGuards(ActorGuard)` per controller) verifies the token, loads the account with roles, memberships and mechanic link in one Prisma query, refuses suspended (403) and deleted/missing (401), then checks the handler's `@Requires(capability)` and puts the actor on the request.
- Rationale: the health and probe controllers stay public with no `@Public` marker work; ST-422 adds the guard to its controllers (message sent).
- Alternatives: global `APP_GUARD` + `@Public()` (touches health and test controllers that other branches also edit).
- Evidence: `libs/domain/src/health/health.controller.ts`, `apps/api/src/bootstrap.spec.ts:24-45`.

## Error codes
- Decision: throw `HttpException({ code, message }, status)`; `ProblemFilter` keeps a string `code` from the exception body, else maps by status as today.
- Evidence: `apps/api/src/problem.filter.ts:13-17, 47-53`.

## Transactions and ports
- Decision: `AuditPort.record(tx, entry)` and `EventPort.record(tx, event)` take Prisma's `Prisma.TransactionClient`; no-op providers bound under `AUDIT_PORT` / `EVENT_PORT` in `AuthModule`. Use cases run inside `prisma.$transaction(async (tx) => …)`.
- Evidence: `libs/domain/src/generated/prisma/internal/prismaNamespace.ts:671` (`TransactionClient`); ST-390 / ST-257 proposed `record(tx, …)` (context.md Prior Art).

## Prisma client
- Decision: `AuthModule` owns one `PrismaClient` with `PrismaPg` like `HealthService`, disconnected on shutdown.
- Evidence: `libs/domain/src/health/health.service.ts:31-40`.

## Migrations in tests and CI
- Decision: one migration under `libs/domain/prisma/migrations`; DB tests expect a migrated database; CI runs `npx prisma migrate deploy --config libs/domain/prisma.config.ts` before tests (ST-422 confirmed it adds no migrate line).
- Evidence: `libs/domain/prisma.config.ts` (`migrations.path`), `.github/workflows/ci.yml:40-45` (no migrate step today).

## Web routing and SSR
- Decision: `provideRouter(routes)`; areas `app/driver|garage|admin` lazy-load one frame component with `canMatch: [areaGuard('<area>')]` so a refused area never downloads; `app/**` server routes render on the client (`RenderMode.Client`) because the session lives in browser memory.
- Evidence: `apps/web/src/app/app.routes.server.ts`; Angular `CanMatchFn` / `RenderMode` in `node_modules/@angular/router`, `@angular/ssr`.

## Capabilities in the browser
- Decision: `GET /me` returns `capabilities` for the role in use; the frame filters its menu by them. No copy of the table in the web (constitution V).
