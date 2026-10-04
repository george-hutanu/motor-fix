**Agent review: success** — PR #12 at `20986d5`, lap 1

Blocking: 0 (blocker 0, high 0) · medium 4 · low 4. Booted: postgres, redis, api, web, worker.
- No Docker on this machine: private PostgreSQL and Redis on free ports, no object store.
- No changed GET endpoint without path parameters.

| # | Severity | Finding | Where | Evidence |
| --- | --- | --- | --- | --- |
| 1 | medium | api readiness: storage down |  |  |
| 2 | medium | worker readiness: storage down |  |  |
| 3 | medium (pre-existing) | Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 4 | medium (pre-existing) | Accessibility (moderate): region — All page content should be contained by landmarks (2 elements) | / · desktop · light · ro (+11 more) | shots/home-desktop-light-ro.png |
| 5 | low | Affected tests were replayed from the Nx local cache, not re-run against this run's database | nx affected -t test (domain, api, worker) | logs/affected-tests.log |
| 6 | low | tasks.md names test files that do not exist (auth.api.spec.ts, auth.adversary.http.spec.ts, accounts.service.spec.ts) | specs/390-audit-history/tasks.md:21,57 |  |
| 7 | low | Coverage check counts $executeRaw only; a write through $queryRaw / $queryRawUnsafe slips past FR-014 | libs/domain/src/audit/audit-coverage.spec.ts:17 |  |
| 8 | low | recordChanges writes an entry with both values SQL NULL when a field goes from absent to null | libs/domain/src/audit/audit.service.ts:70 |  |

### Reproduction
1. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
2. No object store on this machine (no Docker); every other check is ok. Environment limit, not the change.
3. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule landmark-one-main on html. → Observe: Accessibility (moderate): landmark-one-main — Document should have one main landmark (1 element).
4. Open / at the desktop viewport (1440×900), light colour scheme, language ro. → Run axe-core on the page: rule region on p:nth-child(2). → Observe: Accessibility (moderate): region — All page content should be contained by landmarks (2 elements).
5. In the PR worktree: npx nx affected -t test --base=060b9ac --head=20986d5 --parallel=1 → Observe: '[local cache]' for domain:test, api:test, worker:test (3/3 hit). The PostgreSQL-backed integration specs passed on an earlier run with identical inputs; the database is not an Nx input. The tester's own psql flows covered the append-only triggers, rollback, ordering and indexes live.
6. T005 says `libs/domain/src/auth/auth.api.spec.ts` and `libs/domain/src/auth/auth.adversary.http.spec.ts`; the FR-013 row says `accounts.service.spec.ts`. → The files changed are `auth.api.integration.spec.ts`, `auth.adversary.http.integration.spec.ts`, `accounts.service.integration.spec.ts`. The trace stays readable but the paths are wrong.
7. `const RAW_WRITES = new Set(['$executeRaw', '$executeRawUnsafe']);` → A service method doing `this.prisma.$queryRaw`UPDATE job SET ... RETURNING *`` without `this.audit` is not named. Matches the clarification's 'raw execute' wording, so a smell, not a missed requirement.
8. recordChanges(tx, change, {}, { note: null }): canonical(undefined) !== canonical(null), so an `update` entry is written; json() maps both undefined and null to Prisma.DbNull. → The stored row shows old NULL -> new NULL, indistinguishable from no change. Spec-consistent (absent is compared as absent) but the entry carries no information.

Screenshots: 24, one per route × viewport × scheme × language.
