# Data Model: Shared apps/api integration boot helper

No persisted entity changes: the API's schema, routes and contracts stay as they are (FR-006). The only model is the in-memory state of one boot handle, which FR-002's teardown rules are written against.

## Boot handle (`apiBoot()` in `apps/api/src/api-boot.testing.ts`)

Created once per spec file at module scope. Holds, for that file:

| Field | Set by | Cleared by |
| --- | --- | --- |
| `env` (the test environment values the suites use today: `APP_ENV`, `AUTH_TOKEN_SECRET`, `DATABASE_URL`, `REDIS_URL`, `RELEASE_SHA`) | the factory | never (constants) |
| `turn` (`databaseTurn(env.DATABASE_URL)`) | the factory | `stop()` releases it, always |
| `store` (`new S3TestStore()`) and `storeStarted` | the factory; `storeStarted` by `start()` once `store.start()` resolved | `stop()` stops the store when `storeStarted` |
| `app` (`INestApplication`) | `start()` once `createNestApplication` returned, before `init()` | `stop()` closes it when set |

## Stages of `start()` and what `stop()` owes after each

`start()` runs, in order: take the turn, start the store, read the configuration, compile the testing module, create the app, configure it, `init()` it, return it.

| `start()` stopped at | Turn | Store | App |
| --- | --- | --- | --- |
| never called, or threw taking the turn | release (harmless on an untaken turn) | nothing | nothing |
| threw starting the store | release | nothing (never listened) | nothing |
| threw reading the configuration or compiling the module | release | stop | nothing |
| threw in `init()` | release | stop | close (the app exists) |
| returned | release | stop | close |

Order of the closes in `stop()`: app, store, turn. Every close is attempted; the first rejection is kept and rethrown after the turn is released.
