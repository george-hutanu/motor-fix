# Quickstart: Notion client keeps to Notion's API limits

Everything is proved offline with injected `fetchImpl`, `sleep`, `now` and
`random`; no Notion token or network is needed.

## Prerequisites

- Node ≥ 24 (`package.json` engines), `npm ci` done once.

## Run

```sh
npm run test:harness > /tmp/harness.log 2>&1; echo "exit $?"; tail -n 20 /tmp/harness.log
```

Expected: exit 0; the suites `.claude/scripts/lib/notion.spec.mjs`,
`.claude/scripts/notion-sync.spec.mjs` and `.claude/scripts/level.spec.mjs`
pass, including the new cases:

| Scenario (spec) | What the test reads |
| --- | --- |
| US1-1 burst of 10 | 3 requests before any `sleep`; recorded sleeps sum ≥ 7/3 s |
| US1-2/3 429 `Retry-After: 2`, 503 without | one sleep of 2,000 ms; one sleep in [500, 1000] ms for attempt 0, with `random` fixed |
| US1-4/5 caps | `maxRetries: 1` → second 503 is `NotionError` `503 …`; `Retry-After` above `maxWaitS` → no sleep, error; backoff above the cap → sleep of `maxWaitS · 1000` |
| US1-6 timeout | `GET` sent twice; `POST` sent once, `timeout` surfaces |
| US2-1/2/4 `writeProp` | 5,000 chars → 3 objects (2,000, 2,000, 1,000); > 200,000 chars → `text too long`; 101 ids → `relation too long`, 100 ids sent |
| US2-3 comment | 3,000-char body → `rich_text` objects ≤ 2,000 each; ≤ 2,000 → `markdown` |
| US2-5 `appendChildren` | 250 children → 3 `PATCH` bodies of 100, 100, 50 |
| US2-6 body | 600 KB body → `body too large`, `fetchImpl` never called |
| US3 paging | each query page body has `page_size: 100`; `level` reads `?page_size=100` |

Then:

```sh
node .claude/scripts/doctor.mjs
```

Expected: no drift named (the changed files are not hook scripts; bless only
after reading a diff it names).

## Edge cases to keep green

- `NOTION_SYNC_MAX_RETRIES=0`: no retry, first failing answer surfaces.
- `NOTION_SYNC_MAX_WAIT_S=0`: retries happen with no `sleep` call.
- A surrogate pair at a 2,000 boundary is not cut (`Array.from` split).
