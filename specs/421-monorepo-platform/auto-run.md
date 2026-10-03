# /speckit-auto run — 421-monorepo-platform

- Description: ST-421 — The Nx monorepo, staging and production on Railway, and the release pipeline (EP-1 Foundations, slice 1, first story). Notion story: https://app.notion.com/p/3ee607bff0d2815a8fede068cbfbad58.
- Start: branch `main`, commit `69b1c22c1dd8b6ad24a1928577fe4b0f8578c658`, 2026-10-03.

## Preflight
- Tree clean. `npm run typecheck` (placeholder) and `npm run lint` green; `npm test` → harness: 19 files, 350 passed, 1 skipped.
- `npx jest` as written in the skill fails 19/19: no Jest is installed, and npx fetched one that tried to run the harness's vitest ESM specs. Not a red start; the repo's suite is `npm test`. (autonomous decision, evidence: package.json scripts.test)
- Constitution v1.1.0, no placeholders. Spec-drift: no active feature.

## 0. Size
- Level 2 (feature): the outcome is fixed but the plan has choices (Nx layout, CI, Railway wiring).

## 2. Specify
- Branch `421-monorepo-platform` from the user's name (GIT_BRANCH_NAME).
- `specs/` is NOT git-excluded in this repo (`.git/info/exclude` has no specs/.specify/.claude entry; `.claude/` is tracked). Artifacts are committable. Decision: commit the artifacts once, after phase 8, as `docs(specs): …`, and stage spec.md/tasks.md with each feat slice as spec-drift requires.
- Story fetched with discussions: no comments. The Build brief is the main source.
- Clarification table: one open item (domains) → Railway's own addresses, from the Build brief's Open section.
- after_specify hooks: notion-sync start (done), design-check (done, no screens), git commit (deferred to after phase 8, see above), agent-context update (deferred to phase 15, where it runs anyway).

## 3. Notion context
- org-researcher: 21 findings (5 decisions, 8 constraints, 4 open, 1 contradiction, 7 proposed clarifications). Backend architecture read through search excerpts only (page too large to fetch).

## 4. Clarify (5 questions, spec-challenger findings matched the digest)
- Q1 How does the skeleton page reach the API's status / does web forward /health/? → web forwards /api/ only; SSR page calls API /health/ready at API_INTERNAL_URL (FR-019, FR-020).
- Q2 Older commit's production approval when a newer one passes staging? → cancelled; staging serialized in commit order (FR-030).
- Q3 Staging health wait? → 5 minutes, then fail (FR-028).
- Q4 Required variables per app? → listed in FR-021; RELEASE_SHA defaults to dev.
- Q5 mcp health? → /health/live only (FR-012, US3-1).
- Also applied from context.md: Prisma and A28 marked "proposed, confirmed in the plan"; backwards-compatible migrations in the api pre-deploy command (FR-028). Versions are left to the plan (current LTS, read from npm at plan time).

## 5. Plan
- before_plan: design-check → design.md current (written 2026-10-04, story unchanged since).
- Versions from npm 2026-10-04: Node 24 LTS, TS ~6.0 (TS 7 excluded by Angular peers), Nx 23.2.1, Angular 22.2.1, NestJS 12, Prisma 7.10.0 (8 is rc).
- No Docker on this machine → decision: install postgresql@17 and redis with Homebrew for local real-server tests; docker-compose.yml still written for the team (R9).
- Railway: deploy by GraphQL (serviceInstanceUpdate + serviceInstanceDeployV2), research agent report; digest refs and preDeployCommand on image services unconfirmed → checked by hand on first deploy.
- Spec edit: FR-032 one root Dockerfile with an APP build argument (Principle I).
- Constitution Check: all pass; Complexity Tracking: empty schema files, railway-deploy.mjs.

## 6. Checklist
- checklists/platform.md: 15 items; 4 failed and were fixed in spec.md (US3-3 503 shape, FR-014 measurable, production migration edge case, FR-034 by-hand checks). 15/15.

## 7. Tasks
- 38 tasks in 9 phases. T007 changed from a project-graph spec to a Biome noRestrictedImports override (Principle I).

## 8. Analyze
- artifact-lint round 1: 3 ERROR (FR-007/008/009 untasked — ranges "FR-006–FR-010" not parsed), 1 WARN (no Spec Delta). Fixed: FRs listed explicitly in T017/T018; Spec Delta added (capability `platform`, Adds FR-001…FR-034); `.specify/capabilities/platform.md` created from the template (empty requirements; archive fills them).
- Round 2: 0 errors, 0 warnings. Manual passes: 0 CRITICAL, 0 HIGH; 100% FR coverage; context contradiction resolved by Q1.

## 9. Tests (red-first)
- Phase 1 scaffold done first so tests have projects to live in: Nx 23.2.1 generators (`--linter none`), generator samples deleted; webpack configs renamed `.cjs` (root package is `"type": "module"`).
- Dependency decisions: generators pinned Angular ~22.1 / Nest 11 / Express 4 → reset to plan versions. `@nx/nest@23.2.1` peers Nest `<12` → removed `@nx/nest` and `@nestjs/schematics` (generators only; builds use @nx/webpack), Nest 12 kept. `npm audit --omit=dev` found 4 high in Prisma CLI transitive deps (mysql2, deepmerge-ts) → npm `overrides` mysql2 3.24.5, deepmerge-ts 8.0.2 → 0 vulnerabilities. Dev-tool highs (Nx, webpack-dev-server) remain; the CI audit is scoped to production dependencies (FR-027 wording updated).
- Homebrew postgresql@17 and redis installed and started (research R9).
- Red: `npx jest libs/contracts libs/domain apps/api apps/mcp apps/web/src` → Test Suites: 7 failed, 7 total (missing modules; seed: 2 tests failed).
- Seams chosen for testability: readEnv(required, env); HealthModule.register({databaseUrl, redisUrl, version}); configureApp(app, env) + AppModule.register(env); mcp createServer(); web mountEdge(app, apiUrl); page reads TransferState key HEALTH. Added state "unknown" when the API did not answer (FR-019 updated).

## 10. Implement
- All 38 tasks done. Commits: feat(api) workspace + health + conventions; feat(web) page + client + edge server; ci(release) images, deploy script, workflows (also carries the ExpressAdapter fix found while reproducing the image steps).
- Findings during implementation, each fixed and verified:
  - Jest needs `--experimental-vm-modules` to load ESM-only Nest 12; set per Nest project (it breaks jest-preset-angular, so not globally).
  - Nx's generated package.json missed `@prisma/client`, `tslib`, `prisma` (runtimeDependencies) and `@nestjs/platform-express` (dynamic import; fixed by using `new ExpressAdapter()` explicitly).
  - Angular 22 SSR rejects unknown hosts → `allowedHosts` from PUBLIC_WEB_URL.
  - `node .` makes Angular's isMainModule false → the web image has its own final stage starting `server/server.mjs`.
  - TS7 rejected by Angular peers; `moduleResolution: node10` deprecated in TS 6 → `bundler` in web spec tsconfig.
- Verified: smoke tests of every built app from an `npm ci --omit=dev` copy of its dist (image steps without Docker); the page renders ok / Redis error / unknown; `prisma migrate deploy` from the api image layout; Playwright e2e 1 passed locally; fresh clone: typecheck, lint, test, build, test:harness all ok.
- Not verifiable here: `docker build` (no Docker), the GitHub workflows and Railway (owner setup) → quickstart.md by-hand table.

## 11. Converge
- Cycle 1: 34 FRs, 5 SCs (buildable: SC-001–SC-003, SC-005), plan decisions R1–R10 and Principles I–VI checked against the code. 1 finding: F1 unrequested/LOW — ci.yml ran on push to main and again via release.yml's workflow_call → T039 appended and done.
- Not appended (outside the spec): the server-rendered page waits as long as the API does if the API hangs (no client-side timeout) → Follow-ups. plan.md still lists `@nx/nest` (removed during implement) → recorded here; converge does not edit plan.md.
- Cycle 2: no further findings.

## 12. Harden
- Mechanical: artifact-lint 3 ERROR (task-phantom-file: T019/T020/T025 name paths that moved — seed lives in libs/domain/src, edge spec in apps/web/src/server) → tasks.md paths corrected. diff-audit: dead exports ApiEnv, APP_ENVS → unexported; `pg`/`@types/pg` removed (come with @prisma/adapter-pg). Kept deliberately: `import-extension` ERRORs (rule assumes nodenext libs from the harness's origin repo; here libs resolve with `bundler`, proven by typecheck + every build), `reqHandler` (loaded by name by @angular/build), suppressions (all inside the generated client), new-dependency (the given stack).
- Mutation: no package has a stryker.config.json, so no floor exists to measure → not run (reported, not waived).
- Jest now loads ESM-only Nest 12 through `.npmrc` `node-options=--experimental-vm-modules` (applies to npm scripts and npx, so the stop gate and post-edit gate run the Nest suites too); web jest config no longer transforms node_modules (`.mjs` loads natively).
- test-adversary: 134 tests in 6 files; 9 failing → 7 defects fixed (readEnv read Object.prototype names; mcp health with a query string; edge left upstream open when the browser left and hung when the API broke off; deploy restored only the failing service and nothing on a polling error), 1 test-fixture fix (nested DTO needed @IsObject), 1 spec gap closed (request id bounded to 128 safe chars; API 404s outside the prefix as problem details).
- code-reviewer BLOCK: 12 findings. Fixed: Dockerfile `npm ci` ran `prepare` before .husky existed (exit 127 — no image could build) → `--ignore-scripts` + `prisma generate`, replayed on a git-less copy: 4/4 builds; deploy script's own 5-min clock raced Railway's health check → Railway's 300 s check decides, script keeps a 20-min safety limit; Railway calls get a 30 s timeout and an HTTP status check (new test); a failed restore no longer hides the original error; unused generator targets (prune*, copy-workspace-modules, serve-static) and packages (@nx/web, @angular/cli, @angular/language-service) removed; allowedHosts falls back to NG_ALLOWED_HOSTS; hydration event replay and global error listeners removed. Not taken: TODO on CODE_BY_STATUS (codes are added with the first endpoint that needs them; a TODO adds nothing).
- Repair laps: 2.
- The first `git commit` of the harden pass failed in the pre-commit hook; an immediate re-run of the hook and three full `nx run-many -t test --skip-nx-cache` runs were all green, and the retried commit passed. The failing step was not captured (output truncated) → recorded as an unexplained intermittent failure.

## 13. Ticket refresh
- org-researcher refresh: no changes since the digest; story has 0 comments; status In progress at the time. The FR-020 contradiction it re-lists was resolved in phase 4 (spec now forwards /api/ only, as Notion says).

## 14. Review
- notion-sync review: ST-421 → In review. design.md present.
- code-reviewer re-review: all 10 earlier fixes verified; 4 new → fixed 3 (mcp crashed on a request line `new URL` rejects → split on `?`, raw-socket test added; rollback redeploy was untested → assertion added and proven to fail with the line removed; deprecated `aborted` event → `close` + `complete`); declined 1 (env-var knob for the 20-min safety limit: nothing sets it, Principle I).
- spec-reviewer: APPROVE. LOWs fixed: FR-011 row now "inspection"; T011/T020 wording matched to delivery; unused `@nx/node` removed; 3 by-hand rows added (production approval cancellation, docker build, reset staging); page title `MotorFix`. MEDIUM left to the owner: whether the `*.adversary.spec.ts` suites stay as a standing layer or get folded into the primary specs.
- Repair laps: 3 of 5.
